'use strict';
const {checkFreshness}=require('./freshness');
const {verifyReadingLogEntry}=require('./reading-log-schema');
const OFFICIAL_SOURCES=Object.freeze(['PJE','DJEN','DATAJUD']);
const MINTED=new WeakSet();

class CourtSyncEvidenceError extends Error{
  constructor(code,meta){super(code);this.name='CourtSyncEvidenceError';this.code=code;if(meta)this.meta=meta;}
}

function mintCourtSyncEvidenceFromReading(reading,deps={}){
  if(!reading)throw new CourtSyncEvidenceError('reading_not_found');
  if(!verifyReadingLogEntry(reading))throw new CourtSyncEvidenceError('reading_provenance_invalid');
  if(reading.process_id==null||String(reading.process_id).trim()==='')throw new CourtSyncEvidenceError('reading_process_missing');
  const source=String(reading.source||'').toUpperCase();
  if(!OFFICIAL_SOURCES.includes(source))throw new CourtSyncEvidenceError('source_not_official',{source});
  if(reading.ok!==true)throw new CourtSyncEvidenceError('reading_not_successful');
  const noChange=reading.explicit_no_change===true,movement=reading.movement_received===true;
  if(noChange===movement)throw new CourtSyncEvidenceError('reading_has_no_unique_sync_result');
  const freshness=checkFreshness(reading,{now:deps.now,maxAgeMs:deps.maxAgeMs,maxClockSkewMs:deps.maxClockSkewMs});
  if(!freshness.fresh)throw new CourtSyncEvidenceError('reading_not_fresh',{reason:freshness.reason});
  const evidence=Object.freeze({reading_id:reading.reading_id,process_id:String(reading.process_id),source,observed_at:reading.observed_at,explicit_no_change:noChange,movement_received:movement});
  MINTED.add(evidence);
  return evidence;
}
function mintCourtSyncEvidence({readingId}={},deps={}){
  if(!deps.readingLog||typeof deps.readingLog.get!=='function')throw new CourtSyncEvidenceError('reading_store_unavailable');
  if(typeof readingId!=='string'||!readingId)throw new CourtSyncEvidenceError('reading_ref_missing');
  return mintCourtSyncEvidenceFromReading(deps.readingLog.get(readingId),deps);
}
function isCourtSyncEvidence(obj){return typeof obj==='object'&&obj!==null&&MINTED.has(obj);}
module.exports={mintCourtSyncEvidence,mintCourtSyncEvidenceFromReading,isCourtSyncEvidence,CourtSyncEvidenceError,_internal:{OFFICIAL_SOURCES}};
