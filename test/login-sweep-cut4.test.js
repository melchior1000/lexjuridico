'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('login possui modo dia comercial que vence estilos inline',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  assert.match(html,/LOGIN CLARO COMERCIAL — CUT 4/);
  assert.match(html,/body\.dia #login-screen\{background:#f4f7fb!important/);
  assert.match(html,/#btn-login\{background:linear-gradient/);
  assert.match(html,/body\.dia #login-screen input,body\.dia #login-screen select/);
});

test('varredura legado não é mais agendada no boot',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  assert.doesNotMatch(html,/setTimeout\(\s*varreduraInicial\s*,\s*2000\s*\)/);
  assert.match(html,/Varredura legada removida do boot comercial/);
});
