'use strict';

// Medição do consumo de IA — tokens e custo estimado por escritório, por mês, por ponto de
// uso (conversa do LEX, recepção, tarefa…) e por modelo.
//
// Regras (cinto de segurança, nunca porta):
// - medir NUNCA muda nem atrasa a resposta: record() é síncrono, não lança erro e só acumula
//   em memória; a gravação no banco sai depois, agrupada (a cada 30 s);
// - banco fora do ar: o acumulado volta para a fila e é gravado na próxima vez;
// - modelo sem preço conferido: custo "desconhecido" (contado à parte), nunca zero.
// Pré-requisito do teto de gasto por escritório (que NÃO está neste módulo).

const crypto = require('node:crypto');
const {AsyncLocalStorage} = require('node:async_hooks');
// Ponto de uso herdado pelo fluxo assíncrono: quem inicia um trabalho (recepção, tarefa…)
// marca o ponto uma vez e toda chamada de IA dentro dele é contada ali.
const pontoStore = new AsyncLocalStorage();
function runWithAiPonto(ponto, fn) { return pontoStore.run(String(ponto || 'outro'), fn); }
function currentAiPonto() { return pontoStore.getStore() || null; }
const {costUsd, normalizeModel, PRICES_AS_OF, PRICES_SOURCE} = require('./ai-prices');

const NUMBER_FIELDS = ['chamadas', 'erros', 'entrada', 'saida', 'leitura_cache', 'escrita_cache',
  'buscas_web', 'segundos_audio', 'chamadas_sem_preco', 'custo_usd'];
const MAX_KEYS = 60;
const MAX_LOTES = 50;

function emptyTotals() { return Object.fromEntries(NUMBER_FIELDS.map(f => [f, 0])); }

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) && x > 0 ? x : 0;
}

function providerFromHost(host) {
  const h = String(host || '').toLowerCase();
  if (h === 'api.anthropic.com') return 'anthropic';
  if (h === 'api.openai.com') return 'openai';
  if (h === 'generativelanguage.googleapis.com') return 'google';
  return 'desconhecido';
}

function googleModelFromPath(path) {
  const m = String(path || '').match(/\/models\/([^/:?]+)/);
  return m ? m[1] : '';
}

// Lê o consumo que cada provedor devolve na resposta. null = a resposta não trouxe consumo.
function normalizeUsage(provider, response) {
  if (!response || typeof response !== 'object') return null;
  if (provider === 'anthropic') {
    const u = response.usage;
    if (!u || typeof u !== 'object') return null;
    return {entrada: n(u.input_tokens), saida: n(u.output_tokens), leitura_cache: n(u.cache_read_input_tokens),
      escrita_cache: n(u.cache_creation_input_tokens), buscas_web: n(u.server_tool_use?.web_search_requests), segundos_audio: 0};
  }
  if (provider === 'openai') {
    const u = response.usage;
    if (!u || typeof u !== 'object') return null;
    if (u.type === 'duration') return {entrada: 0, saida: 0, leitura_cache: 0, escrita_cache: 0, buscas_web: 0, segundos_audio: n(u.seconds)};
    const cached = n(u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens);
    const input = n(u.prompt_tokens ?? u.input_tokens);
    return {entrada: Math.max(0, input - cached), saida: n(u.completion_tokens ?? u.output_tokens), leitura_cache: cached,
      escrita_cache: 0, buscas_web: 0, segundos_audio: 0};
  }
  if (provider === 'google') {
    const u = response.usageMetadata;
    if (!u || typeof u !== 'object') return null;
    const cached = n(u.cachedContentTokenCount);
    return {entrada: Math.max(0, n(u.promptTokenCount) - cached), saida: n(u.candidatesTokenCount) + n(u.thoughtsTokenCount),
      leitura_cache: cached, escrita_cache: 0, buscas_web: 0, segundos_audio: 0};
  }
  return null;
}

function monthOf(date) {
  // Mês no fuso do escritório (Brasília), para o fechamento bater com o calendário dele.
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit'})
    .formatToParts(date instanceof Date ? date : new Date(date));
  const get = type => parts.find(p => p.type === type)?.value;
  return get('year') + '-' + get('month');
}

function safeKey(value, fallback) {
  const k = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 60);
  return k || fallback;
}

function addTotals(target, delta) {
  for (const f of NUMBER_FIELDS) target[f] = (Number(target[f]) || 0) + (Number(delta[f]) || 0);
  target.custo_usd = Math.round(target.custo_usd * 1e6) / 1e6;
  return target;
}

function addTo(map, key, delta) {
  const k = Object.hasOwn(map, key) || Object.keys(map).length < MAX_KEYS ? key : 'outros';
  map[k] = addTotals(map[k] || emptyTotals(), delta);
}

function emptyMonth(mes, escritorio) {
  return {mes, escritorio_id: escritorio, precos_de: PRICES_AS_OF, fonte_precos: PRICES_SOURCE,
    total: emptyTotals(), por_ponto: {}, por_modelo: {}, atualizado_em: null};
}

// Aplica um lote só uma vez: se a gravação deu certo mas a resposta do banco se perdeu,
// a nova tentativa encontra o id do lote já registrado e não soma de novo.
function applyBatch(base, batch) {
  const applied = Array.isArray(base?.lotes_aplicados) ? base.lotes_aplicados : [];
  if (applied.includes(batch.id)) return undefined;
  const out = mergeMonth(base, batch.delta);
  out.lotes_aplicados = [...applied, batch.id].slice(-MAX_LOTES);
  return out;
}

function mergeMonth(base, delta) {
  const out = base && typeof base === 'object' ? structuredClone(base) : emptyMonth(delta.mes, delta.escritorio_id);
  out.total = addTotals(out.total || emptyTotals(), delta.total);
  out.por_ponto = out.por_ponto || {};
  out.por_modelo = out.por_modelo || {};
  for (const [k, v] of Object.entries(delta.por_ponto)) addTo(out.por_ponto, k, v);
  for (const [k, v] of Object.entries(delta.por_modelo)) addTo(out.por_modelo, k, v);
  out.precos_de = PRICES_AS_OF;
  out.fonte_precos = PRICES_SOURCE;
  out.atualizado_em = delta.atualizado_em || out.atualizado_em;
  return out;
}

function createAiUsageMeter({records = null, log = msg => console.warn(msg), now = () => new Date(),
  escritorioId = process.env.LEX_ESCRITORIO_ID || 'lex-atual', flushMs = 30000} = {}) {
  const escritorio = safeKey(escritorioId, 'lex-atual');
  const pending = new Map(); // mês -> acumulado ainda não posto em lote
  const queue = []; // lotes {id, mes, delta} aguardando confirmação do banco
  const memory = new Map(); // mês -> total (sem banco)
  let timer = null;
  let flushing = null;

  const keyFor = mes => 'ia_consumo_' + escritorio + '_' + mes;

  function record({provider, model, ponto, usage, ok = true} = {}) {
    try {
      const mes = monthOf(now());
      const modelo = normalizeModel(model) || 'desconhecido';
      const delta = emptyTotals();
      delta.chamadas = 1;
      if (!ok) delta.erros = 1;
      if (usage) for (const f of ['entrada', 'saida', 'leitura_cache', 'escrita_cache', 'buscas_web', 'segundos_audio']) delta[f] = n(usage[f]);
      const cost = usage && provider === 'anthropic' ? costUsd(modelo, usage) : null;
      // Consumo sem preço conferido (mesmo em chamada recusada) fica contado à parte.
      if (cost === null) { if (usage) delta.chamadas_sem_preco = 1; }
      else delta.custo_usd = cost;
      const acc = pending.get(mes) || {...emptyMonth(mes, escritorio), total: emptyTotals()};
      acc.total = addTotals(acc.total, delta);
      addTo(acc.por_ponto, safeKey(ponto, 'outro'), delta);
      addTo(acc.por_modelo, modelo, delta);
      acc.atualizado_em = now().toISOString();
      pending.set(mes, acc);
      schedule();
    } catch (error) {
      log('[IA consumo] medição ignorada: ' + (error?.message || error));
    }
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, flushMs);
    if (typeof timer?.unref === 'function') timer.unref();
  }

  async function flushOnce() {
    for (const [mes, delta] of pending) queue.push({id: crypto.randomUUID(), mes, delta});
    pending.clear();
    let failed = 0;
    // Mês com lote falho: os lotes seguintes desse mês esperam, para gravar na ordem e não
    // expulsar da lista de lotes aplicados o id de um lote que talvez já esteja no banco.
    const blockedMonths = new Set();
    const drop = batch => { const i = queue.indexOf(batch); if (i >= 0) queue.splice(i, 1); };
    for (const batch of [...queue]) {
      if (blockedMonths.has(batch.mes)) continue;
      if (!records) {
        memory.set(batch.mes, mergeMonth(memory.get(batch.mes), batch.delta));
        drop(batch);
        continue;
      }
      try {
        await records.change(keyFor(batch.mes), old => applyBatch(old, batch));
        drop(batch);
      } catch (error) {
        // O lote fica na fila com o MESMO id: a próxima tentativa não soma duas vezes.
        failed++;
        blockedMonths.add(batch.mes);
        log('[IA consumo] gravação adiada: ' + (error?.message || error));
      }
    }
    if (failed) schedule();
    return {pendentes: queue.length};
  }

  // Uma gravação por vez, em fila: quem chega espera a anterior (timer, desligamento e
  // nova tentativa podem coincidir).
  function flush() {
    const run = (flushing || Promise.resolve()).catch(() => {}).then(() => flushOnce());
    const tracked = run.finally(() => { if (flushing === tracked) flushing = null; });
    flushing = tracked;
    return tracked;
  }

  async function summary(mes = monthOf(now())) {
    let base = memory.get(mes) || null;
    let leituraIndisponivel = false;
    if (records) {
      try { base = (await records.read(keyFor(mes)))?.value || null; }
      catch (error) { leituraIndisponivel = true; log('[IA consumo] leitura indisponível: ' + (error?.message || error)); }
    }
    let out = base ? structuredClone(base) : emptyMonth(mes, escritorio);
    const applied = Array.isArray(out.lotes_aplicados) ? out.lotes_aplicados : [];
    let notSaved = false;
    for (const batch of queue) {
      if (batch.mes !== mes || applied.includes(batch.id)) continue;
      out = mergeMonth(out, batch.delta); notSaved = true;
    }
    const extra = pending.get(mes);
    if (extra) { out = mergeMonth(out, extra); notSaved = true; }
    delete out.lotes_aplicados;
    out.pendente_gravacao = notSaved;
    // Banco ilegível: o número mostrado pode estar abaixo do real — a tela precisa saber.
    out.leitura_indisponivel = leituraIndisponivel;
    return out;
  }

  return {record, flush, summary};
}

// Medidor único do processo. Sem configuração, mede só em memória (testes, sem banco).
let meter = createAiUsageMeter();
function configureAiUsage(options = {}) { meter = createAiUsageMeter(options); return meter; }
function recordAiUsage(entry) { try { meter.record(entry); } catch { /* medir nunca derruba a IA */ } }

// Registra a partir da resposta crua do provedor (ou do erro da chamada).
function recordAiResponse({host, provider, path, model, response, ponto, error} = {}) {
  try {
    const prov = provider || providerFromHost(host);
    const modelo = model || (prov === 'google' ? googleModelFromPath(path) : '');
    const failed = !!error || !!(response && typeof response === 'object' && response.error);
    // Uma chamada recusada ainda pode ter consumido (ex.: corte por limite): mede o que veio.
    recordAiUsage({provider: prov, model: modelo, ponto, usage: normalizeUsage(prov, response), ok: !failed});
  } catch { /* medir nunca derruba a IA */ }
}
function aiUsageSummary(mes) { return meter.summary(mes); }
function flushAiUsage() { return meter.flush(); }

module.exports = {runWithAiPonto, currentAiPonto, createAiUsageMeter, configureAiUsage, recordAiUsage, recordAiResponse, aiUsageSummary, flushAiUsage,
  normalizeUsage, providerFromHost, googleModelFromPath, monthOf};
