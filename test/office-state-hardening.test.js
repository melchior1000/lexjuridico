'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {officeRoutes,runTaskThroughOffice}=require('../lib/office-routes');
const {blockTask}=require('../lib/office-task-guard');
const {TaskEngine}=require('../lib/task-engine');

const CHECK={documento_identidade:'ok',comprovante_endereco:'ok',procuracao:'ok',contratos:'nao_se_aplica'};
function store(initial){let processes=structuredClone(initial);return{async read(){return{processes:structuredClone(processes),version:1}},async mutate(fn){const next=structuredClone(processes);const value=await fn(next);processes=next;return{value,processes:structuredClone(processes),version:2}},snapshot(){return structuredClone(processes)}}}
function response(){let status=0,body=null;return{res:{writeHead:s=>{status=s},end:b=>{body=b?JSON.parse(b):null}},get:()=>({status,body})}}
function memoryRecords(){const map=new Map();return{async change(key,fn){const old=map.get(key);const next=await fn(old);if(next!==undefined)map.set(key,next);return map.get(key)},async read(key){return map.has(key)?{value:map.get(key)}:null},async list(prefix){return[...map.entries()].filter(([k])=>k.startsWith(prefix)).map(([,v])=>v)}}}

test('setores expõe a mesma sala e checklist persistidos no servidor',async()=>{
  const db=store([{id:1,nome:'Cliente',office_stage:'cadastro',checklist_cadastro:CHECK,cadastro_conferido:true}]);
  const deps={headers:{},authenticate:()=> 'admin',processStore:db,records:{read:async()=>({value:{}})},engine:{list:async()=>[]},aiAvailable:()=>false};
  const out=response();await officeRoutes({url:'/api/escritorio/setores',method:'GET'},out.res,deps);
  assert.equal(out.get().status,200);assert.equal(out.get().body.setores.cadastro,1);assert.equal(out.get().body.casos[0].setor,'cadastro');assert.equal(out.get().body.casos[0].cadastro.conferido,true);
});

test('retomar revalida cadastro antes de voltar para fila',async()=>{
  const db=store([{id:2,nome:'Cliente',office_stage:'cadastro',checklist_cadastro:{...CHECK,procuracao:'falta'},cadastro_conferido:false}]);
  let retried=0;const task={id:'1234567890abcdef1234567890abcdef',tipo:'peticao',processo_id:2,status:'aguardando_dados'};
  const deps={headers:{},authenticate:()=> 'admin',body:async()=>({id:task.id}),processStore:db,records:{read:async()=>({value:{}})},engine:{get:async()=>task,retry:async()=>{retried++;return task},list:async()=>[]},aiAvailable:()=>false,log:()=>{}};
  const out=response();await officeRoutes({url:'/api/tarefas/retomar',method:'POST'},out.res,deps);
  assert.equal(out.get().status,422);assert.match(out.get().body.error,/Produção bloqueada/);assert.equal(retried,0);
});

test('blockTask tira corrida inválida de na_fila e registra a pendência',async()=>{
  const records=memoryRecords(),engine=new TaskEngine({store:records,processes:async()=>[]});
  const task=await engine.submit({tipo:'peticao',processo_id:9,instrucao:'Redigir peça.',request_id:'guard-1'},'admin');
  const blocked=await blockTask(engine,task.id,'Cadastro voltou a ficar incompleto.');
  assert.equal(blocked.status,'aguardando_dados');assert.match(blocked.pendencia,/Cadastro voltou/);
});

test('interface consulta /api/escritorio/setores e não depende de getProcs para os seletores',()=>{
  const js=fs.readFileSync(path.join(__dirname,'..','office-flow-ui.js'),'utf8');
  assert.match(js,/\/api\/escritorio\/setores/);
  assert.doesNotMatch(js,/typeof getProcs|function processes\(/);
});
