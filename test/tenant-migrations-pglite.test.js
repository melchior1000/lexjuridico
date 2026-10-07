'use strict';
// Prova A/B no banco real (PostgreSQL via PGlite): aplica todas as migrações
// sobre um esquema no formato legado e tenta, com a role do runtime, ler,
// alterar e gravar dados de outro escritório.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const {TENANT_TABLES}=require('../lib/supabase');

const MIGRATIONS=path.join(__dirname,'..','supabase','migrations');
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';

// Esquema legado mínimo: chaves únicas globais como em produção antes do SaaS.
const LEGACY=`
create role service_role;
create table public.config (id serial primary key, chave text unique, valor jsonb);
create table public.configuracoes (id serial primary key, chave text unique, valor jsonb, atualizado_em timestamptz);
create table public.whatsapp_recepcao_publica (id serial primary key, numero text unique, nome text);
create table public.whatsapp_recepcao_eventos (id serial primary key, numero text, texto text);
create table public.clientes_pendentes (id serial primary key, chat_id text unique, nome text);
create table public.conversas (id serial primary key, chat_id text, thread_id text, hist jsonb, unique(chat_id,thread_id));
create table public.djen_comunicacoes (id serial primary key, djen_id text unique, cnj text);
create table public.djen_sync_state (id serial primary key, numero_oab text, uf_oab text, unique(numero_oab,uf_oab));
create table public.lex_status (id serial primary key, agente_id text unique, status text);
create table public.memoria_casos (id serial primary key, caso_id text unique, fatos jsonb);
create table public.prazo_alertas (id serial primary key, processo_id text, due_at text, marco text, unique(processo_id,due_at,marco));
create table public.processos_cache (id text primary key, dados jsonb);
create table public.processos_sync (id serial primary key, processo_id text unique);
create table public.processos_prep (id serial primary key, nome text);
create table public.agente_logs (id serial primary key, msg text);
create table public.comandos_pendentes (id serial primary key, acao text);
create table public.contatos (id serial primary key, nome text, numero text);
create table public.whatsapp_sessoes (id serial primary key, numero text unique, estado jsonb);
create table public.memoria_checkpoints (id serial primary key, task_id text unique, estado jsonb);
create table public.arquivo_morto_indice (id serial primary key, id_indice text unique, chat_id text);
create table public.documentos_processo (id serial primary key, processo_id text, nome text);
create table public.mensagens_chat (id serial primary key, texto text);
create table public.auditoria (id serial primary key, evento text);
create table public.cobrancas_pix (id serial primary key, cliente_nome text);
create table public.tempo_uso (id serial primary key, minutos int);
create table public.perfis_juizes (id serial primary key, nome text);
create table public.documentos_indexados (id serial primary key, nome text);
create table public.vivo_acoes (id serial primary key, acao text);
insert into public.djen_comunicacoes(djen_id,cnj) values ('pub-1','0001');
insert into public.contatos(nome,numero) values ('Cliente legado','5511999999999');
`;

async function database(){
  const db=new PGlite({extensions:{pgcrypto}});
  await db.exec(LEGACY);
  for(const file of fs.readdirSync(MIGRATIONS).filter(f=>f.endsWith('.sql')).sort())
    await db.exec(fs.readFileSync(path.join(MIGRATIONS,file),'utf8'));
  await db.exec(`insert into public.escritorios(id,nome,slug) values ('${A}','Escritório A','a'),('${B}','Escritório B','b');`);
  return db;
}
// Sessão do runtime: role sem BYPASSRLS, escritório fixado na conexão.
async function as(db,tenant,sql,params){
  await db.exec(`reset role; select set_config('lex.escritorio_id','${tenant||''}',false); set role lex_backend;`);
  try{return await db.query(sql,params)}finally{await db.exec('reset role;')}
}

let shared;
const ready=()=>shared||(shared=database());

test('toda tabela declarada no código tem RLS forçada e política por escritório no banco',async()=>{
  const db=await ready();
  const {rows}=await db.query(`select c.relname, c.relrowsecurity, c.relforcerowsecurity,
    exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname and p.policyname='lex_backend_tenant') as policy
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`);
  const byName=Object.fromEntries(rows.map(r=>[r.relname,r]));
  for(const table of TENANT_TABLES){
    const row=byName[table];
    assert.ok(row,table+' existe no esquema de teste');
    assert.ok(row.relrowsecurity&&row.relforcerowsecurity&&row.policy,table+' sem muralha');
  }
});

test('escritório B não lê, não altera e não apaga dado do A — em todas as tabelas',async()=>{
  const db=await ready();
  for(const table of TENANT_TABLES){
    const cols=(await db.query(`select column_name,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[table])).rows;
    const text=cols.find(c=>c.data_type==='text'&&!c.column_default&&c.column_name!=='escritorio_id');
    const id=cols.find(c=>c.column_name==='id');
    const values={escritorio_id:A};
    if(text)values[text.column_name]='segredo-A-'+table;
    if(id&&id.data_type==='text')values.id='id-'+table;
    const keys=Object.keys(values);
    await as(db,A,`insert into public.${table}(${keys.join(',')}) values (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(values));
    const seenByB=await as(db,B,`select count(*)::int as n from public.${table} where escritorio_id=$1`,[A]);
    assert.equal(seenByB.rows[0].n,0,table+': B leu dado de A');
    if(table==='auditoria'){
      // Auditoria só aceita inclusão: alterar ou apagar é recusado para qualquer escritório.
      await assert.rejects(as(db,B,`update public.${table} set escritorio_id=escritorio_id where escritorio_id=$1`,[A]),/permission denied/);
      await assert.rejects(as(db,B,`delete from public.${table} where escritorio_id=$1`,[A]),/permission denied/);
    } else {
      const upd=await as(db,B,`update public.${table} set escritorio_id=escritorio_id where escritorio_id=$1`,[A]);
      assert.equal(upd.affectedRows??0,0,table+': B alterou dado de A');
      const del=await as(db,B,`delete from public.${table} where escritorio_id=$1`,[A]);
      assert.equal(del.affectedRows??0,0,table+': B apagou dado de A');
    }
    const seenByA=await as(db,A,`select count(*)::int as n from public.${table}`);
    assert.ok(seenByA.rows[0].n>=1,table+': A perdeu o próprio dado');
  }
});

test('B não consegue gravar em nome de A nem mover linha para outro escritório',async()=>{
  const db=await ready();
  await assert.rejects(as(db,B,`insert into public.contatos(escritorio_id,nome) values ($1,'intruso')`,[A]),/row-level security/);
  await as(db,B,`insert into public.contatos(escritorio_id,nome) values ($1,'meu')`,[B]);
  await assert.rejects(as(db,B,`update public.contatos set escritorio_id=$1 where nome='meu'`,[A]),/row-level security|imutavel/);
  const none=await as(db,null,`select count(*)::int as n from public.contatos`);
  assert.equal(none.rows[0].n,0,'sem escritório na sessão não se vê nada');
});

test('ativação multi-escritório remove o padrão perigoso e as chaves globais',async()=>{
  const db=await database();
  // Tabelas isoladas agora já nascem sem padrão: gravação sem escritório falha.
  await assert.rejects(db.exec(`insert into public.contatos(nome) values ('sem escritório')`),/null value in column "escritorio_id"/);
  // Tabelas da primeira fase: gravação sem escritório cai no primeiro escritório.
  await db.exec(`insert into public.clientes_pendentes(chat_id,nome) values ('c1','sem escritório')`);
  const landed=await db.query(`select e.slug from public.clientes_pendentes c join public.escritorios e on e.id=c.escritorio_id where c.chat_id='c1'`);
  assert.equal(landed.rows[0].slug,'lex-atual');
  // Antes: a mesma publicação do DJEN não entra no segundo escritório.
  await assert.rejects(db.query(`insert into public.djen_comunicacoes(escritorio_id,djen_id) values ($1,'pub-1')`,[B]),/duplicate key/);

  const done=(await db.query('select * from lex_security.ativar_multi_escritorio()')).rows;
  assert.ok(done.some(r=>r.tabela==='clientes_pendentes'&&r.acao==='default removido'));
  assert.ok(done.some(r=>r.tabela==='djen_comunicacoes'&&/unique global removida/.test(r.acao)));

  await assert.rejects(db.exec(`insert into public.clientes_pendentes(chat_id,nome) values ('c2','sem escritório')`),/null value in column "escritorio_id"/);
  // Mesmo número de WhatsApp em dois escritórios (o cliente fala com os dois).
  await db.query(`insert into public.clientes_pendentes(escritorio_id,chat_id) values ($1,'c1')`,[B]);
  await db.query(`insert into public.djen_comunicacoes(escritorio_id,djen_id) values ($1,'pub-1')`,[B]);
  await assert.rejects(db.query(`insert into public.djen_comunicacoes(escritorio_id,djen_id) values ($1,'pub-1')`,[B]),/duplicate key/,'dentro do mesmo escritório segue único');
  // Idempotente.
  assert.deepEqual((await db.query('select * from lex_security.ativar_multi_escritorio()')).rows,[]);
});

test('migração nova é idempotente',async()=>{
  const db=await ready();
  const sql=fs.readFileSync(path.join(MIGRATIONS,'20260924120000_tenantize_remaining_tables.sql'),'utf8');
  await db.exec(sql);
  // Reaplicar a migração de 24/09 sozinha não devolve à auditoria o direito de alterar/apagar.
  const {rows}=await db.query(`select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='auditoria' and grantee in ('lex_backend','lex_runtime','service_role') and privilege_type in ('UPDATE','DELETE','TRUNCATE')`);
  assert.deepEqual(rows,[]);
});

// 06/10/2026 — Varredura de completude (ideia do DeskcommCRM, tests/invariants/
// rls-completude-varredura.test.ts — MIT): nenhuma tabela nova pode nascer sem muralha, e
// nenhuma regra pode ser afrouxada (ex.: "... or true") sem o teste reprovar.
const POLITICA_TENANT='(escritorio_id = lex_security.current_escritorio_id())';
const POLITICA_ESCRITORIOS='(id = lex_security.current_escritorio_id())';
// Tabelas sem escritorio_id ou sem política, cada uma com o motivo.
const EXCECOES={
  escritorios:'cadastro dos escritórios: cada um enxerga só a própria linha (id)',
  usuarios:'sem política = ninguém do servidor lê (contas vivem em configuracoes, isoladas)',
  escritorio_membros:'sem política = ninguém do servidor lê'
};

test('varredura: toda tabela tem RLS forçada e regra exata; tabela nova sem muralha reprova',async()=>{
  const db=await ready();
  const {rows:tabelas}=await db.query(`select c.relname, c.relrowsecurity rls, c.relforcerowsecurity forcada,
    exists(select 1 from information_schema.columns k where k.table_schema='public' and k.table_name=c.relname and k.column_name='escritorio_id') tem_escritorio
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')`);
  // View roda como o dono (passa por cima da RLS) a não ser com security_invoker.
  const {rows:views}=await db.query(`select c.relname, coalesce(c.reloptions,'{}') opcoes from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('v','m')`);
  for(const v of views) assert.ok(v.opcoes.includes('security_invoker=true'),'view '+v.relname+' sem security_invoker fura a muralha');
  // Função SECURITY DEFINER executável pelo servidor também roda como o dono.
  const {rows:definers}=await db.query(`select n.nspname||'.'||p.proname nome from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.prosecdef and n.nspname in ('public','lex_security')
      and (has_function_privilege('lex_backend',p.oid,'EXECUTE') or has_function_privilege('lex_runtime',p.oid,'EXECUTE'))`);
  assert.deepEqual(definers,[],'função SECURITY DEFINER executável pelo servidor: revise antes de liberar');
  const {rows:politicas}=await db.query(`select tablename, policyname, qual, with_check from pg_policies where schemaname='public'`);
  for(const t of tabelas){
    assert.ok(t.rls&&t.forcada,t.relname+': RLS precisa estar ligada e forçada');
    const minhas=politicas.filter(p=>p.tablename===t.relname);
    if(EXCECOES[t.relname]){
      if(t.relname==='escritorios'){
        assert.equal(minhas.length,1,'escritorios: uma política só');
        assert.equal(minhas[0].qual,POLITICA_ESCRITORIOS);
        assert.ok(minhas[0].with_check===null||minhas[0].with_check===POLITICA_ESCRITORIOS,'escritorios: gravação só na própria linha');
      }
      else assert.equal(minhas.length,0,t.relname+': exceção sem política não pode ganhar regra sem revisão');
      continue;
    }
    assert.ok(t.tem_escritorio,t.relname+': tabela sem escritorio_id — isole ou declare em EXCECOES com o motivo');
    assert.ok(TENANT_TABLES.has(t.relname),t.relname+': falta em TENANT_TABLES (lib/supabase.js)');
    assert.ok(minhas.length>=1,t.relname+': sem política');
    for(const p of minhas){
      assert.equal(p.qual,POLITICA_TENANT,t.relname+'.'+p.policyname+': regra de leitura diferente da muralha');
      assert.equal(p.with_check,POLITICA_TENANT,t.relname+'.'+p.policyname+': regra de gravação diferente da muralha');
    }
  }
  for(const table of TENANT_TABLES) assert.ok(tabelas.some(t=>t.relname===table),table+' existe no esquema');
});

test('varredura pega regra afrouxada com "or true"',async()=>{
  const db=new PGlite({extensions:{pgcrypto}});
  await db.exec(LEGACY);
  for(const file of fs.readdirSync(MIGRATIONS).filter(f=>f.endsWith('.sql')).sort())
    await db.exec(fs.readFileSync(path.join(MIGRATIONS,file),'utf8'));
  await db.exec(`drop policy lex_backend_tenant on public.contatos;
    create policy lex_backend_tenant on public.contatos for all to lex_backend
    using (escritorio_id = lex_security.current_escritorio_id() or true)
    with check (escritorio_id = lex_security.current_escritorio_id());`);
  const {rows}=await db.query(`select qual from pg_policies where schemaname='public' and tablename='contatos'`);
  assert.notEqual(rows[0].qual,POLITICA_TENANT,'a sabotagem aparece no catálogo e reprovaria a varredura');
});

test('auditoria só aceita inclusão: o servidor não altera nem apaga registro',async()=>{
  // Banco novo: o teste de idempotência acima reaplica uma migração antiga isoladamente.
  // Reaplicar as migrações deve ser sempre na ordem, até a última (docs/HOMOLOGACAO_MULTI_ESCRITORIO.md).
  const db=await database();
  await as(db,A,`insert into public.auditoria(escritorio_id,evento) values ($1,'teste-somente-inclusao')`,[A]);
  const lidos=await as(db,A,`select count(*)::int n from public.auditoria where evento='teste-somente-inclusao'`);
  assert.equal(lidos.rows[0].n,1);
  await assert.rejects(as(db,A,`update public.auditoria set evento='adulterado' where evento='teste-somente-inclusao'`),/permission denied/);
  await assert.rejects(as(db,A,`delete from public.auditoria where evento='teste-somente-inclusao'`),/permission denied/);
  await db.exec('reset role;');
  const {rows}=await db.query(`select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='auditoria' and grantee in ('service_role','lex_backend','lex_runtime') and privilege_type in ('UPDATE','DELETE','TRUNCATE')`);
  assert.deepEqual(rows,[],'nem a chave service_role altera auditoria');
});

test('migração da auditoria não falha em banco sem a tabela',async()=>{
  const db=new PGlite({extensions:{pgcrypto}});
  await db.exec(`create role lex_backend; create role service_role;`);
  await db.exec(fs.readFileSync(path.join(MIGRATIONS,'20261006120000_auditoria_somente_inclusao.sql'),'utf8'));
});
