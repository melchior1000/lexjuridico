'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
test('cadastro mostra PF/PJ e persiste campos separados',()=>{
  for(const id of ['ptipoPessoa','pnomeCompleto','pcpf','prazaoSocial','pcnpj','pnomeFantasia','prepresentante','pfiliais']) assert.match(html,new RegExp(`id=["']${id}["']`));
  assert.match(html,/tipo_pessoa:document\.getElementById\('ptipoPessoa'\)/);
  assert.match(html,/filiais:\(document\.getElementById\('pfiliais'\)/);
});
test('fonte PJe está descrita para computador do escritório',()=>{
  assert.match(html,/Computador do escritório/);
  assert.match(html,/Você não precisa ter acesso pessoal ao PJe/);
  assert.match(html,/certificado e o PIN permanecem no computador do escritório/);
});
