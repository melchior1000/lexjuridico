'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mintDeadlineTruth, isLegalTruth, DeadlineTruthError } = require('../lib/deadline-truth');
const { checkFreshness } = require('../lib/freshness');

const NOW = Date.parse('2026-09-16T12:00:00Z');
const FRESH = new Date(NOW - 60 * 1000).toISOString();
const STALE = new Date(NOW - 60 * 60 * 1000).toISOString();
const FUTURE = new Date(NOW + 10 * 60 * 1000).toISOString();
function makeStores({ reading, auth } = {}) { return { readingLog:{get:id=>reading&&reading.id===id?reading:null}, authorizationLog:{get:id=>auth&&auth.id===id?auth:null} }; }
function officialReading(over={}) { return {id:'read_1',process_id:'proc_1',source:'PJE',observed_at:FRESH,raw_receipt:{intimation:'raw'},due_at:'2026-09-30T23:59:59-03:00',ok:true,...over}; }
function humanAuth(over={}) { return {id:'auth_1',reading_id:'read_1',process_id:'proc_1',human_id:'user_42',authorized_at:FRESH,...over}; }
const OK={readingId:'read_1',authorizationId:'auth_1'};
const call=(refs,stores,extra={})=>mintDeadlineTruth(refs,{...stores,now:NOW,maxAgeMs:15*60*1000,...extra});

test('happy path emite verdade marcada e imutavel',()=>{const t=call(OK,makeStores({reading:officialReading(),auth:humanAuth()}));assert.equal(t.legal_truth,true);assert.equal(t.source,'PJE');assert.ok(isLegalTruth(t));assert.ok(Object.isFrozen(t));});
test('objeto montado na mao nao e verdade juridica',()=>assert.equal(isLegalTruth({legal_truth:true}),false));
test('chamador nao injeta prazo',()=>{const t=call({...OK,confirmed_due_at:'2099-01-01'},makeStores({reading:officialReading(),auth:humanAuth()}));assert.equal(t.due_at,'2026-09-30T23:59:59-03:00');});
test('recusa leitura inexistente',()=>assert.throws(()=>call({readingId:'x',authorizationId:'auth_1'},makeStores({auth:humanAuth()})),e=>e instanceof DeadlineTruthError&&e.code==='reading_not_found'));
test('recusa fonte manual',()=>assert.throws(()=>call(OK,makeStores({reading:officialReading({source:'MANUAL'}),auth:humanAuth()})),e=>e.code==='source_not_official'));
test('recusa leitura sem recibo bruto',()=>assert.throws(()=>call(OK,makeStores({reading:officialReading({raw_receipt:null}),auth:humanAuth()})),e=>e.code==='reading_receipt_missing'));
test('recusa leitura vencida',()=>assert.throws(()=>call(OK,makeStores({reading:officialReading({observed_at:STALE}),auth:humanAuth()})),e=>e.code==='reading_not_fresh'));
test('recusa observed_at futuro',()=>assert.throws(()=>call(OK,makeStores({reading:officialReading({observed_at:FUTURE}),auth:humanAuth()})),e=>e.code==='reading_not_fresh'));
test('recusa observed_at invalido',()=>assert.throws(()=>call(OK,makeStores({reading:officialReading({observed_at:'x'}),auth:humanAuth()})),e=>e.code==='reading_not_fresh'));
test('recusa observed_at ausente',()=>assert.throws(()=>call(OK,makeStores({reading:officialReading({observed_at:null}),auth:humanAuth()})),e=>e.code==='reading_not_fresh'));
test('recusa ok false',()=>assert.throws(()=>call(OK,makeStores({reading:officialReading({ok:false}),auth:humanAuth()})),e=>e.code==='reading_not_fresh'));
test('recusa autorizacao inexistente',()=>assert.throws(()=>call(OK,makeStores({reading:officialReading()})),e=>e.code==='authorization_not_found'));
test('recusa autorizacao de outra leitura',()=>assert.throws(()=>call(OK,makeStores({reading:officialReading(),auth:humanAuth({reading_id:'outra'})})),e=>e.code==='authorization_reading_mismatch'));
test('recusa autorizacao de outro processo',()=>assert.throws(()=>call(OK,makeStores({reading:officialReading(),auth:humanAuth({process_id:'outro'})})),e=>e.code==='authorization_process_mismatch'));
test('freshness exige timestamp alem de ok',()=>{assert.equal(checkFreshness({ok:true,observed_at:FRESH},{now:NOW}).fresh,true);assert.equal(checkFreshness({ok:true},{now:NOW}).reason,'observed_at_missing');});
