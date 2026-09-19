'use strict';

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeOwnerDeskCommand(value) {
  const text = cleanText(value);
  if (!text || text.startsWith('/')) return null;

  const simple = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[!?.,;:]+$/g, '')
    .trim();

  if (/^(oi|ola|mesa|resumo|recepcao|bom dia|boa tarde|boa noite)$/.test(simple)) {
    return '/recepcao';
  }

  const history = text.match(/^(?:hist[oó]rico|ver|conversa)\s+(\+?[\d\s().-]+)\s*$/i);
  if (history) return '/historico ' + history[1].trim();

  const reply = text.match(/^(?:responder|responda|manda|mande|enviar|envie)\s+(\+?[\d\s().-]+)\s+([\s\S]+)$/i);
  if (reply) return '/responder ' + reply[1].trim() + ' ' + reply[2].trim();

  const resolve = text.match(/^(?:resolver|resolva|arquivar|arquive)\s+(\+?[\d\s().-]+)\s*$/i);
  if (resolve) return '/arquivar ' + resolve[1].trim();

  return null;
}

function normalizeOwnerNamedReply(value) {
  const text = cleanText(value);
  if (!text || text.startsWith('/')) return null;

  const match = text.match(/^(?:a|ao)?\s*([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' -]{1,79}?)\s*[,;:-]?\s*(?:diga|diz|fale|fala|avise|avisa|mande|manda|envie|envia|responda|responde)(?:\s+(?:a|pra|para)\s+el[ae])?\s+(?:q(?:ue)?\s+)?([\s\S]+)$/i);
  if (!match) return null;
  const nome = match[1].trim().replace(/\s+/g, ' ');
  const instrucao = match[2].trim();
  if (!nome || !instrucao) return null;
  return { nome, instrucao };
}

function isOwnerDeskMessage(value) {
  return !!normalizeOwnerDeskCommand(value) || !!normalizeOwnerNamedReply(value);
}

module.exports = { normalizeOwnerDeskCommand, normalizeOwnerNamedReply, isOwnerDeskMessage };
