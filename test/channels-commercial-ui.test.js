'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('canais comerciais mostram WhatsApp e Telegram sem abrir em token',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../office-ui.js'),'utf8');
  assert.match(js,/Canais/);
  assert.match(js,/📱<\/span> WhatsApp/);
  assert.match(js,/✈️<\/span> Telegram/);
  assert.match(js,/WhatsApp do escritório/);
  assert.match(js,/Canal privado do titular/);
  assert.match(js,/\/responder NUMERO TEXTO EXATO/);
  assert.match(js,/Ajustes avançados do Telegram/);
  assert.match(js,/<details class="lex-canal-advanced/);
  assert.doesNotMatch(js,/> Telegram Bot</);
});

test('camada comercial preserva interface anterior em arquivos base',()=>{
  assert.ok(fs.existsSync(path.join(__dirname,'../office-ui-base.js')));
  assert.ok(fs.existsSync(path.join(__dirname,'../office-ui-base.css')));
  const css=fs.readFileSync(path.join(__dirname,'../office-ui.css'),'utf8');
  assert.match(css,/office-ui-base\.css/);
  assert.match(css,/lex-canal-hero/);
  assert.match(css,/@media\(max-width:700px\)/);
});
