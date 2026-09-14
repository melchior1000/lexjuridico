'use strict';
const crypto=require('node:crypto');

function stable(value){
  if(Array.isArray(value)) return value.map(stable);
  if(value&&typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  return value;
}
function canonical(value){return JSON.stringify(stable(value))}
function hash(previousHash,event){
  return crypto.createHash('sha256').update(String(previousHash||'GENESIS')+'\n'+canonical(event)).digest('hex');
}
function append(ledger,event={}){
  const rows=Array.isArray(ledger)?ledger:[];
  const previous=rows.length?rows[rows.length-1]:null;
  const body={
    event_id:String(event.event_id||event.id||crypto.randomUUID()),
    event_type:String(event.event_type||'unknown'),
    intent_id:event.intent_id||null,
    correlation_id:String(event.correlation_id||event.intent_id||event.event_id||event.id||crypto.randomUUID()),
    causation_id:event.causation_id||null,
    case_id:event.case_id??null,
    actor_type:String(event.actor_type||'system'),
    actor_id:String(event.actor_id||event.por||event.agente||'LEX'),
    agent_id:event.agent_id||event.agente||null,
    model_provider:event.model_provider||null,
    model_name:event.model_name||null,
    occurred_at:event.occurred_at||event.criado_em||new Date().toISOString(),
    previous_state:event.previous_state??null,
    new_state:event.new_state??null,
    document_id:event.document_id||null,
    document_version_id:event.document_version_id||null,
    human_authorization_id:event.human_authorization_id||null,
    result:event.result??null,
    payload:event.payload??null,
    previous_event_hash:previous?.event_hash||null
  };
  return Object.freeze({...body,event_hash:hash(body.previous_event_hash,body)});
}
function verify(ledger=[]){
  let previous=null;
  for(const row of ledger){
    const {event_hash,...body}=row;
    if((body.previous_event_hash||null)!==(previous?.event_hash||null)) return false;
    if(hash(body.previous_event_hash,body)!==event_hash) return false;
    previous=row;
  }
  return true;
}
function appendToCase(current,event){
  const ledger=Array.isArray(current?.case_events)?current.case_events:[];
  const row=append(ledger,event);
  return {...current,case_events:[...ledger,row],case_last_event_hash:row.event_hash};
}

module.exports={canonical,hash,append,verify,appendToCase};
