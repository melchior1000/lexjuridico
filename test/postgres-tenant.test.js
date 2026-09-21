'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {
  createTenantPostgresRequest,
  sqlSelect,
  sqlInsert
}=require('../lib/postgres-tenant');

const TENANT='3369b6cc-39dc-466f-84a7-7b65e196dbea';
const OTHER='22222222-2222-4222-8222-222222222222';

function fakePool({bypass=false,member=true,rows=[{ok:true}]}={}){
  const calls=[];
  const client={
    async query(sql,values=[]){
      calls.push({sql,values});
      if(/current_user as role/i.test(sql)) return {rows:[{role:'lex_runtime',bypass,backend_member:member}]};
      if(/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) return {rows:[]};
      if(/set_config/i.test(sql)) return {rows:[{}]};
      return {rows,rowCount:rows.length};
    },
    release(){calls.push({sql:'RELEASE',values:[]});}
  };
  return {calls,pool:{async connect(){calls.push({sql:'CONNECT',values:[]});return client;}}};
}

test('PostgreSQL tenant executa cada consulta em transacao com contexto local',async()=>{
  const db=fakePool({rows:[{chave:'whatsapp'}]});
  const request=createTenantPostgresRequest({tenantId:TENANT,pool:db.pool});
  const result=await request('GET','configuracoes',null,{chave:'eq.whatsapp',limit:'1'});
  assert.equal(result.ok,true);
  assert.deepEqual(result.body,[{chave:'whatsapp'}]);
  assert.ok(db.calls.some(c=>c.sql==='BEGIN'));
  assert.ok(db.calls.some(c=>/set_config\('lex\.escritorio_id'/i.test(c.sql)&&c.values[0]===TENANT));
  const select=db.calls.find(c=>/^SELECT /i.test(c.sql)&&/FROM "configuracoes"/.test(c.sql));
  assert.match(select.sql,/"chave" = \$1/);
  assert.match(select.sql,/"escritorio_id" = \$2/);
  assert.equal(select.values[1],TENANT);
  assert.ok(db.calls.some(c=>c.sql==='COMMIT'));
});

test('PostgreSQL recusa conexao com BYPASSRLS antes da consulta de negocio',async()=>{
  const db=fakePool({bypass:true});
  const request=createTenantPostgresRequest({tenantId:TENANT,pool:db.pool});
  const result=await request('GET','configuracoes',null,{chave:'eq.whatsapp'});
  assert.equal(result.ok,false);
  assert.match(result.erro,/role sem isolamento RLS/i);
  assert.ok(db.calls.some(c=>c.sql==='ROLLBACK'));
  assert.equal(db.calls.some(c=>/FROM "configuracoes"/.test(c.sql)),false);
});

test('PostgreSQL recusa role que nao pertence a lex_backend',async()=>{
  const db=fakePool({member:false});
  const request=createTenantPostgresRequest({tenantId:TENANT,pool:db.pool});
  const result=await request('GET','configuracoes',null,{chave:'eq.whatsapp'});
  assert.equal(result.ok,false);
  assert.match(result.erro,/role sem isolamento RLS/i);
});

test('PostgreSQL bloqueia tenant divergente antes de tocar no pool',async()=>{
  const db=fakePool();
  const request=createTenantPostgresRequest({tenantId:TENANT,pool:db.pool});
  const result=await request('PATCH','configuracoes',{valor:{}},{escritorio_id:'eq.'+OTHER,chave:'eq.whatsapp'});
  assert.equal(result.ok,false);
  assert.match(result.erro,/Banco PostgreSQL|Tenant divergente/i);
  assert.equal(db.calls.length,0);
});

test('upsert do config usa chave composta e injeta tenant no payload',async()=>{
  const db=fakePool({rows:[{chave:'SENHA_ADMIN',escritorio_id:TENANT}]});
  const request=createTenantPostgresRequest({tenantId:TENANT,pool:db.pool});
  const result=await request(
    'POST','config',
    {chave:'SENHA_ADMIN',valor:'hash'},
    {on_conflict:'chave'},
    {Prefer:'resolution=merge-duplicates,return=representation'}
  );
  assert.equal(result.ok,true);
  const insert=db.calls.find(c=>/^INSERT INTO "config"/.test(c.sql));
  assert.ok(insert);
  assert.match(insert.sql,/ON CONFLICT \("escritorio_id","chave"\) DO UPDATE SET/i);
  assert.ok(insert.values.includes(TENANT));
});

test('DELETE nao aceita tenant como unico filtro',async()=>{
  const db=fakePool();
  const request=createTenantPostgresRequest({tenantId:TENANT,pool:db.pool});
  const result=await request('DELETE','conversas',null,{limit:'10'});
  assert.equal(result.ok,false);
  assert.match(result.erro,/Banco PostgreSQL|filtro de negocio/i);
  assert.ok(db.calls.some(c=>c.sql==='ROLLBACK'));
});

test('builder suporta prefixo like, cursor gt, ordenacao e paginacao usadas pela recepcao',()=>{
  const built=sqlSelect('whatsapp_recepcao_publica',{
    nome:'like.Maria*',
    numero:'gt.5561000000000',
    order:'urgente.desc,atualizado_em.desc',
    limit:'40',
    offset:'0'
  });
  assert.match(built.sql,/"nome" LIKE \$1/);
  assert.match(built.sql,/"numero" > \$2/);
  assert.match(built.sql,/ORDER BY "urgente" DESC, "atualizado_em" DESC/);
  assert.match(built.sql,/LIMIT 40 OFFSET 0/);
  assert.deepEqual(built.values,['Maria%','5561000000000']);
});

test('builder de insert nunca interpola valores no SQL',()=>{
  const payload='x\' ; drop table public.configuracoes; --';
  const built=sqlInsert('configuracoes',{chave:'teste',valor:payload,escritorio_id:TENANT},{on_conflict:'chave'},{Prefer:'resolution=merge-duplicates,return=representation'});
  assert.doesNotMatch(built.sql,/drop table/i);
  assert.ok(built.values.includes(payload));
});
