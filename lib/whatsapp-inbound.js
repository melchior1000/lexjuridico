'use strict';

// Entrada do WhatsApp — memória que sobrevive a reinício do servidor.
//
// 1. Descarte de repetição: a Evolution pode entregar o mesmo aviso de mensagem mais de
//    uma vez (reconexão, reenvio). Sem esta trava o LEX respondia duas vezes. A chave é
//    instância + id da mensagem, guardada por contato (últimas 200), como já faz o
//    Telegram em lib/telegram-reception.js. Ideia adaptada do DeskcommCRM
//    (lib/waha/ingest.ts — MIT, Copyright (c) 2026 Rafael Melgaço); código reescrito.
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

  return {claim, rememberLidContact, lidTargetFor, saveOperatorLid, loadOperatorLid};
}

module.exports = {createWhatsappInbound, contactIdFor, contactKeysFor, lidDigits, isLidJid, isContactLidDigits, PHONE_DIGITS};
