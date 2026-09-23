'use strict';
const VERIFICATION_VERSION='lex-verification-v1';
const BLOCKED_TASK_STATES=new Set(['aguardando_dados','aguardando_documento_nitido','aguardando_configuracao']);
function result(state,reason,missing=[]){return Object.freeze({version:VERIFICATION_VERSION,state,verified:state==='verified',reason,missing:Object.freeze([...missing])});}
function verifyExecution(action,evidence={}){
  if(evidence.failed===true)return result('failed',evidence.reason||'execution_failed');
  if(evidence.blocked===true)return result('blocked',evidence.reason||'execution_blocked');
  const key=String(action||'');
  if(key==='task'||key==='lex_review'){
    if(evidence.deferred===true){
      const missing=[];if(!evidence.task_id)missing.push('task_id');if(evidence.queue_status!=='na_fila')missing.push('queue_status');
      return missing.length?result('unverified','queue_not_confirmed',missing):result('accepted','queued_for_execution');
    }
    if(!evidence.task_id)return result('unverified','task_id_missing',['task_id']);
    if(evidence.result_status==='aguardando_revisao')return result('verified','draft_observed');
    if(BLOCKED_TASK_STATES.has(evidence.result_status))return result('blocked',evidence.result_status);
    if(evidence.result_status==='falhou')return result('failed','task_failed');
    return result('unverified','task_result_not_observed',['result_status']);
  }
  if(key==='reply_contact'||key==='send_previous'){
    const missing=[];if(evidence.provider_confirmed!==true)missing.push('provider_confirmed');if(evidence.history_recorded!==true)missing.push('history_recorded');
    return missing.length?result('unverified','external_message_not_fully_observed',missing):result('verified','provider_and_history_confirmed');
  }
  if(key==='register_contact'){
    const missing=[];if(evidence.persisted!==true)missing.push('persisted');if(!evidence.process_id)missing.push('process_id');if(evidence.stage!=='cadastro')missing.push('stage');
    return missing.length?result('unverified','registration_not_confirmed',missing):result('verified','registration_persisted');
  }
  if(key==='move'){
    const missing=[];if(evidence.persisted!==true)missing.push('persisted');if(!evidence.process_id)missing.push('process_id');if(!evidence.stage)missing.push('stage');
    return missing.length?result('unverified','move_not_confirmed',missing):result('verified','move_persisted');
  }
  if(key==='distribute'){
    const missing=[];if(evidence.persisted!==true)missing.push('persisted');if(!evidence.process_id)missing.push('process_id');if(!evidence.stage)missing.push('stage');if(!evidence.number)missing.push('number');
    return missing.length?result('unverified','distribution_not_confirmed',missing):result('verified','distribution_persisted');
  }
  if(key==='datajud'){
    const missing=[];if(evidence.observed!==true)missing.push('observed');if(!evidence.process_id)missing.push('process_id');
    return missing.length?result('unverified','official_sync_not_observed',missing):result('verified','official_sync_observed');
  }
  if(key==='work_queue'||key==='court_watch')return evidence.observed===true?result('verified','read_observed'):result('unverified','read_not_observed',['observed']);
  if(key==='confirm_registration')return result('blocked','human_checklist_required');
  return result('unverified','no_verification_contract');
}
module.exports={VERIFICATION_VERSION,verifyExecution};
