'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('painel registra ordem do LEX sem esperar IA + Evolution na mesma requisição',()=>{
  const base=fs.readFileSync('office-ui-base.js','utf8');
  const ui=fs.readFileSync('office-ui-v2.js','utf8');
  assert.match(base,/const timeoutMs=Number\(options\.timeoutMs\)\|\|30000/);
  assert.match(base,/delete requestOptions\.timeoutMs/);
  assert.match(base,/Não repita o envio até conferir se a mensagem chegou/);
  assert.match(ui,/\/api\/escritorio\/recepcao\/comando/);
  assert.match(ui,/Dê uma ordem ao LEX/);
  assert.match(ui,/Confirmar envio/);
  assert.match(ui,/aguardando_confirmacao/);
  assert.doesNotMatch(ui,/\/api\/escritorio\/recepcao\/responder/);
});
