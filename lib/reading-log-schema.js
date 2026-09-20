'use strict';
const crypto=require('node:crypto');

const OFFICIAL_SOURCES=Object.freeze(['datajud','pje','djen']);
const TRUSTED_CONNECTORS=Object.freeze(['lib/datajud','lib/pje-sync','lib/djen']);
const BINDING_VERSION=3;
const MIN_INTEGRITY_KEY_BYTES=32;

function sha256(value){return crypto.createHash('sha256').update(String(value),'utf8').digest('hex');}
function hmac256(value,key){return crypto.createHmac('sha256',key).update(String(value),'utf8').digest('hex');}
function assertIJson(value,path='
function asIso(value,code){
  const ms=Date.parse(String(value||''));
  if(!Number.isFinite(ms))throw new Error(code);
  return new Date(ms).toISOString();
}
function resolveIntegrityKey(explicit){
  const key=String(explicit||process.env.COURT_READING_INTEGRITY_KEY||'');
  if(Buffer.byteLength(key,'utf8')<MIN_INTEGRITY_KEY_BYTES)throw new Error('READING_INTEGRITY_KEY_REQUIRED');
  return key;
}
function rawText(value){
  if(typeof value==='string')return value;
  try{return JSON.stringify(value)}catch{return''}
}
function bindingPayload(entry){
  return{
    reading_id:String(entry.reading_id||''),
    processo:String(entry.processo||''),
    process_id:String(entry.process_id||''),
    source:String(entry.source||'').toLowerCase(),
    observed_at:String(entry.observed_at||''),
    ok:entry.ok===true,
    status_code:Number(entry.status_code)||0,
    proveniencia:{
      conector:String(entry.proveniencia?.conector||''),
      endpoint:String(entry.proveniencia?.endpoint||''),
      request_id:String(entry.proveniencia?.request_id||''),
      authenticated:entry.proveniencia?.authenticated===true,
      timestamp_requisicao:String(entry.proveniencia?.timestamp_requisicao||''),
      timestamp_resposta:String(entry.proveniencia?.timestamp_resposta||'')
    },
    query_context:entry.query_context&&typeof entry.query_context==='object'?entry.query_context:{},
    resultado:{
      movimentos_encontrados:Number(entry.resultado?.movimentos_encontrados)||0,
      ultimo_movimento:entry.resultado?.ultimo_movimento||null,
      sincronizado:entry.resultado?.sincronizado===true,
      explicit_no_change:entry.resultado?.explicit_no_change===true,
      movement_received:entry.resultado?.movement_received===true
    },
    due_at:entry.due_at==null?null:String(entry.due_at),
    response_hash:String(entry.integridade?.response_hash||''),
    content_type:String(entry.integridade?.content_type||''),
    metadata:entry.recibo?.metadata&&typeof entry.recibo.metadata==='object'?entry.recibo.metadata:{}
  };
}
function freezeEntry(entry){
  Object.freeze(entry.proveniencia);
  Object.freeze(entry.query_context);
  Object.freeze(entry.resultado);
  Object.freeze(entry.integridade);
  Object.freeze(entry.recibo.metadata);
  Object.freeze(entry.recibo);
  return Object.freeze(entry);
}
function createReadingLogEntry(input={},opts={}){
  const source=String(input.source||'').toLowerCase();
  if(!OFFICIAL_SOURCES.includes(source))throw new Error('READING_SOURCE_NOT_OFFICIAL');
  if(!input.processo)throw new Error('READING_PROCESS_REQUIRED');
  if(input.process_id==null||String(input.process_id).trim()==='')throw new Error('READING_PROCESS_ID_REQUIRED');
  const raw=rawText(input.raw_receipt);
  if(!raw)throw new Error('READING_RECEIPT_REQUIRED');
  const p=input.proveniencia||{};
  if(!TRUSTED_CONNECTORS.includes(p.conector))throw new Error('READING_CONNECTOR_NOT_TRUSTED');
  if(p.authenticated!==true)throw new Error('READING_NOT_AUTHENTICATED');
  if(!p.endpoint||!p.request_id||!p.timestamp_requisicao||!p.timestamp_resposta)throw new Error('READING_PROVENANCE_INCOMPLETE');
  const requestedAt=asIso(p.timestamp_requisicao,'READING_REQUEST_TIMESTAMP_INVALID');
  const respondedAt=asIso(p.timestamp_resposta,'READING_RESPONSE_TIMESTAMP_INVALID');
  if(Date.parse(requestedAt)>Date.parse(respondedAt))throw new Error('READING_PROVENANCE_TIME_ORDER_INVALID');
  const observedAt=asIso(input.observed_at||respondedAt,'READING_OBSERVED_AT_INVALID');
  if(Date.parse(observedAt)!==Date.parse(respondedAt))throw new Error('READING_OBSERVED_AT_NOT_BOUND_TO_RESPONSE');
  const dueAt=input.due_at==null?null:String(input.due_at);
  if(dueAt!==null&&!Number.isFinite(Date.parse(dueAt)))throw new Error('READING_DUE_AT_INVALID');
  const explicitNoChange=input.explicit_no_change===true;
  const movementReceived=input.movement_received===true;
  const queryContext=input.query_context&&typeof input.query_context==='object'?structuredClone(input.query_context):{};
  const metadata=input.metadata&&typeof input.metadata==='object'?structuredClone(input.metadata):{};
  assertIJson(queryContext,'$.query_context');assertIJson(metadata,'$.metadata');
  const responseHash=sha256(raw);
  const entry={
    reading_id:String(input.reading_id||crypto.randomUUID()),
    processo:String(input.processo),
    process_id:String(input.process_id),
    source,
    observed_at:observedAt,
    ok:input.ok===true,
    status_code:Number(input.status_code)||0,
    proveniencia:{
      conector:String(p.conector),
      endpoint:String(p.endpoint),
      request_id:String(p.request_id),
      authenticated:true,
      timestamp_requisicao:requestedAt,
      timestamp_resposta:respondedAt
    },
    query_context:queryContext,
    resultado:{
      movimentos_encontrados:Number(input.movimentos_encontrados)||0,
      ultimo_movimento:input.ultimo_movimento||null,
      sincronizado:input.sincronizado===true,
      explicit_no_change:explicitNoChange,
      movement_received:movementReceived
    },
    explicit_no_change:explicitNoChange,
    movement_received:movementReceived,
    due_at:dueAt,
    integridade:{
      binding_version:BINDING_VERSION,
      response_hash:responseHash,
      content_length:Buffer.byteLength(raw,'utf8'),
      content_type:String(input.content_type||''),
      binding_hmac:''
    },
    recibo:{
      raw_receipt:raw,
      metadata
    },
    raw_receipt:raw
  };
  const key=resolveIntegrityKey(opts.integrityKey);
  entry.integridade.binding_hmac=hmac256(canonical(bindingPayload(entry)),key);
  return freezeEntry(entry);
}
function verifyReadingLogEntry(entry,opts={}){
  try{
    if(!entry||typeof entry!=='object')return false;
    if(!OFFICIAL_SOURCES.includes(String(entry.source||'').toLowerCase()))return false;
    if(!entry.reading_id||!entry.processo||entry.process_id==null||String(entry.process_id).trim()==='')return false;
    if(typeof entry.ok!=='boolean'||!entry.observed_at)return false;
    const p=entry.proveniencia;
    if(!p||!TRUSTED_CONNECTORS.includes(p.conector)||p.authenticated!==true||!p.endpoint||!p.request_id||!p.timestamp_requisicao||!p.timestamp_resposta)return false;
    const observed=Date.parse(String(entry.observed_at)),requested=Date.parse(String(p.timestamp_requisicao)),responded=Date.parse(String(p.timestamp_resposta));
    if(![observed,requested,responded].every(Number.isFinite)||requested>responded||observed!==responded)return false;
    if(entry.due_at!=null&&!Number.isFinite(Date.parse(String(entry.due_at))))return false;
    const raw=String(entry.recibo?.raw_receipt||'');
    if(!raw||String(entry.raw_receipt||raw)!==raw)return false;
    if(entry.integridade?.binding_version!==BINDING_VERSION)return false;
    if(entry.integridade.response_hash!==sha256(raw))return false;
    if(entry.integridade.content_length!==Buffer.byteLength(raw,'utf8'))return false;
    assertIJson(entry.query_context,'$.query_context');assertIJson(entry.recibo?.metadata||{},'$.metadata');
    if(!entry.resultado||entry.explicit_no_change!== (entry.resultado.explicit_no_change===true))return false;
    if(entry.movement_received!== (entry.resultado.movement_received===true))return false;
    const key=resolveIntegrityKey(opts.integrityKey);
    const expected=hmac256(canonical(bindingPayload(entry)),key);
    const actual=String(entry.integridade.binding_hmac||'');
    if(actual.length!==expected.length)return false;
    return crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'));
  }catch{return false}
}
module.exports={OFFICIAL_SOURCES,TRUSTED_CONNECTORS,BINDING_VERSION,MIN_INTEGRITY_KEY_BYTES,createReadingLogEntry,verifyReadingLogEntry,sha256,canonical,bindingPayload,assertIJson,resolveIntegrityKey};
){
  if(value===null||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('READING_IJSON_INVALID:'+path);return}
  if(Array.isArray(value)){
    for(let i=0;i<value.length;i++){if(!(i in value)||value[i]===undefined)throw new Error('READING_IJSON_INVALID:'+path+'['+i+']');assertIJson(value[i],path+'['+i+']')}
    return;
  }
  if(typeof value==='object'){
    for(const key of Object.keys(value)){if(value[key]===undefined)throw new Error('READING_IJSON_INVALID:'+path+'.'+key);assertIJson(value[key],path+'.'+key)}
    return;
  }
  throw new Error('READING_IJSON_INVALID:'+path);
}
function canonical(value){
  assertIJson(value);
  if(value===null)return'null';
  if(Array.isArray(value))return'['+value.map(canonical).join(',')+']';
  if(typeof value==='object')return'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function asIso(value,code){
  const ms=Date.parse(String(value||''));
  if(!Number.isFinite(ms))throw new Error(code);
  return new Date(ms).toISOString();
}
function resolveIntegrityKey(explicit){
  const key=String(explicit||process.env.COURT_READING_INTEGRITY_KEY||'');
  if(Buffer.byteLength(key,'utf8')<MIN_INTEGRITY_KEY_BYTES)throw new Error('READING_INTEGRITY_KEY_REQUIRED');
  return key;
}
function rawText(value){
  if(typeof value==='string')return value;
  try{return JSON.stringify(value)}catch{return''}
}
function bindingPayload(entry){
  return{
    processo:String(entry.processo||''),
    process_id:String(entry.process_id||''),
    source:String(entry.source||'').toLowerCase(),
    observed_at:String(entry.observed_at||''),
    ok:entry.ok===true,
    status_code:Number(entry.status_code)||0,
    proveniencia:{
      conector:String(entry.proveniencia?.conector||''),
      endpoint:String(entry.proveniencia?.endpoint||''),
      request_id:String(entry.proveniencia?.request_id||''),
      authenticated:entry.proveniencia?.authenticated===true,
      timestamp_requisicao:String(entry.proveniencia?.timestamp_requisicao||''),
      timestamp_resposta:String(entry.proveniencia?.timestamp_resposta||'')
    },
    query_context:entry.query_context&&typeof entry.query_context==='object'?entry.query_context:{},
    resultado:{
      movimentos_encontrados:Number(entry.resultado?.movimentos_encontrados)||0,
      ultimo_movimento:entry.resultado?.ultimo_movimento||null,
      sincronizado:entry.resultado?.sincronizado===true,
      explicit_no_change:entry.resultado?.explicit_no_change===true,
      movement_received:entry.resultado?.movement_received===true
    },
    due_at:entry.due_at==null?null:String(entry.due_at),
    response_hash:String(entry.integridade?.response_hash||'')
  };
}
function freezeEntry(entry){
  Object.freeze(entry.proveniencia);
  Object.freeze(entry.query_context);
  Object.freeze(entry.resultado);
  Object.freeze(entry.integridade);
  Object.freeze(entry.recibo.metadata);
  Object.freeze(entry.recibo);
  return Object.freeze(entry);
}
function createReadingLogEntry(input={},opts={}){
  const source=String(input.source||'').toLowerCase();
  if(!OFFICIAL_SOURCES.includes(source))throw new Error('READING_SOURCE_NOT_OFFICIAL');
  if(!input.processo)throw new Error('READING_PROCESS_REQUIRED');
  if(input.process_id==null||String(input.process_id).trim()==='')throw new Error('READING_PROCESS_ID_REQUIRED');
  const raw=rawText(input.raw_receipt);
  if(!raw)throw new Error('READING_RECEIPT_REQUIRED');
  const p=input.proveniencia||{};
  if(!TRUSTED_CONNECTORS.includes(p.conector))throw new Error('READING_CONNECTOR_NOT_TRUSTED');
  if(p.authenticated!==true)throw new Error('READING_NOT_AUTHENTICATED');
  if(!p.endpoint||!p.request_id||!p.timestamp_requisicao||!p.timestamp_resposta)throw new Error('READING_PROVENANCE_INCOMPLETE');
  const requestedAt=asIso(p.timestamp_requisicao,'READING_REQUEST_TIMESTAMP_INVALID');
  const respondedAt=asIso(p.timestamp_resposta,'READING_RESPONSE_TIMESTAMP_INVALID');
  if(Date.parse(requestedAt)>Date.parse(respondedAt))throw new Error('READING_PROVENANCE_TIME_ORDER_INVALID');
  const observedAt=asIso(input.observed_at||respondedAt,'READING_OBSERVED_AT_INVALID');
  if(Date.parse(observedAt)!==Date.parse(respondedAt))throw new Error('READING_OBSERVED_AT_NOT_BOUND_TO_RESPONSE');
  const dueAt=input.due_at==null?null:String(input.due_at);
  if(dueAt!==null&&!Number.isFinite(Date.parse(dueAt)))throw new Error('READING_DUE_AT_INVALID');
  const explicitNoChange=input.explicit_no_change===true;
  const movementReceived=input.movement_received===true;
  const responseHash=sha256(raw);
  const entry={
    reading_id:String(input.reading_id||crypto.randomUUID()),
    processo:String(input.processo),
    process_id:String(input.process_id),
    source,
    observed_at:observedAt,
    ok:input.ok===true,
    status_code:Number(input.status_code)||0,
    proveniencia:{
      conector:String(p.conector),
      endpoint:String(p.endpoint),
      request_id:String(p.request_id),
      authenticated:true,
      timestamp_requisicao:requestedAt,
      timestamp_resposta:respondedAt
    },
    query_context:input.query_context&&typeof input.query_context==='object'?structuredClone(input.query_context):{},
    resultado:{
      movimentos_encontrados:Number(input.movimentos_encontrados)||0,
      ultimo_movimento:input.ultimo_movimento||null,
      sincronizado:input.sincronizado===true,
      explicit_no_change:explicitNoChange,
      movement_received:movementReceived
    },
    explicit_no_change:explicitNoChange,
    movement_received:movementReceived,
    due_at:dueAt,
    integridade:{
      binding_version:BINDING_VERSION,
      response_hash:responseHash,
      content_length:Buffer.byteLength(raw,'utf8'),
      content_type:String(input.content_type||''),
      binding_hmac:''
    },
    recibo:{
      raw_receipt:raw,
      metadata:input.metadata&&typeof input.metadata==='object'?structuredClone(input.metadata):{}
    },
    raw_receipt:raw
  };
  const key=resolveIntegrityKey(opts.integrityKey);
  entry.integridade.binding_hmac=hmac256(canonical(bindingPayload(entry)),key);
  return freezeEntry(entry);
}
function verifyReadingLogEntry(entry,opts={}){
  try{
    if(!entry||typeof entry!=='object')return false;
    if(!OFFICIAL_SOURCES.includes(String(entry.source||'').toLowerCase()))return false;
    if(!entry.reading_id||!entry.processo||entry.process_id==null||String(entry.process_id).trim()==='')return false;
    if(typeof entry.ok!=='boolean'||!entry.observed_at)return false;
    const p=entry.proveniencia;
    if(!p||!TRUSTED_CONNECTORS.includes(p.conector)||p.authenticated!==true||!p.endpoint||!p.request_id||!p.timestamp_requisicao||!p.timestamp_resposta)return false;
    const observed=Date.parse(String(entry.observed_at)),requested=Date.parse(String(p.timestamp_requisicao)),responded=Date.parse(String(p.timestamp_resposta));
    if(![observed,requested,responded].every(Number.isFinite)||requested>responded||observed!==responded)return false;
    if(entry.due_at!=null&&!Number.isFinite(Date.parse(String(entry.due_at))))return false;
    const raw=String(entry.recibo?.raw_receipt||'');
    if(!raw||String(entry.raw_receipt||raw)!==raw)return false;
    if(entry.integridade?.binding_version!==BINDING_VERSION)return false;
    if(entry.integridade.response_hash!==sha256(raw))return false;
    if(entry.integridade.content_length!==Buffer.byteLength(raw,'utf8'))return false;
    if(!entry.resultado||entry.explicit_no_change!== (entry.resultado.explicit_no_change===true))return false;
    if(entry.movement_received!== (entry.resultado.movement_received===true))return false;
    const key=resolveIntegrityKey(opts.integrityKey);
    const expected=hmac256(canonical(bindingPayload(entry)),key);
    const actual=String(entry.integridade.binding_hmac||'');
    if(actual.length!==expected.length)return false;
    return crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'));
  }catch{return false}
}
module.exports={OFFICIAL_SOURCES,TRUSTED_CONNECTORS,BINDING_VERSION,MIN_INTEGRITY_KEY_BYTES,createReadingLogEntry,verifyReadingLogEntry,sha256,canonical,bindingPayload};
