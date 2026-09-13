'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {publicWhatsappDecision}=require('../lib/integration-status');

test('pedido genérico de informação de um processo é reconhecido como processo existente',()=>{
  const d=publicWhatsappDecision('queria a info de um processo');
  assert.equal(d.kind,'existing_case');
  assert.match(d.reply,/seguran[cç]a/i);
  assert.doesNotMatch(d.reply,/Recebi sua mensagem\. Para eu encaminhar/i);
});
