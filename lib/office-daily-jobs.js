'use strict';
const {syncRegistered}=require('./datajud');
const {watchlist}=require('./deadline-watch');
const {mintCourtSyncEvidence}=require('./court-sync-evidence');

function reconstructCourtSyncEvidences(processes,now=new Date()){
  const evidences=[];
  for(const p of Array.isArray(processes)?processes:[]){
    const readings=Array.isArray(p.court_readings)?p.court_readings:[];
    const latest=readings[0];
    if(!latest?.reading_id)continue;
    const readingLog={get:id=>String(id)===String(latest.reading_id)?latest:null};
    try{evidences.push(mintCourtSyncEvidence({readingId:String(latest.reading_id)},{readingLog,now}));}catch(_){/* fail closed: sem evidência, nunca fresh */}
  }
  return evidences;
}

async function runDailyOfficeJobs({processStore,now=new Date()}={}){
  if(!processStore?.read)throw new Error('processStore obrigatório.');
  const sync=await syncRegistered(processStore);
  const state=await processStore.read();
  const processes=state.processes||[];
  const evidences=reconstructCourtSyncEvidences(processes,now);
  const watch=watchlist(processes,now,evidences);
  const failed=(sync.resultados||[]).filter(r=>r.ok===false);
  const attention=watch.filter(w=>w.freshness!=='fresh'||(w.fatal_unconfirmed&&w.days_to_due!=null&&w.days_to_due<=1));
  return Object.freeze({
    ok:failed.length===0,
    synced_at:now.toISOString(),
    datajud:{total:sync.total,falhas:failed.length},
    evidence:{reconstituidas:evidences.length},
    watch:{total:watch.length,atencao:attention.length},
    exceptions:[
      ...failed.map(f=>({type:'datajud_failed',processo_id:f.processo_id,error:f.error})),
      ...attention.map(s=>({type:'deadline_attention',case_id:s.case_id,freshness:s.freshness,days_to_due:s.days_to_due,fatal_unconfirmed:s.fatal_unconfirmed}))
    ]
  });
}
module.exports={runDailyOfficeJobs,reconstructCourtSyncEvidences};
