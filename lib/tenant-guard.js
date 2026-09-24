'use strict';
// Trava de inicialização do modo comercial (vários escritórios no mesmo banco).
//
// Cada processo do LEX atende UM escritório: o bot guarda processos, memória
// e conversas em memória do processo. Por isso o escritório é fixado na
// inicialização e nunca muda. No modo comercial o LEX só liga se:
// - LEX_ESCRITORIO_ID for um UUID válido;
// - LEX_TENANCY_REQUIRED=1 (tabela sem isolamento é recusada no código);
// - LEX_DB_MODE=postgres com LEX_DATABASE_URL (role lex_runtime, sem
//   BYPASSRLS): a chave service_role do Supabase ignora a RLS, então o modo
//   REST não serve para vários escritórios no mesmo banco.
const {normalizeTenantId}=require('./supabase');

function tenantBootCheck(env=process.env){
  if(env.LEX_COMERCIAL!=='1')return{comercial:false,ok:true,problemas:[]};
  const problemas=[];
  let tenant=null;
  try{tenant=normalizeTenantId(env.LEX_ESCRITORIO_ID)}catch{tenant=null}
  if(!tenant)problemas.push('LEX_ESCRITORIO_ID ausente ou inválido (UUID do escritório).');
  if(env.LEX_TENANCY_REQUIRED!=='1')problemas.push('LEX_TENANCY_REQUIRED=1 é obrigatório.');
  if(env.LEX_TENANCY_V2!=='1')problemas.push('LEX_TENANCY_V2=1 é obrigatório (após aplicar a migração 20260924120000).');
  if(String(env.LEX_DB_MODE||'').toLowerCase()!=='postgres')problemas.push('LEX_DB_MODE=postgres é obrigatório (REST com service_role ignora a RLS).');
  if(!String(env.LEX_DATABASE_URL||'').trim())problemas.push('LEX_DATABASE_URL (role lex_runtime) é obrigatório.');
  else if(/service_role|postgres:postgres@|\/\/postgres[.:@]/i.test(env.LEX_DATABASE_URL))problemas.push('LEX_DATABASE_URL deve usar a role lex_runtime, não o superusuário.');
  return{comercial:true,ok:!problemas.length,escritorio_id:tenant,problemas};
}

function enforceTenantBoot(env=process.env,{exit=code=>process.exit(code),log=console.error}={}){
  const check=tenantBootCheck(env);
  if(!check.ok){
    log('[LEX] Modo comercial recusado: '+check.problemas.join(' '));
    exit(1);
  }
  return check;
}
module.exports={tenantBootCheck,enforceTenantBoot};
