'use strict';
const crypto=require('node:crypto');
const {verifyExecution,VERIFICATION_VERSION}=require('./verification-gate');
const RECEIPT_VERSION='lex-execution-receipt-v1';
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.keys(value).sort().reduce((out,key)=>(out[key]=stable(value[key]),out),{});return value;}
function digest(value){return crypto.createHash('sha256').update(JSON.stringify(stable(value??null))).digest('hex');}
function createExecutionReceipt(input={}){
  const now=String(input.observed_at||input.requested_at||new Date().toISOString());
  const resolvedAction=String(input.resolved_action||input.action||'unknown');
  const verification=input.verification||verifyExecution(resolvedAction,input.evidence||{});
  const body={version:RECEIPT_VERSION,verification_version:VERIFICATION_VERSION,receipt_id:String(input.receipt_id||crypto.randomUUID()),intent_id:input.intent_id||null,action:String(input.action||resolvedAction),resolved_action:resolvedAction,effect:input.effect||null,capability_version:input.capability_version||null,actor:input.actor||null,process_id:input.process_id??null,requested_at:String(input.requested_at||now),observed_at:verification.state==='unverified'||verification.state==='accepted'?null:now,request_hash:digest(input.request??null),result_hash:digest(input.result??null),runtime_fingerprint:input.runtime_fingerprint||null,verification,evidence:Object.freeze(stable(input.evidence||{}))};
  return Object.freeze({...body,receipt_hash:digest(body)});
}
function verifyReceipt(receipt={}){const {receipt_hash,...body}=receipt||{};return typeof receipt_hash==='string'&&receipt_hash===digest(body);}
module.exports={RECEIPT_VERSION,digest,createExecutionReceipt,verifyReceipt};
