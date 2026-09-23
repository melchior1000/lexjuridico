'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('envio da Recepção espera a janela real do backend sem reenviar POST',()=>{
  const base=fs.readFileSync('office-ui-base.js','utf8');
  const ui=fs.readFileSync('office-ui-v2.js','utf8');
  assert.match(base,/const timeoutMs=Number\(options\.timeoutMs\)\|\|30000/);
  assert.match(base,/delete requestOptions\.timeoutMs/);
  assert.match(base,/Não repita o envio até conferir se a mensagem chegou/);
  assert.match(ui,/\/api\/escritorio\/recepcao\/responder[\s\S]{0,180}timeoutMs:180000/);
  assert.doesNotMatch(ui,/recepcao\/responder[\s\S]{0,220}(?:retry|tentativa|repetir)/i);
});
