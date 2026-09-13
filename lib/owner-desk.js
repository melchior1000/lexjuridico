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

function isOwnerDeskMessage(value) {
  return !!normalizeOwnerDeskCommand(value);
}

module.exports = { normalizeOwnerDeskCommand, isOwnerDeskMessage };
