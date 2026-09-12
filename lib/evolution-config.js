'use strict';

// Mesma configuracao para bootstrap, servidor e diagnostico.
function evolutionConfig(env = process.env) {
  return {
    url: String(env.EVOLUTION_URL || env.EVO_URL || '').replace(/\/+$/, ''),
    key: String(env.EVOLUTION_KEY || env.EVO_KEY || ''),
    instance: String(env.EVOLUTION_INSTANCE || env.EVO_INSTANCE || env.EVO_INST || 'LEX-JURIDICO')
  };
}

module.exports = {evolutionConfig};
