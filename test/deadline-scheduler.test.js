'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDeadlineScheduler}=require('../lib/deadline-scheduler');

function records(){
  const map=new Map();
  return{async read(k){return map.has(k)?{value:structuredClone(map.get(k))}:null},async change(k,fn){const next=await fn(map.has(k)?structuredClone(map.get(k)):null);if(next!==undefined)map.set(k,structuredClone(next));return map.get(k)},get:k=>map.get(k)};
}
test('scheduler não repete um dia já concluído',async()=>{
  const rec=records();let runs=0;
  const s=createDeadlineScheduler({records:rec,now:()=>new Date('2026-09-20T12:00:00-03:00'),run:async()=>{runs++;return{ok:true,djen:{enabled:true,ok:true,cunhar_total:0},alerts:{novos:0},exceptions:[]}}});
  await s.tick();await s.tick();
  assert.equal(runs,1);assert.equal(rec.get('lex_deadline_daily_job').status,'ok');s.stop();
});
test('falha DJEN fica em retry e pode tentar de novo',async()=>{
  const rec=records();let runs=0;
  const s=createDeadlineScheduler({records:rec,now:()=>new Date('2026-09-20T12:00:00-03:00'),run:async()=>{runs++;return{ok:false,djen:{enabled:true,ok:false,error:'403',cunhar_total:0},alerts:{novos:0},exceptions:[]}}});
  await s.tick();await s.tick();
  assert.equal(runs,2);assert.equal(rec.get('lex_deadline_daily_job').status,'retry');s.stop();
});
