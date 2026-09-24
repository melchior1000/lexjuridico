'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTelegramPoller}=require('../lib/telegram-poller');
function store(initial=null){let value=initial;return {async read(){return value?{value}:null;},async change(_key,fn){const next=await fn(value?structuredClone(value):null);if(next!==undefined)value=next;return value;},value:()=>value};}
function timers(){const q=[];return {set(fn,delay){const t={fn,delay,cancelled:false};q.push(t);return t;},clear(t){if(t)t.cancelled=true;},q};}
function deferred(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};}

test('sem token fica desabilitado e nao chama Telegram',async()=>{let calls=0;const t=timers();const p=createTelegramPoller({token:'',requestJson:async()=>{calls++;},adapter:async()=>{},records:store(),setTimer:t.set,clearTimer:t.clear});assert.deepEqual(await p.start(),{ok:false,disabled:true,reason:'token_ausente'});assert.equal(calls,0);assert.equal(t.q.length,0);});
test('webhook ativo impede getUpdates',async()=>{const urls=[];const t=timers();const p=createTelegramPoller({token:'x',requestJson:async url=>{urls.push(url);return {ok:true,result:{url:'https://example.test/hook'}};},adapter:async()=>{},records:store(),setTimer:t.set,clearTimer:t.clear});assert.deepEqual(await p.start(),{ok:false,webhook:true});assert.equal(urls.length,1);assert.match(urls[0],/getWebhookInfo/);assert.equal(t.q.length,0);});
test('primeiro boot descarta backlog e persiste cursor antes de polling',async()=>{const t=timers();const s=store();const p=createTelegramPoller({token:'x',requestJson:async url=>url.includes('getWebhookInfo')?{ok:true,result:{url:''}}:{ok:true,result:[{update_id:41,message:{message_id:1,chat:{id:1}}}]},adapter:async()=>{},records:s,setTimer:t.set,clearTimer:t.clear});assert.equal((await p.start()).ok,true);assert.equal(s.value().update_id,41);assert.equal(t.q.length,1);assert.equal(t.q[0].delay,0);});
test('processa update uma vez e avanca cursor antes do adapter',async()=>{const t=timers();const s=store({update_id:10});const seen=[];const requestJson=async url=>url.includes('getWebhookInfo')?{ok:true,result:{url:''}}:{ok:true,result:[{update_id:11,message:{message_id:7,chat:{id:2}}},{update_id:11,message:{message_id:7,chat:{id:2}}}]};const p=createTelegramPoller({token:'x',requestJson,adapter:async msg=>seen.push([msg.message_id,s.value().update_id]),records:s,setTimer:t.set,clearTimer:t.clear,baseDelayMs:5});await p.start();await t.q.shift().fn();assert.deepEqual(seen,[[7,11]]);assert.equal(s.value().update_id,11);});
test('falha de adapter nao bloqueia update seguinte',async()=>{const t=timers();const s=store({update_id:10});const seen=[];const requestJson=async url=>url.includes('getWebhookInfo')?{ok:true,result:{url:''}}:{ok:true,result:[{update_id:11,message:{message_id:1}},{update_id:12,message:{message_id:2}}]};const p=createTelegramPoller({token:'x',requestJson,adapter:async msg=>{seen.push(msg.message_id);if(msg.message_id===1)throw new Error('boom');},records:s,setTimer:t.set,clearTimer:t.clear,logger:{warn(){}},baseDelayMs:5});await p.start();await t.q.shift().fn();assert.deepEqual(seen,[1,2]);assert.equal(s.value().update_id,12);});
test('409 usa backoff e continua tentando',async()=>{const t=timers();const s=store({update_id:3});let n=0;const p=createTelegramPoller({token:'x',requestJson:async url=>{if(url.includes('getWebhookInfo'))return {ok:true,result:{url:''}};n++;const e=new Error('HTTP 409 Conflict');e.status=409;throw e;},adapter:async()=>{},records:s,setTimer:t.set,clearTimer:t.clear,baseDelayMs:100,maxDelayMs:1000,logger:{warn(){}}});await p.start();await t.q.shift().fn();assert.equal(n,1);assert.equal(t.q.length,1);assert.ok(t.q[0].delay>=200);assert.equal(p.state().running,true);});
test('401 403 e 404 sao terminais e nao agendam loop infinito',async()=>{for(const status of [401,403,404]){const t=timers();const s=store({update_id:3});const p=createTelegramPoller({token:'x',requestJson:async url=>{if(url.includes('getWebhookInfo'))return {ok:true,result:{url:''}};const e=new Error('HTTP '+status);e.status=status;throw e;},adapter:async()=>{},records:s,setTimer:t.set,clearTimer:t.clear,logger:{warn(){}}});await p.start();await t.q.shift().fn();assert.equal(p.state().running,false);assert.equal(t.q.length,0);}});
test('cursor e carregado uma unica vez mesmo se webhook falha no start',async()=>{const t=timers();let reads=0;const s=store({update_id:8});const originalRead=s.read;s.read=async()=>{reads++;return originalRead();};let webhookCalls=0;const p=createTelegramPoller({token:'x',requestJson:async url=>{if(url.includes('getWebhookInfo')&&webhookCalls++===0)throw new Error('rede');if(url.includes('getWebhookInfo'))return {ok:true,result:{url:''}};return {ok:true,result:[]};},adapter:async()=>{},records:s,setTimer:t.set,clearTimer:t.clear,logger:{warn(){}},baseDelayMs:1});assert.equal((await p.start()).retrying,true);await t.q.shift().fn();assert.equal(reads,1);assert.equal(p.state().cursorLoaded,true);});
test('stop invalida tick em voo e espera drenagem sem chamar adapter',async()=>{const t=timers();const s=store({update_id:2});const gate=deferred();let adapterCalls=0,webhookCalls=0;const p=createTelegramPoller({token:'x',requestJson:async url=>{if(url.includes('getWebhookInfo')){webhookCalls++;if(webhookCalls===1)return {ok:true,result:{url:''}};return gate.promise;}return {ok:true,result:[{update_id:3,message:{message_id:1}}]};},adapter:async()=>{adapterCalls++;},records:s,setTimer:t.set,clearTimer:t.clear});await p.start();const tickPromise=t.q.shift().fn();while(!p.state().inFlight)await Promise.resolve();const stopPromise=p.stop();gate.resolve({ok:true,result:{url:''}});await stopPromise;await tickPromise;assert.equal(adapterCalls,0);assert.equal(p.state().running,false);assert.equal(p.state().inFlight,false);});
test('start e idempotente e stop cancela timer',async()=>{const t=timers();const s=store({update_id:2});const p=createTelegramPoller({token:'x',requestJson:async()=>({ok:true,result:{url:''}}),adapter:async()=>{},records:s,setTimer:t.set,clearTimer:t.clear});assert.equal((await p.start()).ok,true);assert.deepEqual(await p.start(),{ok:true,already_running:true});const pending=t.q[0];await p.stop();assert.equal(pending.cancelled,true);assert.equal(p.state().running,false);});


test('takeover explicito remove webhook, confirma e inicia polling',async()=>{
  const t=timers();const s=store({update_id:5});const calls=[];let active=true;
  const p=createTelegramPoller({token:'x',takeoverWebhook:true,requestJson:async url=>{
    calls.push(url);
    if(url.includes('getWebhookInfo'))return {ok:true,result:{url:active?'https://old.example/hook':''}};
    if(url.includes('deleteWebhook')){active=false;return {ok:true,result:true};}
    return {ok:true,result:[]};
  },adapter:async()=>{},records:s,setTimer:t.set,clearTimer:t.clear,logger:{warn(){}}});
  assert.equal((await p.start()).ok,true);assert.equal(active,false);
  assert.equal(calls.filter(x=>x.includes('deleteWebhook')).length,1);
  assert.equal(calls.filter(x=>x.includes('getWebhookInfo')).length,2);
  assert.equal(t.q.length,1);
});

test('409 por mais de 5 minutos explica a causa uma vez só, com a solução',async()=>{
  const t=timers();const s=store({update_id:3});const erros=[],avisos=[];let agora=1_000_000;const real=Date.now;Date.now=()=>agora;
  try{
    const p=createTelegramPoller({token:'x',requestJson:async url=>{if(url.includes('getWebhookInfo'))return {ok:true,result:{url:''}};const e=new Error('HTTP 409 Conflict');e.status=409;throw e;},
      adapter:async()=>{},records:s,setTimer:t.set,clearTimer:t.clear,baseDelayMs:100,maxDelayMs:1000,logger:{warn:m=>avisos.push(m),error:m=>erros.push(m)}});
    await p.start();
    await t.q.shift().fn();                     // primeiro 409: aviso normal
    agora+=6*60*1000;await t.q.shift().fn();    // passou de 5 min: explica
    agora+=60*1000;await t.q.shift().fn();      // não repete
    assert.equal(erros.length,1);
    assert.match(erros[0],/outro programa está lendo este mesmo bot[\s\S]*TELEGRAM_TOKEN/);
    assert.equal(p.state().running,true,'continua tentando');
  }finally{Date.now=real}
});
