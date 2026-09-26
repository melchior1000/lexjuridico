'use strict';
// Travas da auditoria de 25/09/2026 — grupo INTERFACE (index.html).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const RAIZ=path.join(__dirname,'..');
const index=fs.readFileSync(path.join(RAIZ,'index.html'),'utf8');
function fatia(ini,fim){const a=index.indexOf(ini);assert.ok(a>=0,'não achei '+ini);const b=index.indexOf(fim,a);assert.ok(b>a,'não achei '+fim);return index.slice(a,b);}

// ── 12. Prognóstico: sem servidor, nada de número heurístico nem cache ──
test('prognóstico em falha do servidor mostra indisponível com "tentar de novo", sem cartão numérico nem cache',async()=>{
  const trecho=fatia('function renderCardPrognostico(p, d){','function abrirProc(id){');
  const alvo={innerHTML:''};
  const cacheIA=[];
  const ctx=vm.createContext({
    document:{getElementById:()=>alvo},window:{},_prognosticoCache:{},procAtivo:null,
    getAuthToken:()=>'tok',fetch:async()=>({ok:false,status:503}),
    _cacheIA_set:(...a)=>cacheIA.push(a),_escHtml:s=>String(s??''),_fmtBRL:v=>'R$ '+v,_corProbabilidade:()=>'',
    _semaforoPrescricao:()=>({cor:'',txt:''}),diasRestantes:()=>null
  });
  vm.runInContext(trecho,ctx);
  await ctx.carregarPrognosticoProcesso({id:'p1',nome:'Caso',status:'ATIVO',valor:10000});
  assert.match(alvo.innerHTML,/Prognóstico indisponível no momento/);
  assert.match(alvo.innerHTML,/Tentar de novo/);
  assert.match(alvo.innerHTML,/carregarPrognosticoProcesso\(procAtivo,true\)/);
  assert.doesNotMatch(alvo.innerHTML,/Probabilidade de êxito|\d+%|estimativa local/);
  assert.equal(ctx._prognosticoCache.p1,undefined,'falha não grava em cache');
  assert.equal(cacheIA.length,0,'falha não persiste cache 24h');
  assert.doesNotMatch(index,/_calcProbHeuristica/,'heurística removida');
});

test('estatísticas só mostram probabilidade vinda do servidor',()=>{
  assert.match(index,/Sem prognóstico/);
  assert.match(index,/Nenhum prognóstico calculado pelo servidor ainda/);
  assert.doesNotMatch(index,/probabilidade_exito\|\|_calcProb/);
});

// ── 13. ids com crypto.randomUUID (fallback) e comparações como texto ──
test('novoIdLex usa crypto.randomUUID e cai em fallback sem colidir',()=>{
  const trecho=fatia('function novoIdLex(){','// Data de hoje no fuso do aparelho');
  const c1=vm.createContext({crypto:{randomUUID:()=>'11111111-2222-4333-8444-555555555555'}});
  vm.runInContext(trecho,c1);
  assert.equal(c1.novoIdLex(),'11111111-2222-4333-8444-555555555555');
  const c2=vm.createContext({});
  vm.runInContext(trecho,c2);
  const ids=new Set();for(let i=0;i<500;i++)ids.add(c2.novoIdLex());
  assert.equal(ids.size,500,'fallback não repete id');
  for(const id of ids)assert.equal(typeof id,'string');
  assert.match(index,/ps\.push\(\{id:novoIdLex\(\),\.\.\.dados/);
  assert.match(index,/ps\.push\(\{\n\s*id:novoIdLex\(\),\n\s*nome,/);
  assert.match(index,/item=\{id:novoIdLex\(\),tipo:/);
  assert.doesNotMatch(index,/\{id:Date\.now\(\),\.\.\.dados|id:Date\.now\(\),\n\s*nome,|item=\{id:Date\.now\(\)/);
});

test('ids de processo entram entre aspas nos onclick e são comparados como texto',()=>{
  // onclick="abrirProc(${p.id})" quebraria com UUID (vira identificador inválido)
  assert.doesNotMatch(index,/\(\$\{[\w.]+\.id\}[,)]/,'interpolação de id sem aspas em onclick');
  assert.doesNotMatch(index,/\('\+_pipelineProcId\+'\)/);
  assert.doesNotMatch(index,/(?<!String\()\b[\w.]+\.id===(?!String\()[\w.]+\)/,'comparação estrita de .id sem String()');
  // abrirProc com id UUID acha o processo
  const trecho=fatia('function abrirProc(id){','const arquivosHtml=');
  const expr=trecho.slice(trecho.indexOf('const ps=getProcs()'),trecho.indexOf('procAtivo=p;'));
  const ctx=vm.createContext({getProcs:()=>[{id:'3f1c2a4e-1111-4222-8333-444455556666',nome:'UUID'},{id:1758000000000,nome:'Num'}]});
  vm.runInContext('function acha(id){'+expr+'return p;}',ctx);
  assert.equal(ctx.acha('3f1c2a4e-1111-4222-8333-444455556666').nome,'UUID');
  assert.equal(ctx.acha('1758000000000').nome,'Num','id numérico legado vindo como texto do onclick');
  assert.equal(ctx.acha(1758000000000).nome,'Num');
});

// ── 14. Sem "agente local" (localhost:3333) ──
test('o bloco legado do PJe com "agente local" foi removido de vez',()=>{
  assert.doesNotMatch(index,/AGENTE_URL|localhost:3333|detectarAgenteLocal|sincronizacaoDiariaAuto|iniciarPjePolling|conectarPjeComCredenciais/);
  assert.doesNotMatch(index,/function renderPje\(\)/);
});
