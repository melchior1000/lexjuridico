'use strict';
// Identidade do escritório-piloto usada nestes cenários (white-label via ambiente).
Object.assign(process.env,{ESCRITORIO_NOME:'LEX Jurídico',ESCRITORIO_RESP:'Kleuber',LEX_TITULAR_TRATAMENTO:'Dr.'});
const test=require('node:test');
const assert=require('node:assert/strict');
const {intakeDecision,INTRO,authorityFor}=require('../lib/intake-door');

test('LEX se apresenta pelo nome, escritório e supervisão',()=>{
  const d=intakeDecision('Oi');
  assert.equal(d.reply,INTRO);
  assert.match(d.reply,/meu nome é LEX/i);
  assert.match(d.reply,/LEX Jurídico/i);
  assert.match(d.reply,/Dr\. Kleuber/i);
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

test('tema de dono exige autorização expressa',()=>{
  for(const text of ['Quero falar com Kleuber','Quanto vou receber de indenização?','Qual o andamento do meu processo?','Faça a perícia de juros']) {
    const d=intakeDecision(text);
    assert.equal(d.authorityMode,'owner_approval');
    assert.equal(d.requiresApproval,true);
    assert.equal(d.canDecide,false);
    assert.match(d.reply,/Dr\. Kleuber|autorização|revisão/i);
  }
});

test('regra de autoridade nunca permite decisão autônoma',()=>{
  for(const kind of ['greeting','new_case','lawyer','sensitive','existing_case','pericia']) {
    assert.equal(authorityFor(kind).canDecide,false);
  }
});
