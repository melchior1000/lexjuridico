'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createReadingLogEntry}=require('../lib/reading-log-schema');
const {mintDeadlineTruth,isLegalTruth,DeadlineTruthError}=require('../lib/deadline-truth');
const {checkFreshness}=require('../lib/freshness');

const KEY='0123456789abcdef0123456789abcdef';
const NOW=Date.parse('2026-09-20T18:05:00.000Z');
function reading(over={}){
  const observed=over.observed_at||'2026-09-20T18:00:00.000Z';
  return createReadingLogEntry({
    reading_id:'read_1',processo:'5000000-00.2026.8.13.0001',process_id:'proc_1',source:'pje',observed_at:observed,ok:true,status_code:200,
    proveniencia:{conector:'lib/pje-sync',endpoint:'https://pje.example/api',request_id:'req-1',authenticated:true,timestamp_requisicao:observed,timestamp_resposta:observed},
    raw_receipt:'{"intimacao":"raw"}',sincronizado:true,explicit_no_change:true,
    ...over
  },{integrityKey:KEY});
}
function auth(over={}){return{id:'auth_1',reading_id:'read_1',process_id:'proc_1',human_id:'user_42',authorized_at:'2026-09-20T18:01:00.000Z',due_at:'2026-09-30T23:59:59-03:00',...over}}
function call(r=reading(),a=auth(),extra={}){
  return mintDeadlineTruth({readingId:'read_1',authorizationId:'auth_1'},{readingLog:new Map([['read_1',r]]),authorizationLog:new Map([['auth_1',a]]),integrityKey:KEY,now:NOW,...extra});
}
test('happy path emite verdade jurídica cunhada e imutável',()=>{const t=call();assert.equal(t.legal_truth,true);assert.equal(t.process_id,'proc_1');assert.equal(isLegalTruth(t),true);assert.equal(Object.isFrozen(t),true)});
test('objeto manual com legal_truth true não é aceito',()=>assert.equal(isLegalTruth({legal_truth:true,process_id:'proc_1'}),false));
test('leitura adulterada é rejeitada antes da autorização',()=>{const r=structuredClone(reading());r.observed_at='2026-09-20T18:04:00.000Z';assert.throws(()=>call(r),e=>e instanceof DeadlineTruthError&&e.code==='reading_provenance_invalid')});
test('leitura assinada e vencida é rejeitada',()=>{const r=reading({observed_at:'2026-09-20T17:30:00.000Z',proveniencia:{conector:'lib/pje-sync',endpoint:'https://pje.example/api',request_id:'req-1',authenticated:true,timestamp_requisicao:'2026-09-20T17:30:00.000Z',timestamp_resposta:'2026-09-20T17:30:00.000Z'}});assert.throws(()=>call(r),e=>e.code==='reading_not_fresh')});
test('autorização de outro processo é rejeitada',()=>assert.throws(()=>call(reading(),auth({process_id:'outro'})),e=>e.code==='authorization_process_mismatch'));
test('autorização anterior à leitura é rejeitada',()=>assert.throws(()=>call(reading(),auth({authorized_at:'2026-09-20T17:59:00.000Z'})),e=>e.code==='authorization_before_reading'));
test('autorização futura além do skew é rejeitada',()=>assert.throws(()=>call(reading(),auth({authorized_at:'2026-09-20T18:10:00.000Z'})),e=>e.code==='authorization_in_future'));
test('autorização com timestamp inválido é rejeitada',()=>assert.throws(()=>call(reading(),auth({authorized_at:'x'})),e=>e.code==='authorization_timestamp_invalid'));
test('vencimento ausente na autorização é rejeitado',()=>assert.throws(()=>call(reading(),auth({due_at:null})),e=>e.code==='authorization_due_at_missing'));
test('vencimento inválido na autorização é rejeitado',()=>assert.throws(()=>call(reading(),auth({due_at:'x'})),e=>e.code==='authorization_due_at_invalid'));
test('fonte recente precisa de observed_at além de ok',()=>{assert.equal(checkFreshness({ok:true,observed_at:'2026-09-20T18:00:00Z'},{now:NOW}).fresh,true);assert.equal(checkFreshness({ok:true},{now:NOW}).reason,'observed_at_missing')});

test('truth persiste e revalida por HMAC após serialização',()=>{const persisted=JSON.parse(JSON.stringify(call()));assert.equal(isLegalTruth(persisted,{integrityKey:KEY}),true);persisted.due_at='2026-10-01';assert.equal(isLegalTruth(persisted,{integrityKey:KEY}),false)});
test('DataJud nunca cunha vencimento mesmo com due_at e autorização',()=>{
  const observed='2026-09-20T18:00:00.000Z';
  const r=createReadingLogEntry({reading_id:'read_1',processo:'5000000-00.2026.8.13.0001',process_id:'proc_1',source:'datajud',observed_at:observed,ok:true,status_code:200,proveniencia:{conector:'lib/datajud',endpoint:'https://datajud.example',request_id:'req-dj',authenticated:true,timestamp_requisicao:observed,timestamp_resposta:observed},raw_receipt:'{}',sincronizado:true,explicit_no_change:true},{integrityKey:KEY});
  assert.throws(()=>call(r),e=>e instanceof DeadlineTruthError&&e.code==='source_not_deadline_capable');
});
