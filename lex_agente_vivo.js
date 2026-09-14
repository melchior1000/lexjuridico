'use strict';

const core = require('./lex_agente_vivo_core');

function jsonResponse(res, status, obj, CORS) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, CORS || {
    'Access-Control-Allow-Origin': '*'
  });
  res.writeHead(status, headers);
  res.end(JSON.stringify(obj));
}

function processoExiste(processos, processoId) {
  if (!Array.isArray(processos)) return false;
  return processos.some(p => String(p && p.id) === String(processoId));
}

async function tratarRota(req, res, url, deps) {
  const cleanUrl = url ? url.split('?')[0].replace(/\/+$/, '') : '';
  let nextDeps = deps || {};

  if (cleanUrl === '/api/vivo/conversar' && req && req.method === 'POST') {
    let body = nextDeps.body && typeof nextDeps.body === 'object' ? nextDeps.body : null;
    if (!body && typeof nextDeps.lerBody === 'function') {
      body = await nextDeps.lerBody(req);
      nextDeps = { ...nextDeps, body };
    }
    body = body && typeof body === 'object' ? body : {};

    const processoId = body.processo_id;
    if (processoId != null && String(processoId).trim() && !processoExiste(nextDeps.processos, processoId)) {
      jsonResponse(res, 404, {
        error: 'Processo não encontrado. Atualize a carteira e selecione novamente antes de conversar com o LEX.',
        codigo: 'PROCESSO_CONTEXTO_INVALIDO'
      }, nextDeps.CORS);
      return true;
    }
  }

  return core.tratarRota(req, res, url, nextDeps);
}

module.exports = {
  ...core,
  tratarRota
};
