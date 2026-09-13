'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createReceptionTurnBuffer,combineBodies,isTextOnly}=require('../lib/reception-turn-buffer');

function body(id,text){return {instance:'LEX-JURIDICO',data:{key:{id,fromMe:false,remoteJid:'5561988888888@s.whatsapp.net'},pushName:'Maria',message:{conversation:text}}};}

test('combina textos rápidos do mesmo turno sem perder conteúdo',()=>{
  const c=combineBodies([body('1','Oi'),body('2','Quem é você?')]);
  assert.equal(c.data.message.conversation,'Oi | Quem é você?');
});

test('texto puro entra no buffer; mídia não entra',()=>{
  assert.equal(isTextOnly(body('1','Oi').data),true);
  const media=body('2','');media.data.message={audioMessage:{base64:'YQ=='}};
  assert.equal(isTextOnly(media.data),false);
});

test('duas mensagens rápidas geram um único dispatch',async()=>{
  const sent=[];let callback;
  const buffer=createReceptionTurnBuffer({dispatch:async b=>{sent.push(b);return true;},delayMs:10,setTimer:fn=>{callback=fn;return 1;},clearTimer:()=>{}});
  await buffer.enqueue(body('1','Oi'),'LEX-JURIDICO');
  await buffer.enqueue(body('2','Quem é você?'),'LEX-JURIDICO');
  assert.equal(sent.length,0);
  await callback();
  await new Promise(r=>setImmediate(r));
  assert.equal(sent.length,1);
  assert.equal(sent[0].data.message.conversation,'Oi | Quem é você?');
});
