'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {officeRoutes}=require('../lib/office-routes');
const Pipeline=require('../lib/office-pipeline');

function processStore(){
  let rows=[];let version=0;
  return {
    async read(){return {processes:structuredClone(rows),version}},
    async mutate(fn){const next=structuredClone(rows);const value=await fn(next);rows=next;version++;return {value,processes:structuredClone(rows),version}},
    async distribute(current,{setor,numero}){
      const result=await this.mutate(ps=>{const i=ps.findIndex(p=>String(p.id)===String(current.id));if(i<0)throw new Error('Processo não encontrado.');ps[i]={...ps[i],setor,numero,status:'ATIVO'};return ps[i]});
      return result.value;
    },
    snapshot(){return structuredClone(rows)}
  };
}

function taskEngine(){
  const tasks=new Map();let seq=0;
  return {
    async submit(input){const id='e2e-'+(++seq);const task={id,...input,agente:input.tipo==='pericia'?'Pericial':'Redação',status:'na_fila',sha256:null};tasks.set(id,task);return structuredClone(task)},
    async run(id){const task=tasks.get(id);if(!task)throw new Error('Tarefa não encontrada');task.status='aguardando_revisao';task.resultado='minuta pronta';task.sha256='sha-'+id;return structuredClone(task)},
    async get(id){const task=tasks.get(id);return task?structuredClone(task):null},
    async list(){return [...tasks.values()].map(structuredClone)},
    async returnForCorrection(id,motivo){const task=tasks.get(id);task.status='na_fila';task.correcao_solicitada=motivo;task.resultado_anterior=task.resultado;task.resultado=null;task.sha256=null;return structuredClone(task)},
    async review(id,sha){const task=tasks.get(id);if(!task||task.sha256!==sha)throw new Error('Versão divergente');task.status='concluida';task.revisado=true;return structuredClone(task)}
  };
}

function response(){let status=0,body=null;return{res:{writeHead:s=>{status=s},end:b=>{body=b?JSON.parse(b):null}},get:()=>({status,body})}}
async function route(url,method,deps,body){deps.body=async()=>body;const out=response();await officeRoutes({url,method},out.res,deps);return out.get()}
async function waitFor(fn,{tries=50,delay=10}={}){for(let i=0;i<tries;i++){const v=fn();if(v)return v;await new Promise(r=>setTimeout(r,delay))}throw new Error('Estado esperado não foi alcançado')}

const CHECK_OK={documento_identidade:'ok',comprovante_endereco:'ok',procuracao:'ok',contratos:'nao_se_aplica'};

test('E2E escritório: Cadastro → Iniciais → Peças → Revisão → correção → Revisão → distribuição → Processos',async()=>{
  const db=processStore(),engine=taskEngine();
  const deps={headers:{'Content-Type':'application/json'},authenticate:()=> 'admin',body:async()=>({}),processStore:db,engine,records:{read:async()=>({value:{}})},aiAvailable:()=>true,log:()=>{}};

  let r=await route('/api/escritorio/preparacao','POST',deps,{caso:{id:'caso-e2e',nome:'Cliente Piloto',status:'EM_PREP',descricao:'Fatos do caso'},documentos:[]});
  assert.equal(r.status,200);assert.equal(Pipeline.stageOf(r.body.processo),'cadastro');assert.equal(r.body.processo.bloqueio_peca,true);

  r=await route('/api/escritorio/cadastro/conferir','POST',deps,{processo_id:'caso-e2e',checklist:{...CHECK_OK,procuracao:'falta'}});
  assert.equal(r.status,200);assert.equal(r.body.conferido,false);assert.equal(Pipeline.stageOf(db.snapshot()[0]),'cadastro');

  r=await route('/api/tarefas','POST',deps,{processo_id:'caso-e2e',tipo:'peticao',instrucao:'Redija a petição inicial',request_id:'e2e-bloqueada'});
  assert.equal(r.status,422);assert.match(r.body.error,/Produção bloqueada/i);

  r=await route('/api/escritorio/cadastro/conferir','POST',deps,{processo_id:'caso-e2e',checklist:CHECK_OK});
  assert.equal(r.status,200);assert.equal(r.body.conferido,true);assert.equal(r.body.setor,'iniciais');

  r=await route('/api/tarefas','POST',deps,{processo_id:'caso-e2e',tipo:'peticao',instrucao:'Redija a petição inicial',request_id:'e2e-1'});
  assert.equal(r.status,202);const taskId=r.body.tarefa.id;
  await waitFor(()=>Pipeline.stageOf(db.snapshot()[0])==='revisao');
  let p=db.snapshot()[0];assert.equal(Pipeline.stageOf(p),'revisao');assert.equal(p.office_events[0].para,'revisao');

  r=await route('/api/tarefas/devolver','POST',deps,{id:taskId,motivo:'Corrigir o pedido subsidiário'});
  assert.equal(r.status,202);assert.equal(r.body.setor,'pecas');
  await waitFor(()=>Pipeline.stageOf(db.snapshot()[0])==='revisao');
  p=db.snapshot()[0];assert.equal(Pipeline.stageOf(p),'revisao');

  const task=await engine.get(taskId);assert.equal(task.status,'aguardando_revisao');
  r=await route('/api/tarefas/revisar','POST',deps,{id:taskId,sha256:task.sha256});
  assert.equal(r.status,200);assert.equal(r.body.setor,'iniciais');

  r=await route('/api/escritorio/distribuir','POST',deps,{processo_id:'caso-e2e',setor:'judicial',numero:'0000001-00.2026.8.13.0001'});
  assert.equal(r.status,200);assert.equal(r.body.setor,'processos');assert.equal(r.body.numero,'0000001-00.2026.8.13.0001');

  p=db.snapshot()[0];const counts=Pipeline.summary(db.snapshot());
  assert.equal(Pipeline.stageOf(p),'processos');assert.equal(counts.processos,1);assert.equal(counts.cadastro,0);assert.equal(counts.iniciais,0);assert.equal(counts.pecas,0);assert.equal(counts.revisao,0);assert.equal(counts.total,1);
  assert.ok(p.office_events.length>=6);assert.equal(new Set([p.id]).size,1);
});
