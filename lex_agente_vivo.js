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

function norm(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function specializedIntent(message) {
  const text=norm(message);
  if(/\b(jurisprudencia|precedentes?|sumula|tema repetitivo|tema de repercussao)\b/.test(text)&&/\b(pesquis|busc|levant|encontr|analise|analis)\w*/.test(text)) return 'jurisprudencia';
  if(/\b(juiz|juiza|relator|relatora|magistrad[oa]|desembargador[ae]?)\b/.test(text)&&/\b(analise|analisar|pesquis|perfil|padrao decisorio)\w*/.test(text)) return 'julgador';
  return null;
}

function processById(processos,id) {
  return Array.isArray(processos)?processos.find(p=>String(p?.id)===String(id)):null;
}

function namedJudgeFromMessage(message) {
  const m=String(message||'').match(/\b(?:juiz|ju[ií]za|relator(?:a)?|desembargador(?:a)?)\s+(.+?)\s+(?:do|da)\s+((?:TJ|TRF)\s*[A-Z0-9-]+|STJ|STF)\b/i);
  return m?{nome:m[1].trim().slice(0,160),tribunal:m[2].replace(/\s+/g,'').toUpperCase().slice(0,40)}:null;
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

    const specialist=specializedIntent(body.mensagem);
    if(specialist==='jurisprudencia'){
      const selected=processById(nextDeps.processos,processoId);
      const specialistBody={
        mensagem:body.mensagem,historico:body.historico||[],processo_id:processoId||null,
        tema:body.tema||body.mensagem,tribunal_alvo:body.tribunal_alvo||selected?.tribunal||null,
        movimentos_pje:body.movimentos_pje||[]
      };
      return core.tratarRota(req,res,'/api/vivo/juris/conversar',{...nextDeps,body:specialistBody});
    }
    if(specialist==='julgador'){
      const selected=processById(nextDeps.processos,processoId);
      const explicit=namedJudgeFromMessage(body.mensagem);
      const nome=body.nome_julgador||body.juiz||selected?.juiz||selected?.relator||explicit?.nome;
      const tribunal=body.tribunal||selected?.tribunal||explicit?.tribunal;
      if(!nome||!tribunal){
        jsonResponse(res,422,{error:'Selecione um processo com juiz/relator e tribunal identificados, ou informe o nome do julgador e o tribunal.',codigo:'JULGADOR_CONTEXTO_INSUFICIENTE'},nextDeps.CORS);
        return true;
      }
      const specialistBody={nome,tribunal,processo_id:processoId||null,mensagem:body.mensagem};
      return core.tratarRota(req,res,'/api/vivo/juiz/conversar',{...nextDeps,body:specialistBody});
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
  tratarRota,
  specializedIntent,
  namedJudgeFromMessage
};
