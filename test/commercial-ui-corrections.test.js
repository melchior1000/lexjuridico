'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const js=fs.readFileSync(path.join(__dirname,'../office-ui-v2.js'),'utf8');

test('tema comercial sincroniza com tema legado',()=>{
  assert.match(js,/lex_commercial_theme/);
  assert.match(js,/lex_tema/);
  assert.match(js,/classList\.toggle\('dia'/);
  assert.match(js,/classList\.toggle\('noite'/);
});

test('varredura antiga e desativada no boot comercial',()=>{
  assert.match(js,/function\s+disableLegacySweep\s*\(/);
  assert.match(js,/window\.varreduraInicial\s*=\s*function/);
  assert.match(js,/varredura-overlay/);
  assert.match(js,/setInterval/);
});

test('abas de processos e prazos possuem filtros ativos',()=>{
  assert.match(js,/lexSetProcFilter/);
  assert.match(js,/onclick=\"lexSetProcFilter/);
  assert.match(js,/lexSetPrazoTab/);
  assert.match(js,/onclick=\"lexSetPrazoTab/);
});

test('chat do LEX envia contexto do processo selecionado',()=>{
  assert.match(js,/id=\"lex-chat-process\"/);
  assert.match(js,/processo_id/);
  assert.match(js,/numero_processo/);
  assert.match(js,/payload\.setor/);
  assert.match(js,/\/api\/vivo\/conversar/);
});
