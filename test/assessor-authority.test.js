'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {intakeDecision,INTRO,RESPONSIBLE_NAME,authorityFor}=require('../lib/intake-door');

test('LEX se apresenta pelo nome, escritório e supervisão configurável',()=>{
  const d=intakeDecision('Oi');
  assert.equal(d.reply,INTRO);
  assert.match(d.reply,/meu nome é LEX/i);
  assert.match(d.reply,/LEX Jurídico/i);
  assert.ok(RESPONSIBLE_NAME);
  assert.match(d.reply,new RegExp(RESPONSIBLE_NAME.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
  assert.match(d.reply,/Em que posso te ajudar/i);
});

test('fala social e identificação são pré-autorizadas, sem poder de decisão',()=>{
  for(const text of ['Oi','Quem é vc?','Obrigado']) {
    const d=intakeDecision(text);
    assert.equal(d.authorityMode,'preauthorized');
    assert.equal(d.requiresApproval,false);
    assert.equal(d.canDecide,false);
  }
});

test('assessor pode coletar e organizar, mas não assumir posição',()=>{
  const d=intakeDecision('Fui demitido e quero entrar com ação');
  assert.equal(d.destino,'cadastro');
  assert.equal(d.authorityMode,'assessor_intake');
  assert.equal(d.requiresApproval,true);
  assert.equal(d.canDecide,false);
  assert.match(d.reply,/organizar|preparar/i);
});

test('tema sensível exige autorização expressa do responsável configurado',()=>{
  for(const text of ['Quero falar com Kleuber','Quanto vou receber de indenização?','Qual o andamento do meu processo?','Faça a perícia de juros']) {
    const d=intakeDecision(text);
    assert.equal(d.authorityMode,'owner_approval');
    assert.equal(d.requiresApproval,true);
    assert.equal(d.canDecide,false);
    assert.match(d.reply,/autorização|revisão|responsável/i);
  }
});

test('regra de autoridade nunca permite decisão autônoma',()=>{
  for(const kind of ['greeting','new_case','lawyer','sensitive','existing_case','pericia']) {
    assert.equal(authorityFor(kind).canDecide,false);
  }
});
