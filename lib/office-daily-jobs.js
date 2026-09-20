'use strict';
const {syncRegistered}=require('./datajud');
const {watchlist}=require('./deadline-watch');
const {mintCourtSyncEvidence}=require('./court-sync-evidence');
const DjenMonitor=require('./djen-monitor');
const DeadlineAlerts=require('./deadline-alerts');

async function runDailyOfficeJobs({processStore,sbReq,now=new Date(),datajudOptions={},djenOptions={}}={}){
  if(!processStore?.read)throw new Error('processStore obrigatório.');
  const integrityKey=datajudOptions.integrityKey||djenOptions.integrityKey||process.env.COURT_READING_INTEGRITY_KEY;

  let djen={enabled:false,ok:true,reason:'DJEN_OABS_NOT_CONFIGURED',cunhar:[]};
  if(typeof sbReq==='function'){
    let oabs=[];
    try{oabs=Array.isArray(djenOptions.oabs)?djenOptions.oabs:DjenMonitor.parseOabs(djenOptions.oabsEnv??process.env.DJEN_OABS??'')}
    catch(error){djen={enabled:true,ok:false,error:error.message,cunhar:[]}}
    if(oabs.length){
      try{
        const result=await DjenMonitor.syncDjen({processStore,sbReq,oabs,now,clientOptions:djenOptions.clientOptions||{}});
        djen={enabled:true,...result};
      }catch(error){
        djen={enabled:true,ok:false,error:error.message,cunhar:[]};
      }
    }else if(djen.ok){
      try{djen.cunhar=await DjenMonitor.listPendingMint(sbReq)}
      catch(error){djen={enabled:true,ok:false,reason:'DJEN_QUEUE_UNAVAILABLE',error:error.message,cunhar:[]}}
    }
  }

  const datajudEnabled=!!String(datajudOptions.apiKey||'').trim();
  const sync=datajudEnabled
    ? await syncRegistered(processStore,{...datajudOptions,integrityKey})
    : {ok:true,total:0,resultados:[],skipped:true,reason:'DATAJUD_API_KEY_NOT_CONFIGURED'};
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
  let alerts={candidatos:0,novos:0,alertas:[]};
  if(typeof sbReq==='function'){
    try{alerts=await DeadlineAlerts.persistDeadlineAlerts(sbReq,watch)}
    catch(error){alerts={candidatos:0,novos:0,alertas:[],error:error.message}}
  }
  const djenFailure=djen.enabled&&djen.ok===false;
  return Object.freeze({
    ok:failed.length===0&&evidenceFailures.length===0&&!djenFailure&&!alerts.error,
    synced_at:now.toISOString(),
    djen:{
      enabled:!!djen.enabled,ok:djen.ok!==false,reason:djen.reason||null,error:djen.error||null,
      consultadas:djen.consultadas||0,casadas:djen.casadas||0,orfas:djen.orfas||0,canceladas:djen.canceladas||0,
      cunhar_total:Array.isArray(djen.cunhar)?djen.cunhar.length:0,cunhar:Array.isArray(djen.cunhar)?djen.cunhar:[]
    },
    datajud:{enabled:datajudEnabled,total:sync.total,falhas:failed.length,skipped:sync.skipped===true,reason:sync.reason||null},
    evidence:{validas:evidences.length,falhas:evidenceFailures.length},
    watch:{total:watch.length,atencao:attention.length,items:watch},
    alerts,
    exceptions:[
      ...(djenFailure?[{type:'djen_failed',error:djen.error||'Falha na leitura DJEN'}]:[]),
      ...(alerts.error?[{type:'deadline_alert_store_failed',error:alerts.error}]:[]),
      ...failed.map(x=>({type:'datajud_failed',processo_id:x.processo_id,error:x.error})),
      ...evidenceFailures.map(x=>({type:'court_evidence_failed',processo_id:x.processo_id,error:x.error})),
      ...attention.map(x=>({type:'deadline_attention',case_id:x.case_id,freshness:x.freshness,days_to_due:x.days_to_due,fatal_unconfirmed:x.fatal_unconfirmed}))
    ]
  });
}
module.exports={runDailyOfficeJobs};
