#!/usr/bin/env node
'use strict';
// =====================================================================
// HOMOLOGAÇÃO A/B DO ISOLAMENTO ENTRE ESCRITÓRIOS — no banco REAL
// ---------------------------------------------------------------------
// AGENTS.md §9: cria dois escritórios sintéticos (A e B) com dados distintos e
// prova, pela role do runtime (lex_runtime, sem BYPASSRLS), que A não lê,
// altera, apaga nem grava em nome de B — e vice-versa — em TODAS as tabelas
// isoladas, mesmo fornecendo IDs válidos do outro. Ao final remove os dados
// sintéticos e imprime a evidência (JSON) para o dossiê de homologação.
//
// Uso (ler antes: docs/HOMOLOGACAO_MULTI_ESCRITORIO.md):
//   LEX_DATABASE_URL=postgres://lex_runtime:...@host/db \
//   LEX_ADMIN_DATABASE_URL=postgres://postgres:...@host/db \
//   node scripts/homologar-isolamento.js [--manter] [--json evidencia.json]
//
// - LEX_ADMIN_DATABASE_URL: só para criar/remover os escritórios sintéticos.
// - LEX_DATABASE_URL: a conexão do runtime (role lex_runtime). É por ela que os
//   ataques são feitos, exatamente como o LEX em produção.
// Nada é apagado fora dos dois escritórios sintéticos criados por este script.
// =====================================================================
const crypto=require('node:crypto');
const fs=require('node:fs');
const {TENANT_TABLES}=require('../lib/supabase');

function args(argv){const o={manter:false,json:null};for(let i=0;i<argv.length;i++){if(argv[i]==='--manter')o.manter=true;else if(argv[i]==='--json')o.json=argv[++i]}return o}

// Núcleo testável: recebe os dois clientes já conectados ({query}) e devolve a evidência.
async function homologar({admin,run,manter=false,log=console.log,error=console.error}={}){
  const A=crypto.randomUUID(),B=crypto.randomUUID();
  const stamp=Date.now().toString(36);
  const evidence={inicio:new Date().toISOString(),escritorios:{A,B},tabelas:[],falhas:[],ok:false};
  const fail=(t,m)=>{evidence.falhas.push({tabela:t,problema:m});error('  ✗ '+t+': '+m)};
  const ok=(t,m)=>log('  ✓ '+t+': '+m);
  const rc=r=>Number(r?.rowCount??r?.affectedRows??0);
  // Sessão do runtime fixada num escritório (mesma mecânica de lib/postgres-tenant.js).
  async function as(tenant,sql,params){
    await run.query('begin');
    try{await run.query("select set_config('lex.escritorio_id',$1,true)",[tenant||'']);const r=await run.query(sql,params);await run.query('commit');return r}
    catch(e){await run.query('rollback');throw e}
  }
  try{
    const role=(await run.query("select rolname, rolsuper, rolbypassrls from pg_roles where rolname=current_user")).rows[0];
    if(!role||role.rolsuper||role.rolbypassrls){fail('role',`a conexão do runtime é '${role?.rolname}' com super=${role?.rolsuper} bypassrls=${role?.rolbypassrls}: inválida para homologar`);throw new Error('role inválida')}
    ok('role',role.rolname+' sem BYPASSRLS');
    await admin.query("insert into public.escritorios(id,nome,slug,status) values ($1,$2,$3,'active'),($4,$5,$6,'active')",[A,'Homologação A '+stamp,'homolog-a-'+stamp,B,'Homologação B '+stamp,'homolog-b-'+stamp]);
    ok('escritorios','A e B criados');
    for(const table of TENANT_TABLES){
      const rec={tabela:table,rls:null,leitura_cruzada:null,alteracao_cruzada:null,exclusao_cruzada:null,gravacao_em_nome_do_outro:null,troca_de_escritorio:null};
      try{
        const rls=(await admin.query("select relrowsecurity, relforcerowsecurity from pg_class where oid=('public.'||$1)::regclass",[table])).rows[0];
        rec.rls=!!(rls?.relrowsecurity&&rls?.relforcerowsecurity);
        if(!rec.rls)fail(table,'RLS não está forçada');
        const cols=(await admin.query("select column_name,data_type,column_default,is_nullable from information_schema.columns where table_schema='public' and table_name=$1",[table])).rows;
        const text=cols.find(c=>c.data_type==='text'&&!c.column_default&&c.column_name!=='escritorio_id');
        const id=cols.find(c=>c.column_name==='id');
        const mk=(tenant,tag)=>{const v={escritorio_id:tenant};if(text)v[text.column_name]='homolog-'+tag+'-'+stamp;if(id&&id.data_type==='text')v.id='homolog-'+tag+'-'+table+'-'+stamp;return v};
        const ins=async(session,v)=>{const k=Object.keys(v);await as(session,`insert into public.${table}(${k.join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(v))};
        await ins(A,mk(A,'A'));await ins(B,mk(B,'B'));
        const bSeesA=(await as(B,`select count(*)::int as n from public.${table} where escritorio_id=$1`,[A])).rows[0].n;
        const aSeesB=(await as(A,`select count(*)::int as n from public.${table} where escritorio_id=$1`,[B])).rows[0].n;
        rec.leitura_cruzada=Number(bSeesA)===0&&Number(aSeesB)===0;if(!rec.leitura_cruzada)fail(table,`leitura cruzada: B viu ${bSeesA} de A, A viu ${aSeesB} de B`);
        const upd=await as(B,`update public.${table} set escritorio_id=escritorio_id where escritorio_id=$1`,[A]);
        rec.alteracao_cruzada=rc(upd)===0;if(!rec.alteracao_cruzada)fail(table,'B alterou '+rc(upd)+' linha(s) de A');
        const del=await as(B,`delete from public.${table} where escritorio_id=$1`,[A]);
        rec.exclusao_cruzada=rc(del)===0;if(!rec.exclusao_cruzada)fail(table,'B apagou '+rc(del)+' linha(s) de A');
        // Ataque: a sessão de B tenta inserir uma linha com escritorio_id de A.
        try{await ins(B,mk(A,'intruso'));rec.gravacao_em_nome_do_outro=false;fail(table,'B inseriu linha com escritorio_id de A')}
        catch(e){rec.gravacao_em_nome_do_outro=/row-level security|imutavel|violates/i.test(e.message);if(!rec.gravacao_em_nome_do_outro)fail(table,'erro inesperado ao tentar gravar em nome de A: '+e.message)}
        try{const r=await as(B,`update public.${table} set escritorio_id=$1 where escritorio_id=$2`,[A,B]);rec.troca_de_escritorio=rc(r)===0;if(!rec.troca_de_escritorio)fail(table,'B moveu linha própria para A')}
        catch(e){rec.troca_de_escritorio=/row-level security|imutavel|violates/i.test(e.message)}
        const aStill=(await as(A,`select count(*)::int as n from public.${table} where escritorio_id=$1`,[A])).rows[0].n;
        if(Number(aStill)<1)fail(table,'A perdeu o próprio dado durante os ataques');
        if(rec.rls&&rec.leitura_cruzada&&rec.alteracao_cruzada&&rec.exclusao_cruzada&&rec.gravacao_em_nome_do_outro&&rec.troca_de_escritorio)ok(table,'isolado');
      }catch(e){fail(table,'erro no teste: '+e.message)}
      evidence.tabelas.push(rec);
    }
    const blind=(await as(null,"select count(*)::int as n from public.contatos")).rows[0].n;
    if(Number(blind)!==0)fail('sessão sem escritório',`viu ${blind} linha(s)`);else ok('sessão sem escritório','não vê nada');
  }catch(e){if(!/role inválida/.test(e.message))fail('geral',e.message)}
  finally{
    if(!manter){
      try{
        for(const table of TENANT_TABLES){await admin.query(`delete from public.${table} where escritorio_id = any($1::uuid[])`,[[A,B]]).catch(()=>{})}
        await admin.query('delete from public.escritorios where id = any($1::uuid[])',[[A,B]]);
        log('  ✓ limpeza: dados sintéticos removidos');
      }catch(e){error('  ! limpeza incompleta: '+e.message+' (remova manualmente os escritórios '+A+' e '+B+')')}
    }else log('  · --manter: escritórios sintéticos preservados '+A+' / '+B);
  }
  evidence.fim=new Date().toISOString();evidence.ok=evidence.falhas.length===0;
  return evidence;
}

async function main(){
  const opt=args(process.argv.slice(2));
  const runtimeUrl=process.env.LEX_DATABASE_URL,adminUrl=process.env.LEX_ADMIN_DATABASE_URL;
  if(!runtimeUrl||!adminUrl){console.error('Defina LEX_DATABASE_URL (role lex_runtime) e LEX_ADMIN_DATABASE_URL (administrador).');process.exit(2)}
  if(/service_role|\/\/postgres[.:@]/i.test(runtimeUrl)){console.error('LEX_DATABASE_URL deve usar a role lex_runtime, não o superusuário: a homologação precisa passar pela RLS.');process.exit(2)}
  const {Client}=require('pg');
  const admin=new Client({connectionString:adminUrl,application_name:'lex-homologacao-admin'});
  const run=new Client({connectionString:runtimeUrl,application_name:'lex-homologacao-runtime'});
  await admin.connect();await run.connect();
  let evidence;
  try{evidence=await homologar({admin,run,manter:opt.manter})}
  finally{await run.end().catch(()=>{});await admin.end().catch(()=>{})}
  if(opt.json)fs.writeFileSync(opt.json,JSON.stringify(evidence,null,2));
  console.log(evidence.ok?'\nHOMOLOGAÇÃO A/B: APROVADA — nenhum acesso cruzado em '+evidence.tabelas.length+' tabelas.':'\nHOMOLOGAÇÃO A/B: REPROVADA — '+evidence.falhas.length+' falha(s). NÃO declarar produto comercial.');
  process.exit(evidence.ok?0:1);
}
module.exports={homologar};
if(require.main===module)main().catch(e=>{console.error('Homologação abortada: '+e.message);process.exit(1)});
