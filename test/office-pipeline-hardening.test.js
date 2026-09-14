'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Pipeline=require('../lib/office-pipeline');
const {officeRoutes}=require('../lib/office-routes');
const {TaskEngine}=require('../lib/task-engine');

const CHECK={documento_identidade:'ok',comprovante_endereco:'ok',procuracao:'ok',contratos:'nao_se_aplica'};
function store(initial){let processes=structuredClone(initial);return{async read(){return{processes:structuredClone(processes),version:1}},async mutate(fn){const next=structuredClone(processes);const value=await fn(next);processes=next;return{value,processes:structuredClone(processes),version:Date.now()}},snapshot(){return structuredClone(processes)}}}
function response(){let status=0,body=null;return{res:{writeHead:s=>{status=s},end:b=>{body=b?JSON.parse(b):null}},get:()=>({status,body})}}
function memoryRecords(){const map=new Map();return{async change(key,fn){const old=map.get(key);const next=await fn(old);if(next!==undefined)map.set(key,next);return map.get(key)},async read(key){return map.has(key)?{value:map.get(key)}:null},async list(prefix){return[...map.entries()].filter(([k])=>k.startsWith(prefix)).map(([,v])=>v)}}}

test('análise preserva a sala atual em vez de arrastar o processo para Peças',async()=>{
  const db=store([{id:1,nome:'Caso',office_stage:'processos',descricao:'fatos'}]);
  const p=await Pipeline.syncTaskStart(db,{id:'a1',tipo:'analise',processo_id:1,agente:'Jurídico judicial'},'admin');
  assert.equal(Pipeline.stageOf(p),'processos');
  assert.equal(Pipeline.stageOf(db.snapshot()[0]),'processos');
});

test('revisão entra na sala Revisão e perícia entra na sala Perícia',async()=>{
  const db=store([{id:2,nome:'Caso',office_stage:'processos',descricao:'fatos'}]);
  await Pipeline.syncTaskStart(db,{id:'r1',tipo:'revisao',processo_id:2,agente:'Revisão'},'admin');
  assert.equal(Pipeline.stageOf(db.snapshot()[0]),'revisao');
  const db2=store([{id:3,nome:'Caso',office_stage:'processos',descricao:'fatos'}]);
  await Pipeline.syncTaskStart(db2,{id:'p1',tipo:'pericia',processo_id:3,agente:'Pericial'},'admin');
  assert.equal(Pipeline.stageOf(db2.snapshot()[0]),'pericia');
});

test('Cadastro conferido passa por Iniciais antes de entrar em Peças',async()=>{
  const db=store([{id:4,nome:'Cliente',office_stage:'cadastro',descricao:'fatos',checklist_cadastro:CHECK,cadastro_conferido:true}]);
  const p=await Pipeline.syncTaskStart(db,{id:'t1',tipo:'peticao',processo_id:4,agente:'Redação'},'admin');
  assert.equal(Pipeline.stageOf(p),'pecas');
  assert.equal(p.office_events[1].de,'cadastro');
  assert.equal(p.office_events[1].para,'iniciais');
  assert.equal(p.office_events[0].de,'iniciais');
  assert.equal(p.office_events[0].para,'pecas');
});

test('GET /api/escritorio/setores é a fonte oficial de sala e checklist',async()=>{
  const db=store([{id:5,nome:'Cliente',numero:'0000001-00.2026.8.13.0001',office_stage:'cadastro',checklist_cadastro:CHECK,cadastro_conferido:true}]);
  const deps={headers:{},authenticate:()=> 'admin',processStore:db,records:{read:async()=>({value:{}})},engine:{list:async()=>[]},aiAvailable:()=>false};
  const out=response();await officeRoutes({url:'/api/escritorio/setores',method:'GET'},out.res,deps);
  assert.equal(out.get().status,200);
  assert.equal(out.get().body.setores.cadastro,1);
  assert.equal(out.get().body.casos[0].setor,'cadastro');
  assert.equal(out.get().body.casos[0].cadastro.conferido,true);
});

test('retomar tarefa revalida o Cadastro antes de recolocar na fila',async()=>{
  const db=store([{id:6,nome:'Cliente',office_stage:'cadastro',checklist_cadastro:{...CHECK,procuracao:'falta'},cadastro_conferido:false}]);
  let retried=0;
  const existing={id:'1234567890abcdef1234567890abcdef',tipo:'peticao',processo_id:6,status:'aguardando_dados'};
  const deps={headers:{},authenticate:()=> 'admin',body:async()=>({id:existing.id}),processStore:db,records:{read:async()=>({value:{}})},engine:{get:async()=>existing,retry:async()=>{retried++;return existing},list:async()=>[]},aiAvailable:()=>false,log:()=>{}};
  const out=response();await officeRoutes({url:'/api/tarefas/retomar',method:'POST'},out.res,deps);
  assert.equal(out.get().status,422);
  assert.match(out.get().body.error,/Produção bloqueada/);
  assert.equal(retried,0);
});

test('TaskEngine.block tira tarefa da fila quando a porta do setor falha',async()=>{
  const records=memoryRecords();
  const engine=new TaskEngine({store:records,processes:async()=>[]});
  const task=await engine.submit({tipo:'peticao',processo_id:99,instrucao:'Redigir peça.',request_id:'block-test'},'admin');
  const blocked=await engine.block(task.id,'Cadastro incompleto: procuração.');
  assert.equal(blocked.status,'aguardando_dados');
  assert.match(blocked.pendencia,/procuração/);
});
