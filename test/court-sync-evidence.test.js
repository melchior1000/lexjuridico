'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createReadingLogEntry}=require('../lib/reading-log-schema');
const {mintCourtSyncEvidence,isCourtSyncEvidence}=require('../lib/court-sync-evidence');
function valid(now=new Date('2026-09-16T12:00:00Z')){return createReadingLogEntry({reading_id:'r1',processo:'5000000-00.2026.8.13.0001',process_id:'p1',source:'datajud',observed_at:now.toISOString(),ok:true,status_code:200,proveniencia:{conector:'lib/datajud',endpoint:'https://api-publica.datajud.cnj.jus.br/x/_search',request_id:'req-1',authenticated:true,timestamp_requisicao:now.toISOString(),timestamp_resposta:now.toISOString()},content_type:'application/json',raw_receipt:'{"hits":[]}',movimentos_encontrados:0,sincronizado:true,explicit_no_change:true})}
function mint(reading,now=new Date('2026-09-16T12:00:00Z')){return mintCourtSyncEvidence({readingId:reading.reading_id},{readingLog:new Map([[reading.reading_id,reading]]),now:now.getTime()})}
test('reading válido cunha evidência privada',()=>{const e=mint(valid());assert.equal(isCourtSyncEvidence(e),true)});
test('objeto forjado com shape correto não é evidência cunhada',()=>{assert.equal(isCourtSyncEvidence({reading_id:'r1',source:'DATAJUD',observed_at:new Date().toISOString()}),false)});
test('reading sem proveniência confiável é rejeitado',()=>{const r={...valid(),proveniencia:null};assert.throws(()=>mint(r),/reading_provenance_invalid/)});
test('recibo ausente é rejeitado',()=>{const base=valid(),r={...base,recibo:{...base.recibo,raw_receipt:''}};assert.throws(()=>mint(r),/reading_provenance_invalid/)});
test('recibo adulterado sem recomputar hash é rejeitado',()=>{const base=valid(),r={...base,recibo:{...base.recibo,raw_receipt:'adulterado'},raw_receipt:'adulterado'};assert.throws(()=>mint(r),/reading_provenance_invalid/)});
test('timestamp e source isolados não cunham evidência',()=>{const r={reading_id:'fake',processo:'5000000-00.2026.8.13.0001',source:'pje',observed_at:new Date().toISOString(),ok:true};assert.throws(()=>mint(r),/reading_provenance_invalid/)});
