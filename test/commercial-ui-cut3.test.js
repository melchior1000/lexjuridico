'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const js=fs.readFileSync(path.join(__dirname,'../office-ui-v2.js'),'utf8');
const check=fs.readFileSync(path.join(__dirname,'../scripts/check-syntax.js'),'utf8');

test('microfone do chat tem handler real com fallback',()=>{
  assert.match(js,/onclick=\"lexStartVoice\(\)\"/);
  assert.match(js,/SpeechRecognition\|\|window\.webkitSpeechRecognition/);
  assert.match(js,/microfone do teclado/);
});

test('KPI trabalho abre fila de tarefas e nao volta para home',()=>{
  assert.match(js,/onclick=\"lexTarefas\(\)\"/);
  assert.match(js,/window\.renderTrabalho=window\.lexTarefas/);
  assert.match(js,/page==='trabalho'\)\{window\.lexTarefas\(\);return\}/);
});

test('tema legado e comercial usam o mesmo alternador',()=>{
  assert.match(js,/window\.alternarTema=window\.lexToggleTheme/);
  assert.match(js,/localStorage\.setItem\('lex_commercial_theme'/);
  assert.match(js,/localStorage\.setItem\('lex_tema'/);
  assert.match(js,/lex-commercial-login-theme/);
});

test('varredura antiga e neutralizada no runtime comercial',()=>{
  assert.match(js,/window\.varreduraInicial=function\(\)/);
  assert.match(js,/varredura-overlay/);
});

test('CI verifica tambem os arquivos da casca comercial',()=>{
  for(const name of ['office-ui-base.js','office-ui-device.js','office-ui-v2.js']) assert.match(check,new RegExp(name.replace(/\./g,'\\.')));
});

test('Mais usa wrappers e mantem tarefas e escritorio vivos',()=>{
  assert.match(js,/window\.lexLegacy=function/);
  assert.match(js,/Clientes \/ Contatos/);
  assert.match(js,/lexTarefas\(\)/);
  assert.match(js,/lexEscritorio\(\)/);
});
