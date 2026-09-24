'use strict';
const crypto=require('node:crypto');
const RUNTIME_VERSION='lex-runtime-v1';
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.keys(value).sort().reduce((out,key)=>(out[key]=stable(value[key]),out),{});return value;}
function digest(value){return crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(stable(value??null))).digest('hex');}
function createRuntimeFingerprint(input={}){
  const body={version:RUNTIME_VERSION,policy_version:String(input.policy_version||'unspecified'),model_provider:input.model_provider||null,model_name:input.model_name||null,triage_prompt_hash:digest(String(input.triage_prompt||'')),system_prompt_hash:digest(String(input.system_prompt||'')),playbook_hash:digest(String(input.playbook||'')),context_hash:digest(String(input.context||''))};
  return Object.freeze({...body,fingerprint:digest(body)});
}
module.exports={RUNTIME_VERSION,digest,createRuntimeFingerprint};
