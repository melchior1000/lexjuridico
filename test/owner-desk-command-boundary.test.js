const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeOwnerDeskCommand}=require('../lib/owner-desk');

test('mesa do dono nao transforma pergunta juridica livre em comando',()=>{
  for(const text of [
    'qual a melhor tese para esse processo?',
    'faça um acordo de 50 mil',
    'responda o cliente dizendo que ele vai ganhar',
    'analise a perícia'
  ]) assert.equal(normalizeOwnerDeskCommand(text),null);
});
