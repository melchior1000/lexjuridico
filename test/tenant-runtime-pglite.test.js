'use strict';
// Prova, no PostgreSQL real (PGlite), o caminho que o app realmente usa: o wrapper
// createTenantPostgresRequest + ProcessStore, com DOIS escritórios no mesmo banco.
// Cobre a chave primária global de processos_cache (segundo escritório não gravava)
// e garante que nenhuma chave global sobreviva à ativação do modo multi-escritório.
process.env.LEX_TENANCY_V2='1'; // modo comercial exige a fase 2 do isolamento
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const {createTenantPostgresRequest}=require('../lib/postgres-tenant');
const {TENANT_TABLES}=require('../lib/supabase');
const {ProcessStore}=require('../lib/process-store');

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const MIGRATIONS=path.join(__dirname,'..','supabase','migrations');
const LEGACY=fs.readFileSync(path.join(__dirname,'tenant-migrations-pglite.test.js'),'utf8').match(/const LEGACY=`([\s\S]*?)`;/)[1];

async function database(){
  const db=new PGlite({extensions:{pgcrypto}});
  await db.exec(LEGACY);
  // Colunas do snapshot de processos que existem em produção e faltam no esquema legado mínimo.
  await db.exec('alter table public.processos_cache add column total int, add column versao bigint, add column ultimo_aparelho text, add column atualizado_em timestamptz;');
  for(const f of fs.readdirSync(MIGRATIONS).filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync(path.join(MIGRATIONS,f),'utf8'));
  await db.exec(`insert into public.escritorios(id,nome,slug) values ('${A}','Escritório A','a'),('${B}','Escritório B','b');`);
  await db.query('select * from lex_security.ativar_multi_escritorio()');
  return db;
}
// Pool no formato do pg: cada conexão roda como lex_backend dentro da transação.
function poolFor(db){
  return{connect:async()=>({
    async query(sql,params){
      if(sql==='BEGIN'){await db.exec('begin; set local role lex_backend;');return{rows:[],rowCount:0}}
      if(sql==='COMMIT'||sql==='ROLLBACK'){await db.exec(sql.toLowerCase());return{rows:[],rowCount:0}}
      if(/pg_roles where rolname=current_user/.test(sql))return{rows:[{role:'lex_backend',bypass:false,backend_member:true,superuser:false}],rowCount:1};
      const r=await db.query(sql,params);return{rows:r.rows,rowCount:r.affectedRows??r.rows?.length??0};
    },
    release(){}
  })};
}

test('runtime de B não lê, não altera e não grava em nome de A pelo wrapper real',async()=>{
  const db=await database();
  const reqA=createTenantPostgresRequest({tenantId:A,pool:poolFor(db)});
  const reqB=createTenantPostgresRequest({tenantId:B,pool:poolFor(db)});
  const gravado=await reqA('POST','contatos',{nome:'Cliente A',numero:'5511'},{},{Prefer:'return=representation'});
  assert.equal(gravado.ok,true,JSON.stringify(gravado));
  const lido=await reqB('GET','contatos',null,{nome:'eq.Cliente A'});
  assert.deepEqual(lido.body,[]);
  const alterado=await reqB('PATCH','contatos',{nome:'X'},{nome:'eq.Cliente A'},{Prefer:'return=representation'});
  assert.deepEqual(alterado.body||[],[]);
  const intruso=await reqB('POST','contatos',{nome:'Y',escritorio_id:A},{},{});
  assert.equal(intruso.ok,false);
  const deA=await reqA('GET','contatos',null,{nome:'eq.Cliente A'});
  assert.equal(deA.body.length,1,'dado de A intacto');
});

test('dois escritórios gravam e leem o próprio snapshot de processos (processos_cache)',async()=>{
  const db=await database();
  const storeA=new ProcessStore(createTenantPostgresRequest({tenantId:A,pool:poolFor(db)}));
  const storeB=new ProcessStore(createTenantPostgresRequest({tenantId:B,pool:poolFor(db)}));
  await storeA.replace([{id:'p-a',cliente:'A'}],0,'teste');
  await storeB.replace([{id:'p-b',cliente:'B'}],0,'teste');
  assert.deepEqual((await storeA.read()).processes.map(p=>p.id),['p-a']);
  assert.deepEqual((await storeB.read()).processes.map(p=>p.id),['p-b']);
  const vA=(await storeA.read()).version;
  await storeA.replace([{id:'p-a',cliente:'A'},{id:'p-a2',cliente:'A'}],vA,'teste');
  assert.equal((await storeB.read()).processes.length,1,'gravação de A não toca B');
});

test('após ativar_multi_escritorio, nenhuma PK/unique de tabela isolada ignora escritorio_id (exceto id gerado pelo banco)',async()=>{
  const db=await database();
  const rows=(await db.query(`
    select c.conrelid::regclass::text as tabela, c.conname, c.contype,
           array_agg(a.attname::text order by a.attname) as cols,
           bool_and(a.attidentity<>'' or a.atthasdef) as gerada
    from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
    where c.contype in ('p','u') and c.connamespace='public'::regnamespace
    group by 1,2,3`)).rows;
  const tenantTables=TENANT_TABLES instanceof Set?TENANT_TABLES:new Set(TENANT_TABLES);
  const globais=rows.filter(r=>tenantTables.has(r.tabela.replace('public.',''))&&!r.cols.includes('escritorio_id')&&!(r.cols.length===1&&r.cols[0]==='id'&&r.gerada));
  assert.deepEqual(globais,[],'chaves globais sobreviveram: '+JSON.stringify(globais));
});
