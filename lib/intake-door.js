'use strict';

// LEX atua como assessor do escritório: acolhe, pergunta, organiza e prepara.
// Ele não substitui o advogado, não assume compromissos e não envia conteúdo jurídico
// ou posição do escritório sem autorização expressa do Dr. Kleuber.
const INTRO = 'Olá, meu nome é LEX. Sou o assistente virtual do escritório LEX Jurídico e trabalho sob orientação do Dr. Kleuber. Em que posso te ajudar?';
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const PREAUTHORIZED_KINDS = new Set(['greeting','identity','consent','ack','identify']);
const OWNER_ONLY_KINDS = new Set(['lawyer','sensitive','urgent','existing_case','pericia']);

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

function authorityFor(kind) {
  if (PREAUTHORIZED_KINDS.has(kind)) return {mode:'preauthorized', requiresApproval:false, canDecide:false};
  if (OWNER_ONLY_KINDS.has(kind)) return {mode:'owner_approval', requiresApproval:true, canDecide:false};
  return {mode:'assessor_intake', requiresApproval:true, canDecide:false};
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
    greeting: firstContact ? INTRO : (name ? 'Oi, ' + name + '. Em que posso te ajudar?' : 'Olá! Em que posso te ajudar?'),
    identity: firstContact ? INTRO : (name ? 'Meu nome é LEX, ' + name + '. Trabalho no escritório LEX Jurídico e estou acompanhando seu atendimento. Em que posso te ajudar?' : 'Meu nome é LEX. Trabalho no escritório LEX Jurídico e estou acompanhando seu atendimento. Em que posso te ajudar?'),
    lawyer: prefix + 'entendi. Vou levar seu pedido ao Dr. Kleuber e aguardar a orientação dele antes de te dar uma posição.' + identify,
    sensitive: prefix + 'entendi o ponto. Como assessor, posso organizar as informações, mas não decido nem assumo posição pelo escritório. Vou submeter isso ao Dr. Kleuber antes de responder.' + identify,
    urgent: prefix + 'entendi a urgência. Vou sinalizar isso imediatamente ao Dr. Kleuber e aguardar a orientação dele antes de te passar qualquer posição.' + identify,
    existing_case: name ? name + ', posso organizar os dados do processo, mas não vou te passar andamento, prazo ou orientação sem autorização do Dr. Kleuber. Me informe o número do processo ou, se não tiver, me diga do que se trata.' : 'Posso organizar os dados do processo, mas não vou te passar andamento, prazo ou orientação sem autorização do Dr. Kleuber. Me diga seu nome e, se tiver, o número do processo.',
    pericia: prefix + 'posso receber e organizar o material para o setor de perícia. Cálculo, conclusão ou valor só serão apresentados após revisão e autorização do Dr. Kleuber.' + identify,
    media: prefix + 'recebi sua mensagem sobre documentos. Posso organizar o material para conferência, mas o recebimento não significa análise ou aprovação do conteúdo.' + identify,
    administrative: prefix + 'recebi o contato administrativo. Vou organizar as informações e submeter ao Dr. Kleuber antes de assumir qualquer compromisso pelo escritório.' + identify,
    new_case: prefix + 'posso organizar seu pedido de atendimento e preparar as informações para o Dr. Kleuber.' + (name ? ' Me conte o que aconteceu e o que você precisa.' : ' Me diga seu nome e, em poucas palavras, o que aconteceu.'),
    consent: 'Entendi seu consentimento para o atendimento. Esse consentimento não autoriza decisões sobre o caso nem me permite assumir posição pelo escritório. Em que posso te ajudar?',
    ack: 'Por nada. Continuo à disposição para organizar o que você precisar.',
    identify: 'Prazer, ' + name + '. Me conte o que você precisa do escritório.',
    general: name ? name + ', pode me contar os fatos. Vou organizar seu relato e, antes de qualquer orientação ou posição do escritório, submeto ao Dr. Kleuber.' : 'Pode me contar o que aconteceu. Vou organizar seu relato para o Dr. Kleuber; antes de qualquer orientação ou posição do escritório, preciso da autorização dele.',
    audio_unread: 'Recebi seu áudio, mas não consegui ouvi-lo com segurança. Pode escrever a mensagem ou reenviar o áudio?'
  };
  let reply = replies[kind];
  if (reply) reply = reply[0].toUpperCase()+reply.slice(1);
  if (reply === context.lastReply && !['ack'].includes(kind)) {
    reply = name ? name + ', entendi. Pode me passar o próximo fato ou documento; eu organizo e submeto ao Dr. Kleuber antes de qualquer posição.' : 'Entendi. Pode me passar o próximo fato ou documento; eu organizo e submeto ao Dr. Kleuber antes de qualquer posição.';
  }
  const destino = ({new_case:'cadastro',media:'instrucao',existing_case:'andamento',pericia:'pericia'})[kind] || 'recepcao';
  const authority = authorityFor(kind);
  return {
    kind,
    destino,
    name,
    reply,
    archive:false,
    escalate:OWNER_ONLY_KINDS.has(kind),
    requiresApproval:authority.requiresApproval,
    authorityMode:authority.mode,
    canDecide:false,
    automaticScope:'recepcao_e_coleta',
    ownerRule:'LEX pode acolher, perguntar, organizar e preparar. Não pode orientar juridicamente, decidir, negociar, prometer, concluir perícia ou assumir posição do escritório sem autorização do Dr. Kleuber.'
  };
}

module.exports = {INTRO, classify, extractName, intakeContext, intakeDecision, authorityFor};
