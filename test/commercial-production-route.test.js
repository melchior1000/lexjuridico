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

test('ordem jurídica continua criando tarefa no motor oficial',()=>{
  const src=fs.readFileSync('office-command-ui.js','utf8');
  assert.match(src,/command\.action==='task'/);
  assert.match(src,/lexApi\('\/api\/tarefas'/);
  assert.match(src,/processo_id/);
});
