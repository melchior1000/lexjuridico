'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('interface comercial possui voz, tarefas, rotas seguras e tema sincronizado',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../office-ui-v2.js'),'utf8');
  assert.match(js,/lexStartVoice/);
  assert.match(js,/SpeechRecognition|webkitSpeechRecognition/);
  assert.match(js,/lexTarefas/);
  assert.match(js,/\/api\/trabalho/);
  assert.match(js,/goLex\('agenda'\)/);
  assert.match(js,/goLex\('autuacao'\)/);
  assert.match(js,/goLex\('estatisticas'\)/);
  assert.match(js,/goLex\('escritorio'\)/);
  assert.match(js,/lex_commercial_theme/);
  assert.match(js,/lex_tema/);
  assert.match(js,/window\.varreduraInicial/);
});

test('check de sintaxe inclui os arquivos da casca comercial',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../scripts/check-syntax.js'),'utf8');
  for(const name of ['office-ui-base.js','office-ui-device.js','office-ui-v2.js']) assert.match(js,new RegExp(name.replace(/\./g,'\\.')));
});
