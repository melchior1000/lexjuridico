'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createReadingLogEntry}=require('../lib/reading-log-schema');
const {mintCourtSyncEvidence,isCourtSyncEvidence}=require('../lib/court-sync-evidence');
const {mintDeadlineTruth,isLegalTruth}=require('../lib/deadline-truth');
const {checkFreshness,_internal}=require('../lib/freshness');

const NOW=Date.parse('2026-09-19T22:00:00Z');
const observed=new Date(NOW-60*1000).toISOString();

function reading(over={}){
  return createReadingLogEntry({
    reading_id:'r1',processo:'5000000-00.2026.8.13.0001',process_id:'p1',
    source:'pje',observed_at:observed,ok:true,status_code:200,due_at:'2026-09-30T23:59:59-03:00',
    proveniencia:{conector:'lib/pje-sync',endpoint:'https://pje.teste.jus.br/api',request_id:'req1',authenticated:true,timestamp_requisicao:observed,timestamp_resposta:observed},
    raw_receipt:'{"intimacao":"x"}',content_type:'application/json',movimentos_encontrados:1,sincronizado:true,movement_received:true,...over
  });
}

test('frescor judicial padrao e de 15 minutos',()=>assert.equal(_internal.DEFAULT_MAX_AGE_MS,15*60*1000));
test('leitura oficial fresca cunha evidencia privada',()=>{const r=reading();const e=mintCourtSyncEvidence({readingId:'r1'},{readingLog:new Map([['r1',r]]),now:NOW});assert.equal(isCourtSyncEvidence(e),true);assert.equal(isCourtSyncEvidence({...e}),false);});
test('prazo so vira verdade com leitura oficial integra e autorizacao humana vinculada',()=>{const r=reading();const auth={id:'a1',reading_id:'r1',process_id:'p1',human_id:'secretaria-1',authorized_at:observed};const t=mintDeadlineTruth({readingId:'r1',authorizationId:'a1'},{readingLog:new Map([['r1',r]]),authorizationLog:new Map([['a1',auth]]),now:NOW});assert.equal(t.due_at,'2026-09-30T23:59:59-03:00');assert.equal(isLegalTruth(t),true);});
test('prazo nao e cunhado sem autorizacao humana',()=>{const r=reading();assert.throws(()=>mintDeadlineTruth({readingId:'r1',authorizationId:'a1'},{readingLog:new Map([['r1',r]]),authorizationLog:new Map(),now:NOW}),/authorization_not_found/);});
test('recibo adulterado invalida a evidencia',()=>{const base=reading();const bad={...base,recibo:{...base.recibo,raw_receipt:'adulterado'}};assert.throws(()=>mintCourtSyncEvidence({readingId:'r1'},{readingLog:new Map([['r1',bad]]),now:NOW}),/reading_provenance_invalid/);});
test('leitura velha nao confirma estado judicial',()=>{const old=reading({observed_at:new Date(NOW-16*60*1000).toISOString()});assert.equal(checkFreshness(old,{now:NOW}).fresh,false);});
