'use strict';
const crypto=require('node:crypto');

const OFFICIAL_SOURCES=Object.freeze(['datajud','pje','djen']);
const TRUSTED_CONNECTORS=Object.freeze(['lib/datajud','lib/pje-sync','lib/connector','lib/djen']);

function sha256(value){return crypto.createHash('sha256').update(String(value),'utf8').digest('hex')}

function createReadingLogEntry(input={}){
  const source=String(input.source||'').toLowerCase();
  if(!OFFICIAL_SOURCES.includes(source))throw new Error('READING_SOURCE_NOT_OFFICIAL');
  if(!input.processo)throw new Error('READING_PROCESS_REQUIRED');
  if(!input.raw_receipt)throw new Error('READING_RECEIPT_REQUIRED');
  if(!input.proveniencia||!TRUSTED_CONNECTORS.includes(input.proveniencia.conector))throw new Error('READING_CONNECTOR_NOT_TRUSTED');
  const raw=String(input.raw_receipt),observedAt=String(input.observed_at||new Date().toISOString());
  const entry={
    reading_id:String(input.reading_id||crypto.randomUUID()),
    processo:String(input.processo),
    process_id:input.process_id==null?null:String(input.process_id),
    source,observed_at:observedAt,ok:input.ok===true,status_code:Number(input.status_code)||0,
    due_at:input.due_at==null?null:String(input.due_at),
    proveniencia:{
      conector:input.proveniencia.conector,
      endpoint:String(input.proveniencia.endpoint||''),
      request_id:String(input.proveniencia.request_id||crypto.randomUUID()),
      authenticated:input.proveniencia.authenticated===true,
      timestamp_requisicao:String(input.proveniencia.timestamp_requisicao||''),
      timestamp_resposta:String(input.proveniencia.timestamp_resposta||'')
    },
    query_context:input.query_context&&typeof input.query_context==='object'?input.query_context:{},
    integridade:{response_hash:sha256(raw),content_length:Buffer.byteLength(raw,'utf8'),content_type:String(input.content_type||'')},
    recibo:{raw_receipt:raw,metadata:input.metadata&&typeof input.metadata==='object'?input.metadata:{}},
    resultado:{movimentos_encontrados:Number(input.movimentos_encontrados)||0,ultimo_movimento:input.ultimo_movimento||null,sincronizado:input.sincronizado===true},
    explicit_no_change:input.explicit_no_change===true,
    movement_received:input.movement_received===true,
    raw_receipt:raw
  };
  return Object.freeze({...entry,proveniencia:Object.freeze(entry.proveniencia),query_context:Object.freeze(entry.query_context),integridade:Object.freeze(entry.integridade),recibo:Object.freeze(entry.recibo),resultado:Object.freeze(entry.resultado)});
}

function verifyReadingLogEntry(entry){
  if(!entry||typeof entry!=='object')return false;
  if(!OFFICIAL_SOURCES.includes(String(entry.source||'').toLowerCase()))return false;
  if(!entry.reading_id||!entry.processo||entry.ok!==true||!entry.observed_at)return false;
  if(!entry.proveniencia||!TRUSTED_CONNECTORS.includes(entry.proveniencia.conector)||entry.proveniencia.authenticated!==true||!entry.proveniencia.endpoint||!entry.proveniencia.request_id||!entry.proveniencia.timestamp_requisicao||!entry.proveniencia.timestamp_resposta)return false;
  if(!entry.query_context||typeof entry.query_context!=='object')return false;
  if(!entry.recibo?.raw_receipt||!entry.integridade?.response_hash)return false;
  const raw=String(entry.recibo.raw_receipt);
  return entry.integridade.response_hash===sha256(raw)&&entry.integridade.content_length===Buffer.byteLength(raw,'utf8');
}

module.exports={OFFICIAL_SOURCES,TRUSTED_CONNECTORS,createReadingLogEntry,verifyReadingLogEntry,sha256};
