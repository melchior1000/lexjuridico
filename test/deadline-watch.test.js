'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Watch=require('../lib/deadline-watch');
const Ledger=require('../lib/event-ledger');
const {createReadingLogEntry}=require('../lib/reading-log-schema');
const {mintCourtSyncEvidenceFromReading}=require('../lib/court-sync-evidence');

const NOW=new Date('2026-09-14T18:00:00.000Z');
const caso={id:'c1',nome:'Ação teste',status:'ATIVO',prazo:'2026-09-16',last_court_sync_at:'2026-09-13T12:00:00.000Z',andamentos:[{data:'2026-09-13',txt:'[PJe] Intimação'}]};
function reading(){
  const at='2026-09-14T17:59:00.000Z';
  return createReadingLogEntry({
    reading_id:'r1',processo:'5000000-00.2026.8.13.0001',process_id:'c1',
    source:'datajud',observed_at:at,ok:true,status_code:200,
    proveniencia:{conector:'lib/datajud',endpoint:'https://datajud.test/_search',request_id:'req',authenticated:true,timestamp_requisicao:'2026-09-14T17:58:59.000Z',timestamp_resposta:at},
    raw_receipt:'{"hits":[]}',sincronizado:true,explicit_no_change:true
  });
}

test('mobile sem TJ não transforma carimbo legado em evidência',async()=>{
  const r=await Watch.openOfficeWatch({processes:[caso],session:{device:'mobile',pje_session:'absent',tj_reachable:false},intent_id:'i1',now:NOW});
  assert.equal(r.synced,false);
  assert.match(r.warning,/sem acesso ao TJ neste dispositivo/);
  assert.equal(r.items[0].last_court_sync_at,null);
  assert.notEqual(r.items[0].freshness,'fresh');
});

test('desktop só fica fresh com evidência oficial cunhada',async()=>{
  const rd=reading(),ev=mintCourtSyncEvidenceFromReading(rd,{now:NOW.getTime()}),proc={...caso,court_readings:[structuredClone(rd)]};
  const r=await Watch.openOfficeWatch({processes:[proc],session:{device:'desktop',pje_session:'confirmed',tj_reachable:true},intent_id:'i2',now:NOW,syncFn:async({processes})=>({ok:true,sync_evidences:[ev],processes})});
  assert.equal(r.synced,true);
  assert.equal(r.items[0].freshness,'fresh');
});

test('reading persistida é revalidada após restart',()=>{
  const rd=structuredClone(reading());
  const f=Watch.freshnessOf({...caso,court_readings:[rd]},NOW);
  assert.equal(f.freshness,'fresh');
  assert.equal(f.last_court_sync_source,'datajud');
});

test('retry mesmo intent não duplica ledger',()=>{
  const event={event_type:'court_sync_attempted',intent_id:'same',result:'blocked',payload:{warning:'x'}};
  const a=Watch.recordWatch({},event),b=Watch.recordWatch(a,event);
  assert.equal(b.case_events.length,1);
  assert.equal(Ledger.verify(b.case_events),true);
});

test('andamento não baixa prazo',()=>{
  const before=Watch.freshnessOf(caso,NOW);
  const after=Watch.freshnessOf({...caso,andamentos:[{data:'2026-09-14',txt:'novo'},...caso.andamentos]},NOW);
  assert.equal(after.prazo,before.prazo);
  assert.equal(after.fatal_unconfirmed,true);
});
