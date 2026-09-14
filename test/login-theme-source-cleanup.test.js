const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const syntax=fs.readFileSync(path.join(__dirname,'../scripts/check-syntax.js'),'utf8');
const themeJs=fs.readFileSync(path.join(__dirname,'../login-theme.js'),'utf8');

test('CI valida explicitamente o javascript do tema do login',()=>{
  assert.match(syntax,/login-theme\.js/);
});

test('normalizador do login permanece isolado sem tocar em motor ou canais',()=>{
  assert.match(themeJs,/lexPrepareLoginTheme/);
  assert.doesNotMatch(themeJs,/TaskEngine|whatsapp|telegram|pje|\/api\//i);
});
