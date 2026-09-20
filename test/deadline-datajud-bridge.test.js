'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Watch=require('../lib/deadline-watch');
const {mergeMovements}=require('../lib/datajud');

test('carimbo legado do Datajud não prova freshness',()=>{
  const now=new Date('2026-09-14T15:00:00.000Z');
  const p={id:1,prazo:'15/09/2026',datajud_atualizado_em:'2026-09-14T14:00:00.000Z'};
  assert.notEqual(Watch.freshnessOf(p,now).freshness,'fresh');
});

test('andamento novo não apaga prazo',()=>{
  const proc={numero:'0000000-00.2024.8.07.0001',prazo:'20/09/2026',andamentos:[]};
  const out=mergeMovements(proc,[{data:'2026-09-14',texto:'Juntada'}]);
  assert.equal(proc.prazo,'20/09/2026');
  assert.equal(out.novos,1);
});

test('prazo fatal continua unconfirmed sem verdade jurídica cunhada',()=>{
  assert.equal(Watch.freshnessOf({id:2,prazo:'14/09/2026'}).fatal_unconfirmed,true);
});

test('campo legado deadline_confirmed_at sozinho não confirma prazo',()=>{
  assert.equal(Watch.freshnessOf({id:3,prazo:'14/09/2026',deadline_confirmed_at:'2026-09-14T10:00:00-03:00'}).fatal_unconfirmed,true);
});
