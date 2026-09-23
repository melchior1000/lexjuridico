'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {intakeDecision,INTRO}=require('../lib/intake-door');

function next(history,text){
  const d=intakeDecision(text,{},[...history].reverse());
  history.push({direcao:'entrada',texto:text},{direcao:'saida_lex',texto:d.reply});
  return d;
}

test('Oi -> Quem é vc? não repete o INTRO completo',()=>{
  const h=[];
  const first=next(h,'Oi');
  const second=next(h,'Quem é vc?');
  assert.equal(first.reply,INTRO);
  assert.notEqual(second.reply,INTRO);
  assert.match(second.reply,/Sou o LEX/i);
});

test('Oi -> Quem é vc? -> Quero falar com o advogado responsável progride sem voltar ao início',()=>{
  const h=[];
  next(h,'Oi');
  next(h,'Quem é vc?');
  const third=next(h,'Quero falar com o advogado responsável');
  assert.equal(third.kind,'lawyer');
  assert.match(third.reply,/advogado responsável/i);
  assert.doesNotMatch(third.reply,/assistente virtual do escritório/i);
});
