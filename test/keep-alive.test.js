'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createKeepAlive}=require('../lib/keep-alive');

test('visita /health do próprio endereço a cada 10 min, 24 h',async()=>{
  const urls=[];let agendado=null;
  const k=createKeepAlive({url:'https://lex-juridico.onrender.com/',fetchImpl:async u=>{urls.push(u);return{ok:true}},setTimer:(fn,ms)=>{agendado={fn,ms};return{}},clearTimer:()=>{}});
  assert.equal(k.start(),true);assert.equal(agendado.ms,10*60*1000);
  await agendado.fn();await new Promise(r=>setImmediate(r));
  assert.deepEqual(urls,['https://lex-juridico.onrender.com/health']);
  assert.equal(k.start(),false,'não duplica');
});

test('sem endereço não liga; 3 falhas seguidas avisam uma vez',async()=>{
  assert.equal(createKeepAlive({url:''}).start(),false);
  const logs=[];const k=createKeepAlive({url:'https://x.onrender.com',fetchImpl:async()=>({ok:false,status:502}),log:m=>logs.push(m)});
  for(let i=0;i<4;i++)await k.ping();
  assert.equal(logs.length,1);assert.match(logs[0],/3 visitas seguidas falharam \(HTTP 502\)/);
});

test('servidor liga o keep-alive com RENDER_EXTERNAL_URL e a rotina do GitHub cobre a madrugada',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const bot=fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8');
  assert.match(bot,/createKeepAlive\(\{url:process\.env\.LEX_KEEPALIVE_URL\|\|process\.env\.RENDER_EXTERNAL_URL/);
  assert.match(bot,/global\._lexKeepAlive\?\.stop\?\.\(\);/);
  const wf=fs.readFileSync(path.join(__dirname,'..','.github','workflows','manter-servidor-acordado.yml'),'utf8');
  assert.match(wf,/cron: '\*\/10 \* \* \* \*'/);
});
