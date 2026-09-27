'use strict';
// Render gratuito dorme após ~15 min sem visita; a rotina do GitHub "a cada 5 min" rodou,
// na prática, a cada 2–5 h (27/09/2026: 07:06, 12:56, 17:21 UTC). O LEX dormia e perdia
// mensagem do WhatsApp. Trava: o próprio LEX visita o endereço PÚBLICO a cada 10 min.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createKeepAwake,INTERVALO_PADRAO}=require('../lib/keep-awake');

test('visita o /health do endereço público e confirma',async()=>{
  const chamadas=[];
  const k=createKeepAwake({url:'https://lex-juridico.onrender.com/',fetchImpl:async(u,o)=>{chamadas.push({u,o});return{ok:true,status:200}}});
  assert.equal(k.ativo,true);
  assert.equal(await k.tick(),true);
  assert.equal(chamadas[0].u,'https://lex-juridico.onrender.com/health');
  assert.ok(chamadas[0].o.signal,'visita com tempo limite');
});

test('intervalo fica abaixo dos 15 min do Render',()=>{
  assert.ok(INTERVALO_PADRAO<15*60*1000);
  assert.ok(INTERVALO_PADRAO>=5*60*1000,'sem exagero de visitas');
});

test('fora do Render (sem endereço público) ou desligado por variável não faz nada',async()=>{
  let n=0;const f=async()=>{n++;return{ok:true}};
  const semUrl=createKeepAwake({url:'',fetchImpl:f});
  assert.equal(semUrl.ativo,false);
  semUrl.start();assert.equal(await semUrl.tick(),false);
  const desligado=createKeepAwake({url:'https://x.onrender.com',desligado:true,fetchImpl:f});
  assert.equal(desligado.ativo,false);
  assert.equal(n,0);
});

test('falha de rede não derruba o LEX: devolve false e registra',async()=>{
  const logs=[];
  const k=createKeepAwake({url:'https://x.onrender.com',fetchImpl:async()=>{throw new Error('rede fora')},log:m=>logs.push(m)});
  assert.equal(await k.tick(),false);
  assert.match(logs[0],/rede fora/);
  const k2=createKeepAwake({url:'https://x.onrender.com',fetchImpl:async()=>({ok:false,status:502}),log:m=>logs.push(m)});
  assert.equal(await k2.tick(),false);
  assert.match(logs[1],/502/);
});

test('start agenda uma vez e não segura o processo; stop cancela',()=>{
  const timers=[];let parado=null;
  const k=createKeepAwake({url:'https://x.onrender.com',fetchImpl:async()=>({ok:true}),
    setIntervalImpl:(fn,ms)=>{const t={fn,ms,unref(){this.unrefed=true}};timers.push(t);return t},clearIntervalImpl:t=>{parado=t}});
  k.start();k.start();
  assert.equal(timers.length,1);
  assert.equal(timers[0].ms,INTERVALO_PADRAO);
  assert.equal(timers[0].unrefed,true);
  k.stop();assert.equal(parado,timers[0]);
});

test('bot.js liga a visita no boot com o endereço público do Render',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8');
  assert.match(src,/createKeepAwake\(\{url:process\.env\.LEX_SERVIDOR_URL\|\|process\.env\.RENDER_EXTERNAL_URL,desligado:process\.env\.LEX_MANTER_ACORDADO==='0'/);
  assert.match(src,/keepAwake\.start\(\)/);
});
