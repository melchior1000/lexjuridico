'use strict';

const crypto=require('node:crypto');

const CRITICAL_ACTS=new Set(['protocolar','enviar_cliente','confirmar_prazo_fatal','distribuir_processo','aprovar_peca']);

function stable(v){
  if(Array.isArray(v)) return v.map(stable);
  if(v&&typeof v==='object') return Object.keys(v).sort().reduce((o,k)=>(o[k]=stable(v[k]),o),{});
  return v;
}
function payloadHash(payload){return crypto.createHash('sha256').update(JSON.stringify(stable(payload??null))).digest('hex');}
function sourceStatus(source){
  const s=source||{};
  return {
    title:String(s.title||s.titulo||'').trim(),
    court:String(s.court||s.tribunal||'').trim(),
    reference:String(s.reference||s.processo||s.tema||s.sumula||'').trim(),
    date:String(s.date||s.data||'').trim(),
    url:String(s.url||'').trim(),
    verified:s.verified===true
  };
}
function reviewPackage(input={}){
  const sources=(input.sources||input.jurisprudencia||[]).map(sourceStatus);
  const unverified=sources.filter(s=>!s.verified||!s.url||!s.reference);
  return Object.freeze({
    kind:'legal_review',
    case_id:input.case_id||null,
    draft_version_id:input.draft_version_id||null,
    produced_by:input.produced_by||null,
    reviewed_by:'LEX',
    thesis:input.thesis||input.tese||'',
    sources,
    source_status:unverified.length?'needs_human_source_check':'verified_for_human_review',
    warnings:unverified.map(s=>`Jurisprudência não confirmada: ${s.reference||s.title||'fonte sem identificação'}`),
    requires_human_supervisor:true,
    can_execute_critical_act:false,
    created_at:input.created_at||new Date().toISOString()
  });
}
function authorization({act,payload,supervisor_id,approved_hash,authorization_id,approved_at}={}){
  const hash=payloadHash(payload);
  const critical=CRITICAL_ACTS.has(String(act||''));
  const valid=!critical||(Boolean(supervisor_id)&&Boolean(authorization_id)&&approved_hash===hash);
  return Object.freeze({act:act||null,critical,payload_hash:hash,supervisor_id:supervisor_id||null,authorization_id:authorization_id||null,approved_at:approved_at||null,authorized:valid});
}
function assertAuthorized(args){const a=authorization(args);if(!a.authorized){const e=new Error('Ato crítico bloqueado: autorização humana não corresponde ao payload exato.');e.code='HUMAN_AUTH_REQUIRED';e.authorization=a;throw e;}return a;}

module.exports={CRITICAL_ACTS,payloadHash,sourceStatus,reviewPackage,authorization,assertAuthorized};
