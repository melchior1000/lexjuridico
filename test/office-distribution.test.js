'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Workflow=require('../lib/workflow');
const Pipeline=require('../lib/office-pipeline');
const {officeRoutes}=require('../lib/office-routes');

function processStore(initial){
  let rows=structuredClone(initial);
  return{
    async read(){return{processes:structuredClone(rows),version:1}},
    async mutate(fn){const next=structuredClone(rows),value=await fn(next);rows=next;return{value,processes:structuredClone(rows),version:2}},
    async distribute(preparation,request){
      const i=rows.findIndex(p=>String(p.id)===String(preparation.id));
      if(i<0)throw new Error('Processo não encontrado.');
      rows[i]=Workflow.distribute(rows[i],request,'2026-09-14T17:30:00.000Z');
      return structuredClone(rows[i]);
    },
    snapshot(){return structuredClone(rows)}
  };
}
function response(){let status=0,body=null;return{res:{writeHead:s=>status=s,end:b=>body=b?JSON.parse(b):null},get:()=>({status,body})}}

test('secretaria confirma distribuição e o caso sai de Iniciais para Processos',async()=>{
  const db=processStore([{id:31,nome:'Inicial pronta',setor:'autuacao',status:'EM_PREP',office_stage:'iniciais',fluxo_setor:'iniciais',numero:'',andamentos:[]}]);
  const deps={headers:{},authenticate:()=> 'secretaria',body:async()=>({processo_id:31,setor:'judicial',numero:'0000001-00.2026.8.13.0001'}),processStore:db};
  const out=response();await officeRoutes({url:'/api/escritorio/distribuir',method:'POST'},out.res,deps);
  assert.equal(out.get().status,200);assert.equal(out.get().body.setor,'processos');assert.equal(out.get().body.numero,'0000001-00.2026.8.13.0001');
  const p=db.snapshot()[0];assert.equal(Pipeline.stageOf(p),'processos');assert.equal(p.status,'DISTRIBUIDO');assert.equal(p.setor,'judicial');
  assert.equal(p.office_last_event.de,'iniciais');assert.equal(p.office_last_event.para,'processos');
});

test('distribuição judicial recusa número que não seja CNJ completo',async()=>{
  const db=processStore([{id:32,nome:'Inicial',setor:'autuacao',status:'EM_PREP',office_stage:'iniciais'}]);
  const deps={headers:{},authenticate:()=> 'admin',body:async()=>({processo_id:32,setor:'judicial',numero:'123'}),processStore:db};
  const out=response();await officeRoutes({url:'/api/escritorio/distribuir',method:'POST'},out.res,deps);
  assert.equal(out.get().status,422);assert.match(out.get().body.error,/CNJ completo/);assert.equal(Pipeline.stageOf(db.snapshot()[0]),'iniciais');
});

test('secretaria pode criar ou atualizar preparação no Cadastro sem ganhar acesso jurídico amplo',async()=>{
  const db=processStore([]);
  const caso={id:33,nome:'Cliente novo',area:'cível',faltando:'procuração'};
  let body={caso,documentos:[]};
  const deps={headers:{},authenticate:()=> 'secretaria',body:async()=>body,processStore:db};
  const out=response();await officeRoutes({url:'/api/escritorio/preparacao',method:'POST'},out.res,deps);
  assert.equal(out.get().status,200);assert.equal(out.get().body.processo.office_stage,'cadastro');assert.equal(out.get().body.processo.bloqueio_peca,true);
  body={};const denied=response();await officeRoutes({url:'/api/trabalho',method:'GET'},denied.res,deps);
  assert.equal(denied.get().status,403);
});
