'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Watch=require('../lib/deadline-watch');
const Ledger=require('../lib/event-ledger');
const {createReadingLogEntry}=require('../lib/reading-log-schema');
const {mintCourtSyncEvidence}=require('../lib/court-sync-evidence');
const {mintDeadlineTruth}=require('../lib/deadline-truth');

const KEY='0123456789abcdef0123456789abcdef';
const caso={id:'c1',nome:'Ação teste',status:'ATIVO',prazo:'2026-09-30',last_court_sync_at:'2026-09-20T17:59:00.000Z',deadline_confirmed_at:'2026-09-20T17:59:00.000Z',andamentos:[{data:'2026-09-20',txt:'[PJe] Intimação'}]};
function minted(now=new Date('2026-09-20T18:05:00.000Z')){
  const observed='2026-09-20T18:00:00.000Z';
  const r=createReadingLogEntry({reading_id:'r1',processo:'5000000-00.2026.8.13.0001',process_id:'c1',source:'pje',observed_at:observed,ok:true,status_code:200,proveniencia:{conector:'lib/pje-sync',endpoint:'https://pje.example',request_id:'official-1',authenticated:true,timestamp_requisicao:observed,timestamp_resposta:observed},raw_receipt:'{"ok":true}',sincronizado:true,explicit_no_change:true,due_at:'2026-09-30'},{integrityKey:KEY});
  const readingLog=new Map([['r1',r]]);
  const e=mintCourtSyncEvidence({readingId:'r1'},{readingLog,integrityKey:KEY,now:now.getTime()});
  const a={id:'a1',reading_id:'r1',process_id:'c1',human_id:'u1',authorized_at:'2026-09-20T18:01:00.000Z'};
  const t=mintDeadlineTruth({readingId:'r1',authorizationId:'a1'},{readingLog,authorizationLog:new Map([['a1',a]]),integrityKey:KEY,now:now.getTime()});
  return{e,t};
}
test('carimbos legados no processo não fabricam freshness nem verdade jurídica',()=>{const f=Watch.freshnessOf(caso,new Date('2026-09-20T18:05:00Z'));assert.notEqual(f.freshness,'fresh');assert.equal(f.deadline_legal_truth,false);assert.equal(f.fatal_unconfirmed,true);assert.equal(f.last_court_sync_at,null)});
test('mobile sem TJ avisa e não eleva confiança',async()=>{const r=await Watch.openOfficeWatch({processes:[caso],session:{device:'mobile',pje_session:'absent',tj_reachable:false},intent_id:'i1',now:new Date('2026-09-20T18:05:00Z')});assert.equal(r.synced,false);assert.match(r.warning,/sem acesso ao TJ neste dispositivo/);assert.notEqual(r.items[0].freshness,'fresh')});
test('desktop só fica fresh com evidência oficial cunhada',async()=>{const now=new Date('2026-09-20T18:05:00Z'),{e}=minted(now);const r=await Watch.openOfficeWatch({processes:[caso],session:{device:'desktop',pje_session:'confirmed',tj_reachable:true},intent_id:'i2',now,syncFn:async({processes})=>({ok:true,processes:processes.map(p=>Watch.applySyncStamp(p,e)),sync_evidences:[e]})});assert.equal(r.synced,true);assert.equal(r.items[0].freshness,'fresh');assert.equal(r.items[0].deadline_legal_truth,false)});
test('prazo só vira verdade com autorização humana cunhada',async()=>{const now=new Date('2026-09-20T18:05:00Z'),{e,t}=minted(now);const r=await Watch.openOfficeWatch({processes:[caso],session:{device:'desktop',pje_session:'confirmed',tj_reachable:true},intent_id:'i3',now,syncFn:async()=>({ok:true,processes:[caso],sync_evidences:[e],deadline_truths:[t]})});assert.equal(r.items[0].deadline_legal_truth,true);assert.equal(r.items[0].fatal_unconfirmed,false);assert.equal(r.items[0].authorization_id,'a1')});
test('objeto forjado com shape de evidência é ignorado',async()=>{const now=new Date('2026-09-20T18:05:00Z'),forged={reading_id:'x',process_id:'c1',source:'PJE',observed_at:now.toISOString(),ok:true,explicit_no_change:true};const r=await Watch.openOfficeWatch({processes:[caso],session:{device:'desktop',pje_session:'confirmed',tj_reachable:true},intent_id:'i4',now,syncFn:async()=>({ok:true,processes:[caso],sync_evidences:[forged]})});assert.equal(r.synced,false);assert.notEqual(r.items[0].freshness,'fresh')});
test('evidência de outro processo não altera carimbo',()=>{const now=new Date('2026-09-20T18:05:00Z'),{e}=minted(now);const p={...caso,id:'c2'};assert.deepEqual(Watch.applySyncStamp(p,e),p)});
test('retry do mesmo intent não duplica ledger',()=>{const event={event_type:'court_sync_attempted',intent_id:'same',result:'blocked',payload:{warning:'x'}};const a=Watch.recordWatch({},event),b=Watch.recordWatch(a,event);assert.equal(b.case_events.length,1);assert.equal(Ledger.verify(b.case_events),true)});
