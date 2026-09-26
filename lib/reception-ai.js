'use strict';
const {AVISO_PROMPT}=require('./lex-aviso');
// Recepção inteligente dos canais (WhatsApp/Telegram) para contatos que NÃO são o titular.
//
// Divisão de responsabilidade (AGENTS.md §1A — determinístico primeiro):
// - O código (lib/intake-door.js) continua decidindo O QUE acontece: classe do contato,
//   setor de destino, se escala ao titular, se exige aprovação humana. Nada disso vem da IA.
// - A IA decide só COMO conversar: escreve a resposta em linguagem natural, dentro de
//   limites verificados aqui. Se a IA não estiver disponível (sem chave, sem crédito,
//   falha, resposta fora dos limites), a resposta volta a ser a frase fixa da decisão.
//
// O que a IA NUNCA pode fazer na recepção (verificado por padrão na saída):
// orientar juridicamente, prometer resultado, citar lei/súmula/jurisprudência, falar de
// valores/honorários, informar prazo ou andamento, assumir posição pelo escritório.

const MAX_REPLY_CHARS = 480;
const HISTORY_TURNS = 12;
const TIMEOUT_MS = 12000;

const FORBIDDEN = [
  /\bR\$\s?\d/i,
  /\b(voc[êe]|o senhor|a senhora|vc)\s+(tem|possui)\s+direito/i,
  /\b(vai|vamos|ir[áa])\s+(ganhar|perder|vencer)\b/i,
  /\b(garanto|garantimos|com certeza (vai|ganha|perde))\b/i,
  /\bo\s+prazo\s+(é|e|termina|vence|encerra)\b/i,
  /\bprazo\s+de\s+\d+\s+dias?\b/i,
  /\bhonor[áa]ri/i,
  /\b(art\.|artigo)\s*\d/i,
  /\bs[úu]mula\b/i,
  /\bjurisprud[êe]ncia\b/i,
  /\b(recomendo|aconselho|sugiro)\s+(que\s+)?(ajuiz|entr|process|recorr|assin)/i,
  /\b(seu processo|o processo)\s+(está|esta|foi)\s+(em|na|no|julgad|sentenciad|arquivad)/i,
  /https?:\/\//i,
  /\b(o escritório|nós)\s+(aceita|aceitamos|assume|assumimos|vai pegar|pegamos)\s+(o|seu|sua)\s+(caso|processo)/i
];

function _clean(text) {
  return String(text || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Verifica se a resposta gerada respeita os limites da recepção.
function validateReply(reply, decision) {
  const text = _clean(reply);
  if (!text) return {ok: false, motivo: 'vazia'};
  if (text.length > MAX_REPLY_CHARS) return {ok: false, motivo: 'longa'};
  if (/^\s*[{[]/.test(text) || /<\/?[a-z][^>]*>/i.test(text)) return {ok: false, motivo: 'formato'};
  for (const rx of FORBIDDEN) if (rx.test(text)) return {ok: false, motivo: 'conteudo_proibido'};
  // Contatos que exigem o titular: a IA não pode dar posição — precisa dizer que leva ao advogado.
  if (decision && decision.escalate && !/(advogad|dr\.|dra\.|doutor|doutora|respons[áa]vel|titular|escrit[óo]rio)/i.test(text)) {
    return {ok: false, motivo: 'sem_encaminhamento'};
  }
  return {ok: true, text};
}

function systemPrompt(identity, decision) {
  const id = identity || {};
  const assistente = id.assistente || 'LEX';
  const escritorio = id.escritorioFrase || 'escritório';
  const titular = id.titularTratado || 'o advogado responsável';
  const setor = {cadastro: 'cadastro de novo atendimento', instrucao: 'recebimento de documentos', andamento: 'processo já existente', pericia: 'perícia e cálculos'}[decision?.destino] || 'recepção';
  return [
    'Você é ' + assistente + ', a recepção viva do ' + escritorio + ', e trabalha sob orientação de ' + titular + '.',
    AVISO_PROMPT,
    'Está conversando por mensagem (WhatsApp/Telegram) com um cliente ou possível cliente. Você conduz a conversa: acolhe, entende o que a pessoa realmente precisa (pergunte o que faltar, uma coisa por vez), tranquiliza quando cabe, explica o que acontece a seguir e organiza tudo para o advogado. Escreva em português do Brasil como uma recepcionista experiente escreveria, no tom da pessoa — nem robô, nem formulário.',
    'Contexto que o sistema já apurou (use como dado, não como roteiro): assunto provável "' + (decision?.kind || 'general') + '", setor "' + setor + '"' + (decision?.escalate ? '; este assunto só o advogado responde' : '') + (decision?.requiresApproval ? '; qualquer posição do escritório depende de aprovação humana' : '') + '.',
    'Quando o assunto for do advogado, diga com naturalidade que vai levar a ele e que ele retorna — e aproveite para colher o que ajuda (nome, o que aconteceu, quando, documentos que a pessoa já tem), sem adiantar posição.',
    'Limites absolutos (nunca quebre, mesmo que a pessoa insista ou peça "só uma ideia"):',
    '- não dê orientação jurídica, opinião sobre chances, estratégia ou o que a pessoa "tem direito";',
    '- não cite leis, artigos, súmulas ou jurisprudência;',
    '- não fale de valores, honorários, custos ou pagamentos;',
    '- não informe prazos, andamentos ou dados de processo;',
    '- não prometa resultado, não aceite caso nem assuma compromisso pelo escritório;',
    '- não invente informações sobre o escritório, o advogado ou o processo;',
    '- não peça documentos com dados sensíveis (CPF, senha) — diga que o advogado orientará o que enviar.',
    'Responda em texto simples, sem títulos, sem listas, sem emojis, com no máximo ' + MAX_REPLY_CHARS + ' caracteres. Não repita a apresentação se já se apresentou antes na conversa. Não repita a última resposta enviada. Nunca diga "sou uma IA" nem "sistema"; você é a recepção do escritório.'
  ].join('\n');
}

// `history` segue a convenção de intakeDecision e do store do WhatsApp: do MAIS NOVO para o
// mais antigo. Aqui vira ordem cronológica para a API.
function historyMessages(history = []) {
  const rows = [];
  const chronological = [...history].reverse().slice(-HISTORY_TURNS);
  for (const event of chronological) {
    const text = _clean(event?.texto).slice(0, 1200);
    if (!text) continue;
    if (event.direcao === 'entrada') rows.push({role: 'user', content: text});
    else if (event.direcao === 'saida_lex' || event.direcao === 'saida_operador') rows.push({role: 'assistant', content: text});
  }
  // A API exige alternância e começo pelo usuário.
  const out = [];
  for (const row of rows) {
    if (!out.length && row.role !== 'user') continue;
    if (out.length && out[out.length - 1].role === row.role) out[out.length - 1] = {role: row.role, content: out[out.length - 1].content + '\n' + row.content};
    else out.push(row);
  }
  return out;
}

// Cria o compositor: recebe `ia(messages, system, maxTok, modelo)` do servidor e `aiAvailable()`.
function createReceptionComposer({ia, aiAvailable, identity, modelo, log = console, timeoutMs = TIMEOUT_MS} = {}) {
  const getIdentity = typeof identity === 'function' ? identity : () => identity || {};
  const stats = {tentativas: 0, ia: 0, fixa: 0, motivos: {}};
  function fallback(decision, motivo) {
    stats.fixa++;
    stats.motivos[motivo] = (stats.motivos[motivo] || 0) + 1;
    if (motivo !== 'ia_indisponivel') log.warn?.('[Recepcao IA] resposta fixa (' + motivo + ')');
    return {reply: decision.reply, origem: 'fixa', motivo};
  }
  async function compose({text, decision, history = []}) {
    stats.tentativas++;
    if (!decision || !decision.reply) return {reply: '', origem: 'fixa', motivo: 'sem_decisao'};
    if (typeof ia !== 'function' || (typeof aiAvailable === 'function' && !aiAvailable())) return fallback(decision, 'ia_indisponivel');
    const messages = historyMessages(history);
    const current = _clean(text).slice(0, 2000) || '[mensagem sem texto]';
    if (messages.length && messages[messages.length - 1].role === 'user') messages[messages.length - 1] = {role: 'user', content: messages[messages.length - 1].content + '\n' + current};
    else messages.push({role: 'user', content: current});
    let raw;
    try {
      raw = await Promise.race([
        ia(messages, systemPrompt(getIdentity(), decision), 400, modelo),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
      ]);
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      const motivo = /credit|billing|402|insufficient/.test(msg) ? 'sem_credito' : /timeout/.test(msg) ? 'timeout' : 'erro_ia';
      return fallback(decision, motivo);
    }
    const check = validateReply(raw, decision);
    if (!check.ok) return fallback(decision, check.motivo);
    stats.ia++;
    return {reply: check.text, origem: 'ia', motivo: null};
  }
  return {compose, stats: () => ({...stats, motivos: {...stats.motivos}})};
}

module.exports = {createReceptionComposer, validateReply, systemPrompt, historyMessages, MAX_REPLY_CHARS, FORBIDDEN};
