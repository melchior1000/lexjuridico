'use strict';

// A porta apenas acolhe e organiza o pedido. Não consulta autos, calcula ou executa tarefas.
// Somente estas falas de recepção são automáticas; conteúdo do caso exige o dono.
const OWNER_LABEL = 'analista jurídico Kleuber';
const INTRO = 'Sou o LEX, assistente virtual do escritório LEX Jurídico e trabalho com o analista jurídico Kleuber. O que você precisa? Se quiser, me diga seu nome ou empresa.';
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function classify(text, data = {}) {
  const n = normalize(text);
  const m = data.message || {};
  if (/\b(urgente|prisao|preso|mandado|liminar)\b|(?:audiencia|prazo|vence) (?:hoje|amanha)/.test(n)) return 'urgent';
  if (/(?:falar|conversar|contato|chamar|chame|chama|falo|fale).*\b(kleuber|advogado|doutor|responsavel|analista)\b|\b(kleuber|doutor|advogado|analista) (?:esta|ta|pode|disponivel)|me passa o advogado/.test(n)) return 'lawyer';
  if (/\b(quero|gostaria|vim|posso)\s+(?:vender|oferecer|apresentar)\b|\b(vender|oferecer)\s+(?:um|uma|meu|minha|produto|servico)|\b(proposta comercial|representante comercial|vendedor|fornecedor comercial)\b/.test(n)) return 'vendor';
  if (/\b(acordo|honorarios?|estrategia|indenizacao)\b|quanto.*(?:ganho|recebo|pagar)|valor (?:do|de) processo/.test(n)) return 'sensitive';
  if (/\b(pericia|pericial|laudo|calculo|calcular|juros)\b/.test(n)) return 'pericia';
  if (/\b(processo|andamento|sentenca|recurso|peticao|audiencia)\b|meu caso|prazo do/.test(n)) return 'existing_case';
  if (/\b(documentos?|comprovante|procuracao|contrato)\b|\b(rg|cpf)\b/.test(n) || m.documentMessage || m.imageMessage) return 'media';
  if (m.audioMessage) return 'audio_unread';
  if (/\b(cobranca|vivo|claro|tim|operadora|fornecedor|financeiro|boleto|fatura|nota fiscal|nfe)\b/.test(n)) return 'administrative';
  if (/trabalhist|demissao|demitid|rescisao|horas extras|empresa nao pagou|quero processar|entrar com acao|preciso de advogado|cadastro|cadastrar/.test(n)) return 'new_case';
  if (/quem (?:e|eh|fala)|de quem|(?:esse|este) numero|seu nome/.test(n)) return 'identity';
  if (/^(?:sim[, ]*)?autorizo[.! ]*$|^consinto[.! ]*$/.test(n.trim())) return 'consent';
  if (/^(?:oi|ola|bom dia|boa tarde|boa noite|opa|alo)(?:[!. ,|]+(?:tudo bem|como vai))?[!. ,|]*$/.test(n.trim())) return 'greeting';
  if (/^(?:obrigad[oa]|valeu|ok|certo|entendi)[!. ]*$/.test(n.trim())) return 'ack';
  return 'general';
}

function extractName(text, expected = false) {
  const raw = String(text || '').trim();
  const explicit = raw.match(/^(?:meu nome [ée]\s+|me chamo\s+|sou\s+(?:o\s+|a\s+)?)([\p{L}][\p{L}' -]{1,70})(?:[,.!]|$)/iu);
  const candidate = (explicit ? explicit[1] : expected ? raw : '').trim();
  if (!/^[\p{L}][\p{L}' -]{1,70}$/u.test(candidate)) return null;
  if (/\b(quero|preciso|gostaria|ajuda|informacao|autorizo|sim|nao|processo|ola|oi|falar|sou|meu|nome|pericia|obrigado|obrigada|ok|certo|tudo|tenho|urgente|retorno|aguardando|produto|servico|vender|oferecer|carro)\b/.test(normalize(candidate))) return null;
  const words = candidate.split(/\s+/);
  if ((!explicit && !expected && words.length < 2) || words.length > 6) return null;
  return candidate;
}

function chronological(history = []) { return [...history].reverse(); }

function intakeContext(history = []) {
  let name = null, subject = null, lastReply = '';
  for (const event of chronological(history)) {
    if (event.direcao === 'saida_lex') { lastReply = String(event.texto || ''); continue; }
    if (event.direcao !== 'entrada') continue;
    const text = String(event.texto || '').replace(/^\[Áudio transcrito\] /, '');
    const kind = classify(text);
    const found = extractName(text, /(?:diga|informe|qual).*nome|nome ou empresa/i.test(lastReply));
    if (found && kind === 'general') name = found;
    if (!['greeting','identity','consent','ack','general'].includes(kind)) subject = kind;
  }
  return {name, subject, lastReply};
}

function vendorContext(history = []) {
  const events=chronological(history);
  const inputs=events.filter(e=>e.direcao==='entrada').map(e=>String(e.texto||'').trim()).filter(Boolean);
  const replies=events.filter(e=>e.direcao==='saida_lex').map(e=>String(e.texto||''));
  const started=inputs.some(t=>classify(t)==='vendor');
  const askedName=replies.some(t=>/qual (?:é )?seu nome|nome ou empresa/i.test(t));
  const askedOffer=replies.some(t=>/o que você quer oferecer|qual produto|qual serviço/i.test(t));
  const askedPrice=replies.some(t=>/qual (?:é )?o valor|valor da proposta/i.test(t));
  const product=inputs.find((t,i)=>started && i>inputs.findIndex(x=>classify(x)==='vendor') && !/^\p{L}+(?:\s+\p{L}+){0,5}$/u.test(t) && !/(?:r\$|\d+[\d.,]*\s*(?:mil|milhao|milhões)?)/i.test(t)) || null;
  const price=inputs.find(t=>/(?:r\$|\b\d+[\d.,]*\s*(?:mil|milhao|milhões)\b)/i.test(normalize(t))) || null;
  return {started,askedName,askedOffer,askedPrice,product,price};
}

function intakeDecision(text, data = {}, history = []) {
  const context = intakeContext(history);
  const vendor = vendorContext(history);
  let kind = classify(text, data);
  const expectingName=/(?:diga|informe|qual).*nome|nome ou empresa/i.test(context.lastReply);
  const found = kind === 'general' ? extractName(text, expectingName) : null;
  const name = found || context.name;
  if (found) kind = context.subject || 'identify';
  else if (kind === 'general' && context.subject) kind = context.subject;
  const prefix = name ? name + ', ' : '';
  const identify = name ? '' : ' Me diga seu nome para eu identificar seu pedido.';
  const firstContact = history.length === 0;
  let vendorReply='';
  if(kind==='vendor') {
    const current=String(text||'').trim();
    const currentPrice=/(?:r\$|\b\d+[\d.,]*\s*(?:mil|milhao|milhões)\b)/i.test(normalize(current));
    if(!name) vendorReply='Claro. Qual é seu nome ou empresa?';
    else if(found || (!vendor.askedOffer && !vendor.product)) vendorReply=name+', o que você quer oferecer ao escritório?';
    else if(!vendor.price && !currentPrice) vendorReply=name+', entendi a oferta. Qual é o valor da proposta?';
    else vendorReply=name+', obrigado. Registrei sua proposta comercial e vou deixá-la na mesa do '+OWNER_LABEL+'. Se houver interesse, o escritório retorna por este número.';
  }
  const replies = {
    greeting: firstContact ? INTRO : (name ? 'Oi, ' + name + '. Como posso ajudar?' : 'Olá! Como posso ajudar?'),
    identity: firstContact ? INTRO : (name ? 'Sou o LEX, ' + name + '. Já estou acompanhando seu atendimento por aqui. O que você precisa?' : 'Sou o LEX. Já estou acompanhando seu atendimento por aqui. O que você precisa?'),
    lawyer: prefix + 'você quer falar com o '+OWNER_LABEL+'. Vou encaminhar seu pedido a ele.' + identify,
    sensitive: prefix + 'esse assunto depende da análise e autorização do '+OWNER_LABEL+'. Vou levar seu pedido a ele.' + identify,
    urgent: prefix + 'entendi a urgência. Vou encaminhar seu relato ao '+OWNER_LABEL+' com prioridade.' + identify,
    existing_case: name ? name + ', por segurança, os dados do processo dependem da autorização do '+OWNER_LABEL+'. Você tem o número do processo ou prefere me dizer do que se trata?' : 'Certo. Por segurança, os dados do processo dependem da autorização do '+OWNER_LABEL+'. Me diga seu nome e, se tiver, o número do processo. Se não tiver, pode me dizer do que se trata.',
    pericia: prefix + 'a leitura e os cálculos cabem ao setor de perícia, com revisão do '+OWNER_LABEL+'. Vou encaminhar seu pedido, sem antecipar valores.' + identify,
    media: prefix + 'recebi sua mensagem sobre documentos. Vou encaminhá-la para conferência; o recebimento não confirma a leitura nem a análise do arquivo.' + identify,
    administrative: prefix + 'recebi o contato administrativo. Vou encaminhá-lo ao '+OWNER_LABEL+' para avaliação.' + identify,
    vendor: vendorReply,
    new_case: prefix + 'posso organizar seu pedido de atendimento para o '+OWNER_LABEL+'.' + (name ? ' Conte o que aconteceu e o que você precisa.' : ' Me diga seu nome e, em poucas palavras, o que aconteceu.'),
    consent: 'Entendi sua mensagem de consentimento. Isso não autoriza decisões sobre o caso nem o envio de orientações. Como posso ajudar no atendimento?',
    ack: 'Por nada. Continuo à disposição por aqui.',
    identify: 'Prazer, ' + name + '. O que você precisa do escritório?',
    general: name ? name + ', vou encaminhar seu relato ao '+OWNER_LABEL+'. Há algum detalhe que você queira acrescentar?' : 'Posso organizar seu pedido para o '+OWNER_LABEL+'. Me diga seu nome e o que você precisa.',
    audio_unread: 'Recebi seu áudio, mas não consegui ouvi-lo com segurança. Pode escrever a mensagem ou reenviar o áudio?'
  };
  let reply = replies[kind];
  if (reply) reply = reply[0].toUpperCase()+reply.slice(1);
  if (reply === context.lastReply && !['ack'].includes(kind)) {
    reply = name ? name + ', entendi. Me conte o próximo ponto para eu continuar daqui.' : 'Entendi. Me conte o próximo ponto para eu continuar daqui.';
  }
  const destino = ({new_case:'cadastro',media:'instrucao',existing_case:'andamento',pericia:'pericia',vendor:'comercial'})[kind] || 'recepcao';
  const requiresApproval = !['greeting','identity','consent','ack','identify'].includes(kind);
  return {kind, destino, name, reply, archive:false, escalate:['lawyer','sensitive','urgent','existing_case','pericia'].includes(kind), requiresApproval, automaticScope:'recepcao'};
}

module.exports = {INTRO, classify, extractName, intakeContext, intakeDecision};
