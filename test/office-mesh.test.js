'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const State=require('../lib/office-state');
const Pipeline=require('../lib/office-pipeline');

function store(initial){
  let processes=structuredClone(initial);
  return {
    async read(){return {processes:structuredClone(processes),version:1}},
    async mutate(fn){const next=structuredClone(processes);const value=await fn(next);processes=next;return {value,processes:structuredClone(processes),version:Date.now()}},
    snapshot(){return structuredClone(processes)}
  };
}

test('setores oficiais vêm de uma lista canônica única',()=>{
  assert.deepEqual(State.SECTOR_CODES,['recepcao','cadastro','iniciais','processos','prazos','pecas','pericia','revisao','concluidos']);
  assert.equal(Pipeline.STAGES,State.SECTOR_CODES);
  assert.equal(Pipeline.SECTORS.find(x=>x.code==='pericia').name,'Perícia');
});

test('movimento gera um único case.sector_changed e outbox na mesma mutação',async()=>{
  const db=store([{id:'p1',nome:'Caso',office_stage:'processos',numero:'0000001-00.2026.8.13.0001'}]);
  const moved=await Pipeline.moveProcess(db,'p1','prazos',{actor:'admin',agent:'LEX Coordenador',reason:'Prazo recebido',intentId:'intent-001'});
  assert.equal(moved.office_stage,'prazos');
  assert.equal(moved.case_state_version,1);
  assert.equal(moved.office_events.length,1);
  assert.equal(moved.office_events[0].event_type,'case.sector_changed');
  assert.equal(moved.office_events[0].intent_id,'intent-001');
  assert.equal(moved.office_events[0].de,'processos');
  assert.equal(moved.office_events[0].para,'prazos');
  assert.equal(moved.office_outbox.length,1);
  assert.equal(moved.office_outbox[0].event_id,moved.office_events[0].id);
  assert.equal(moved.office_outbox[0].status,'pending');
  assert.equal(Pipeline.summary(db.snapshot()).processos,0);
  assert.equal(Pipeline.summary(db.snapshot()).prazos,1);
});

test('mesmo intent_id é idempotente e não duplica evento nem outbox',async()=>{
  const db=store([{id:'p2',nome:'Caso',office_stage:'processos',numero:'0000002-00.2026.8.13.0001'}]);
  const meta={actor:'admin',reason:'Enviar para revisão',intentId:'move-review-123'};
  await Pipeline.moveProcess(db,'p2','revisao',meta);
  await Pipeline.moveProcess(db,'p2','revisao',meta);
  const p=db.snapshot()[0];
  assert.equal(p.office_stage,'revisao');
  assert.equal(p.case_state_version,1);
  assert.equal(p.office_events.length,1);
  assert.equal(p.office_outbox.length,1);
});

test('retry da mesma geração da tarefa não gera segunda movimentação',async()=>{
  const db=store([{id:'p3',nome:'Caso',office_stage:'processos',numero:'0000003-00.2026.8.13.0001'}]);
  const task={id:'t77',tipo:'pericia',processo_id:'p3',agente:'Pericial',tentativas:0};
  await Pipeline.syncTaskStart(db,task,'admin');
  await Pipeline.syncTaskStart(db,task,'admin');
  const p=db.snapshot()[0];
  assert.equal(p.office_stage,'pericia');
  assert.equal(p.office_events.filter(e=>e.intent_id==='task:t77:start:pericia:attempt:0').length,1);
  assert.equal(p.office_outbox.filter(e=>e.intent_id==='task:t77:start:pericia:attempt:0').length,1);
});

test('correção humana cria nova geração e pode voltar legitimamente à Revisão',async()=>{
  const db=store([{id:'p5',nome:'Laudo',office_stage:'pericia',numero:'0000005-00.2026.8.13.0001'}]);
  await Pipeline.syncTaskResult(db,{id:'t88',tipo:'pericia',processo_id:'p5',agente:'Pericial',status:'aguardando_revisao',tentativas:1},'admin');
  await Pipeline.moveProcess(db,'p5','pericia',{actor:'admin',agent:'LEX Revisão',reason:'Correção solicitada',intentId:'correction:t88:1'});
  await Pipeline.syncTaskResult(db,{id:'t88',tipo:'pericia',processo_id:'p5',agente:'Pericial',status:'aguardando_revisao',tentativas:2},'admin');
  const p=db.snapshot()[0];
  assert.equal(p.office_stage,'revisao');
  assert.equal(p.office_events.filter(e=>e.intent_id==='task:t88:result:revisao:attempt:1').length,1);
  assert.equal(p.office_events.filter(e=>e.intent_id==='task:t88:result:revisao:attempt:2').length,1);
});

test('outbox pendente é lida e confirmação de processamento também é idempotente',async()=>{
  const db=store([{id:'p4',nome:'Caso',office_stage:'processos',numero:'0000004-00.2026.8.13.0001'}]);
  await Pipeline.moveProcess(db,'p4','prazos',{actor:'admin',reason:'Prazo',intentId:'intent-outbox'});
  const pending=Pipeline.pendingOutbox(db.snapshot());
  assert.equal(pending.length,1);
  const id=pending[0].id;
  const first=await Pipeline.markOutboxProcessed(db,id,{actor:'worker',now:'2026-09-14T22:00:00.000Z'});
  const second=await Pipeline.markOutboxProcessed(db,id,{actor:'worker',now:'2026-09-14T22:01:00.000Z'});
  assert.equal(first.status,'processed');
  assert.equal(second.status,'processed');
  assert.equal(db.snapshot()[0].office_outbox[0].attempts,1);
  assert.equal(Pipeline.pendingOutbox(db.snapshot()).length,0);
});
