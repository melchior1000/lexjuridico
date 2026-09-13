'use strict';

const https = require('node:https');
const {timingSafeEqual} = require('node:crypto');
const {createReceptionStore} = require('./whatsapp-reception-store');

const receptionStore = createReceptionStore();
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
  setTimeout(() => receptionStore.healthcheck().then(result => {
    console.log('[WhatsApp Recepcao] persistencia Supabase:', result.ok ? 'ok' : 'indisponivel');
  }).catch(() => console.warn('[WhatsApp Recepcao] persistencia Supabase: indisponivel')), 500);
}

function brazilMobile(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!/^[+\d\s().-]+$/.test(raw)) throw new Error('Numero do WhatsApp invalido');
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11) digits = '55' + digits;
  if (!/^55[1-9]\d9\d{8}$/.test(digits)) throw new Error('Informe celular brasileiro com DDD');
  return digits;
}

function sameBrazilWhatsappNumber(ownerDigits, expected) {
  if (typeof ownerDigits !== 'string' || typeof expected !== 'string') return false;
  if (ownerDigits === expected) return true;
  if (!/^55[1-9]\d9\d{8}$/.test(expected)) return false;
  const expectedWithoutNinth = expected.slice(0, 4) + expected.slice(5);
  return ownerDigits === expectedWithoutNinth;
}

function whatsappDigitsFromJid(jid) {
  const m = String(jid || '').match(/^(\d+)(?::\d+)?@s\.whatsapp\.net$/);
  return m ? m[1] : null;
}

function whatsappAccessMode(remoteJid, operatorValue) {
  if (!operatorValue) return 'legacy';
  let expected;
  try { expected = brazilMobile(operatorValue); }
  catch { return 'public'; }
  const sender = whatsappDigitsFromJid(remoteJid);
  if (!sender) return 'public';
  return sameBrazilWhatsappNumber(sender, expected) ? 'operator' : 'public';
}

function whatsappMessageText(data) {
  const m = data?.message || {};
  return String(
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  ).trim();
}

function normalizeReceptionText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}

function publicWhatsappDecision(text, data = {}) {
  const raw = String(text || '').trim();
  const n = normalizeReceptionText(raw);
  const message = data?.message || {};
  const hasDocument = !!message.documentMessage;
  const hasAudio = !!message.audioMessage;
  const hasImage = !!message.imageMessage;

  if (/prisao|preso|mandado|liminar|audiencia (hoje|amanha)|prazo (hoje|amanha)|vence hoje|vence amanha|bloqueio urgente|urgente/.test(n)) {
    return {kind:'urgent',escalate:true,archive:false,reply:'Entendi. Registrei como urgente e o responsável foi avisado. Se houver prazo, audiência ou documento, envie aqui para eu deixar tudo organizado.'};
  }
  if (/quero falar com (o |a )?(advogado|doutor|responsavel)|falar com (o |a )?(advogado|doutor)|preciso do advogado|me passa o advogado/.test(n)) {
    return {kind:'lawyer',escalate:true,archive:false,reply:'Certo. Registrei seu pedido para falar com o responsável. Informe seu nome completo e, em uma frase, o assunto para eu deixar o retorno organizado.'};
  }
  if (/quanto (eu )?(ganho|recebo)|valor (do|de) (acordo|processo)|proposta de acordo|aceito acordo|estrategia|o que voce acha que eu ganho|honorario|honorarios/.test(n)) {
    return {kind:'sensitive',escalate:true,archive:false,reply:'Esse ponto precisa de análise do responsável. Registrei seu pedido. Informe seu nome e, se houver, o número do caso para o retorno correto.'};
  }
  if (/meu processo|meu caso|andamento|numero do processo|n[uú]mero do processo|sentenca|recurso|peticao|audiencia|prazo do processo/.test(n)) {
    return {kind:'existing_case',escalate:true,archive:false,reply:'Neste canal eu não abro processo automaticamente por segurança. Me passe seu nome e o número do caso; o responsável retorna com a informação correta.'};
  }
  if (/cobranca|vivo|claro|tim|operadora|fornecedor|financeiro|boleto|fatura|nota fiscal|nf-e|nfe/.test(n)) {
    return {kind:'administrative',escalate:false,archive:true,reply:'Recebido. Registrei o contato administrativo. Se houver boleto, nota ou documento, pode enviar por aqui.'};
  }
  if (hasDocument || hasAudio || hasImage) {
    return {kind:'media',escalate:false,archive:false,reply:'Recebi o arquivo. Para eu organizar corretamente, informe seu nome e em uma frase a que assunto ele se refere.'};
  }
  if (/trabalhist|demissao|demitid|rescisao|acidente de trabalho|horas extras|empresa nao pagou|quero processar|preciso entrar com acao|preciso de advogado|advogado trabalhista|advogado civil|advogado tributario/.test(n)) {
    return {kind:'new_case',escalate:false,archive:false,reply:'Consigo iniciar o atendimento. Me informe seu nome completo, sua cidade e, em uma frase, o que aconteceu.'};
  }
  if (/quem (e|eh)|de quem|esse numero|este numero/.test(n)) {
    return {kind:'identity',escalate:false,archive:true,reply:'Olá! Este é o WhatsApp do Lex Jurídico. Se precisar falar com o escritório, diga seu nome ou empresa e o assunto.'};
  }
  if (/^(oi|ola|bom dia|boa tarde|boa noite|opa|al[oô])\b/.test(n)) {
    return {kind:'greeting',escalate:false,archive:false,reply:'Olá! Você falou com o Lex Jurídico. Diga seu nome ou empresa e, em poucas palavras, como posso ajudar.'};
  }
  return {kind:'general',escalate:false,archive:false,reply:'Recebi sua mensagem. Para eu encaminhar corretamente, informe seu nome ou empresa e, em poucas palavras, o assunto.'};
}

function publicWhatsappReply(text, data) {
  return publicWhatsappDecision(text, data).reply;
}

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

function evolutionEndpoint(base, suffix) {
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('EVOLUTION_URL deve ser HTTPS sem credenciais ou parametros');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/' + suffix;
  return url.toString();
}

async function _sendEvolutionText(number, text, instance, {url, key, request = requestJson} = {}) {
  if (!number || !text || !instance || !url || !key) return false;
  try {
    const result = await request(evolutionEndpoint(url, 'message/sendText/' + encodeURIComponent(instance)), {
      method:'POST', headers:{apikey:key}, timeoutMs:15000,
      data:{number:String(number), text:String(text).substring(0,4000)}
    });
    return !!(result?.key?.id && !result.error);
  } catch { return false; }
}

function _listReceptionText(rows) {
  if (!rows.length) return 'Recepção: ninguém aguardando retorno.';
  return 'Recepção — aguardando você:\n' + rows.map((x,i)=>`${i+1}. ${x.urgente?'🔴 ':''}${x.nome} (${x.numero}) — ${x.classe} — ${String(x.ultima_mensagem||'').substring(0,120)}`).join('\n') + '\n\nUse /historico NUMERO para ver a conversa, /responder NUMERO mensagem ou /arquivar NUMERO.';
}

function _historyText(rows, target) {
  if (!rows.length) return `Histórico ${target}: nenhum evento registrado.`;
  return `Histórico ${target} — mais recentes primeiro:\n` + rows.map(x => {
    const when = x.criado_em ? new Date(x.criado_em).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '--';
    const who = x.direcao === 'entrada' ? 'Contato' : x.direcao === 'saida_operador' ? 'Você' : 'LEX';
    return `${when} · ${who}: ${String(x.texto||'').replace(/[\r\n]+/g,' ').substring(0,240)}`;
  }).join('\n');
}

async function handleWhatsappOperatorCommand(body, instance, options = {}) {
  const data = body?.data || body || {};
  const text = whatsappMessageText(data);
  const operatorValue = options.operator || process.env.LEX_OPERATOR_WHATSAPP || '';
  let operator;
  try { operator = brazilMobile(operatorValue); } catch { operator = null; }
  if (!operator || !/^\//.test(text)) return false;
  const cfg = options.url && options.key ? {url:options.url,key:options.key} : require('./evolution-config').evolutionConfig();
  const request = options.request || requestJson;
  const store = options.store || receptionStore;

  if (/^\/ajuda\s*$/i.test(text)) {
    await _sendEvolutionText(operator, 'Comandos privados do LEX:\n/recepcao — contatos aguardando\n/historico NUMERO — últimas mensagens do contato\n/responder NUMERO mensagem — responder pelo WhatsApp do escritório\n/arquivar NUMERO — retirar da fila', instance, {url:cfg.url,key:cfg.key,request});
    return true;
  }
  if (/^\/recepcao\s*$/i.test(text)) {
    const rows = await store.list({status:'aguardando_advogado',limit:10});
    await _sendEvolutionText(operator, _listReceptionText(rows), instance, {url:cfg.url,key:cfg.key,request});
    return true;
  }
  const historyMatch = text.match(/^\/historico\s+(\+?[\d\s().-]+)\s*$/i);
  if (historyMatch) {
    let target;
    try { target = brazilMobile(historyMatch[1]); } catch { target = null; }
    if (!target) {
      await _sendEvolutionText(operator, 'Número inválido. Use: /historico 5561999999999', instance, {url:cfg.url,key:cfg.key,request});
      return true;
    }
    const rows = typeof store.history==='function' ? await store.history(target,{limit:15}) : [];
    await _sendEvolutionText(operator, _historyText(rows,target), instance, {url:cfg.url,key:cfg.key,request});
    return true;
  }
  const replyMatch = text.match(/^\/responder\s+(\+?[\d\s().-]+)\s+([\s\S]+)$/i);
  if (replyMatch) {
    let target;
    try { target = brazilMobile(replyMatch[1]); } catch { target = null; }
    if (!target) {
      await _sendEvolutionText(operator, 'Número inválido. Use: /responder 5561999999999 sua mensagem', instance, {url:cfg.url,key:cfg.key,request});
      return true;
    }
    const replyText=replyMatch[2].trim();
    const ok = await _sendEvolutionText(target, replyText, instance, {url:cfg.url,key:cfg.key,request});
    if (ok && typeof store.appendEvent==='function') await store.appendEvent({numero:target,nome:'Contato',direcao:'saida_operador',texto:replyText,classe:'geral',nivel:'atencao'});
    await _sendEvolutionText(operator, ok ? `Resposta enviada para ${target}.` : `Não consegui confirmar o envio para ${target}.`, instance, {url:cfg.url,key:cfg.key,request});
    return true;
  }
  const archiveMatch = text.match(/^\/arquivar\s+(\+?[\d\s().-]+)\s*$/i);
  if (archiveMatch) {
    let target;
    try { target = brazilMobile(archiveMatch[1]); } catch { target = null; }
    const archived = target ? await store.archive(target) : false;
    await _sendEvolutionText(operator, archived ? `Contato ${target} arquivado.` : 'Contato não encontrado na fila.', instance, {url:cfg.url,key:cfg.key,request});
    return true;
  }
  return false;
}

async function publicWhatsappReception(body, instance, options = {}) {
  const data = body?.data || body || {};
  const sender = whatsappDigitsFromJid(data.key?.remoteJid || '');
  const operatorValue = options.operator || process.env.LEX_OPERATOR_WHATSAPP || '';
  let operator;
  try { operator = brazilMobile(operatorValue); } catch { operator = null; }
  if (!sender || !operator || sameBrazilWhatsappNumber(sender, operator)) return false;

  const cfg = options.url && options.key ? {url:options.url,key:options.key} : require('./evolution-config').evolutionConfig();
  const request = options.request || requestJson;
  const store = options.store || receptionStore;
  const name = String(data.pushName || 'Contato').replace(/[\r\n]+/g,' ').substring(0,80);
  const text = whatsappMessageText(data);
  const original = text || '[mídia ou arquivo sem texto]';
  const decision = publicWhatsappDecision(text, data);
  const item = await store.upsert(sender, name, original);
  const safeOriginal = original.replace(/[\r\n]+/g,' ').substring(0,500);
  const level = item.urgente || decision.kind==='urgent' ? 'urgente' : decision.escalate ? 'atencao' : 'ciencia';

  if (typeof store.appendEvent==='function') await store.appendEvent({numero:sender,nome:name,direcao:'entrada',texto:original,classe:item.classe||'geral',nivel:level});
  if (decision.archive) await store.archive(sender);
  const marker = level==='urgente' ? '[URGENTE]' : level==='atencao' ? '[ATENÇÃO]' : '[CIÊNCIA]';
  const reason = decision.kind==='existing_case' ? 'possível processo existente' : decision.kind==='lawyer' ? 'pediu advogado' : decision.kind==='sensitive' ? 'tema sensível' : decision.kind==='administrative' ? 'administrativo' : decision.kind==='new_case' ? 'caso novo' : decision.kind==='media' ? 'arquivo recebido' : decision.kind;
  await _sendEvolutionText(operator, `${marker} ${name} (${sender}) — ${reason}: ${safeOriginal}`, instance, {url:cfg.url,key:cfg.key,request});

  const replied = await _sendEvolutionText(sender, decision.reply, instance, {url:cfg.url,key:cfg.key,request});
  if (replied) {
    if (typeof store.appendEvent==='function') await store.appendEvent({numero:sender,nome:name,direcao:'saida_lex',texto:decision.reply,classe:item.classe||'geral',nivel:level});
    await _sendEvolutionText(operator, `[LEX] respondeu a ${name} (${sender}): ${decision.reply}`, instance, {url:cfg.url,key:cfg.key,request});
  }
  return replied;
}

function webhookAuthStatus(secret, supplied) {
  if (typeof secret !== 'string' || !secret) return 503;
  if (typeof supplied !== 'string' || !supplied) return 401;
  const expected = Buffer.from(secret), actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? 200 : 401;
}

function incomingWhatsappMessage(body, instance) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  if (body.instance && body.instance !== instance) return false;
  if (body.event && String(body.event).toLowerCase().replace(/_/g,'.') !== 'messages.upsert') return false;
  const data = body.data || body;
  if (!data || Array.isArray(data) || data.key?.fromMe !== false) return false;
  const valid = typeof data.key?.id === 'string' && !!data.key.id &&
    /^\d+(?::\d+)?@s\.whatsapp\.net$/.test(data.key?.remoteJid || '') &&
    !!data.message && typeof data.message === 'object';
  if (!valid) return false;

  const operatorValue = process.env.LEX_OPERATOR_WHATSAPP || '';
  const mode = whatsappAccessMode(data.key.remoteJid, operatorValue);
  if (mode === 'public') {
    queueMicrotask(() => publicWhatsappReception(body, instance).catch(() => {}));
    return false;
  }
  if (mode === 'operator' && /^\/(recepcao|historico|responder|arquivar|ajuda)\b/i.test(whatsappMessageText(data))) {
    queueMicrotask(() => handleWhatsappOperatorCommand(body, instance).catch(() => {}));
    return false;
  }
  return true;
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
    const owner = String(selected[0].ownerJid || '').match(/^(\d+)(?::\d+)?@s\.whatsapp\.net$/);
    if (!owner) return {...pending, estado:'numero_nao_confirmado'};
    if (!sameBrazilWhatsappNumber(owner[1], expected)) return {...pending, estado:'numero_divergente'};
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

module.exports = {
  brazilMobile, sameBrazilWhatsappNumber, whatsappAccessMode, publicWhatsappReply, publicWhatsappDecision,
  publicWhatsappReception, handleWhatsappOperatorCommand, requestJson, evolutionEndpoint, whatsappStatus,
  telegramStatus, webhookAuthStatus, incomingWhatsappMessage
};