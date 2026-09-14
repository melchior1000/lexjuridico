'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Ledger=require('../lib/event-ledger');
const Pipeline=require('../lib/office-pipeline');

test('ledger encadeia eventos e detecta adulteração retroativa',()=>{
  const a=Ledger.append([],{event_id:'e1',event_type:'case.created',case_id:1,actor_id:'admin',payload:{x:1},occurred_at:'2026-09-14T20:00:00-03:00'});
  const b=Ledger.append([a],{event_id:'e2',event_type:'case.sector_changed',case_id:1,actor_id:'LEX',previous_state:{sector:'cadastro'},new_state:{sector:'iniciais'},occurred_at:'2026-09-14T20:01:00-03:00'});
  assert.equal(b.previous_event_hash,a.event_hash);
  assert.equal(Ledger.verify([a,b]),true);
  assert.equal(Ledger.verify([{...a,payload:{x:2}},b]),false);
});

test('movimento grava estado anterior e posterior no ledger sem duplicar retry',()=>{
  const base={id:7,office_stage:'processos',case_state_version:3};
  const a=Pipeline.handoff(base,'prazos',{actor:'admin',agent:'LEX Coordenador',intentId:'intent-7',reason:'prazo lançado',now:'2026-09-14T20:00:00-03:00'});
  assert.equal(a.case_events.length,1);
  assert.deepEqual(a.case_events[0].previous_state,{sector:'processos',case_state_version:3});
  assert.deepEqual(a.case_events[0].new_state,{sector:'prazos',case_state_version:4});
  assert.equal(Ledger.verify(a.case_events),true);
  const retry=Pipeline.handoff(a,'prazos',{actor:'admin',intentId:'intent-7',reason:'retry'});
  assert.equal(retry.case_events.length,1);
  assert.equal(retry.case_state_version,4);
});

test('correlation e causation ficam preservados no filme do processo',()=>{
  const p=Pipeline.handoff({id:8,office_stage:'processos'},'pecas',{actor:'LEX',agent:'Redação',intentId:'intent-8',correlationId:'corr-8',causationId:'task-8',taskId:'task-8',reason:'redigir'});
  const e=p.case_events[0];
  assert.equal(e.correlation_id,'corr-8');
  assert.equal(e.causation_id,'task-8');
  assert.equal(e.intent_id,'intent-8');
  assert.equal(e.actor_id,'LEX');
  assert.equal(e.agent_id,'Redação');
});
