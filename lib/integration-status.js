'use strict';

const https = require('node:https');
const {timingSafeEqual} = require('node:crypto');

function brazilMobile(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!/^[+\d\s().-]+$/.test(raw)) throw new Error('Numero do WhatsApp invalido');
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11) digits = '55' + digits;
  if (!/^55[1-9]\d9\d{8}$/.test(digits)) throw new Error('Informe celular brasileiro com DDD');
  return digits;
}

// Apenas destinos definidos no servidor. Sem redirects, sem corpo de erro ou
// URL/token em mensagens de erro; limite de resposta e timeout de socket.
function requestJson(address, {headers = {}, method = 'GET', data, rawBody, timeoutMs = 15000, transport = https} = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(address);
    if (url.protocol !== 'https:' || url.username || url.password) {
      reject(new Error('A integracao exige URL HTTPS sem credenciais embutidas'));
      return;
    }
    if (rawBody !== undefined && (!Buffer.isBuffer(rawBody) || data !== undefined)) {
      reject(new Error('Corpo binario invalido ou ambiguo')); return;
    }
    const body = rawBody !== undefined ? rawBody : data === undefined ? null : JSON.stringify(data);
    const req = transport.request(url, {method, headers: {
      ...headers, ...(data === undefined ? {} : {'Content-Type':'application/json'}),
      ...(body === null ? {} : {'Content-Length':Buffer.byteLength(body)})
    }}, res => {
      const chunks = []; let size = 0;
      res.on('error', () => reject(new Error('Resposta interrompida pelo provedor')));
      res.on('aborted', () => reject(new Error('Resposta interrompida pelo provedor')));
      res.on('data', chunk => {
        size += Buffer.byteLength(chunk);
        if (size > 1024 * 1024) { req.destroy(); reject(new Error('Resposta do provedor excedeu o limite')); return; }
        chunks.push(Buffer.from(chunk));
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error('Provedor respondeu HTTP ' + res.statusCode);
          error.status = res.statusCode; reject(error); return;
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('Resposta JSON invalida do provedor')); }
      });
    });
    req.on('error', () => reject(new Error('Falha de rede da integracao')));
    req.setTimeout(timeoutMs, () => { reject(new Error('Tempo de resposta da integracao excedido')); req.destroy(); });
    if (body !== null) req.write(body);
    req.end();
  });
}

function webhookAuthStatus(secret, supplied) {
  if (typeof secret !== 'string' || !secret) return 503;
  if (typeof supplied !== 'string' || !supplied) return 401;
  const expected = Buffer.from(secret), actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? 200 : 401;
}

// Filtra antes de responder: ecos de envio e eventos de conexão não são mensagens de cliente.
function incomingWhatsappMessage(body, instance) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  if (body.instance && body.instance !== instance) return false;
  if (body.event && String(body.event).toLowerCase().replace(/_/g,'.') !== 'messages.upsert') return false;
  const data = body.data || body;
  if (!data || Array.isArray(data) || data.key?.fromMe !== false) return false;
  return typeof data.key?.id === 'string' && !!data.key.id &&
    /^\d+(?::\d+)?@s\.whatsapp\.net$/.test(data.key?.remoteJid || '') &&
    !!data.message && typeof data.message === 'object';
}

function evolutionEndpoint(base, suffix) {
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('EVOLUTION_URL deve ser HTTPS sem credenciais ou parametros');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/' + suffix;
  return url.toString();
}

async function whatsappStatus({url, key, instance, number, enabled = true}, getJson = requestJson) {
  const pending = {conectado:false, estado:'nao_configurado'};
  if (!enabled) return {...pending, estado:'desativado'};
  if (!url || !key || !instance || !number) return pending;
  try {
    const expected = brazilMobile(number);
    const options = {headers:{apikey:key}};
    const response = await getJson(evolutionEndpoint(url, 'instance/connectionState/' + encodeURIComponent(instance)), options);
    if (response?.instance?.instanceName !== instance) return {...pending, estado:'instancia_nao_confirmada'};
    if (response.instance.state !== 'open') return {...pending, estado:'aguardando_pareamento'};
    const rows = await getJson(evolutionEndpoint(url, 'instance/fetchInstances') + '?instanceName=' + encodeURIComponent(instance), options);
    if (!Array.isArray(rows)) return {...pending, estado:'resposta_invalida'};
    const selected = rows.filter(row => row.name === instance);
    if (selected.length !== 1) return {...pending, estado:'instancia_nao_confirmada'};
    // ownerJid e a identidade da sessao, diferente de number (configuracao).
    const owner = String(selected[0].ownerJid || '').match(/^(\d+)(?::\d+)?@s\.whatsapp\.net$/);
    if (!owner) return {...pending, estado:'numero_nao_confirmado'};
    if (owner[1] !== expected) return {...pending, estado:'numero_divergente'};
    return {conectado:true, estado:'conectado', verificado_em:new Date().toISOString()};
  } catch(error) {
    const estado = [401,403].includes(error.status) ? 'falha_autenticacao' : error.status === 404 ? 'instancia_ausente' : 'falha_na_verificacao';
    return {...pending, estado};
  }
}

async function telegramStatus({token, admin}, getJson = requestJson) {
  if (!token || !admin) return {conectado:false, estado:'nao_configurado'};
  try {
    const base = 'https://api.telegram.org/bot' + token + '/';
    const me = await getJson(base + 'getMe');
    if (!me?.ok || me.result?.is_bot !== true) return {conectado:false, estado:'token_nao_confirmado'};
    const webhook = await getJson(base + 'getWebhookInfo');
    if (!webhook?.ok || typeof webhook.result?.url !== 'string') return {conectado:false, estado:'resposta_invalida'};
    if (webhook.result.url) return {conectado:false, estado:'webhook_conflita_com_polling'};
    return {conectado:true, estado:'api_disponivel', bot:me.result.username || null,
      envio_confirmado:false, observacao:'Recebimento e envio ainda exigem teste real.'};
  } catch { return {conectado:false, estado:'falha_na_verificacao'}; }
}

module.exports = {brazilMobile, requestJson, evolutionEndpoint, whatsappStatus, telegramStatus, webhookAuthStatus, incomingWhatsappMessage};
