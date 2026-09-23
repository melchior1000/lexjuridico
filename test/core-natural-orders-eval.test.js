'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {parseOfficeCommand}=require('../lib/office-command');

const matrix=JSON.parse(fs.readFileSync(path.join(__dirname,'..','evals','core-natural-orders.json'),'utf8'));

test('matriz de ordens naturais essenciais permanece reconhecida pelo Core',()=>{
  assert.equal(matrix.version,1);
  assert.ok(Array.isArray(matrix.cases)&&matrix.cases.length>=12,'matriz de eval precisa cobrir as ordens essenciais');
  for(const scenario of matrix.cases){
    const parsed=parseOfficeCommand(scenario.input,{});
    assert.ok(parsed,scenario.id+': ordem deixou de ser reconhecida');
    for(const [key,value] of Object.entries(scenario.expect)){
      assert.deepEqual(parsed[key],value,scenario.id+': campo '+key+' divergiu');
    }
  }
});

test('matriz cobre os requisitos explícitos da etapa 6',()=>{
  const inputs=matrix.cases.map(x=>x.input.toLowerCase()).join('\n');
  for(const required of [
    'contestação',
    'analise esse processo',
    'precisa de mim',
    'responda a leidyanny',
    'cadastre esse cliente',
    'whatsapp'
  ]) assert.ok(inputs.includes(required),'faltou cenário obrigatório: '+required);
});
