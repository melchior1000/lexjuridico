'use strict';
// Licença e cobrança (Mercado Pago): revisão adversarial — assinatura falsa, evento repetido,
// fora de ordem, sem tenant, tenant A nunca altera B, gate desligado por padrão, dados nunca apagados.
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Policy=require('../lib/license-policy');
const MP=require('../lib/billing-mercadopago');
const {createBillingRoutes}=require('../lib/billing-routes');

function records(){
  const map=new Map();
  return{map,async read(k){return map.has(k)?{value:structuredClone(map.get(k))}:null},async change(k,fn){const next=await fn(map.has(k)?structuredClone(map.get(k)):null);if(next!==undefined)map.set(k,next);return next},async list(prefix){return [...map.entries()].filter(([k])=>k.startsWith(prefix)).map(([,v])=>v)}};
}
const SECRET='segredo-webhook-teste';
function sign({dataId,requestId,ts}){const id=/^[a-z0-9]+$/i.test(dataId)&&/[a-z]/i.test(dataId)?dataId.toLowerCase():dataId;return 'ts='+ts+',v1='+crypto.createHmac('sha256',SECRET).update('id:'+id+';request-id:'+requestId+';ts:'+ts+';').digest('hex')}
const NOW=new Date('2026-09-26T12:00:00Z');
function api(resources){return async(url)=>{const id=url.split('/').pop();const r=resources[id];return{ok:!!r,status:r?200:404,text:async()=>JSON.stringify(r||{message:'not found'})}}}
function mk(resources,env={}){
  const rec=records();
  const billing=MP.createMercadoPagoBilling({records:rec,env:{MERCADOPAGO_ACCESS_TOKEN:'tok',MERCADOPAGO_WEBHOOK_SECRET:SECRET,...env},fetchImpl:api(resources),now:()=>NOW});
  const hook=(type,dataId,requestId='req-1',ts=Math.floor(NOW.getTime()/1000))=>billing.webhook({headers:{'x-signature':sign({dataId,requestId,ts}),'x-request-id':requestId},body:{type,action:type+'.updated',data:{id:dataId}}});
  return{rec,billing,hook};
}

test('política: trial → past_due ao vencer; tolerância; IA bloqueia antes da escrita; suspensa só lê e exporta; nada é apagado',()=>{
  const lic=Policy.newTrial('A',new Date('2026-09-01T00:00:00Z'));
  assert.equal(Policy.decide(lic,'ai',new Date('2026-09-10T00:00:00Z')).allowed,true);
  const late=Policy.effectiveStatus(lic,new Date('2026-09-20T00:00:00Z'));assert.equal(late.status,'past_due');
  const pd=Policy.transition(lic,'past_due','trial venceu',new Date('2026-09-15T00:00:00Z'));
  assert.equal(Policy.decide(pd,'ai',new Date('2026-09-20T00:00:00Z')).allowed,true,'5 dias: tolerância');
  assert.equal(Policy.decide(pd,'ai',new Date('2026-09-25T00:00:00Z')).allowed,false,'10 dias: IA bloqueada');
  assert.equal(Policy.decide(pd,'write',new Date('2026-09-25T00:00:00Z')).allowed,true,'10 dias: escrita segue');
  const susp=Policy.decide(pd,'write',new Date('2026-10-20T00:00:00Z'));assert.equal(susp.status,'suspended');assert.equal(susp.allowed,false);
  for(const a of ['read','export'])assert.equal(Policy.decide(pd,a,new Date('2026-12-01T00:00:00Z')).allowed,true,a+' nunca bloqueia');
  const canc=Policy.transition(pd,'canceled','pediu cancelamento');
  assert.equal(Policy.decide(canc,'export').allowed,true);assert.equal(Policy.decide(canc,'ai').allowed,false);
  assert.ok(canc.historico.length>=3&&canc.historico.at(-1).para==='canceled','histórico auditável');
  assert.throws(()=>Policy.transition(lic,'premium','x'));
});

test('gate desligado por padrão: allows() sempre true, mas informa o que faria',async()=>{
  const rec=records();const pol=Policy.createLicensePolicy({records:rec,env:{},now:()=>NOW});
  await pol.apply('A','suspended','teste');
  const d=await pol.allows('A','ai');assert.equal(d.allowed,true);assert.equal(d.gate,'off');assert.equal(d.would_allow,false);
  const on=Policy.createLicensePolicy({records:rec,env:{LEX_LICENSE_GATE:'1'},now:()=>NOW});
  assert.equal((await on.allows('A','ai')).allowed,false);
});

test('webhook: assinatura inválida, ausente, fora da janela ou segredo não configurado → 401 sem tocar na licença',async()=>{
  const {billing,rec}=mk({'1':{id:1,status:'approved',external_reference:'A'}});
  const bad=await billing.webhook({headers:{'x-signature':'ts=1,v1=deadbeef','x-request-id':'r'},body:{type:'payment',data:{id:'1'}}});
  assert.equal(bad.ok,false);assert.equal(bad.status,401);
  const none=await billing.webhook({headers:{},body:{type:'payment',data:{id:'1'}}});assert.equal(none.status,401);
  const old=await billing.webhook({headers:{'x-signature':sign({dataId:'1',requestId:'r',ts:Math.floor(NOW.getTime()/1000)-3600}),'x-request-id':'r'},body:{type:'payment',data:{id:'1'}}});
  assert.equal(old.status,401);assert.match(old.motivo,/janela/);
  const noSecret=MP.createMercadoPagoBilling({records:rec,env:{MERCADOPAGO_ACCESS_TOKEN:'t'},fetchImpl:api({}),now:()=>NOW});
  assert.equal((await noSecret.webhook({headers:{'x-signature':'ts=1,v1=a'},body:{type:'payment',data:{id:'1'}}})).status,401);
  assert.equal([...rec.map.keys()].filter(k=>k.startsWith('lex_licenca_')).length,0,'nenhuma licença criada');
});

test('webhook válido: busca o recurso na API (não confia no corpo), aplica ao escritório do external_reference, e evento repetido é idempotente',async()=>{
  const {rec,hook}=mk({'10':{id:10,status:'approved',external_reference:'A',date_last_updated:'2026-09-26T11:00:00Z'}});
  const r1=await hook('payment','10');
  assert.equal(r1.aplicado,true);assert.equal(r1.escritorio_id,'A');assert.equal(r1.para,'active');
  assert.equal(rec.map.get('lex_licenca_A').status,'active');
  const r2=await hook('payment','10');
  assert.equal(r2.aplicado,false);assert.match(r2.motivo,/repetido/);
  assert.equal(rec.map.get('lex_licenca_A').historico.length,2,'trial + 1 transição, não 2');
  assert.ok(!rec.map.has('lex_licenca_B'),'B intocado');
});

test('webhook: pagamento de A nunca altera B; cancelamento de A não afeta B; evento sem external_reference é ignorado',async()=>{
  const {rec,hook}=mk({'1':{id:1,status:'approved',external_reference:'A'},'2':{id:2,status:'approved',external_reference:'B'},'3':{id:3,status:'cancelled',external_reference:'A'},'4':{id:4,status:'approved'},'5':{id:'5',status:'cancelled',external_reference:'A'}});
  await hook('payment','1');await hook('payment','2');
  assert.equal(rec.map.get('lex_licenca_A').status,'active');assert.equal(rec.map.get('lex_licenca_B').status,'active');
  const c=await hook('subscription_preapproval','5');
  assert.equal(c.para,'canceled');assert.equal(rec.map.get('lex_licenca_A').status,'canceled');
  assert.equal(rec.map.get('lex_licenca_B').status,'active','B não sente o cancelamento de A');
  const orphan=await hook('payment','4');
  assert.equal(orphan.aplicado,false);assert.match(orphan.motivo,/external_reference/);
  assert.ok(![...rec.map.keys()].some(k=>k==='lex_licenca_'||k==='lex_licenca_undefined'),'nenhum escritório arbitrário criado');
});

test('webhook fora de ordem: recusa antiga não rebaixa aprovação mais nova',async()=>{
  const {rec,hook}=mk({'20':{id:20,status:'approved',external_reference:'A',date_last_updated:'2026-09-26T11:00:00Z'},'21':{id:21,status:'rejected',external_reference:'A',date_last_updated:'2026-09-26T10:00:00Z'}});
  await hook('payment','20');const r=await hook('payment','21');
  assert.equal(r.aplicado,false);assert.match(r.motivo,/mais antigo/);assert.equal(rec.map.get('lex_licenca_A').status,'active');
});

test('assinar cria a assinatura com external_reference = escritório e guarda o vínculo; provedor fora → erro claro, nada gravado',async()=>{
  const calls=[];
  const rec=records();
  const billing=MP.createMercadoPagoBilling({records:rec,env:{MERCADOPAGO_ACCESS_TOKEN:'tok',MERCADOPAGO_WEBHOOK_SECRET:SECRET},now:()=>NOW,
    fetchImpl:async(url,init)=>{calls.push({url,init});return{ok:true,status:201,text:async()=>JSON.stringify({id:'pre_1',status:'pending',init_point:'https://mp.example/pay/pre_1'})}}});
  const out=await billing.assinar({escritorioId:'A',email:'x@y.z',valor:299.9});
  assert.equal(out.link,'https://mp.example/pay/pre_1');
  const sent=JSON.parse(calls[0].init.body);assert.equal(sent.external_reference,'A');assert.equal(sent.auto_recurring.transaction_amount,299.9);assert.equal(sent.auto_recurring.currency_id,'BRL');
  assert.match(calls[0].init.headers.Authorization,/^Bearer tok$/);
  assert.equal(rec.map.get('lex_mp_vinculo_A').preapproval_id,'pre_1');
  await assert.rejects(()=>billing.assinar({escritorioId:'A',valor:0}),/valor/);
  const down=MP.createMercadoPagoBilling({records:records(),env:{MERCADOPAGO_ACCESS_TOKEN:'tok'},now:()=>NOW,fetchImpl:async()=>({ok:false,status:500,text:async()=>'{"message":"boom"}'})});
  await assert.rejects(()=>down.assinar({escritorioId:'A',valor:10}),/HTTP 500/);
  const off=MP.createMercadoPagoBilling({records:records(),env:{},now:()=>NOW});
  await assert.rejects(()=>off.assinar({escritorioId:'A',valor:10}),/não configurado/);
});

test('rotas: webhook é público mas assinado; licença/assinar/reconciliar exigem admin',async()=>{
  const rec=records();
  const routes=createBillingRoutes({records:rec,env:{LEX_ESCRITORIO_ID:'A',MERCADOPAGO_WEBHOOK_SECRET:SECRET,MERCADOPAGO_ACCESS_TOKEN:'tok'},authenticate:r=>r.headers.perfil||null,body:async r=>r.body||{},now:()=>NOW,fetchImpl:api({'7':{id:7,status:'approved',external_reference:'A'}})});
  const res=()=>{const r={};r.writeHead=(s)=>{r.status=s};r.end=b=>{r.body=JSON.parse(b)};return r};
  let r=res();await routes.handle({method:'POST',headers:{},body:{type:'payment',data:{id:'7'}}},r,'/api/webhook-mercadopago');
  assert.equal(r.status,401);
  const ts=Math.floor(NOW.getTime()/1000);
  r=res();await routes.handle({method:'POST',headers:{'x-signature':sign({dataId:'7',requestId:'rq',ts}),'x-request-id':'rq'},body:{type:'payment',data:{id:'7'}}},r,'/api/webhook-mercadopago?data.id=7');
  assert.equal(r.status,200);assert.equal(r.body.aplicado,true);
  r=res();await routes.handle({method:'GET',headers:{}},r,'/api/billing/licenca');assert.equal(r.status,401);
  r=res();await routes.handle({method:'GET',headers:{perfil:'secretaria'}},r,'/api/billing/licenca');assert.equal(r.status,403);
  r=res();await routes.handle({method:'GET',headers:{perfil:'admin'}},r,'/api/billing/licenca');
  assert.equal(r.status,200);assert.equal(r.body.licenca.status,'active');assert.equal(r.body.gate_ativo,false);assert.equal(r.body.permite.ai,true);
});
