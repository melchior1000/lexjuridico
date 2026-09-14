'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {parseOfficeCommand,extractNumber}=require('../lib/office-command');

test('LEX reconhece devolução para Cadastro com motivo',()=>{
  const c=parseOfficeCommand('Volta pro cadastro, falta procuração',{processo_id:7});
  assert.equal(c.action,'move');
  assert.equal(c.target,'cadastro');
  assert.equal(c.processo_id,7);
  assert.match(c.reason,/procura/i);
});

test('LEX reconhece produção jurídica por tipo',()=>{
  assert.equal(parseOfficeCommand('Pode redigir a petição inicial agora',{processo_id:7}).tipo,'peticao');
  assert.equal(parseOfficeCommand('Faça a perícia deste caso',{processo_id:7}).tipo,'pericia');
  assert.equal(parseOfficeCommand('Prepare os quesitos para o perito',{processo_id:7}).tipo,'quesitos');
  assert.equal(parseOfficeCommand('Analise os riscos deste processo',{processo_id:7}).tipo,'analise');
});

test('LEX reconhece cadastro pronto e distribuição com número',()=>{
  assert.equal(parseOfficeCommand('Cadastro pronto, documentos conferidos',{processo_id:2}).action,'confirm_registration');
  const c=parseOfficeCommand('Distribuído protocolo 0000001-00.2026.8.13.0001',{processo_id:2});
  assert.equal(c.action,'distribute');
  assert.equal(c.numero,'0000001-00.2026.8.13.0001');
  assert.equal(extractNumber('protocolo ABC-12345'),'ABC-12345');
});

test('pergunta jurídica comum não vira movimento administrativo',()=>{
  assert.equal(parseOfficeCommand('Explique o princípio da causalidade',{processo_id:2}),null);
});

test('casca comercial carrega parser e executor depois do fluxo',()=>{
  const loader=fs.readFileSync('office-ui.js','utf8');
  const ui=fs.readFileSync('office-command-ui.js','utf8');
  assert.match(loader,/lib\/office-command\.js/);
  assert.match(loader,/office-command-ui\.js/);
  assert.ok(loader.indexOf('office-flow-ui.js')<loader.indexOf('office-command-ui.js'));
  assert.match(ui,/LexOfficeCommand\?\.parseOfficeCommand/);
  assert.match(ui,/\/api\/escritorio\/mover/);
  assert.match(ui,/\/api\/escritorio\/distribuir/);
  assert.match(ui,/\/api\/tarefas/);
});
