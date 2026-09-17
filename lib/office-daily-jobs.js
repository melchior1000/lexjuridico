'use strict';
const {watchlist}=require('./deadline-watch');

async function runDailyOfficeJobs({processStore,now=new Date()}={}){
  if(!processStore?.read)throw new Error('processStore obrigatório.');
  const state=await processStore.read();
  const watch=watchlist(state.processes||[],now);
  const attention=watch.filter(w=>w.freshness!=='fresh'||(w.fatal_unconfirmed&&w.days_to_due!=null&&w.days_to_due<=1));
  return Object.freeze({
    ok:true,
    synced_at:now.toISOString(),
    watch:{total:watch.length,atencao:attention.length},
    exceptions:[
      ...attention.map(s=>({type:'deadline_attention',case_id:s.case_id,freshness:s.freshness,days_to_due:s.days_to_due,fatal_unconfirmed:s.fatal_unconfirmed}))
    ]
  });
}
module.exports={runDailyOfficeJobs};
