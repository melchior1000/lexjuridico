'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Pipeline=require('../lib/office-pipeline');

function store(initial){let processes=structuredClone(initial);return{async read(){return{processes:structuredClone(processes),version:1}},async mutate(fn){const next=structuredClone(processes);const value=await fn(next);processes=next;return{value,processes:structuredClone(processes),version:2}},snapshot(){return structuredClone(processes)}}}
const CHECK={documento_identidade:'ok',comprovante_endereco:'ok',procuracao:'ok',contratos:'nao_se_aplica'};

test('análise não é enviada para Peças',async()=>{
  const db=store([{id:1,nome:'Caso',office_stage:'processos'}]);
  const p=await Pipeline.syncTaskStart(db,{id:'a1',tipo:'analise',processo_id:1,agente:'Jurídico judicial'},'admin');
  assert.equal(Pipeline.stageOf(p),'processos');
});

test('revisão entra em Revisão e perícia entra em Perícia',async()=>{
  const review=store([{id:2,nome:'Caso',office_stage:'processos'}]);
  assert.equal(Pipeline.stageOf(await Pipeline.syncTaskStart(review,{id:'r1',tipo:'revisao',processo_id:2,agente:'Revisão'},'admin')),'revisao');
  const expert=store([{id:3,nome:'Caso',office_stage:'processos'}]);
  assert.equal(Pipeline.stageOf(await Pipeline.syncTaskStart(expert,{id:'p1',tipo:'pericia',processo_id:3,agente:'Pericial'},'admin')),'pericia');
});

test('Cadastro conferido dá baixa, passa por Iniciais e entra em Peças',async()=>{
  const db=store([{id:4,nome:'Cliente',office_stage:'cadastro',checklist_cadastro:CHECK,cadastro_conferido:true}]);
  const p=await Pipeline.syncTaskStart(db,{id:'t1',tipo:'peticao',processo_id:4,agente:'Redação'},'admin');
  assert.equal(Pipeline.stageOf(p),'pecas');
  assert.equal(p.office_events[1].de,'cadastro');assert.equal(p.office_events[1].para,'iniciais');
  assert.equal(p.office_events[0].de,'iniciais');assert.equal(p.office_events[0].para,'pecas');
});
