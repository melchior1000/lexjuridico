'use strict';
const crypto=require('node:crypto');

const SECTORS=Object.freeze([
  Object.freeze({code:'recepcao',name:'Recepção',order:10}),
  Object.freeze({code:'cadastro',name:'Cadastro',order:20}),
  Object.freeze({code:'iniciais',name:'Iniciais',order:30}),
  Object.freeze({code:'processos',name:'Processos',order:40}),
  Object.freeze({code:'prazos',name:'Prazos',order:50}),
  Object.freeze({code:'pecas',name:'Peças',order:60}),
  Object.freeze({code:'pericia',name:'Perícia',order:70}),
  Object.freeze({code:'revisao',name:'Revisão',order:80}),
  Object.freeze({code:'concluidos',name:'Concluídos',order:90})
]);
const SECTOR_CODES=Object.freeze(SECTORS.map(s=>s.code));
const SECTOR_BY_CODE=Object.freeze(Object.fromEntries(SECTORS.map(s=>[s.code,s])));

function normalize(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}
function normalizeSector(value){
  const code=normalize(value);
  return SECTOR_BY_CODE[code]?code:null;
}
function assertSector(value){
  const code=normalizeSector(value);
  if(!code) throw new Error('Setor de destino inválido.');
  return code;
}
function newIntentId(prefix='intent'){
  return prefix+':'+crypto.randomUUID();
}
function buildSectorChanged({caseId,from,to,actor='LEX',agent='LEX Coordenador',reason='Transferência de setor',taskId=null,intentId=null,now=null}={}){
  const source=assertSector(from),target=assertSector(to);
  const at=now||new Date().toISOString();
  const id=crypto.randomUUID();
  const canonicalIntent=String(intentId||newIntentId('sector-change'));
  const payload={case_id:String(caseId??''),from:source,to:target,reason:String(reason||'Transferência de setor'),task_id:taskId||null};
  return {
    id,
    event_id:id,
    event_type:'case.sector_changed',
    intent_id:canonicalIntent,
    case_id:caseId??null,
    de:source,
    para:target,
    por:String(actor||agent||'LEX'),
    agente:String(agent||'LEX Coordenador'),
    motivo:payload.reason,
    task_id:taskId||null,
    payload,
    criado_em:at,
    outbox:{
      id:crypto.randomUUID(),
      event_id:id,
      intent_id:canonicalIntent,
      topic:'case.sector_changed',
      status:'pending',
      attempts:0,
      payload,
      criado_em:at,
      processado_em:null
    }
  };
}

module.exports={SECTORS,SECTOR_CODES,SECTOR_BY_CODE,normalizeSector,assertSector,newIntentId,buildSectorChanged};
