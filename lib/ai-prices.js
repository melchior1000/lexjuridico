'use strict';

// Preços da IA em dólares por milhão de tokens — fonte única do LEX.
// Conferidos em 06/10/2026 na página oficial: https://platform.claude.com/docs/en/about-claude/pricing
// Os preços mudam: conferir a página antes de usar estes números para cobrar o cliente.
// "escrita em cache" = gravação de 5 minutos (padrão da API).
// Modelos de outros provedores (OpenAI, Google) ficam sem preço até serem conferidos na
// fonte oficial: o consumo é medido e o custo aparece como "desconhecido", nunca zero.

const PRICES_AS_OF = '2026-10-06';
const PRICES_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';

const ANTHROPIC = {
  'claude-fable-5-1':  {entrada: 10,   saida: 50, escrita_cache: 12.5, leitura_cache: 0.25},
  'claude-mythos-5-1': {entrada: 10,   saida: 50, escrita_cache: 12.5, leitura_cache: 0.25},
  'claude-opus-5-5':   {entrada: 4,    saida: 20, escrita_cache: 5,    leitura_cache: 0.2},
  'claude-sonnet-5-5': {entrada: 2,    saida: 10, escrita_cache: 2.5,  leitura_cache: 0.2},
  'claude-haiku-4-5':  {entrada: 1,    saida: 5,  escrita_cache: 1.25, leitura_cache: 0.1},
  'claude-fable-5':    {entrada: 10,   saida: 50, escrita_cache: 12.5, leitura_cache: 1},
  'claude-mythos-5':   {entrada: 10,   saida: 50, escrita_cache: 12.5, leitura_cache: 1},
  'claude-opus-5':     {entrada: 5,    saida: 25, escrita_cache: 6.25, leitura_cache: 0.5},
  'claude-sonnet-5':   {entrada: 2,    saida: 10, escrita_cache: 2.5,  leitura_cache: 0.2},
  'claude-sonnet-4-6': {entrada: 3,    saida: 15, escrita_cache: 3.75, leitura_cache: 0.3},
  'claude-3-5-haiku':  {entrada: 0.8,  saida: 4,  escrita_cache: 1,    leitura_cache: 0.08}
};

// Ferramenta de pesquisa na web da Anthropic: US$ 10 por 1.000 pesquisas (mesma página).
const WEB_SEARCH_USD_PER_SEARCH = 10 / 1000;

// Nome exato do modelo, sem sufixo de data (-20251001) nem "-latest". Nada de "parecido":
// claude-opus-5-5 não pode cair no preço do claude-opus-5.
function normalizeModel(model) {
  return String(model || '').trim().toLowerCase().replace(/-(\d{8}|latest)$/, '');
}

function priceFor(model) {
  return ANTHROPIC[normalizeModel(model)] || null;
}

// usage: {entrada, saida, leitura_cache, escrita_cache, buscas_web}. Devolve dólares ou
// null quando o modelo não tem preço conferido.
function costUsd(model, usage = {}) {
  const p = priceFor(model);
  if (!p) return null;
  const n = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  const tokens = n(usage.entrada) * p.entrada + n(usage.saida) * p.saida
    + n(usage.leitura_cache) * p.leitura_cache + n(usage.escrita_cache) * p.escrita_cache;
  return tokens / 1e6 + n(usage.buscas_web) * WEB_SEARCH_USD_PER_SEARCH;
}

module.exports = {PRICES_AS_OF, PRICES_SOURCE, WEB_SEARCH_USD_PER_SEARCH, normalizeModel, priceFor, costUsd};
