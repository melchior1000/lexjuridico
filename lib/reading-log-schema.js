'use strict';
const crypto=require('node:crypto');

const OFFICIAL_SOURCES=Object.freeze(['datajud','pje','djen']);
const TRUSTED_CONNECTORS=Object.freeze(['lib/datajud','lib/pje-sync','lib/djen']);
function sha256(value){return crypto.createHash('sha256').update(String(value),'utf8').digest('hex');}
function isoMs(value){const t=Date.parse(String(value||''));return Number.isNaN(t)?null:t;}
function integrityMaterial(entry){
  const p=entry.proveniencia||{},receipt=String(entry.recibo?.raw_receipt??entry.raw_receipt??'');
  return JSON.stringify({
    version:'court-reading-v2',
    reading_id:String(entry.reading_id||''),
    processo:String(entry.processo||''),
    process_id:String(entry.process_id||''),
    source:String(entry.source||'').toLowerCase(),
    observed_at:String(entry.observed_at||''),
    ok:entry.ok===true,
    status_code:Number(entry.status_code)||0,
    proveniencia:{
      conector:String(p.conector||''),
      endpoint:String(p.endpoint||''),
      request_id:String(p.request_id||''),
      authenticated:p.authenticated===true,
      timestamp_requisicao:String(p.timestamp_requisicao||''),
      timestamp_resposta:String(p.timestamp_resposta||'')
    },
    due_at:entry.due_at==null?null:String(entry.due_at),
    explicit_no_change:entry.explicit_no_change===true,
    movement_received:entry.movement_received===true,
    raw_receipt:receipt
  });
}
function createReadingLogEntry(input={}){
  const source=String(input.source||'').toLowerCase();
  if(!OFFICIAL_SOURCES.includes(source))throw new Error('READING_SOURCE_NOT_OFFICIAL');
  if(!input.processo)throw new Error('READING_PROCESS_REQUIRED');
  if(input.process_id==null||String(input.process_id).trim()==='')throw new Error('READING_PROCESS_ID_REQUIRED');
  const raw=typeof input.raw_receipt==='string'?input.raw_receipt:JSON.stringify(input.raw_receipt??'');
  if(!raw)throw new Error('READING_RECEIPT_REQUIRED');
  const observedAt=String(input.observed_at||'');
  if(isoMs(observedAt)===null)throw new Error('READING_OBSERVED_AT_INVALID');
  const prov=input.proveniencia||{};
  if(!TRUSTED_CONNECTORS.includes(prov.conector))throw new Error('READING_CONNECTOR_NOT_TRUSTED');
  if(!prov.endpoint||!prov.request_id||prov.authenticated!==true)throw new Error('READING_PROVENANCE_INCOMPLETE');
  if(isoMs(prov.timestamp_requisicao)===null||isoMs(prov.timestamp_resposta)===null)throw new Error('READING_PROVENANCE_TIMESTAMP_INVALID');
  if(String(prov.timestamp_resposta)!==observedAt)throw new Error('READING_OBSERVED_AT_NOT_BOUND');
  if(isoMs(prov.timestamp_requisicao)>isoMs(prov.timestamp_resposta))throw new Error('READING_PROVENANCE_ORDER_INVALID');
  if(input.due_at!=null&&(typeof input.due_at!=='string'||Number.isNaN(Date.parse(input.due_at))))throw new Error('READING_DUE_AT_INVALID');
  const entry={
    reading_id:String(input.reading_id||crypto.randomUUID()),
    processo:String(input.processo),
    process_id:String(input.process_id),
    source,observed_at:observedAt,ok:input.ok===true,status_code:Number(input.status_code)||0,
    proveniencia:{conector:prov.conector,endpoint:String(prov.endpoint),request_id:String(prov.request_id),authenticated:true,timestamp_requisicao:String(prov.timestamp_requisicao),timestamp_resposta:String(prov.timestamp_resposta)},
    query_context:input.query_context&&typeof input.query_context==='object'?input.query_context:{},
    due_at:input.due_at==null?null:String(input.due_at),
    recibo:{raw_receipt:raw,metadata:input.metadata&&typeof input.metadata==='object'?input.metadata:{}},
    resultado:{movimentos_encontrados:Number(input.movimentos_encontrados)||0,ultimo_movimento:input.ultimo_movimento||null,sincronizado:input.sincronizado===true},
    explicit_no_change:input.explicit_no_change===true,
    movement_received:input.movement_received===true,
    raw_receipt:raw
  };
  entry.integridade={
    version:'court-reading-v2',
    response_hash:sha256(raw),
    record_hash:sha256(integrityMaterial(entry)),
    content_length:Buffer.byteLength(raw,'utf8'),
    content_type:String(input.content_type||'')
  };
  return Object.freeze({...entry,
    proveniencia:Object.freeze(entry.proveniencia),query_context:Object.freeze(entry.query_context),
    integridade:Object.freeze(entry.integridade),recibo:Object.freeze(entry.recibo),resultado:Object.freeze(entry.resultado)
  });
}
function verifyReadingLogEntry(entry){
  if(!entry||typeof entry!=='object')return false;
  if(!entry.reading_id||!entry.processo||!entry.process_id)return false;
  if(!OFFICIAL_SOURCES.includes(String(entry.source||'').toLowerCase()))return false;
  if(isoMs(entry.observed_at)===null)return false;
  const p=entry.proveniencia;
  if(!p||!TRUSTED_CONNECTORS.includes(p.conector)||!p.endpoint||!p.request_id||p.authenticated!==true)return false;
  if(isoMs(p.timestamp_requisicao)===null||isoMs(p.timestamp_resposta)===null)return false;
  if(String(p.timestamp_resposta)!==String(entry.observed_at))return false;
  if(isoMs(p.timestamp_requisicao)>isoMs(p.timestamp_resposta))return false;
  if(entry.due_at!=null&&(typeof entry.due_at!=='string'||Number.isNaN(Date.parse(entry.due_at))))return false;
  const raw=String(entry.recibo?.raw_receipt??'');
  if(!raw||String(entry.raw_receipt??'')!==raw)return false;
  if(!entry.integridade||entry.integridade.version!=='court-reading-v2')return false;
  if(entry.integridade.response_hash!==sha256(raw))return false;
  if(entry.integridade.content_length!==Buffer.byteLength(raw,'utf8'))return false;
  return entry.integridade.record_hash===sha256(integrityMaterial(entry));
}
module.exports={OFFICIAL_SOURCES,TRUSTED_CONNECTORS,createReadingLogEntry,verifyReadingLogEntry,sha256,_internal:{integrityMaterial,isoMs}};
