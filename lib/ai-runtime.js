'use strict';

// Modelo Anthropic definido pelo titular; todos os agentes usam o mesmo TOP.
const DEFAULT_MODELS = {
  anthropic: {top: 'claude-opus-4-8', mid: 'claude-opus-4-8', eco: 'claude-opus-4-8'},
  openai: {top: 'gpt-4.1', mid: 'gpt-4.1-mini', eco: 'gpt-4.1-nano'},
  google: {top: 'gemini-2.5-pro', mid: 'gemini-2.5-flash', eco: 'gemini-2.0-flash-lite'}
};

function positiveInteger(value, fallback, max) {
  const n = Number(value);
  if (value === undefined || value === '') return fallback;
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error('Limite de IA invalido');
  return n;
}

function modelsFor(provider, env = process.env) {
  if (!Object.hasOwn(DEFAULT_MODELS, provider)) throw new Error('Provedor de IA invalido');
  if (provider === 'anthropic') {
    const model = env.LEX_ANTHROPIC_MODEL_TOP || DEFAULT_MODELS.anthropic.top;
    // Variáveis MID/ECO legadas não podem rebaixar agentes silenciosamente.
    return {top:model, mid:model, eco:model};
  }
  return Object.fromEntries(Object.entries(DEFAULT_MODELS[provider]).map(([tier, fallback]) =>
    [tier, env[`LEX_${provider.toUpperCase()}_MODEL_${tier.toUpperCase()}`] || fallback]));
}

// Uma única admissão compartilhada pelo bot e pelo agente vivo. Não mantém
// uma fila de requisições ilimitada em RAM nem dispara retries por sobrecarga local.
function createAdmission({ maxConcurrent = 2 } = {}) {
  let active = 0;
  return {
    async run(operation) {
      if (active >= maxConcurrent) {
        const error = new Error('LEX ocupado com outras tarefas de IA. Tente novamente em instantes.');
        error.code = 'LEX_AI_BUSY';
        error.status = 503;
        throw error;
      }
      active++;
      try { return await operation(); } finally { active--; }
    },
    get active() { return active; }
  };
}

const admission = createAdmission({maxConcurrent: positiveInteger(process.env.LEX_AI_MAX_CONCURRENT, 2, 20)});
module.exports = {modelsFor, positiveInteger, createAdmission, admission};
