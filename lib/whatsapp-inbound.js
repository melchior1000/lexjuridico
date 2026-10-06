'use strict';

// Entrada do WhatsApp — memória que sobrevive a reinício do servidor.
//
// 1. Descarte de repetição: a Evolution pode entregar o mesmo aviso de mensagem mais de
//    uma vez (reconexão, reenvio). Sem esta trava o LEX respondia duas vezes. A chave é
//    instância + id da mensagem, guardada por contato (últimas 200), como já faz o
//    Telegram em lib/telegram-reception.js. Ideia adaptada do DeskcommCRM
//    (lib/waha/ingest.ts — MIT, Copyright (c) 2026 Rafael Melgaço); código reescrito.
//    Aviso completo da licença em THIRD_PARTY_NOTICES.md.
// 2. Contato só com LID: o WhatsApp pode mandar um código (…@lid) no lugar do telefone.
//    Esse contato entra na recepção com o próprio código e as respostas saem para o LID.
// 3. Titular → LID: o vínculo confirmado pelo telefone do titular é gravado no banco,
//    para não se perder quando o servidor reinicia.
//
// Sem banco (testes, falha de leitura/gravação), vale a memória do processo: na dúvida
// a mensagem é processada, nunca descartada em silêncio.

const MAX_IDS = 200;
const MAX_MEMORY_CONTACTS = 2000;
const OPERATOR_KEY = 'whatsapp_titular_lid';

// Telefone brasileiro como gravado na fila (com ou sem o 9): 12 ou 13 dígitos.
const PHONE_DIGITS = /^55\d{10,11}$/;
// LID de CONTATO: 14 a 20 dígitos. Nunca se confunde com telefone brasileiro (no máximo
// 13), então um envio para o código jamais cai no telefone de outra pessoa.
const CONTACT_LID_DIGITS = /^\d{14,20}$/;

function isLidJid(value) {
  return /^\d{5,20}@lid$/.test(String(value || ''));
}

// Dígitos do LID de um contato, só quando o LID não pode ser confundido com telefone.
function lidDigits(lid) {
  const m = String(lid || '').match(/^(\d+)@lid$/);
  return m && CONTACT_LID_DIGITS.test(m[1]) ? m[1] : null;
}

function isContactLidDigits(value) {
  return CONTACT_LID_DIGITS.test(String(value || ''));
}

function contactIdFor(address) {
  if (address?.digits) return String(address.digits);
  return lidDigits(address?.lid);
}

// Todas as identidades da mensagem (telefone e LID): a mesma mensagem pode chegar uma vez
// com o telefone junto e outra só com o LID; a trava confere as duas.
function contactKeysFor(address) {
  return [...new Set([address?.digits ? String(address.digits) : null, lidDigits(address?.lid)].filter(Boolean))];
}

// Formas de um mesmo contato: dígitos do LID, ou telefone com e sem o 9 (o WhatsApp pode
// mandar a conta antiga sem o 9). Pedido de saída gravado numa forma vale para as outras.
function contactVariants(raw) {
  const value = String(raw || '').trim();
  const lid = lidDigits(value);
  if (lid) return [lid];
  const digits = value.replace(/(?::\d+)?@.*$/, '').replace(/\D/g, ''); // ':12' = aparelho, não faz parte do número
  if (!digits) return [];
  if (/^55\d{2}9\d{8}$/.test(digits)) return [digits, digits.slice(0, 4) + digits.slice(5)];
  if (/^55\d{2}[6-9]\d{7}$/.test(digits)) return [digits, digits.slice(0, 4) + '9' + digits.slice(4)];
  return [digits];
}

function createWhatsappInbound({records = null, log = msg => console.warn(msg), maxIds = MAX_IDS} = {}) {
  const seen = new Map(); // contato -> Set de ids (memória do processo)
  const lidContacts = new Map(); // dígitos do LID -> jid

  function rememberLocal(contact, eventId) {
    let set = seen.get(contact);
    if (!set) {
      set = new Set();
      seen.set(contact, set);
      if (seen.size > MAX_MEMORY_CONTACTS) seen.delete(seen.keys().next().value);
    }
    if (set.has(eventId)) return false;
    set.add(eventId);
    if (set.size > maxIds) set.delete(set.values().next().value);
    return true;
  }

  // true = primeira vez que esta mensagem chega; false = repetição (descartar).
  // `contacts` = todas as identidades da mensagem (telefone e/ou LID).
  async function claim({contact, contacts, instance, messageId}) {
    const keys = [...new Set([...(Array.isArray(contacts) ? contacts : []), contact].filter(Boolean).map(String))];
    if (!keys.length || !messageId) return true;
    const eventId = String(instance || '') + '|' + String(messageId);
    let local = true;
    for (const key of keys) if (!rememberLocal(key, eventId)) local = false;
    if (!records) return local;
    if (!local) return false;
    let first = true;
    try {
      for (const key of keys) {
        await records.change('whatsapp_entrada_' + key, old => {
          const row = old && Array.isArray(old.ids) ? old : {contato: key, ids: []};
          if (row.ids.includes(eventId)) { first = false; return undefined; }
          row.ids = [...row.ids, eventId].slice(-maxIds);
          row.atualizado_em = new Date().toISOString();
          return row;
        });
      }
    } catch (error) {
      log('[WhatsApp Entrada] trava de repetição sem banco; usando memória: ' + (error?.message || error));
      return first;
    }
    return first;
  }

  async function rememberLidContact(lid, nome) {
    const digits = lidDigits(lid);
    if (!digits || !isLidJid(lid)) return;
    lidContacts.set(digits, lid);
    if (!records) return;
    try {
      await records.change('whatsapp_contato_lid_' + digits, old => {
        if (old && old.lid === lid) return undefined;
        return {lid, nome: String(nome || 'Contato').slice(0, 80), criado_em: old?.criado_em || new Date().toISOString()};
      });
    } catch (error) {
      log('[WhatsApp Entrada] não consegui gravar o contato LID: ' + (error?.message || error));
    }
  }

  // Destino de envio para um contato da recepção identificado só pelo LID.
  async function lidTargetFor(id) {
    const digits = String(id || '').replace(/\D/g, '');
    if (!isContactLidDigits(digits)) return null;
    if (lidContacts.has(digits)) return lidContacts.get(digits);
    if (!records) return null;
    try {
      const row = await records.read('whatsapp_contato_lid_' + digits);
      const lid = row?.value?.lid;
      if (isLidJid(lid) && lidDigits(lid) === digits) {
        lidContacts.set(digits, lid);
        return lid;
      }
    } catch (error) {
      log('[WhatsApp Entrada] não consegui ler o contato LID: ' + (error?.message || error));
    }
    return null;
  }

  async function saveOperatorLid(operator, lid) {
    if (!records || !operator || !isLidJid(lid)) return;
    try {
      await records.change(OPERATOR_KEY, old => {
        if (old && old.operador === operator && old.lid === lid) return undefined;
        return {operador: operator, lid, atualizado_em: new Date().toISOString()};
      });
    } catch (error) {
      log('[WhatsApp Entrada] não consegui gravar o LID do titular: ' + (error?.message || error));
    }
  }

  async function loadOperatorLid(operator) {
    if (!records || !operator) return null;
    try {
      const row = await records.read(OPERATOR_KEY);
      const value = row?.value;
      return value && value.operador === operator && isLidJid(value.lid) ? value.lid : null;
    } catch (error) {
      log('[WhatsApp Entrada] não consegui ler o LID do titular: ' + (error?.message || error));
      return null;
    }
  }

  // Pedido de saída: o LEX não manda mais mensagem AUTOMÁTICA a este contato.
  // Cache por forma do contato, com validade de 5 min: outro processo do servidor pode ter
  // gravado ou liberado o pedido nesse meio tempo.
  const OPTOUT_TTL_MS = 5 * 60 * 1000;
  const optOuts = new Map(); // forma -> {row|null, em}
  // Pedido que o banco não aceitou fica preso na memória (sem validade) até o reinício:
  // expirar em 5 min soltaria as automáticas sem ninguém perceber.
  const cached = v => { const c = optOuts.get(v); return c && (c.fixo || Date.now() - c.em < OPTOUT_TTL_MS) ? c : null; };
  const remember = (v, row, fixo = false) => optOuts.set(v, {row, em: Date.now(), fixo});
  // Devolve {row, gravado}. gravado=false: valeu só na memória deste processo (banco falhou).
  async function markOptOut(contact, {nivel = 'inequivoco', texto = '', nome = ''} = {}) {
    const variants = contactVariants(contact);
    const key = variants[0];
    if (!key) return {row: null, gravado: false};
    const row = {contato: key, nivel: nivel === 'provavel' ? 'provavel' : 'inequivoco',
      texto: String(texto || '').slice(0, 300), nome: String(nome || '').slice(0, 80), criado_em: new Date().toISOString()};
    let final = row;
    let gravado = !records;
    if (records) {
      try {
        // Pedido inequívoco já gravado nunca é rebaixado a "provável".
        const saved = await records.change('whatsapp_optout_' + key, old => (old && old.nivel === 'inequivoco' && row.nivel === 'provavel') ? undefined : row);
        if (saved && saved.nivel) final = saved;
        gravado = true;
      } catch (error) { log('[WhatsApp Entrada] não consegui gravar o pedido de saída: ' + (error?.message || error)); }
    }
    for (const v of variants) remember(v, final, !gravado);
    return {row: final, gravado};
  }
  // null = pode receber mensagem automática. Banco ilegível: na dúvida, NÃO envia.
  async function optOutStatus(contact) {
    const variants = contactVariants(contact);
    for (const v of variants) { const c = cached(v); if (c && c.row) return c.row; }
    if (!records) return null;
    for (const v of variants) {
      if (cached(v)) continue;
      try {
        const value = (await records.read('whatsapp_optout_' + v))?.value || null;
        const row = value && value.nivel ? value : null;
        remember(v, row);
        if (row) return row;
      } catch (error) {
        log('[WhatsApp Entrada] não consegui ler pedido de saída; mensagem automática suspensa: ' + (error?.message || error));
        return {contato: v, nivel: 'desconhecido', texto: '', criado_em: null};
      }
    }
    return null;
  }
  // O cache só muda depois que o banco confirmou: falhou, nada muda.
  async function clearOptOut(contact) {
    const variants = contactVariants(contact);
    let cleared = variants.some(v => cached(v)?.row);
    if (records) {
      for (const v of variants) {
        try {
          await records.change('whatsapp_optout_' + v, old => { if (!old || !old.nivel) return undefined; cleared = true; return {contato: v, nivel: null, liberado_em: new Date().toISOString()}; });
        } catch (error) { log('[WhatsApp Entrada] não consegui liberar o contato: ' + (error?.message || error)); throw error; }
      }
    }
    for (const v of variants) remember(v, null);
    return cleared;
  }

  return {claim, rememberLidContact, lidTargetFor, saveOperatorLid, loadOperatorLid, markOptOut, optOutStatus, clearOptOut};
}

module.exports = {createWhatsappInbound, contactIdFor, contactKeysFor, contactVariants, lidDigits, isLidJid, isContactLidDigits, PHONE_DIGITS};
