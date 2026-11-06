'use strict';
// Fecha dois buracos de configuração apontados na auditoria de isolamento:
// 1. LEX_ESCRITORIO_ID definido em modo REST (service_role ignora a RLS) era aceito
//    quando LEX_COMERCIAL não estava em 1;
// 2. a guarda da conexão não checava rolsuper — um superusuário com nome qualquer
//    passava (pg_has_role devolve true para superusuário) e a RLS era ignorada.
const test=require('node:test');
const assert=require('node:assert/strict');
const {tenantBootCheck}=require('../lib/tenant-guard');
const {createTenantPostgresRequest}=require('../lib/postgres-tenant');
const {incomingWhatsappMessage}=require('../lib/integration-status');

const T='11111111-1111-4111-8111-111111111111';

test('com LEX_ESCRITORIO_ID definido, modo REST é recusado mesmo sem LEX_COMERCIAL',()=>{
  const out=tenantBootCheck({LEX_ESCRITORIO_ID:T,LEX_DB_MODE:'rest'});
  assert.equal(out.ok,false);
  assert.match(out.problemas.join(' '),/postgres/i);
  const semModo=tenantBootCheck({LEX_ESCRITORIO_ID:T});
  assert.equal(semModo.ok,false);
});

test('sem LEX_ESCRITORIO_ID e sem LEX_COMERCIAL a instalação única continua ligando',()=>{
  assert.equal(tenantBootCheck({}).ok,true);
  assert.equal(tenantBootCheck({LEX_DB_MODE:'rest'}).ok,true);
});

test('conexão de superusuário é recusada mesmo sem BYPASSRLS e membro de lex_backend',async()=>{
  const pool={connect:async()=>({
    async query(sql){
      if(/pg_roles where rolname=current_user/.test(sql))return{rows:[{role:'admin',bypass:false,backend_member:true,superuser:true}]};
      if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql))return{rows:[]};
      throw new Error('consulta de negócio não deveria rodar');
    },
    release(){}
  })};
  const req=createTenantPostgresRequest({tenantId:T,pool});
  const out=await req('GET','contatos',null,{});
  assert.equal(out.ok,false);
  assert.equal(out.status,503);
  assert.match(out.erro,/role sem isolamento/);
});

test('a guarda da conexão pergunta rolsuper ao banco',async()=>{
  let guardSql='';
  const pool={connect:async()=>({
    async query(sql){
      if(/pg_roles where rolname=current_user/.test(sql)){guardSql=sql;return{rows:[{role:'x',bypass:true}]}}
      return{rows:[]};
    },release(){}
  })};
  await createTenantPostgresRequest({tenantId:T,pool})('GET','contatos',null,{});
  assert.match(guardSql,/rolsuper/);
});

test('webhook do WhatsApp sem o campo instance é recusado',()=>{
  process.env.LEX_OPERATOR_WHATSAPP='5511999999999'; // mensagem do operador: aceita de imediato (a pública vai para a fila)
  const msg={event:'messages.upsert',data:{key:{fromMe:false,id:'m1',remoteJid:'5511999999999@s.whatsapp.net'},message:{conversation:'oi'}}};
  assert.equal(incomingWhatsappMessage({...msg,instance:'lex-a'},'lex-a')!==false,true);
  assert.equal(incomingWhatsappMessage({...msg,instance:'lex-b'},'lex-a'),false);
  assert.equal(incomingWhatsappMessage(msg,'lex-a'),false);
});
