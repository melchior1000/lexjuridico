'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {pairing}=require('../lib/whatsapp-pairing');const {setup}=require('./runtime');
const config={url:'https://evo.invalid/prefix',key:'test-key',instance:'LEX-JURIDICO',webhookSecret:'test-webhook',publicUrl:'https://lex.invalid'};
test('pareamento configura webhook autenticado e só devolve QR',async()=>{
  const calls=[];const result=await pairing(config,async(url,opts)=>{calls.push({url,...opts});return {base64:'data:image/png;base64,YQ==',apikey:'secret-not-returned'};});
  assert.equal(calls[0].url,'https://evo.invalid/prefix/webhook/set/LEX-JURIDICO');
  assert.equal(calls[0].data.webhook.url,'https://lex.invalid/api/webhook-whatsapp');
  assert.equal(calls[0].data.webhook.headers['x-webhook-secret'],'test-webhook');
  assert.deepEqual(calls[0].data.webhook.events,['MESSAGES_UPSERT']);
  assert.equal(result.qr,'data:image/png;base64,YQ==');assert.ok(!JSON.stringify(result).includes('secret-not-returned'));
});
test('pareamento não acessa rede sem segredo nem aceita URL de imagem remota',async()=>{
  await assert.rejects(pairing({...config,webhookSecret:''},()=>{throw Error('Rede não deve ser chamada');}),/WHATSAPP_WEBHOOK_SECRET/);
  const result=await pairing(config,async()=>({base64:'https://external.invalid/image'}));assert.equal(result.qr,null);
});
test('pareamento exige admin antes de acessar Evolution',async()=>{
  const app=setup();
  assert.equal((await app.request('/api/whatsapp/parear',null,{},'POST')).status,401);
  assert.equal((await app.request('/api/whatsapp/parear',app.token('secretaria'),{},'POST')).status,403);
});
test('rota de pareamento passa apenas configuração do servidor e não guarda QR em cache',async()=>{
  let cfg;const app=setup({EVO_URL:config.url,EVO_KEY:config.key,EVO_INST:config.instance,WHATSAPP_WEBHOOK_SECRET:config.webhookSecret,
    _configRuntime:{whatsapp:{}},process:{env:{RENDER_EXTERNAL_URL:config.publicUrl}},require:()=>({pairing:async c=>{cfg=c;return {ok:true,qr:'data:image/png;base64,YQ=='};}})});
  const r=await app.request('/api/whatsapp/parear',app.token('admin'),{url:'https://attacker.invalid'},'POST');
  assert.equal(r.status,200);assert.equal(cfg.url,config.url);assert.equal(r.headers['Cache-Control'],'no-store');
});
test('interface mostra QR somente como imagem e expira sem gravar no navegador',async()=>{
  const fs=require('node:fs'),vm=require('node:vm');const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
  const nodes=[];const box={textContent:'',appendChild(n){nodes.push(n);n.parentNode=this;}};let expire;
  const ctx=vm.createContext({SERVIDOR:'https://lex.invalid',getAuthToken:()=> 'test',setTimeout:fn=>{expire=fn;},
    document:{getElementById:()=>box,createElement:()=>({style:{}})},fetchComTimeout:async()=>({ok:true,json:async()=>({qr:'data:image/png;base64,YQ=='})})});
  vm.runInContext(html.slice(html.indexOf('async function parearWhatsapp('),html.indexOf('async function salvarPjeAvancado(')),ctx);
  await ctx.parearWhatsapp();assert.equal(nodes.length,2);assert.equal(nodes[1].src,'data:image/png;base64,YQ==');
  expire();assert.match(box.textContent,/expirado/);
});
