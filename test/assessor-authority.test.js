'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {intakeDecision,intro,authorityFor}=require('../lib/intake-door');
const {setOfficeProfile}=require('../lib/office-identity');

test('LEX se apresenta pela identidade configurada do escritório',()=>{
  setOfficeProfile({nome:'Almeida Advocacia',responsavel:'Marina Almeida'});
  try {
    const d=intakeDecision('Oi');
    assert.equal(d.reply,intro());
    assert.match(d.reply,/meu nome é LEX/i);
    assert.match(d.reply,/Almeida Advocacia/i);
    assert.match(d.reply,/Marina Almeida/i);
    assert.match(d.reply,/Em que posso te ajudar/i);
  } finally {
    setOfficeProfile({});
  }
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
  setOfficeProfile({});
  for(const text of ['Quero falar com o advogado responsável','Quanto vou receber de indenização?','Qual o andamento do meu processo?','Faça a perícia de juros']) {
    const d=intakeDecision(text);
    assert.equal(d.authorityMode,'owner_approval');
    assert.equal(d.requiresApproval,true);
    assert.equal(d.canDecide,false);
    assert.match(d.reply,/responsável|autorização|revisão/i);
  }
});

test('regra de autoridade nunca permite decisão autônoma',()=>{
  for(const kind of ['greeting','new_case','lawyer','sensitive','existing_case','pericia']) {
    assert.equal(authorityFor(kind).canDecide,false);
  }
});
