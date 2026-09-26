'use strict';
// O script de homologação A/B aprova um banco com as migrações aplicadas e REPROVA um banco
// onde a RLS foi desligada — provado num PostgreSQL real (PGlite), com clientes no formato do pg.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const {homologar}=require('../scripts/homologar-isolamento');
const {TENANT_TABLES}=require('../lib/supabase');

const MIGRATIONS=path.join(__dirname,'..','supabase','migrations');
// Mesmo esquema legado do teste de migrações (chaves únicas globais como antes do SaaS).
const LEGACY=fs.readFileSync(path.join(__dirname,'tenant-migrations-pglite.test.js'),'utf8').match(/const LEGACY=`([\s\S]*?)`;/)[1];

async function database(){
  const db=new PGlite({extensions:{pgcrypto}});
  await db.exec(LEGACY);
  for(const file of fs.readdirSync(MIGRATIONS).filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync(path.join(MIGRATIONS,file),'utf8'));
  return db;
}
// Clientes no formato do pg ({query(sql,params)} → {rows,rowCount}). O "runtime" roda como lex_backend
// (sem BYPASSRLS) dentro de cada transação; o "admin" como superusuário.
function clients(db){
  const wrap=async(sql,params)=>{const r=await db.query(sql,params);return{rows:r.rows,rowCount:r.affectedRows??r.rows?.length??0}};
  const admin={query:wrap};
  const run={async query(sql,params){
    if(/pg_roles where rolname=current_user/.test(sql))return{rows:[{rolname:'lex_backend',rolsuper:false,rolbypassrls:false}],rowCount:1};
    if(sql==='begin'){await db.exec('begin; set local role lex_backend;');return{rows:[],rowCount:0}}
    if(sql==='commit'||sql==='rollback'){await db.exec(sql);return{rows:[],rowCount:0}}
    return wrap(sql,params);
  }};
  return{admin,run};
}
const quiet={log(){},error(){}};

test('banco com as migrações: homologação APROVADA em todas as tabelas isoladas e dados sintéticos removidos',async()=>{
  const db=await database();const {admin,run}=clients(db);
  const ev=await homologar({admin,run,...quiet});
  assert.equal(ev.ok,true,JSON.stringify(ev.falhas));
  assert.equal(ev.tabelas.length,TENANT_TABLES.size||TENANT_TABLES.length);
  for(const t of ev.tabelas)assert.ok(t.rls&&t.leitura_cruzada&&t.alteracao_cruzada&&t.exclusao_cruzada&&t.gravacao_em_nome_do_outro&&t.troca_de_escritorio,t.tabela);
  const left=(await db.query('select count(*)::int as n from public.escritorios where slug like $1',['homolog-%'])).rows[0].n;
  assert.equal(left,0,'escritórios sintéticos removidos');
  const contatos=(await db.query("select count(*)::int as n from public.contatos where nome like 'homolog-%'")).rows[0].n;
  assert.equal(contatos,0,'linhas sintéticas removidas');
});

test('banco com RLS desligada numa tabela: homologação REPROVADA apontando a tabela',async()=>{
  const db=await database();
  await db.exec('alter table public.contatos no force row level security; alter table public.contatos disable row level security;');
  const {admin,run}=clients(db);
  const ev=await homologar({admin,run,...quiet});
  assert.equal(ev.ok,false);
  assert.ok(ev.falhas.some(f=>f.tabela==='contatos'&&/RLS|leitura cruzada|alterou|apagou|gravou|inseriu/.test(f.problema)),JSON.stringify(ev.falhas));
});

test('conexão do runtime com BYPASSRLS ou superusuário é recusada antes de qualquer ataque',async()=>{
  const db=await database();const {admin,run}=clients(db);
  const superRun={query:async(sql,params)=>/pg_roles where rolname=current_user/.test(sql)?{rows:[{rolname:'postgres',rolsuper:true,rolbypassrls:true}],rowCount:1}:run.query(sql,params)};
  const ev=await homologar({admin,run:superRun,...quiet});
  assert.equal(ev.ok,false);assert.equal(ev.tabelas.length,0);assert.match(ev.falhas[0].problema,/inválida para homologar/);
});
