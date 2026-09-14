'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Pipeline=require('../lib/office-pipeline');
const {officeRoutes,assertTaskGate}=require('../lib/office-routes');

function store(initial){
  let rows=structuredClone(initial),mutations=0;
  return{
    async read(){return{processes:structuredClone(rows),version:1}},
    async mutate(fn){mutations++;const next=structuredClone(rows),value=await fn(next);rows=next;return{value,processes:structuredClone(rows),version:mutations+1}},
    snapshot(){return structuredClone(rows)},mutations(){return mutations}
  };
}
function response(){let status=0,body=null;return{res:{writeHead:s=>status=s,end:b=>body=b?JSON.parse(b):null},get:()=>({status,body})}}
const CHECK={documento_identidade:'ok',comprovante_endereco:'ok',procuracao:'ok',contratos:'nao_se_aplica'};

test('conferir Cadastro e entrar em Iniciais ocorre em uma única mutação',async()=>{
  const db=store([{id:41,nome:'Cliente',office_stage:'cadastro',docsFaltantes:''}]);
  const p=await Pipeline.confirmAndForwardRegistration(db,41,CHECK,'secretaria');
  assert.equal(db.mutations(),1);assert.equal(Pipeline.stageOf(p),'iniciais');assert.equal(p.cadastro_conferido,true);
  assert.equal(p.office_last_event.de,'cadastro');assert.equal(p.office_last_event.para,'iniciais');
});

test('confirmação de distribuição atualiza legado e sala oficial numa única mutação',async()=>{
  const db=store([{id:42,nome:'Inicial',setor:'autuacao',status:'EM_PREP',office_stage:'iniciais',fluxo_setor:'iniciais',andamentos:[]}]);
  const deps={headers:{},authenticate:()=> 'secretaria',body:async()=>({processo_id:42,setor:'judicial',numero:'0000001-00.2026.8.13.0001'}),processStore:db};
  const out=response();await officeRoutes({url:'/api/escritorio/distribuir',method:'POST'},out.res,deps);
  assert.equal(out.get().status,200);assert.equal(db.mutations(),1);
  const p=db.snapshot()[0];assert.equal(p.status,'DISTRIBUIDO');assert.equal(p.setor,'judicial');assert.equal(Pipeline.stageOf(p),'processos');
  assert.equal(p.office_last_event.de,'iniciais');assert.equal(p.office_last_event.para,'processos');
});

test('gate rejeita tarefa impossível antes de criar item órfão na fila',async()=>{
  const concluido=store([{id:43,nome:'Encerrado',office_stage:'concluidos',status:'CONCLUIDO'}]);
  await assert.rejects(()=>assertTaskGate({processStore:concluido},{processo_id:43,tipo:'peticao'}),/Transferência inválida/);
  const emPecas=store([{id:44,nome:'Peça',office_stage:'pecas'}]);
  await assert.rejects(()=>assertTaskGate({processStore:emPecas},{processo_id:44,tipo:'pericia'}),/Transferência inválida/);
});
