const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('agente vivo nao pode calcular ou estimar prazo juridico sem deadline-truth',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../lex_agente_vivo_core.js'),'utf8');
  assert.ok(!source.includes('calcule ou estime o vencimento'));
  assert.match(source,/Prazo jurídico operacional só existe após leitura oficial auditável/);
  assert.match(source,/deadline-truth/);
  assert.match(source,/confirmação humana/);
});
