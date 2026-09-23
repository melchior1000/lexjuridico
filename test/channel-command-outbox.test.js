'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createChannelCommandOutbox,PREFIX}=require('../lib/channel-command-outbox');

function records(){
  const map=new Map();
  return{
    async read(key){return map.has(key)?{value:structuredClone(map.get(key)),stamp:new Date().toISOString()}:null},
    async change(key,fn){
      const old=map.has(key)?structuredClone(map.get(key)):null;
      const next=await fn(old);
      if(next!==undefined)map.set(key,structuredClone(next));
      return next===undefined?old:structuredClone(next);
    },
    async list(prefix){return[...map.entries()].filter(([k])=>k.startsWith(prefix)).map(([,v])=>structuredClone(v))},
    map
  };
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('ordem vira previa e não envia antes da confirmação humana',async()=>{
  const rec=records(),deliveries=[],events=[];
  const out=createChannelCommandOutbox({
    records:rec,
    compose:async job=>'Olá, falo com você amanhã.',
    deliverDetailed:async input=>{deliveries.push(input);return{ok:true,state:'confirmado',provider_id:'msg-1'}},
    receptionStore:{appendEvent:async e=>{events.push(e);return e}},
    log:()=>{}
  });
  const job=await out.enqueue({origem:'whatsapp',id:'5561999999999',nome:'Cliente',comando:'Diga a ele que falo amanhã',historico:[]});
  assert.equal(job.status,'pendente');
  await flush();
  let saved=await out.read(job.id);
  assert.equal(saved.status,'aguardando_confirmacao');
  assert.equal(saved.texto_final,'Olá, falo com você amanhã.');
  assert.equal(deliveries.length,0);

  await out.confirm(job.id,{texto:'Olá. Falo com você amanhã.'});
  await flush();
  saved=await out.read(job.id);
  assert.equal(saved.status,'enviado');
  assert.equal(saved.provider_id,'msg-1');
  assert.deepEqual(deliveries,[{origem:'whatsapp',id:'5561999999999',texto:'Olá. Falo com você amanhã.'}]);
  assert.equal(events.length,1);
  assert.equal(events[0].direcao,'saida_operador');
});

test('erro real do provedor fica persistido no job',async()=>{
  const rec=records();
  const out=createChannelCommandOutbox({
    records:rec,
    compose:async()=> 'Mensagem pronta',
    deliverDetailed:async()=>({ok:false,state:'aguardando_pareamento',error:'Evolution indisponível: aguardando_pareamento.'}),
    receptionStore:{appendEvent:async()=>{}},
    log:()=>{}
  });
  const job=await out.enqueue({origem:'whatsapp',id:'5561988888888',comando:'Responda'});
  await flush();
  await out.confirm(job.id);
  await flush();
  const saved=await out.read(job.id);
  assert.equal(saved.status,'falhou');
  assert.equal(saved.provider_state,'aguardando_pareamento');
  assert.match(saved.last_error,/aguardando_pareamento/);
});

test('reinício no meio do POST não reenvia automaticamente resultado ambíguo',async()=>{
  const rec=records();
  const out=createChannelCommandOutbox({
    records:rec,compose:async()=> 'x',deliverDetailed:async()=>({ok:true}),receptionStore:{appendEvent:async()=>{}},log:()=>{},staleMs:1
  });
  const id='ambiguous';
  await rec.change(PREFIX+id,()=>({id,origem:'whatsapp',contato_id:'5561999999999',status:'enviando',atualizado_em:'2020-01-01T00:00:00.000Z'}));
  await out.recover();
  const saved=await out.read(id);
  assert.equal(saved.status,'falhou');
  assert.match(saved.last_error,/resultado pode ser indeterminado/);
});

test('cancelamento antes do envio impede entrega',async()=>{
  const rec=records(),deliveries=[];
  const out=createChannelCommandOutbox({
    records:rec,compose:async()=> 'Mensagem pronta',deliverDetailed:async x=>{deliveries.push(x);return{ok:true}},receptionStore:{appendEvent:async()=>{}},log:()=>{}
  });
  const job=await out.enqueue({origem:'telegram',id:'12345',comando:'Diga oi'});
  await flush();
  await out.cancel(job.id);
  await flush();
  const saved=await out.read(job.id);
  assert.equal(saved.status,'cancelado');
  assert.equal(deliveries.length,0);
});
