'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Bridge=require('../lib/hybrid-court-bridge');
const {createReadingLogEntry}=require('../lib/reading-log-schema');
const {mintCourtSyncEvidence}=require('../lib/court-sync-evidence');
const {mintDeadlineTruth}=require('../lib/deadline-truth');

const KEY='0123456789abcdef0123456789abcdef';
const NOW=new Date('2026-09-20T18:05:00.000Z');
function signedReading({id='r1',process='c1',observed='2026-09-20T18:00:00.000Z',due='2026-09-30'}={}){
  return createReadingLogEntry({reading_id:id,processo:'5000000-00.2026.8.13.0001',process_id:process,source:'pje',observed_at:observed,ok:true,status_code:200,proveniencia:{conector:'lib/pje-sync',endpoint:'https://pje.example',request_id:'req-'+id,authenticated:true,timestamp_requisicao:observed,timestamp_resposta:observed},raw_receipt:'{"ok":true}',sincronizado:true,explicit_no_change:true,due_at:due},{integrityKey:KEY});
}
function evidence(r=signedReading()){return mintCourtSyncEvidence({readingId:r.reading_id},{readingLog:new Map([[r.reading_id,r]]),integrityKey:KEY,now:NOW.getTime()})}
function truth(r=signedReading()){const a={id:'a1',reading_id:r.reading_id,process_id:r.process_id,human_id:'u1',authorized_at:'2026-09-20T18:01:00.000Z'};return mintDeadlineTruth({readingId:r.reading_id,authorizationId:'a1'},{readingLog:new Map([[r.reading_id,r]]),authorizationLog:new Map([['a1',a]]),integrityKey:KEY,now:NOW.getTime()})}
test('evidência oficial cunhada e recente permite carimbo',()=>{const e=evidence();assert.equal(Bridge.canStampOfficialSync([e],NOW),true);assert.equal(Bridge.sourceState([e],NOW).freshness,'fresh')});
test('shape oficial não verificado nunca permite carimbo',()=>{const raw={source:'pje',ok:true,explicit_no_change:true,observed_at:'2026-09-20T18:00:00Z'};assert.equal(Bridge.canStampOfficialSync([raw],NOW),false);assert.equal(Bridge.sourceState([raw],NOW).freshness,'stale')});
test('evidência antiga deixa de ser fresh',()=>{const e=evidence();const later=new Date('2026-09-20T18:20:01.000Z');assert.equal(Bridge.canStampOfficialSync([e],later),false);assert.equal(Bridge.sourceState([e],later).freshness,'stale')});
test('entrada nula ou malformada não derruba reconciliação',()=>{const s=Bridge.sourceState([null,'x',{}],NOW);assert.ok(s);const r=Bridge.reconcile({case_id:'c1',readings:[null],now:NOW});assert.equal(r.requires_human_attention,true)});
test('arquivo local nunca confirma sincronização oficial',()=>{const r=[{source:'local_bridge',ok:true,movement_received:true}];assert.equal(Bridge.canStampOfficialSync(r,NOW),false);assert.equal(Bridge.sourceState(r,NOW).freshness,'provisional')});
test('verdade jurídica de outro processo é rejeitada na reconciliação',()=>{const t=truth();const r=Bridge.reconcile({case_id:'c2',truth:t,deadline:{suggested_due_at:'2026-10-01'},now:NOW});assert.equal(r.deadline.legal_truth,false);assert.match(r.warnings.join(' '),/outro processo/i)});
test('verdade jurídica cunhada do mesmo processo é aceita',()=>{const r0=signedReading(),t=truth(r0),e=evidence(r0);const r=Bridge.reconcile({case_id:'c1',truth:t,readings:[e],now:NOW});assert.equal(r.deadline.legal_truth,true);assert.equal(r.requires_human_attention,false)});
test('bridge local é somente entrada mesmo se chamador tentar fonte oficial',()=>{const e=Bridge.bridgeEnvelope({case_id:'c1',path:'/entrada/i.pdf',sha256:'deadbeef',source:'pje',intent_id:'i1'});assert.equal(e.source,'local_bridge');assert.equal(e.payload.can_confirm_deadline,false);assert.equal(e.payload.can_file,false)});
