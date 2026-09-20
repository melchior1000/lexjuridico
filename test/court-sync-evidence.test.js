'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createReadingLogEntry}=require('../lib/reading-log-schema');
const {mintCourtSyncEvidence,isCourtSyncEvidence}=require('../lib/court-sync-evidence');

const KEY='0123456789abcdef0123456789abcdef';
const NOW=Date.parse('2026-09-20T18:00:00.000Z');
function reading(observed='2026-09-20T18:00:00.000Z'){
  return createReadingLogEntry({
    reading_id:'r1',processo:'5000000-00.2026.8.13.0001',process_id:'p1',source:'datajud',observed_at:observed,ok:true,status_code:200,
    proveniencia:{conector:'lib/datajud',endpoint:'https://api.example/_search',request_id:'req-1',authenticated:true,timestamp_requisicao:observed,timestamp_resposta:observed},
    content_type:'application/json',raw_receipt:'{"hits":[]}',sincronizado:true,explicit_no_change:true
  },{integrityKey:KEY});
}
function mint(r,now=NOW){return mintCourtSyncEvidence({readingId:r.reading_id},{readingLog:new Map([[r.reading_id,r]]),integrityKey:KEY,now})}
test('reading assinado e fresco cunha evidência privada',()=>{const e=mint(reading());assert.equal(isCourtSyncEvidence(e),true);assert.equal(e.process_id,'p1')});
test('objeto forjado com o mesmo shape não vira evidência',()=>assert.equal(isCourtSyncEvidence({reading_id:'r1',process_id:'p1',source:'DATAJUD',observed_at:new Date(NOW).toISOString(),ok:true}),false));
test('reading adulterado não cunha evidência',()=>{const r=structuredClone(reading());r.observed_at='2026-09-20T18:05:00.000Z';assert.throws(()=>mint(r),/reading_provenance_invalid/)});
test('reading assinado mas vencido não cunha evidência',()=>{const r=reading('2026-09-20T17:30:00.000Z');assert.throws(()=>mint(r),/reading_not_fresh/)});
test('reading sem resultado explícito não cunha evidência',()=>{const observed='2026-09-20T18:00:00.000Z';const r=createReadingLogEntry({reading_id:'r2',processo:'x',process_id:'p1',source:'pje',observed_at:observed,ok:true,status_code:200,proveniencia:{conector:'lib/pje-sync',endpoint:'https://pje.example',request_id:'req2',authenticated:true,timestamp_requisicao:observed,timestamp_resposta:observed},raw_receipt:'{}',sincronizado:false},{integrityKey:KEY});assert.throws(()=>mintCourtSyncEvidence({readingId:'r2'},{readingLog:new Map([['r2',r]]),integrityKey:KEY,now:NOW}),/reading_has_no_sync_result/)});
