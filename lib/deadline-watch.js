'use strict';
const crypto=require('node:crypto');
const flow=require('./workflow');
const {appendToCase}=require('./event-ledger');
const Bridge=require('./hybrid-court-bridge');
const {isCourtSyncEvidence}=require('./court-sync-evidence');
const {isLegalTruth}=require('./deadline-truth');

const STALE_AFTER_HOURS=Bridge.STALE_AFTER_HOURS;
function todaySP(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(now)}
function canReachCourt(session={}){return session.device==='desktop'&&session.pje_session==='confirmed'&&session.tj_reachable===true}
function civilDate(value){
  const direct=flow.date(value);if(direct)return direct;
  const ms=Date.parse(String(value||'').trim());
  return Number.isFinite(ms)?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date(ms)):null;
}
function evidenceForProcess(evidences,p){return(Array.isArray(evidences)?evidences:[]).find(e=>isCourtSyncEvidence(e)&&String(e.process_id)===String(p.id))||null}
function truthForProcess(truths,p,opts={}){return(Array.isArray(truths)?truths:[]).find(t=>isLegalTruth(t,opts)&&String(t.process_id)===String(p.id))||null}
function freshnessOf(p,now=new Date(),syncEvidence=null,truth=null,opts={}){
  const evidence=isCourtSyncEvidence(syncEvidence)&&String(syncEvidence.process_id)===String(p.id)?syncEvidence:null;
  const legal=isLegalTruth(truth,opts)&&String(truth.process_id)===String(p.id)?truth:null;
  const due=civilDate(legal?.due_at)||civilDate(p.prazoReal||p.prazo);
  const state=Bridge.sourceState(evidence?[evidence]:[],now);
  const days=due?Math.round((Date.parse(due+'T12:00:00Z')-Date.parse(todaySP(now)+'T12:00:00Z'))/86400000):null;
  return Object.freeze({
    case_id:p.id||null,prazo:due,days_to_due:days,
    last_court_sync_at:evidence?.observed_at||null,
    last_court_sync_source:evidence?.source?String(evidence.source).toLowerCase():null,
    freshness:state.freshness,
    fatal_unconfirmed:!legal,
    deadline_status:legal?'confirmed':due?'suggested':'unknown',
    deadline_legal_truth:!!legal,
    authorization_id:legal?.authorization_id||null,
    djen_id_origem:p.djen_id_origem||legal?.source_ref||null
  });
}
function sessionBlockMessage(s={}){if(s.device==='mobile'&&!canReachCourt(s))return'LEX não atualizou prazo: sem acesso ao TJ neste dispositivo.';if(s.pje_session==='expired')return'LEX não atualizou prazo: sessão do PJe expirada.';if(s.pje_session==='absent'||s.tj_reachable===false)return'LEX não atualizou prazo: sem acesso ao TJ.';return null}
function watchlist(processes,now=new Date(),syncEvidences=[],truths=[],opts={}){
  const rows=Array.isArray(processes)?processes:[];
  const truthByProcess=new Map();
  for(const p of rows){
    const t=p?.deadline_truth;
    if(t&&isLegalTruth(t,opts)&&t.process_id!=null)truthByProcess.set(String(t.process_id),t);
  }
  for(const t of Array.isArray(truths)?truths:[]){
    if(t&&isLegalTruth(t,opts)&&t.process_id!=null)truthByProcess.set(String(t.process_id),t);
  }
  const availableTruths=[...truthByProcess.values()];
  return rows.filter(p=>!flow.CLOSED.has(String(p.status||'').toUpperCase())).map(p=>{
    const f=freshnessOf(p,now,evidenceForProcess(syncEvidences,p),truthForProcess(availableTruths,p,opts),opts),last=Array.isArray(p.andamentos)&&p.andamentos[0]?p.andamentos[0]:null;
    return Object.freeze({...f,titulo:p.nome||p.numero||p.id,intimacao:last?{data:last.data,texto:last.txt||last.texto||''}:null,proxacao:p.proxacao||null,needs_human_deadline_check:f.freshness!=='fresh'||!f.deadline_legal_truth||f.days_to_due==null||f.days_to_due<=5});
  }).sort((a,b)=>(a.days_to_due==null?9999:a.days_to_due)-(b.days_to_due==null?9999:b.days_to_due));
}
async function openOfficeWatch({processes,session,intent_id,actor_id='LEX',syncFn,now=new Date(),integrityKey=process.env.COURT_READING_INTEGRITY_KEY}){
  const intent=String(intent_id||crypto.randomUUID()),block=sessionBlockMessage(session),base={intent_id:intent,actor_type:'system',actor_id,event_type:'court_sync_attempted',payload:{device:session?.device||null,pje_session:session?.pje_session||null,tj_reachable:session?.tj_reachable===true}};
  if(block||typeof syncFn!=='function'||!canReachCourt(session)){const warning=block||'LEX não atualizou prazo: sem acesso ao TJ.';return Object.freeze({ok:false,intent_id:intent,synced:false,warning,items:watchlist(processes,now,[],[],{integrityKey}).map(i=>({...i,warning})),ledger_event:{...base,result:'blocked',payload:{...base.payload,warning}}})}
  const result=await syncFn({processes,session,intent_id:intent,now});
  const evidences=(Array.isArray(result?.sync_evidences)?result.sync_evidences:[]).filter(isCourtSyncEvidence);
  const truths=(Array.isArray(result?.deadline_truths)?result.deadline_truths:[]).filter(t=>isLegalTruth(t,{integrityKey}));
  const explicit=evidences.length>0;
  const after=explicit?(result.processes||processes):processes;
  const source=explicit?String(evidences[0].source).toLowerCase():null,observedAt=explicit?evidences[0].observed_at:null;
  const warning=explicit?null:(result?.warning||'LEX não atualizou prazo: fonte oficial sem evidência verificada.');
  return Object.freeze({ok:explicit,intent_id:intent,synced:explicit,warning,items:watchlist(after,now,evidences,truths,{integrityKey}),ledger_event:{...base,result:explicit?'synced':'failed',causation_id:result?.causation_id||null,payload:{...base.payload,source,observed_at:observedAt,official_sync:explicit}}});
}
function applySyncStamp(p,syncEvidence){
  if(!isCourtSyncEvidence(syncEvidence))return p;
  if(String(syncEvidence.process_id)!==String(p.id))return p;
  const observedAt=syncEvidence.observed_at;
  return{...p,last_court_sync_at:observedAt,last_court_sync_source:String(syncEvidence.source).toLowerCase(),atualizado_em:observedAt};
}
function recordWatch(current,event){const events=current?.case_events||[];if(event?.intent_id&&events.some(e=>e.intent_id===event.intent_id&&e.event_type===event.event_type))return current;return appendToCase(current,event)}
module.exports={STALE_AFTER_HOURS,canReachCourt,freshnessOf,sessionBlockMessage,watchlist,openOfficeWatch,applySyncStamp,recordWatch,evidenceForProcess,truthForProcess};
