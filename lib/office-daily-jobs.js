'use strict';
const {syncRegistered}=require('./datajud');
const {watchlist}=require('./deadline-watch');

async function runDailyOfficeJobs({processStore,now=new Date()}={}){
  if(!processStore?.read)throw new Error('processStore obrigatório.');
  const sync=await syncRegistered(processStore);
  const state=await processStore.read();
  const watch=watchlist(state.processes||[],now);
  const failed=(sync.resultados||[]).filter(r=>r.ok===false);
  const attention=watch.filter(w=>w.freshness!=='fresh'||(w.fatal_unconfirmed&&w.days_to_due!=null&&w.days_to_due<=1));
  return Object.freeze({
    ok:failed.length===0,
    synced_at:now.toISOString(),
    datajud:{total:sync.total,falhas:failed.length},
    watch:{total:watch.length,atencao:attention.length},
    exceptions:[
      ...failed.map(f=>({type:'datajud_failed',processo_id:f.processo_id,error:f.error})),
      ...attention.map(s=>({type:'deadline_attention',case_id:s.case_id,freshness:s.freshness,days_to_due:s.days_to_due,fatal_unconfirmed:s.fatal_unconfirmed}))
    ]
  });
}
module.exports={runDailyOfficeJobs};
