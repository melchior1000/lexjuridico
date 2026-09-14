'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const ui=fs.readFileSync('office-attachment-ui.js','utf8');
const loader=fs.readFileSync('office-ui.js','utf8');

test('chat central anexa documento somente com processo selecionado',()=>{
  assert.match(ui,/lex-chat-process/);
  assert.match(ui,/Selecione o processo antes de anexar/);
  assert.match(ui,/\/api\/entrada-processual/);
  assert.match(ui,/processo_id/);
  assert.match(ui,/origem:'lex_chat'/);
});

test('anexo não promete análise: reporta estado confirmado pelo intake',()=>{
  for(const status of ['novo_andamento','provavel_duplicado','provavel_antigo','precisa_conferencia']) assert.match(ui,new RegExp(status));
  assert.match(ui,/25\*1024\*1024/);
});

test('casca comercial carrega o adaptador de anexos',()=>{
  assert.match(loader,/office-attachment-ui\.js/);
});
