'use strict';

const core = require('./lex_agente_vivo_core');
const {executeNaturalOfficeCommand}=require('./lib/office-routes');

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

    if (nextDeps.engine && nextDeps.processStore) {
      try {
        const execution=await executeNaturalOfficeCommand(nextDeps,{
          text:body.mensagem,processo_id:processoId,profile:nextDeps.perfil,
          request_id:body.request_id||req?.headers?.['x-request-id']||undefined
        });
        if(execution?.handled){
          jsonResponse(res,200,{ok:true,texto:execution.message,execucao:{
            action:execution.command?.action||null,tipo:execution.command?.tipo||null,
            task_id:execution.task?.id||null,status:execution.result?.status||null,
            needs_input:!!execution.needs_input,candidates:execution.candidates||null
          },processo_id:execution.result?.processo_id||execution.command?.processo_id||processoId||null},nextDeps.CORS);
          return true;
        }
      } catch(e) {
        jsonResponse(res,e.status||422,{error:e.message,codigo:'LEX_EXECUCAO_FALHOU'},nextDeps.CORS);
        return true;
      }
    }
  }

  return core.tratarRota(req, res, url, nextDeps);
}

module.exports = {
  ...core,
  tratarRota
};
