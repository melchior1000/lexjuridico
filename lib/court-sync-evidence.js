'use strict';

const {checkFreshness}=require('./freshness');
const {verifyReadingLogEntry}=require('./reading-log-schema');

const OFFICIAL_SOURCES=Object.freeze(['PJE','DJEN','DATAJUD']);
const MINTED=new WeakSet();

class CourtSyncEvidenceError extends Error{
  constructor(code,meta){super(code);this.name='CourtSyncEvidenceError';this.code=code;if(meta)this.meta=meta;}
}

function mintCourtSyncEvidence({readingId}={},deps={}){
  const {readingLog}=deps;
  if(!readingLog||typeof readingLog.get!=='function')throw new CourtSyncEvidenceError('reading_store_unavailable');
  if(typeof readingId!=='string'||!readingId)throw new CourtSyncEvidenceError('reading_ref_missing');
  const reading=readingLog.get(readingId);
  if(!reading)throw new CourtSyncEvidenceError('reading_not_found');
  const source=String(reading.source||'').toUpperCase();
  if(!OFFICIAL_SOURCES.includes(source))throw new CourtSyncEvidenceError('source_not_official',{source});
  if(!verifyReadingLogEntry(reading))throw new CourtSyncEvidenceError('reading_provenance_invalid');
  if(reading.ok!==true)throw new CourtSyncEvidenceError('reading_not_successful');
  if(reading.explicit_no_change!==true&&reading.movement_received!==true)throw new CourtSyncEvidenceError('reading_has_no_sync_result');
  const freshness=checkFreshness(reading,{now:deps.now,maxAgeMs:deps.maxAgeMs,maxClockSkewMs:deps.maxClockSkewMs});
  if(!freshness.fresh)throw new CourtSyncEvidenceError('reading_not_fresh',{reason:freshness.reason});
  const evidence=Object.freeze({reading_id:readingId,process_id:reading.process_id||null,source,observed_at:reading.observed_at,explicit_no_change:reading.explicit_no_change===true,movement_received:reading.movement_received===true});
  MINTED.add(evidence);
  return evidence;
}

function isCourtSyncEvidence(obj){return typeof obj==='object'&&obj!==null&&MINTED.has(obj);}

module.exports={mintCourtSyncEvidence,isCourtSyncEvidence,CourtSyncEvidenceError,_internal:{OFFICIAL_SOURCES}};
