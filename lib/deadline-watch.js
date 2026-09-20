'use strict';
const crypto=require('node:crypto');
const flow=require('./workflow');
const {appendToCase}=require('./event-ledger');
const Bridge=require('./hybrid-court-bridge');
const {checkFreshness}=require('./freshness');
const {verifyReadingLogEntry}=require('./reading-log-schema');
const {isCourtSyncEvidence,mintCourtSyncEvidenceFromReading}=require('./court-sync-evidence');

const STALE_AFTER_HOURS=Bridge.STALE_AFTER_HOURS;

function todaySP(now=new Date()){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(now);
}
function canReachCourt(session={}){
  return session.device==='desktop'&&session.pje_session==='confirmed'&&session.tj_reachable===true;
}
function latestVerifiedReading(p){
  return (Array.isArray(p?.court_readings)?p.court_readings:[])
    .filter(r=>verifyReadingLogEntry(r)&&String(r.process_id)===String(p.id))
    .sort((a,b)=>String(b.observed_at).localeCompare(String(a.observed_at)))[0]||null;
}
function resolveEvidence(p,now,syncEvidence){
  if(isCourtSyncEvidence(syncEvidence)&&String(syncEvidence.process_id)===String(p.id))return syncEvidence;
  const reading=latestVerifiedReading(p);
  if(!reading)return null;
  try{return mintCourtSyncEvidenceFromReading(reading,{now:now.getTime()});}catch{return null;}
}
function freshnessOf(p,now=new Date(),syncEvidence=null){
  const due=flow.date(p.prazoReal||p.prazo);
  const reading=latestVerifiedReading(p);
  const evidence=resolveEvidence(p,now,syncEvidence);
  let freshness='unknown',synced=null,source=null;
  if(evidence){
    freshness='fresh';
    synced=evidence.observed_at;
    source=String(evidence.source).toLowerCase();
  }else if(reading){
    const hasSyncResult=reading.explicit_no_change===true||reading.movement_received===true;
    const f=checkFreshness(reading,{now:now.getTime()});
    freshness=hasSyncResult?(f.fresh?'unknown':'stale'):'unknown';
    synced=reading.observed_at;
    source=reading.source;
  }
  const days=due?Math.round((Date.parse(due)-Date.parse(todaySP(now)))/86400000):null;
  const authority=Bridge.deadlineTruth({suggested_due_at:due});
  return Object.freeze({
    case_id:p.id||null,prazo:due,days_to_due:days,
    last_court_sync_at:synced,last_court_sync_source:source,freshness,
    fatal_unconfirmed:true,deadline_status:authority.status,deadline_legal_truth:false
  });
}
function sessionBlockMessage(s={}){
  if(s.device==='mobile'&&!canReachCourt(s))return'LEX não atualizou prazo: sem acesso ao TJ neste dispositivo.';
  if(s.pje_session==='expired')return'LEX não atualizou prazo: sessão do PJe expirada.';
  if(s.pje_session==='absent'||s.tj_reachable===false)return'LEX não atualizou prazo: sem acesso ao TJ.';
  return null;
}
function evidenceForProcess(evidences,p){
  return(Array.isArray(evidences)?evidences:[]).find(e=>isCourtSyncEvidence(e)&&String(e.process_id)===String(p.id))||null;
}
function watchlist(processes,now=new Date(),syncEvidences=[]){
  return(Array.isArray(processes)?processes:[])
    .filter(p=>!flow.CLOSED.has(String(p.status||'').toUpperCase()))
    .map(p=>{
      const f=freshnessOf(p,now,evidenceForProcess(syncEvidences,p));
      const last=Array.isArray(p.andamentos)&&p.andamentos[0]?p.andamentos[0]:null;
      return Object.freeze({...f,titulo:p.nome||p.numero||p.id,intimacao:last?{data:last.data,texto:last.txt||last.texto||''}:null,proxacao:p.proxacao||null,needs_human_deadline_check:f.freshness!=='fresh'||!f.deadline_legal_truth||f.days_to_due==null||f.days_to_due<=5});
    })
    .sort((a,b)=>(a.days_to_due==null?9999:a.days_to_due)-(b.days_to_due==null?9999:b.days_to_due));
}
async function openOfficeWatch({processes,session,intent_id,actor_id='LEX',syncFn,now=new Date()}){
  const intent=String(intent_id||crypto.randomUUID());
  const block=sessionBlockMessage(session);
  const base={intent_id:intent,actor_type:'system',actor_id,event_type:'court_sync_attempted',payload:{device:session?.device||null,pje_session:session?.pje_session||null,tj_reachable:session?.tj_reachable===true}};
  if(block||typeof syncFn!=='function'||!canReachCourt(session)){
    const warning=block||'LEX não atualizou prazo: sem acesso ao TJ.';
    return Object.freeze({ok:false,intent_id:intent,synced:false,warning,items:watchlist(processes,now).map(i=>({...i,warning})),ledger_event:{...base,result:'blocked',payload:{...base.payload,warning}}});
  }
  const result=await syncFn({processes,session,intent_id:intent,now});
  const evidences=(Array.isArray(result?.sync_evidences)?result.sync_evidences:[]).filter(isCourtSyncEvidence);
  const explicit=evidences.length>0;
  const after=result?.processes||processes;
  return Object.freeze({
    ok:explicit,intent_id:intent,synced:explicit,
    warning:explicit?null:(result?.warning||'LEX não atualizou prazo: fonte oficial sem evidência verificada.'),
    items:watchlist(after,now,evidences),
    ledger_event:{...base,result:explicit?'synced':'failed',causation_id:result?.causation_id||null,payload:{...base.payload,official_sync:explicit,reading_ids:evidences.map(e=>e.reading_id)}}
  });
}
function applySyncStamp(p,syncEvidence){
  if(!isCourtSyncEvidence(syncEvidence)||String(syncEvidence.process_id)!==String(p.id))return p;
  return{...p,last_court_sync_at:syncEvidence.observed_at,last_court_sync_source:String(syncEvidence.source).toLowerCase(),atualizado_em:syncEvidence.observed_at};
}
function recordWatch(current,event){
  const events=current?.case_events||[];
  if(event?.intent_id&&events.some(e=>e.intent_id===event.intent_id&&e.event_type===event.event_type))return current;
  return appendToCase(current,event);
}
module.exports={STALE_AFTER_HOURS,canReachCourt,freshnessOf,sessionBlockMessage,watchlist,openOfficeWatch,applySyncStamp,recordWatch,_internal:{latestVerifiedReading,resolveEvidence}};
