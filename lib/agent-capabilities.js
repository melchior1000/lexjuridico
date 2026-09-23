'use strict';
const CAPABILITY_VERSION='lex-capabilities-v1';
const ACTION_CAPABILITIES=Object.freeze({
  task:Object.freeze({profiles:Object.freeze(['admin','advogado']),effect:'draft_internal',verification:'task'}),
  lex_review:Object.freeze({profiles:Object.freeze(['admin','advogado']),effect:'draft_internal',verification:'task'}),
  move:Object.freeze({profiles:Object.freeze(['admin','advogado']),effect:'state_write',verification:'persisted'}),
  reply_contact:Object.freeze({profiles:Object.freeze(['admin','advogado','secretaria']),effect:'external_message',verification:'provider_and_history'}),
  send_previous:Object.freeze({profiles:Object.freeze(['admin','advogado','secretaria']),effect:'external_message',verification:'provider_and_history'}),
  register_contact:Object.freeze({profiles:Object.freeze(['admin','advogado','secretaria']),effect:'state_write',verification:'persisted'}),
  work_queue:Object.freeze({profiles:Object.freeze(['admin','advogado','secretaria']),effect:'read',verification:'observed'}),
  datajud:Object.freeze({profiles:Object.freeze(['admin','advogado','secretaria']),effect:'official_sync',verification:'observed'}),
  court_watch:Object.freeze({profiles:Object.freeze(['admin','advogado','secretaria']),effect:'read',verification:'observed'}),
  confirm_registration:Object.freeze({profiles:Object.freeze(['admin','advogado','secretaria']),effect:'human_gate',verification:'blocked_until_human'}),
  distribute:Object.freeze({profiles:Object.freeze(['admin','advogado','secretaria']),effect:'state_write',verification:'persisted'})
});
function capabilityForAction(action){return ACTION_CAPABILITIES[String(action||'').trim()]||null;}
function authorizationForAction(action,profile){
  const capability=capabilityForAction(action),normalized=String(profile||'').trim().toLowerCase();
  if(!capability)return Object.freeze({known:false,allowed:false,action:String(action||''),profile:normalized,capability:null,version:CAPABILITY_VERSION});
  return Object.freeze({known:true,allowed:capability.profiles.includes(normalized),action:String(action),profile:normalized,capability,version:CAPABILITY_VERSION});
}
module.exports={CAPABILITY_VERSION,ACTION_CAPABILITIES,capabilityForAction,authorizationForAction};
