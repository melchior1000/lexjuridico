const fs=require('node:fs');
const path=require('node:path');

const syntax=fs.readFileSync(path.join(__dirname,'../scripts/check-syntax.js'),'utf8');
const themeJs=fs.readFileSync(path.join(__dirname,'../login-theme.js'),'utf8');

test('CI valida explicitamente o javascript do tema do login',()=>{
  expect(syntax).toMatch(/login-theme\.js/);
});

test('normalizador do login permanece isolado sem tocar em motor ou canais',()=>{
  expect(themeJs).toMatch(/lexPrepareLoginTheme/);
  expect(themeJs).not.toMatch(/TaskEngine|whatsapp|telegram|pje|\/api\//i);
});
