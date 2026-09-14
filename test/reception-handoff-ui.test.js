'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ui=fs.readFileSync('reception-handoff-ui.js','utf8');
const loader=fs.readFileSync('office-ui.js','utf8');

test('Recepção oferece encaminhamento real ao Cadastro',()=>{
  assert.match(ui,/Encaminhar ao Cadastro/);
  assert.match(ui,/\/api\/escritorio\/preparacao/);
  assert.match(ui,/\/api\/escritorio\/recepcao\/arquivar/);
  assert.match(ui,/faltando:''/);
  assert.doesNotMatch(ui,/faltando:'Conferir documentos do cadastro'/);
});

test('handoff usa id determinístico para retry não duplicar o mesmo atendimento',()=>{
  assert.match(ui,/function deterministicId\(item\)/);
  assert.match(ui,/recepcao-/);
  assert.match(ui,/item\?\.criado_em/);
});

test('Recepção explica o novo fluxo e toast não depende de identificador global solto',()=>{
  assert.match(ui,/Encaminhe ao Cadastro quando a demanda virar caso/);
  assert.match(ui,/typeof window\.toast==='function'/);
  assert.doesNotMatch(ui,/(?<!window\.)toast\?\./);
});

test('arquivo de handoff é carregado pela casca',()=>{
  assert.match(loader,/reception-handoff-ui\.js/);
});