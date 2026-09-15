'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Watch=require('../lib/deadline-watch');
const {mergeMovements}=require('../lib/datajud');

test('freshness aceita carimbo do Datajud',()=>{const now=new Date('2026-09-14T12:00:00-03:00');const p={id:1,prazo:'15/09/2026',datajud_atualizado_em:'2026-09-14T14:00:00.000Z'};const f=Watch.freshnessOf(p,now);assert.equal(f.freshness,'fresh')});
test('andamento novo não apaga prazo',()=>{const proc={numero:'0000000-00.2024.8.07.0001',prazo:'20/09/2026',andamentos:[]};const out=mergeMovements(proc,[{data:'2026-09-14',texto:'Juntada'}]);assert.equal(proc.prazo,'20/09/2026');assert.equal(out.novos,1)});
test('prazo fatal continua unconfirmed sem carimbo humano',()=>{const f=Watch.freshnessOf({id:2,prazo:'14/09/2026'});assert.equal(f.fatal_unconfirmed,true)});
test('carimbo humano confirma sem alterar data do prazo',()=>{const f=Watch.freshnessOf({id:3,prazo:'14/09/2026',deadline_confirmed_at:'2026-09-14T10:00:00-03:00'});assert.equal(f.fatal_unconfirmed,false);assert.ok(f.prazo)});
