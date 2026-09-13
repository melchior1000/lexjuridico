'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {publicWhatsappDecision,publicWhatsappReception}=require('../lib/integration-status');

const cfg={operator:'5561999171717',url:'https://evo.example.test',key:'fake'};
function body(text,extraMessage={}){
  return {data:{pushName:'Maria',key:{id:'m1',fromMe:false,remoteJid:'5561988888888@s.whatsapp.net'},message:{conversation:text,...extraMessage}}};
}
function fakeStore(){
  const state={upserts:[],archives:[]};
  return {state,
    upsert:async(numero,nome,mensagem)=>{state.upserts.push({numero,nome,mensagem});return {numero,nome,classe:/urgente/i.test(mensagem)?'urgente':'geral',urgente:/urgente/i.test(mensagem),status:'aguardando_advogado'};},
    archive:async numero=>{state.archives.push(numero);return true;},
    list:async()=>[]
  };
}
function fakeRequest(calls){return async(url,opts)=>{calls.push(opts.data);return {key:{id:'ok-'+calls.length}};};}

test('saudacao e caso novo dao ciencia ao operador sem pedir decisao',async()=>{
  for(const text of ['Oi, boa tarde','Queria um advogado trabalhista, fui demitido']){
    const calls=[];const store=fakeStore();
    await publicWhatsappReception(body(text),'LEX-JURIDICO',{...cfg,request:fakeRequest(calls),store});
    assert.equal(store.state.upserts.length,1);
    assert.equal(calls.length,3);
    assert.equal(calls[0].number,'5561999171717');
    assert.match(calls[0].text,/\[CI.NCIA\]/);
    assert.equal(calls[1].number,'5561988888888');
    assert.equal(calls[2].number,'5561999171717');
    assert.match(calls[2].text,/\[LEX\] respondeu/i);
    assert.doesNotMatch(calls.map(x=>x.text).join('\n'),/heuristica|classificacao automatica/i);
  }
});

test('processo existente sobe como atencao e mostra a resposta do LEX',async()=>{
  const calls=[];const store=fakeStore();
  await publicWhatsappReception(body('Qual o andamento do meu processo?'),'LEX-JURIDICO',{...cfg,request:fakeRequest(calls),store});
  assert.equal(calls.length,3);
  assert.equal(calls[0].number,'5561999171717');
  assert.match(calls[0].text,/\[ATENÇÃO\].*possível processo existente/i);
  assert.equal(calls[1].number,'5561988888888');
  assert.match(calls[1].text,/não abro processo automaticamente/i);
  assert.equal(calls[2].number,'5561999171717');
  assert.match(calls[2].text,/\[LEX\] respondeu/i);
});

test('urgencia real alerta operador imediatamente e informa a resposta',async()=>{
  const calls=[];const store=fakeStore();
  await publicWhatsappReception(body('Tenho audiência amanhã, é urgente'),'LEX-JURIDICO',{...cfg,request:fakeRequest(calls),store});
  assert.equal(calls.length,3);
  assert.equal(calls[0].number,'5561999171717');
  assert.match(calls[0].text,/\[URGENTE\]/);
  assert.match(calls[1].text,/responsável foi avisado/i);
  assert.match(calls[2].text,/\[LEX\] respondeu/i);
});

test('administrativo e resolvido pelo LEX mas o operador recebe ciencia',async()=>{
  const calls=[];const store=fakeStore();
  await publicWhatsappReception(body('Sou fornecedor e tenho uma fatura para enviar'),'LEX-JURIDICO',{...cfg,request:fakeRequest(calls),store});
  assert.deepEqual(store.state.archives,['5561988888888']);
  assert.equal(calls.length,3);
  assert.equal(calls[0].number,'5561999171717');
  assert.match(calls[0].text,/\[CI.NCIA\].*administrativo/i);
  assert.equal(calls[1].number,'5561988888888');
  assert.match(calls[1].text,/contato administrativo/i);
  assert.match(calls[2].text,/\[LEX\] respondeu/i);
});

test('decisao de recepcao reserva escalonamento para temas de dono',()=>{
  assert.equal(publicWhatsappDecision('Oi').escalate,false);
  assert.equal(publicWhatsappDecision('Quero um advogado trabalhista').escalate,false);
  assert.equal(publicWhatsappDecision('Quero falar com o advogado').escalate,true);
  assert.equal(publicWhatsappDecision('Qual o valor do acordo?').escalate,true);
  assert.equal(publicWhatsappDecision('Qual o andamento do meu processo?').escalate,true);
  assert.equal(publicWhatsappDecision('Tenho prazo amanhã, urgente').escalate,true);
});
