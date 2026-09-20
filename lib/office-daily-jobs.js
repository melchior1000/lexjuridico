'use strict';
const {syncRegistered}=require('./datajud');
const {watchlist}=require('./deadline-watch');
const {mintCourtSyncEvidence}=require('./court-sync-evidence');

async function runDailyOfficeJobs({processStore,now=new Date(),datajudOptions={}}={}){
  if(!processStore?.read)throw new Error('processStore obrigatório.');
  const integrityKey=datajudOptions.integrityKey||process.env.COURT_READING_INTEGRITY_KEY;
  const sync=await syncRegistered(processStore,{...datajudOptions,integrityKey});
  const evidences=[],evidenceFailures=[];
  for(const row of sync.resultados||[]){
    if(row.ok===false||!row.reading)continue;
    try{
      evidences.push(mintCourtSyncEvidence(
        {readingId:row.reading.reading_id},
        {readingLog:new Map([[row.reading.reading_id,row.reading]]),integrityKey,now:Math.max(now.getTime(),Date.parse(row.reading.observed_at)||0)}
      ));
    }catch(error){
      evidenceFailures.push({processo_id:row.processo_id,error:error.message});
    }
  }
  const state=await processStore.read();
  const truths=(state.processes||[]).map(p=>p?.deadline_truth).filter(Boolean);
  const watch=watchlist(state.processes||[],now,evidences,truths,{integrityKey});
  const failed=(sync.resultados||[]).filter(r=>r.ok===false);
  const attention=watch.filter(w=>w.freshness!=='fresh'||(w.fatal_unconfirmed&&w.days_to_due!=null&&w.days_to_due<=1));
  return Object.freeze({
    ok:failed.length===0&&evidenceFailures.length===0,
    synced_at:now.toISOString(),
    datajud:{total:sync.total,falhas:failed.length},
    evidence:{validas:evidences.length,falhas:evidenceFailures.length},
    watch:{total:watch.length,atencao:attention.length},
    exceptions:[
      ...failed.map(x=>({type:'datajud_failed',processo_id:x.processo_id,error:x.error})),
      ...evidenceFailures.map(x=>({type:'court_evidence_failed',processo_id:x.processo_id,error:x.error})),
      ...attention.map(x=>({type:'deadline_attention',case_id:x.case_id,freshness:x.freshness,days_to_due:x.days_to_due,fatal_unconfirmed:x.fatal_unconfirmed}))
    ]
  });
}
module.exports={runDailyOfficeJobs};
