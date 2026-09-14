'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Pipeline=require('../lib/office-pipeline');
const {officeRoutes}=require('../lib/office-routes');

function store(initial){
  let processes=structuredClone(initial);
  return {
    async read(){return {processes:structuredClone(processes),version:1}},
    async mutate(fn){const next=structuredClone(processes);const value=await fn(next);processes=next;return {value,processes:structuredClone(processes),version:Date.now()}},
    snapshot(){return structuredClone(processes)}
  };
}
function response(){let status=0,body=null;return{res:{writeHead:s=>{status=s},end:b=>{body=b?JSON.parse(b):null}},get:()=>({status,body})}}

test('um processo ocupa exatamente uma sala e a contagem acompanha a transferência',()=>{
  const a={id:1,nome:'Caso',office_stage:'cadastro',descricao:'fatos'};
  const before=Pipeline.summary([a]);assert.equal(before.cadastro,1);assert.equal(before.pecas,0);assert.equal(before.total,1);
  const b=Pipeline.handoff(a,'iniciais',{actor:'admin',reason:'cadastro conferido'});
  const c=Pipeline.handoff(b,'pecas',{actor:'LEX',reason:'redigir inicial'});
  const after=Pipeline.summary([c]);assert.equal(after.cadastro,0);assert.equal(after.iniciais,0);assert.equal(after.pecas,1);assert.equal(after.total,1);
  assert.equal(c.office_events.length,2);assert.equal(c.office_events[0].de,'iniciais');assert.equal(c.office_events[0].para,'pecas');
});

test('Cadastro não libera Iniciais enquanto houver documento pendente',()=>{
  const p={id:1,office_stage:'cadastro',docsFaltantes:'procuração legível'};
  assert.throws(()=>Pipeline.handoff(p,'iniciais',{reason:'tentar'}),/Cadastro incompleto/);
});

test('produção jurídica faz baixa do Cadastro, passa por Iniciais e entra em Peças',async()=>{
  const db=store([{id:7,nome:'Cliente',office_stage:'cadastro',docsFaltantes:'',descricao:'fatos do caso'}]);
  const moved=await Pipeline.syncTaskStart(db,{id:'t1',tipo:'peticao',processo_id:7,agente:'Redação'},'admin');
  assert.equal(Pipeline.stageOf(moved),'pecas');
  assert.equal(moved.office_events.length,2);
  assert.equal(moved.office_events[1].de,'cadastro');assert.equal(moved.office_events[1].para,'iniciais');
  assert.equal(moved.office_events[0].de,'iniciais');assert.equal(moved.office_events[0].para,'pecas');
});

test('perícia entra na sala Perícia e entrega pronta entra em Revisão',async()=>{
  const db=store([{id:8,nome:'Laudo',office_stage:'processos',descricao:'material'}]);
  await Pipeline.syncTaskStart(db,{id:'t2',tipo:'pericia',processo_id:8,agente:'Pericial'},'admin');
  assert.equal(Pipeline.stageOf(db.snapshot()[0]),'pericia');
  await Pipeline.syncTaskResult(db,{id:'t2',tipo:'pericia',processo_id:8,agente:'Pericial',status:'aguardando_revisao'},'admin');
  assert.equal(Pipeline.stageOf(db.snapshot()[0]),'revisao');
});

test('pendência detectada devolve o caso ao Cadastro com histórico',async()=>{
  const db=store([{id:9,nome:'Caso',office_stage:'pecas',descricao:'material'}]);
  const p=await Pipeline.syncTaskResult(db,{id:'t3',tipo:'peticao',processo_id:9,agente:'Redação',status:'aguardando_dados'},'admin');
  assert.equal(Pipeline.stageOf(p),'cadastro');
  assert.match(p.office_last_event.motivo,/devolvida ao Cadastro/i);
});

test('revisão aprovada volta a Iniciais sem número e a Processos quando já distribuído',async()=>{
  const semNumero=store([{id:10,nome:'Inicial',office_stage:'revisao',numero:''}]);
  await Pipeline.syncTaskReview(semNumero,{id:'t4',tipo:'peticao',processo_id:10},'admin');
  assert.equal(Pipeline.stageOf(semNumero.snapshot()[0]),'iniciais');
  const comNumero=store([{id:11,nome:'Contestação',office_stage:'revisao',numero:'0000001-00.2026.8.13.0001'}]);
  await Pipeline.syncTaskReview(comNumero,{id:'t5',tipo:'contestacao',processo_id:11},'admin');
  assert.equal(Pipeline.stageOf(comNumero.snapshot()[0]),'processos');
});

test('rota mover exige motivo e devolve contagem oficial das salas',async()=>{
  const db=store([{id:12,nome:'Caso',office_stage:'processos',numero:'0000001-00.2026.8.13.0001'}]);
  const deps={headers:{'Content-Type':'application/json'},authenticate:()=> 'admin',body:async()=>({processo_id:12,destino:'prazos',motivo:'prazo lançado'}),processStore:db,records:{read:async()=>({value:{}})},engine:{list:async()=>[]},aiAvailable:()=>false,log:()=>{}};
  const out=response();await officeRoutes({url:'/api/escritorio/mover',method:'POST'},out.res,deps);
  assert.equal(out.get().status,200);assert.equal(out.get().body.setor,'prazos');assert.equal(out.get().body.setores.processos,0);assert.equal(out.get().body.setores.prazos,1);
});
