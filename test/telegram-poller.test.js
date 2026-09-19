'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTelegramPoller}=require('../lib/telegram-poller');

function store(initial=null){
  let value=initial;
  return {
    async read(){return value?{value}:null;},
    async change(_key,fn){const next=await fn(value?structuredClone(value):null);if(next!==undefined)value=next;return value;},
    value:()=>value
  };
}
function timers(){
  const q=[];
  return {set(fn,delay){const t={fn,delay,cancelled:false};q.push(t);return t;},clear(t){if(t)t.cancelled=true;},q};
}

test('sem token fica desabilitado e nao chama Telegram',async()=>{
  let calls=0;const t=timers();
  const p=createTelegramPoller({token:'',requestJson:async()=>{calls++;},adapter:async()=>{},records:store(),setTimer:t.set,clearTimer:t.clear});
  assert.deepEqual(await p.start(),{ok:false,disabled:true,reason:'token_ausente'});
  assert.equal(calls,0);assert.equal(t.q.length,0);
});

test('webhook ativo impede getUpdates',async()=>{
  const urls=[];const t=timers();
  const p=createTelegramPoller({token:'x',requestJson:async url=>{urls.push(url);return {ok:true,result:{url:'https://example.test/hook'}};},adapter:async()=>{},records:store(),setTimer:t.set,clearTimer:t.clear});
  assert.deepEqual(await p.start(),{ok:false,webhook:true});
  assert.equal(urls.length,1);assert.match(urls[0],/getWebhookInfo/);assert.equal(t.q.length,0);
});

test('primeiro boot descarta backlog e persiste cursor antes de polling',async()=>{
  const t=timers();const s=store();
  const p=createTelegramPoller({token:'x',requestJson:async url=>{if(url.includes('getWebhookInfo'))return {ok:true,result:{url:''}};return {ok:true,result:[{update_id:41,message:{message_id:1,chat:{id:1}}}]};},adapter:async()=>{},records:s,setTimer:t.set,clearTimer:t.clear});
  assert.equal((await p.start()).ok,true);
  assert.equal(s.value().update_id,41);assert.equal(t.q.length,1);assert.equal(t.q[0].delay,0);
});

test('processa update uma vez e avanca cursor antes do adapter',async()=>{
  const t=timers();const s=store({update_id:10});const seen=[];
  const requestJson=async url=>url.includes('getWebhookInfo')?{ok:true,result:{url:''}}:{ok:true,result:[{update_id:11,message:{message_id:7,chat:{id:2}}},{update_id:11,message:{message_id:7,chat:{id:2}}}]};
  const p=createTelegramPoller({token:'x',requestJson,adapter:async msg=>{seen.push([msg.message_id,s.value().update_id]);},records:s,setTimer:t.set,clearTimer:t.clear,baseDelayMs:5});
  await p.start();await t.q.shift().fn();
  assert.deepEqual(seen,[[7,11]]);assert.equal(s.value().update_id,11);
});

test('409 usa backoff e nao derruba poller',async()=>{
  const t=timers();const s=store({update_id:3});let n=0;
  const p=createTelegramPoller({token:'x',requestJson:async url=>{if(url.includes('getWebhookInfo'))return {ok:true,result:{url:''}};n++;const e=new Error('HTTP 409 Conflict');e.status=409;throw e;},adapter:async()=>{},records:s,setTimer:t.set,clearTimer:t.clear,baseDelayMs:100,maxDelayMs:1000,logger:{warn(){}}});
  await p.start();await t.q.shift().fn();
  assert.equal(n,1);assert.equal(t.q.length,1);assert.ok(t.q[0].delay>=200);
});

test('start e idempotente e stop cancela timer',async()=>{
  const t=timers();const s=store({update_id:2});
  const p=createTelegramPoller({token:'x',requestJson:async()=>({ok:true,result:{url:''}}),adapter:async()=>{},records:s,setTimer:t.set,clearTimer:t.clear});
  assert.equal((await p.start()).ok,true);assert.deepEqual(await p.start(),{ok:true,already_running:true});
  const pending=t.q[0];p.stop();assert.equal(pending.cancelled,true);assert.equal(p.state().running,false);
});
