'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ui=fs.readFileSync(path.join(__dirname,'../office-dossier-ui.js'),'utf8');
const loader=fs.readFileSync(path.join(__dirname,'../office-ui.js'),'utf8');
const pkg=require('../package.json');

test('dossiê comercial mostra documentos, origem e estado de conferência',()=>{
  assert.match(ui,/entrada_processual/);
  assert.match(ui,/arquivos/);
  assert.match(ui,/recebimentos/);
  assert.match(ui,/originLabel/);
  assert.match(ui,/Precisa conferência/);
  assert.match(ui,/Provável duplicado/);
});

test('dossiê liga PJe, encaminhamento, produção e anexo ao processo selecionado; nunca Datajud',()=>{
  assert.match(ui,/\/api\/escritorio\/pje\/processos/);
  assert.doesNotMatch(ui,/\/api\/escritorio\/datajud/);
  assert.match(ui,/\/api\/escritorio\/mover/);
  assert.match(ui,/\/api\/tarefas/);
  assert.match(ui,/lexDossierAttach/);
  assert.match(ui,/lex-chat-process/);
});

test('lista de processos abre a pele comercial do dossiê',()=>{
  assert.match(ui,/window\.lexOpenProc=fn/);
  assert.match(loader,/office-dossier-ui\.js/);
  assert.match(loader,/office-dossier-ui\.css/);
});

test('eslint cobre o novo sidecar comercial',()=>{
  assert.match(pkg.scripts.lint,/office-dossier-ui\.js/);
});
