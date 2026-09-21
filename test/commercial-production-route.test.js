'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('atalhos comerciais de peça e perícia não reabrem geradores legados',()=>{
  const src=fs.readFileSync('office-command-ui.js','utf8');
  assert.match(src,/page==='peticao'.*openCommercialProduction\('peticao'\)/s);
  assert.match(src,/page==='pericia'.*openCommercialProduction\('pericia'\)/s);
  assert.match(src,/window\.lexChat\(\)/);
  assert.match(src,/window\.lexPrefill/);
});

test('ordem jurídica sai da Web e cria tarefa apenas no Core oficial',()=>{
  const src=fs.readFileSync('office-command-ui.js','utf8');
  const chat=fs.readFileSync('office-ui-v2.js','utf8');
  const routes=fs.readFileSync('lib/office-routes.js','utf8');
  assert.doesNotMatch(src,/\/api\/tarefas/);
  assert.match(chat,/\/api\/vivo\/conversar/);
  assert.match(routes,/parseOfficeCommand/);
  assert.match(routes,/deps\.engine\.submit/);
  assert.match(routes,/runTaskThroughOffice/);
});
