'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {TaskEngine}=require('../lib/task-engine');
const Pipeline=require('../lib/office-pipeline');
const {officeRoutes}=require('../lib/office-routes');

function taskStore(initial={}){const map=new Map(Object.entries(initial));return{async read(k){return{value:map.get(k)}},async change(k,fn){const old=map.get(k),next=fn(old);if(next!==undefined)map.set(k,next);return map.get(k)},async list(prefix){return[...map.entries()].filter(([k])=>k.startsWith(prefix)).map(([,v])=>v)}}}
function processStore(initial){let rows=structuredClone(initial);return{async read(){return{processes:structuredClone(rows),version:1}},async mutate(fn){const next=structuredClone(rows),value=await fn(next);rows=next;return{value,processes:structuredClone(rows),version:2}},snapshot(){return structuredClone(rows)}}}
function response(){let status=0,body=null;return{res:{writeHead:s=>status=s,end:b=>body=b?JSON.parse(b):null},get:()=>({status,body})}}
const CHECK={documento_identidade:'ok',comprovante_endereco:'ok',procuracao:'ok',contratos:'nao_se_aplica'};

test('TaskEngine devolve entrega aguardando revisão para nova fila com motivo',async()=>{
  const id='a'.repeat(32),store=taskStore({['lex_task:'+id]:{id,tipo:'peticao',processo_id:1,agente:'Redação',instrucao:'Redija a inicial',status:'aguardando_revisao',resultado:'versão 1',sha256:'abc',tentativas:1}});
  const engine=new TaskEngine({store,processes:async()=>[]});
  const task=await engine.returnForCorrection(id,'corrigir o pedido subsidiário','admin');
  assert.equal(task.status,'na_fila');assert.equal(task.correcao_solicitada,'corrigir o pedido subsidiário');assert.equal(task.resultado,null);assert.equal(task.resultado_anterior,'versão 1');
});

test('cadastro conferido pela rota dá baixa no Cadastro e entrada em Iniciais',async()=>{
  const db=processStore([{id:21,nome:'Cliente',office_stage:'cadastro',docsFaltantes:''}]);
  const deps={headers:{},authenticate:()=> 'secretaria',body:async()=>({processo_id:21,checklist:CHECK}),processStore:db};
  const out=response();await officeRoutes({url:'/api/escritorio/cadastro/conferir',method:'POST'},out.res,deps);
  assert.equal(out.get().status,200);assert.equal(out.get().body.conferido,true);assert.equal(out.get().body.setor,'iniciais');
  const p=db.snapshot()[0];assert.equal(Pipeline.stageOf(p),'iniciais');assert.equal(p.office_last_event.de,'cadastro');assert.equal(p.office_last_event.para,'iniciais');
});

test('devolução de revisão retorna peça ao setor produtor e recoloca tarefa na fila',async()=>{
  const id='b'.repeat(32),db=processStore([{id:22,nome:'Caso',office_stage:'revisao',numero:'0000001-00.2026.8.13.0001'}]);
  const store=taskStore({['lex_task:'+id]:{id,tipo:'peticao',processo_id:22,agente:'Redação',instrucao:'Redija',status:'aguardando_revisao',resultado:'v1',sha256:'sha',tentativas:1}});
  const engine=new TaskEngine({store,processes:async()=>db.snapshot(),available:()=>false});
  const deps={headers:{},authenticate:()=> 'admin',body:async()=>({id,motivo:'corrigir fundamento'}),processStore:db,engine,log:()=>{}};
  const out=response();await officeRoutes({url:'/api/tarefas/devolver',method:'POST'},out.res,deps);
  assert.equal(out.get().status,202);assert.equal(out.get().body.setor,'pecas');
  assert.equal(Pipeline.stageOf(db.snapshot()[0]),'pecas');
  const task=await engine.get(id);assert.ok(['na_fila','aguardando_configuracao'].includes(task.status));
});
