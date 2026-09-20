'use strict';
const crypto=require('node:crypto');
const {checkFreshness,_internal:{DEFAULT_MAX_AGE_MS}}=require('./freshness');
const {verifyReadingLogEntry}=require('./reading-log-schema');
const {mintDeadlineTruth,isLegalTruth}=require('./deadline-truth');
const {isCourtSyncEvidence}=require('./court-sync-evidence');

const STALE_AFTER_HOURS=DEFAULT_MAX_AGE_MS/36e5;
const SOURCES=Object.freeze({PJE:'pje',DJEN:'djen',DATAJUD:'datajud',LOCAL:'local_bridge',MANUAL:'manual'});
const OFFICIAL=new Set([SOURCES.PJE,SOURCES.DJEN,SOURCES.DATAJUD]);

function normalizeSource(input={}){
  input=input&&typeof input==='object'?input:{};
  const source=String(input.source||'').toLowerCase();
  return Object.freeze({
    id:input.reading_id||input.id||null,
    process_id:input.process_id||null,
    source,
    official:OFFICIAL.has(source),
    ok:input.ok===true,
    observed_at:input.observed_at||null,
    explicit_no_change:input.explicit_no_change===true,
    movement_received:input.movement_received===true,
    error:input.error||null
  });
}
function isFreshObservedAt(observedAt,now=new Date()){
  return checkFreshness({ok:true,observed_at:observedAt},{now:now.getTime()}).fresh;
}
function sourceState(readings=[],now=new Date()){
  const originals=Array.isArray(readings)?readings:[];
  const normalized=originals.map(normalizeSource);
  const successful=normalized.filter(r=>r.ok&&(r.explicit_no_change||r.movement_received));
  const officialSuccessful=successful.filter(r=>r.official);
  const verifiedOfficial=originals.filter((r,i)=>
    officialSuccessful.includes(normalized[i])&&verifyReadingLogEntry(r)&&checkFreshness(r,{now:now.getTime()}).fresh
  ).map(normalizeSource);
  const failed=normalized.filter(r=>!r.ok);
  let freshness='unknown';
  if(verifiedOfficial.length)freshness='fresh';
  else if(officialSuccessful.length||failed.length)freshness='stale';
  else if(successful.length)freshness='provisional';
  return Object.freeze({freshness,successful,official:verifiedOfficial,official_successful:officialSuccessful,failed,readings:normalized});
}
function deadlineTruth({suggested_due_at=null,confirmed_due_at=null}={}){
  const due=suggested_due_at||confirmed_due_at;
  return Object.freeze({due_at:due,status:due?'suggested':'unknown',legal_truth:false,authorization_id:null});
}
function deriveDeadlineTruth(refs,deps){return mintDeadlineTruth(refs,deps);}
function reconcile({case_id,readings=[],deadline={},intent_id,now=new Date(),truth=null}={}){
  const sources=sourceState(readings,now);
  const legal=isLegalTruth(truth)&&case_id!=null&&truth.process_id!=null&&String(truth.process_id)===String(case_id);
  const d=legal?truth:deadlineTruth(deadline);
  const warnings=[];
  if(sources.freshness==='unknown')warnings.push('LEX não confirmou atualização em fonte judicial.');
  if(sources.freshness==='stale')warnings.push('Fontes judiciais indisponíveis, inválidas ou desatualizadas; estado não confirmado.');
  if(sources.freshness==='provisional')warnings.push('Atualização local/manual é provisória até conferência em fonte oficial.');
  if(isLegalTruth(truth)&&!legal)warnings.push('Confirmação de prazo pertence a outro processo ou não possui vínculo processual válido.');
  if(!legal&&d.status==='suggested')warnings.push('Prazo sugerido: exige leitura oficial auditável e autorização humana vinculada antes de virar prazo jurídico definitivo.');
  return Object.freeze({case_id:case_id||null,intent_id:String(intent_id||crypto.randomUUID()),sources,deadline:d,warnings,requires_human_attention:warnings.length>0||!legal});
}
function canStampOfficialSync(evidence,now=new Date()){
  const list=Array.isArray(evidence)?evidence:[evidence];
  return list.some(e=>isCourtSyncEvidence(e)&&checkFreshness({ok:true,observed_at:e.observed_at},{now:now.getTime()}).fresh);
}
function bridgeEnvelope({case_id,path,sha256,observed_at=new Date().toISOString(),intent_id}={}){
  if(!case_id)throw new Error('CASE_ID_REQUIRED');
  if(!sha256)throw new Error('DOCUMENT_SHA256_REQUIRED');
  return Object.freeze({
    event_type:'document.received',
    intent_id:String(intent_id||crypto.randomUUID()),
    case_id:String(case_id),
    source:SOURCES.LOCAL,
    observed_at,
    payload:Object.freeze({path:path||null,sha256:String(sha256),authority:'input_only',can_confirm_deadline:false,can_file:false})
  });
}
module.exports={STALE_AFTER_HOURS,SOURCES,normalizeSource,isFreshObservedAt,sourceState,deadlineTruth,deriveDeadlineTruth,isLegalTruth,reconcile,canStampOfficialSync,bridgeEnvelope};
