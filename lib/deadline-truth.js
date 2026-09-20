'use strict';
const crypto=require('node:crypto');
const {checkFreshness,toEpochMs,MAX_CLOCK_SKEW_MS}=require('./freshness');
const {verifyReadingLogEntry,canonical,resolveIntegrityKey}=require('./reading-log-schema');

const OFFICIAL_SOURCES=Object.freeze(['PJE','DJEN']);
const TRUTH_VERSION=2;
const MINTED=new WeakSet();

class DeadlineTruthError extends Error{
  constructor(code,meta){super(code);this.name='DeadlineTruthError';this.code=code;if(meta)this.meta=meta}
}
function truthPayload(truth){
  return{
    truth_version:Number(truth.truth_version)||0,
    legal_truth:truth.legal_truth===true,
    process_id:String(truth.process_id||''),
    due_at:String(truth.due_at||''),
    source:String(truth.source||'').toUpperCase(),
    source_ref:String(truth.source_ref||''),
    regime:String(truth.regime||''),
    observed_at:String(truth.observed_at||''),
    reading_id:String(truth.reading_id||''),
    authorization_id:String(truth.authorization_id||''),
    authorized_by:String(truth.authorized_by||''),
    authorized_at:String(truth.authorized_at||''),
    reading_binding_hmac:String(truth.reading_binding_hmac||''),
    minted_at:Number(truth.minted_at)||0
  };
}
function signTruth(truth,key){return crypto.createHmac('sha256',key).update(canonical(truthPayload(truth)),'utf8').digest('hex')}
function verifyDeadlineTruth(truth,opts={}){
  try{
    if(!truth||typeof truth!=='object'||truth.legal_truth!==true||truth.truth_version!==TRUTH_VERSION)return false;
    if(!truth.process_id||!truth.reading_id||!truth.authorization_id||!truth.authorized_by||!truth.authorized_at||!truth.observed_at)return false;
    if(!OFFICIAL_SOURCES.includes(String(truth.source||'').toUpperCase()))return false;
    if(toEpochMs(truth.due_at)===null||toEpochMs(truth.observed_at)===null||toEpochMs(truth.authorized_at)===null)return false;
    if(!truth.reading_binding_hmac)return false;
    const key=resolveIntegrityKey(opts.integrityKey);
    const expected=signTruth(truth,key),actual=String(truth.truth_hmac||'');
    if(actual.length!==expected.length)return false;
    return crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'));
  }catch{return false}
}
function mintDeadlineTruth(refs={},deps={}){
  const {readingId,authorizationId}=refs;
  const {readingLog,authorizationLog}=deps;
  if(!readingLog||typeof readingLog.get!=='function'||!authorizationLog||typeof authorizationLog.get!=='function')throw new DeadlineTruthError('stores_unavailable');
  if(typeof readingId!=='string'||!readingId)throw new DeadlineTruthError('reading_ref_missing');
  if(typeof authorizationId!=='string'||!authorizationId)throw new DeadlineTruthError('authorization_ref_missing');
  const reading=readingLog.get(readingId);
  if(!reading)throw new DeadlineTruthError('reading_not_found');
  if(!verifyReadingLogEntry(reading,{integrityKey:deps.integrityKey}))throw new DeadlineTruthError('reading_provenance_invalid');
  const source=String(reading.source||'').toUpperCase();
  if(!OFFICIAL_SOURCES.includes(source))throw new DeadlineTruthError('source_not_deadline_capable',{source});
  if(reading.process_id==null||String(reading.process_id).trim()==='')throw new DeadlineTruthError('reading_process_id_missing');

  const auth=authorizationLog.get(authorizationId);
  if(!auth)throw new DeadlineTruthError('authorization_not_found');
  if(!auth.human_id||!auth.authorized_at)throw new DeadlineTruthError('authorization_incomplete');
  if(String(auth.reading_id||'')!==readingId)throw new DeadlineTruthError('authorization_reading_mismatch');
  if(String(auth.process_id||'')!==String(reading.process_id))throw new DeadlineTruthError('authorization_process_mismatch');
  if(auth.due_at==null||String(auth.due_at).trim()==='')throw new DeadlineTruthError('authorization_due_at_missing');
  const dueMs=toEpochMs(auth.due_at);
  if(dueMs===null)throw new DeadlineTruthError('authorization_due_at_invalid');

  const now=Number.isFinite(deps.now)?deps.now:Date.now();
  const maxSkewMs=Number.isFinite(deps.maxClockSkewMs)?deps.maxClockSkewMs:MAX_CLOCK_SKEW_MS;
  const freshness=checkFreshness(reading,{now,maxAgeMs:deps.maxAgeMs,maxClockSkewMs:maxSkewMs});
  if(!freshness.fresh)throw new DeadlineTruthError('reading_not_fresh',{reason:freshness.reason});
  const observedMs=toEpochMs(reading.observed_at),authorizedMs=toEpochMs(auth.authorized_at);
  if(authorizedMs===null)throw new DeadlineTruthError('authorization_timestamp_invalid');
  if(observedMs===null||authorizedMs<observedMs)throw new DeadlineTruthError('authorization_before_reading');
  if(authorizedMs>now+maxSkewMs)throw new DeadlineTruthError('authorization_in_future');

  const key=resolveIntegrityKey(deps.integrityKey);
  const base={
    truth_version:TRUTH_VERSION,
    legal_truth:true,
    process_id:String(reading.process_id),
    due_at:String(auth.due_at),
    source,
    source_ref:String(auth.source_ref||reading.query_context?.source_ref||''),
    regime:String(auth.regime||'manual'),
    observed_at:reading.observed_at,
    reading_id:readingId,
    authorization_id:authorizationId,
    authorized_by:String(auth.human_id),
    authorized_at:new Date(authorizedMs).toISOString(),
    reading_binding_hmac:reading.integridade.binding_hmac,
    minted_at:now
  };
  const truth=Object.freeze({...base,truth_hmac:signTruth(base,key)});
  MINTED.add(truth);
  return truth;
}
function isLegalTruth(obj,opts={}){
  return typeof obj==='object'&&obj!==null&&(MINTED.has(obj)||verifyDeadlineTruth(obj,opts));
}
module.exports={mintDeadlineTruth,isLegalTruth,verifyDeadlineTruth,truthPayload,DeadlineTruthError,OFFICIAL_SOURCES,TRUTH_VERSION};
