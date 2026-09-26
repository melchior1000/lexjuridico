'use strict';
// Travas da auditoria de 25/09/2026 — grupo FUSO HORÁRIO.
// O produto roda em UTC-3 (Brasília); o servidor (Render) roda em UTC.
// Às 23h de Brasília, toISOString().slice(0,10) já devolve o dia seguinte.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {hojeBrasil,ymdSP}=require('../lib/data-brasil');

const RAIZ=path.join(__dirname,'..');
// 25/09/2026 23:30 em Brasília = 26/09/2026 02:30 UTC
const NOITE_BR=new Date('2026-09-26T02:30:00Z');
const HOJE_BR='2026-09-25';

test('hojeBrasil às 23h30 de Brasília devolve a data de hoje, não a de amanhã (UTC)',()=>{
  assert.equal(NOITE_BR.toISOString().slice(0,10),'2026-09-26','premissa: em UTC já é amanhã');
  assert.equal(hojeBrasil(NOITE_BR),HOJE_BR);
  assert.equal(ymdSP(NOITE_BR),HOJE_BR);
  assert.equal(hojeBrasil(NOITE_BR.getTime()),HOJE_BR,'aceita timestamp numérico');
  assert.match(hojeBrasil(),/^\d{4}-\d{2}-\d{2}$/);
  assert.throws(()=>hojeBrasil('lixo'),/inválida/);
});

test('office-queries usa a mesma função de data do produto (lib/data-brasil)',()=>{
  const src=fs.readFileSync(path.join(RAIZ,'lib','office-queries.js'),'utf8');
  assert.match(src,/require\('\.\/data-brasil'\)/);
  assert.doesNotMatch(src,/function ymdSP\(/);
});

test('nenhum dos pontos auditados grava "hoje" em UTC no backend',()=>{
  const alvos={
    'bot.js':[/_tempoUsoRegistros\.push\(\{perfil:pf, tipo:'login'.*data:new Date\(\)\.toISOString/,/_tempoUsoRegistros\.push\(\{perfil:pf, tipo:'heartbeat'.*data:new Date\(\)\.toISOString/,/_toIsoDataBr\(p\.prazo\) \|\| new Date\(\)\.toISOString/,/_toIsoDataBr\(a\?\.data\) \|\| new Date\(\)\.toISOString/,/andamentos:\[\{id:Date\.now\(\),data:new Date\(\)\.toISOString/],
    'lib/carteira-audit.js':[/andamentos\.unshift\(\{data:now\.toISOString/],
    'lib/djen-monitor.js':[/data:row\.data_disponibilizacao\|\|new Date\(\)\.toISOString/,/data:row\.data_disponibilizacao\|\|now\.toISOString/],
    'lex_agente_vivo_core.js':[/const hoje = new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/]
  };
  for(const [arq,padroes] of Object.entries(alvos)){
    const src=fs.readFileSync(path.join(RAIZ,arq),'utf8');
    assert.match(src,/hojeBrasil/,arq+' deve importar hojeBrasil');
    for(const p of padroes)assert.doesNotMatch(src,p,arq+' ainda usa UTC: '+p);
  }
});

test('correção de CNJ às 23h de Brasília grava o andamento com a data de hoje',async()=>{
  const A=require('../lib/carteira-audit');
  const state={processes:[{id:'p1',nome:'Caso',numero:'',andamentos:[]}]};
  const processStore={mutate:async fn=>({value:fn(state.processes),version:2})};
  const out=await A.applyCnjCorrection({processStore,processId:'p1',numero:'0000001-62.2026.8.13.0704',now:NOITE_BR,actor:'admin'});
  assert.equal(out.processo.andamentos[0].data,HOJE_BR);
});

test('bot.js: login/heartbeat de tempo de uso registram a data de Brasília',async()=>{
  const {setup}=require('./runtime');
  const registros=[];
  const app=setup({hojeBrasil:()=>HOJE_BR,global:{_tokensRevogados:new Set(),_sessaoAtividade:new Map(),_tempoUsoRegistros:registros},sbReq:async()=>({ok:true,body:[]})});
  const r=await app.request('/api/tempo-uso/login',app.token('admin'),{},'POST');
  assert.equal(r.status,200);
  assert.equal(registros[0].data,HOJE_BR);
});

// ── Frontend: hojeLocal() usa o relógio do aparelho ──
function trechoHojeLocal(){
  const index=fs.readFileSync(path.join(RAIZ,'index.html'),'utf8');
  const ini=index.indexOf('function hojeLocal(');
  const fim=index.indexOf('// Fetch com timeout',ini);
  return {index,trecho:index.slice(ini,fim)};
}
test('index.html: hojeLocal usa getFullYear/getMonth/getDate e os pontos auditados a chamam',()=>{
  const {index,trecho}=trechoHojeLocal();
  assert.match(trecho,/getFullYear\(\)/);assert.match(trecho,/getMonth\(\)/);assert.match(trecho,/getDate\(\)/);
  assert.doesNotMatch(trecho,/toISOString/);
  const ctx=vm.createContext({});
  vm.runInContext(trecho,ctx);
  const d=new Date(2026,8,25,23,30);
  assert.equal(ctx.hojeLocal(d),'2026-09-25');
  assert.equal(ctx.hojeLocal(d.getTime()),'2026-09-25');
  assert.equal(ctx.hojeLocal(new Date(2026,0,5)),'2026-01-05','mês e dia com zero à esquerda');
  const proibidos=[
    /const hoje = new Date\(\)\.toISOString\(\)\.slice\(0,10\);\n\s*const raw = JSON\.parse\(localStorage\.getItem\(_LOGIN_COUNT_KEY\)/,
    /const hoje = data \|\| new Date\(\)\.toISOString/,
    /const hojeStr = agora\.toISOString/,
    /const hoje = new Date\(\)\.toISOString\(\)\.slice\(0,10\);\n\s*const FINAIS/,
    /const hoje = new Date\(\)\.toISOString\(\)\.slice\(0,10\);\n\s*ps\.push\(\{id:/,
    /atualizado_em: new Date\(\)\.toISOString\(\)\.slice\(0,10\)/,
    /const hoje = new Date\(\)\.toISOString\(\)\.slice\(0,10\);\n\s*ps\[idx\]\.andamentos\.unshift/,
    /andamentos\.unshift\(\{\n\s*data: new Date\(\)\.toISOString/,
    /divida-data-atual'\)\?\.value \|\| new Date\(\)\.toISOString/
  ];
  for(const p of proibidos)assert.doesNotMatch(index,p,'index.html ainda grava "hoje" em UTC: '+p);
  assert.ok((index.match(/hojeLocal\(/g)||[]).length>=12,'pontos auditados devem chamar hojeLocal()');
});
