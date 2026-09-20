'use strict';
const crypto=require('node:crypto');
const {checkFreshness,DEFAULT_MAX_AGE_MS}=require('./freshness');
const {mintDeadlineTruth,isLegalTruth}=require('./deadline-truth');
const {isCourtSyncEvidence}=require('./court-sync-evidence');

const STALE_AFTER_HOURS=DEFAULT_MAX_AGE_MS/36e5;
const SOURCES=Object.freeze({PJE:'pje',DJEN:'djen',DATAJUD:'datajud',LOCAL:'local_bridge',MANUAL:'manual'});
const OFFICIAL=new Set([SOURCES.PJE,SOURCES.DJEN,SOURCES.DATAJUD]);

function normalizeSource(input){
  const row=input&&typeof input==='object'?input:{};
  const source=String(row.source||'').toLowerCase();
  const verified=isCourtSyncEvidence(row);
  return Object.freeze({
    id:row.id||row.reading_id||null,
    process_id:row.process_id==null?null:String(row.process_id),
    source,
    official:verified&&OFFICIAL.has(source),
    verified,
    ok:row.ok===true,
    observed_at:row.observed_at||null,
    explicit_no_change:row.explicit_no_change===true,
    movement_received:row.movement_received===true,
    document_hash:row.document_hash||null,
    reference:row.reference||null,
    error:row.error||null
  });
}
function isFreshObservedAt(observedAt,now=new Date()){
  return checkFreshness({ok:true,observed_at:observedAt},{now:now.getTime()}).fresh;
}
function sourceState(readings=[],now=new Date()){
  const normalized=(Array.isArray(readings)?readings:[]).map(normalizeSource);
  const successful=normalized.filter(r=>r.ok&&(r.explicit_no_change||r.movement_received));
  const officialSuccessful=successful.filter(r=>r.official&&r.verified);
  const official=officialSuccessful.filter(r=>checkFreshness(r,{now:now.getTime()}).fresh);
  const rawOfficial=normalized.filter(r=>OFFICIAL.has(r.source)&&!r.verified);
  const failed=normalized.filter(r=>r.ok===false);
  let freshness='unknown';
  if(official.length)freshness='fresh';
  else if(officialSuccessful.length||rawOfficial.length||failed.length)freshness='stale';
  else if(successful.length)freshness='provisional';
  return Object.freeze({freshness,successful,official,official_successful:officialSuccessful,unverified_official:rawOfficial,failed,readings:normalized});
}
function deadlineTruth({suggested_due_at=null,confirmed_due_at=null}={}){
  const due=suggested_due_at||confirmed_due_at;
  return Object.freeze({due_at:due,status:due?'suggested':'unknown',legal_truth:false,authorization_id:null});
}
function deriveDeadlineTruth(refs,deps){return mintDeadlineTruth(refs,deps)}
function reconcile({case_id,readings=[],deadline={},intent_id,now=new Date(),truth=null}={}){
  const sources=sourceState(readings,now);
  const caseId=case_id==null?null:String(case_id);
  const minted=isLegalTruth(truth);
  const legal=minted&&caseId!==null&&truth.process_id!=null&&String(truth.process_id)===caseId;
  const d=legal?truth:deadlineTruth(deadline);
  const warnings=[];
  if(sources.freshness==='unknown')warnings.push('LEX não confirmou atualização em fonte judicial.');
  if(sources.freshness==='stale')warnings.push('Fonte judicial ausente, inválida, não verificada ou desatualizada; estado não confirmado.');
  if(sources.freshness==='provisional')warnings.push('Atualização local/manual é provisória até conferência em fonte oficial.');
  if(minted&&!legal)warnings.push('Verdade de prazo pertence a outro processo e foi rejeitada.');
  if(!legal&&d.status==='suggested')warnings.push('Prazo sugerido: exige leitura oficial auditável e autorização humana vinculada antes de virar prazo jurídico definitivo.');
  return Object.freeze({case_id:caseId,intent_id:String(intent_id||crypto.randomUUID()),sources,deadline:d,warnings,requires_human_attention:warnings.length>0||!legal});
}
function canStampOfficialSync(readings=[],now=new Date()){return sourceState(readings,now).official.length>0}
function bridgeEnvelope({case_id,path,sha256,observed_at=new Date().toISOString(),intent_id}={}){
  if(!case_id)throw new Error('CASE_ID_REQUIRED');
  if(!sha256)throw new Error('DOCUMENT_SHA256_REQUIRED');
  return Object.freeze({event_type:'document.received',intent_id:String(intent_id||crypto.randomUUID()),case_id:String(case_id),source:SOURCES.LOCAL,observed_at,payload:Object.freeze({path:path||null,sha256:String(sha256),authority:'input_only',can_confirm_deadline:false,can_file:false})});
}
module.exports={STALE_AFTER_HOURS,SOURCES,normalizeSource,isFreshObservedAt,sourceState,deadlineTruth,deriveDeadlineTruth,isLegalTruth,reconcile,canStampOfficialSync,bridgeEnvelope};
