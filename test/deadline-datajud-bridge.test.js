'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Watch=require('../lib/deadline-watch');
const {mergeMovements}=require('../lib/datajud');

test('carimbo persistido do Datajud sozinho não fabrica freshness',()=>{const now=new Date('2026-09-20T18:00:00Z');const p={id:1,prazo:'2026-09-21',datajud_atualizado_em:'2026-09-20T17:59:00Z',last_court_sync_at:'2026-09-20T17:59:00Z'};const f=Watch.freshnessOf(p,now);assert.notEqual(f.freshness,'fresh')});
test('andamento novo não apaga prazo',()=>{const proc={numero:'0000000-00.2024.8.07.0001',prazo:'2026-09-30',andamentos:[]};const out=mergeMovements(proc,[{data:'2026-09-20',texto:'Juntada'}]);assert.equal(proc.prazo,'2026-09-30');assert.equal(out.novos,1)});
test('prazo fatal continua não confirmado sem verdade cunhada',()=>{const f=Watch.freshnessOf({id:2,prazo:'2026-09-21'});assert.equal(f.fatal_unconfirmed,true);assert.equal(f.deadline_legal_truth,false)});
test('carimbo humano legado não fabrica verdade jurídica',()=>{const f=Watch.freshnessOf({id:3,prazo:'2026-09-21',deadline_confirmed_at:'2026-09-20T17:00:00Z'});assert.equal(f.fatal_unconfirmed,true);assert.equal(f.deadline_legal_truth,false);assert.ok(f.prazo)});
