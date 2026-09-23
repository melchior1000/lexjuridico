'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {
  whatsappIdentity,
  whatsappAccessMode,
  publicWhatsappReception,
  handleWhatsappOperatorCommand
}=require('../lib/integration-status');

const cfg={operator:'5561999171717',url:'https://example.invalid',key:'test'};
function lidBody(text,{lid='115375790358554@lid',phone='5561988888888@s.whatsapp.net',name='Contato'}={}){
  return {data:{key:{id:'lid-'+Math.random(),fromMe:false,remoteJid:lid,remoteJidAlt:phone},message:{conversation:text},pushName:name}};
}

test('identidade WhatsApp usa remoteJidAlt como telefone e preserva LID para resposta',()=>{
  const data=lidBody('Oi').data;
  assert.deepEqual(whatsappIdentity(data),{
    digits:'5561988888888',
    lid:'115375790358554@lid',
    replyTarget:'115375790358554@lid',
    remoteJid:'115375790358554@lid',
    remoteJidAlt:'5561988888888@s.whatsapp.net'
  });
});

test('dono em LID continua sendo reconhecido pelo telefone alternativo',()=>{
  assert.equal(whatsappAccessMode('998877665544@lid',cfg.operator,'556199171717@s.whatsapp.net'),'operator');
});

test('recepção responde no LID observado em vez de reconstruir número brasileiro',async()=>{
  const sent=[];
  const store={
    history:async()=>[],
    upsert:async()=>({classe:'geral',urgente:false}),
    appendEvent:async()=>{}
  };
  const request=async(_,opts)=>{sent.push(opts.data);return {key:{id:'sent'}};};
  const body=lidBody('Oi');
  const ok=await publicWhatsappReception(body,'LEX',{...cfg,store,request});
  assert.equal(ok,true);
  assert.equal(sent[0].number,'115375790358554@lid');
  assert.match(sent[0].text,/assistente virtual.*escritório/i);
});

test('mesa do dono responde pelo mesmo LID recebido',async()=>{
  const sent=[];
  const request=async(_,opts)=>{sent.push(opts.data);return {key:{id:'sent'}};};
  const store={list:async()=>[]};
  const body=lidBody('/recepcao',{lid:'887766554433@lid',phone:'556199171717@s.whatsapp.net',name:'Titular'});
  const handled=await handleWhatsappOperatorCommand(body,'LEX',{...cfg,store,request});
  assert.equal(handled,true);
  assert.equal(sent[0].number,'887766554433@lid');
  assert.match(sent[0].text,/Recepção:/);
});
