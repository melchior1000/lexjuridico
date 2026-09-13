'use strict';

// A porta apenas acolhe e organiza o pedido. Não consulta autos, calcula ou executa tarefas.
// Somente estas falas de recepção são automáticas; conteúdo do caso exige o dono.
const INTRO = 'Sou o LEX, assistente virtual do escritório LEX Jurídico e trabalho sob orientação do Dr. Kleuber. O que você precisa? Se quiser, me diga seu nome ou empresa.';
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function classify(text, data = {}) {
  const n = normalize(text);
  const m = data.message || {};
  if (/\b(urgente|prisao|preso|mandado|liminar)\b|(?:audiencia|prazo|vence) (?:hoje|amanha)/.test(n)) return 'urgent';
  if (/(?:falar|conversar|contato|chamar|chame|chama|falo|fale).*\b(kleuber|advogado|doutor|responsavel)\b|\b(kleuber|doutor|advogado) (?:esta|ta|pode|disponivel)|me passa o advogado/.test(n)) return 'lawyer';
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
  if (/\b(quero|preciso|gostaria|ajuda|informacao|autorizo|sim|nao|processo|ola|oi|falar|sou|meu|nome|pericia|obrigado|obrigada|ok|certo|tudo|tenho|urgente|retorno|aguardando)\b/.test(normalize(candidate))) return null;
  const words = candidate.split(/\s+/);
  if ((!explicit && words.length < 2) || words.length > 6) return null;
  return candidate;
}

function intakeContext(history = []) {
  let name = null, subject = null, lastReply = '';
  for (const event of [...history].reverse()) {
    if (event.direcao === 'saida_lex') { lastReply = String(event.texto || ''); continue; }
    if (event.direcao !== 'entrada') continue;
    const text = String(event.texto || '').replace(/^\[Áudio transcrito\] /, '');
    const kind = classify(text);
    const found = extractName(text, /(?:diga|informe).*nome|qual.*nome|nome ou empresa/i.test(lastReply));
    if (found && kind === 'general') name = found;
    if (!['greeting','identity','consent','ack','general'].includes(kind)) subject = kind;
  }
  return {name, subject, lastReply};
}

function intakeDecision(text, data = {}, history = []) {
  const context = intakeContext(history);
  let kind = classify(text, data);
  const found = kind === 'general' ? extractName(text, /(?:diga|informe).*nome|qual.*nome|nome ou empresa/i.test(context.lastReply)) : null;
  const name = found || context.name;
  if (found) kind = context.subject || 'identify';
  else if (kind === 'general' && context.subject) kind = context.subject;
  const prefix = name ? name + ', ' : '';
  const identify = name ? '' : ' Me diga seu nome para eu identificar seu pedido.';
  const firstContact = history.length === 0;
  const replies = {
    greeting: firstContact ? INTRO : (name ? 'Oi, ' + name + '. Como posso ajudar?' : 'Olá! Como posso ajudar?'),
    identity: firstContact ? INTRO : (name ? 'Sou o LEX, ' + name + '. Já estou acompanhando seu atendimento por aqui. O que você precisa?' : 'Sou o LEX. Já estou acompanhando seu atendimento por aqui. O que você precisa?'),
    lawyer: prefix + 'você quer falar com o Dr. Kleuber. Vou encaminhar seu pedido a ele.' + identify,
    sensitive: prefix + 'esse assunto depende da análise e autorização do Dr. Kleuber. Vou levar seu pedido a ele.' + identify,
    urgent: prefix + 'entendi a urgência. Vou encaminhar seu relato ao Dr. Kleuber com prioridade.' + identify,
    existing_case: name ? name + ', por segurança, os dados do processo dependem da autorização do Dr. Kleuber. Você tem o número do processo ou prefere me dizer do que se trata?' : 'Certo. Por segurança, os dados do processo dependem da autorização do Dr. Kleuber. Me diga seu nome e, se tiver, o número do processo. Se não tiver, pode me dizer do que se trata.',
    pericia: prefix + 'a leitura e os cálculos cabem ao setor de perícia, com revisão do Dr. Kleuber. Vou encaminhar seu pedido, sem antecipar valores.' + identify,
    media: prefix + 'recebi sua mensagem sobre documentos. Vou encaminhá-la para conferência; o recebimento não confirma a leitura nem a análise do arquivo.' + identify,
    administrative: prefix + 'recebi o contato administrativo. Vou encaminhá-lo ao Dr. Kleuber para avaliação.' + identify,
    new_case: prefix + 'posso organizar seu pedido de atendimento para o Dr. Kleuber.' + (name ? ' Conte o que aconteceu e o que você precisa.' : ' Me diga seu nome e, em poucas palavras, o que aconteceu.'),
    consent: 'Entendi sua mensagem de consentimento. Isso não autoriza decisões sobre o caso nem o envio de orientações. Como posso ajudar no atendimento?',
    ack: 'Por nada. Continuo à disposição por aqui.',
    identify: 'Prazer, ' + name + '. O que você precisa do escritório?',
    general: name ? name + ', vou encaminhar seu relato ao Dr. Kleuber. Há algum detalhe que você queira acrescentar?' : 'Posso organizar seu pedido para o Dr. Kleuber. Me diga seu nome e o que você precisa.',
    audio_unread: 'Recebi seu áudio, mas não consegui ouvi-lo com segurança. Pode escrever a mensagem ou reenviar o áudio?'
  };
  let reply = replies[kind];
  if (reply) reply = reply[0].toUpperCase()+reply.slice(1);
  if (reply === context.lastReply && !['ack'].includes(kind)) {
    reply = name ? name + ', entendi. Me conte o próximo ponto para eu continuar daqui.' : 'Entendi. Me conte o próximo ponto para eu continuar daqui.';
  }
  const destino = ({new_case:'cadastro',media:'instrucao',existing_case:'andamento',pericia:'pericia'})[kind] || 'recepcao';
  const requiresApproval = !['greeting','identity','consent','ack','identify'].includes(kind);
  return {kind, destino, name, reply, archive:false, escalate:['lawyer','sensitive','urgent','existing_case','pericia'].includes(kind), requiresApproval, automaticScope:'recepcao'};
}

module.exports = {INTRO, classify, extractName, intakeContext, intakeDecision};
