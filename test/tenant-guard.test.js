'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {tenantBootCheck,enforceTenantBoot}=require('../lib/tenant-guard');
const {TENANT_TABLES,GLOBAL_TABLES,createSupabaseRequest}=require('../lib/supabase');

const OK={LEX_COMERCIAL:'1',LEX_ESCRITORIO_ID:'11111111-1111-4111-8111-111111111111',LEX_TENANCY_REQUIRED:'1',LEX_DB_MODE:'postgres',LEX_DATABASE_URL:'postgresql://lex_runtime:x@db.exemplo:5432/postgres'};

test('modo comercial só liga com escritório, tenancy obrigatória e banco com RLS',()=>{
  assert.equal(tenantBootCheck({}).ok,true,'instalação de um escritório segue como está');
  assert.equal(tenantBootCheck(OK).ok,true);
  for(const [k,v,re] of [['LEX_ESCRITORIO_ID','',/UUID/],['LEX_ESCRITORIO_ID','abc',/UUID/],['LEX_TENANCY_REQUIRED','0',/TENANCY/],['LEX_DB_MODE','rest',/postgres/],['LEX_DATABASE_URL','',/lex_runtime/],['LEX_DATABASE_URL','postgresql://postgres:postgres@db:5432/postgres',/superusuário/]]){
    const out=tenantBootCheck({...OK,[k]:v});
    assert.equal(out.ok,false,k+'='+v);
    assert.match(out.problemas.join(' '),re);
  }
  let code=null;
  enforceTenantBoot({...OK,LEX_DB_MODE:'rest'},{exit:c=>{code=c},log:()=>{}});
  assert.equal(code,1);
  assert.match(fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8'),/require\('\.\/lib\/tenant-guard'\)\.enforceTenantBoot\(\);\nconst sbRaw = createSupabaseRequest/);
});

test('trava permanente: toda tabela usada no código está isolada por escritório',()=>{
  const root=path.join(__dirname,'..');
  const files=['bot.js','lex_agente_vivo.js','lex_agente_vivo_core.js',...fs.readdirSync(path.join(root,'lib')).map(f=>'lib/'+f),...fs.readdirSync(path.join(root,'api','djen')).map(f=>'api/djen/'+f)].filter(f=>f.endsWith('.js'));
  const used=new Set();
  const patterns=[/'(?:GET|POST|PATCH|DELETE|PUT)'\s*,\s*'([a-z_][a-z0-9_]*)'/g,/\bsb(?:Get|Rows|Upsert|Insert|Delete|Patch)\(\s*'([a-z_][a-z0-9_]*)'/g];
  for(const f of files){
    const src=fs.readFileSync(path.join(root,f),'utf8');
    for(const re of patterns)for(const m of src.matchAll(re))used.add(m[1]);
  }
  // 'processos' é virtual: bot.js desvia para processStore (processos_cache).
  used.delete('processos');
  assert.ok(used.size>=20,'varredura encontrou poucas tabelas: '+used.size);
  const naked=[...used].filter(t=>!TENANT_TABLES.has(t)&&!GLOBAL_TABLES.has(t));
  assert.deepEqual(naked,[],'tabela sem isolamento por escritório: declare em lib/supabase.js e crie migração com RLS');
});

test('com escritório configurado, tabela não declarada é recusada antes de ir ao banco',async()=>{
  let called=false;
  const https={request(){called=true;throw new Error('não deveria chamar')}};
  const request=createSupabaseRequest({url:'https://db.invalid',key:'k',https,tenantId:OK.LEX_ESCRITORIO_ID});
  const out=await request('GET','tabela_nova_sem_rls',null,{});
  assert.equal(called,false);
  assert.equal(out.ok,false);
});

test('cadastro de escritório gera SQL seguro e configuração que passa na trava',()=>{
  const {provision}=require('../scripts/provision-office');
  const out=provision({nome:"D'Ávila Advogados",slug:'davila',oab:['123456:mg']});
  assert.match(out.sql,/'D''Ávila Advogados'/);
  assert.match(out.sql,/ativar_multi_escritorio/);
  const env=Object.fromEntries(out.env.split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
  assert.equal(env.DJEN_OABS,'123456:MG');
  assert.equal(tenantBootCheck(env).ok,true);
  assert.notEqual(provision({nome:'X',slug:'x2'}).env.match(/COURT_READING_INTEGRITY_KEY=(\w+)/)[1],provision({nome:'Y',slug:'y2'}).env.match(/COURT_READING_INTEGRITY_KEY=(\w+)/)[1],'segredos nunca repetem entre escritórios');
  assert.throws(()=>provision({nome:'X',slug:'X Y'}),/slug/);
  assert.throws(()=>provision({nome:'X',slug:'xx',oab:['12:MGX']}),/OAB/);
});
