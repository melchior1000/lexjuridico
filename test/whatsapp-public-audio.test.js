'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {publicWhatsappReception,incomingWhatsappMessage}=require('../lib/integration-status');

function bodyAudio(textBase64='YXVkaW8='){
  return {instance:'LEX-JURIDICO',event:'messages.upsert',data:{
    key:{id:'msg-audio-1',fromMe:false,remoteJid:'5561988888888@s.whatsapp.net'},
    pushName:'Maria',message:{audioMessage:{base64:textBase64,mimetype:'audio/ogg'}}
  }};
}
function store(){
  const events=[];return {events,
    async upsert(numero,nome,ultima_mensagem){return {numero,nome,ultima_mensagem,classe:'geral',urgente:false};},
    async appendEvent(e){events.push(e);return true;},async archive(){return true;}
  };
}

test('audio publico transcrito segue classificacao da fala e avisa operador',async()=>{
  const sent=[];const s=store();
  const ok=await publicWhatsappReception(bodyAudio(),'LEX-JURIDICO',{
    operator:'5561999171717',url:'https://evolution.exemplo.com',key:'x',store:s,
    transcribe:async()=>({ok:true,texto:'Meu prazo vence amanhã, é urgente'}),
    request:async(_url,opt)=>{sent.push(opt.data);return {key:{id:'ok'}};}
  });
  assert.equal(ok,true);
  assert.equal(sent.length,3);
  assert.match(sent[0].text,/\[URGENTE\]/);
  assert.match(sent[0].text,/Áudio transcrito/);
  assert.match(sent[0].text,/prazo vence amanhã/i);
  assert.match(sent[1].text,/urgente|urgência/i);
  assert.match(sent[2].text,/\[LEX\] respondeu/);
  assert.match(s.events[0].texto,/Áudio transcrito/);
});

test('falha de transcricao nao inventa fala e pede reenvio',async()=>{
  const sent=[];const s=store();
  await publicWhatsappReception(bodyAudio(),'LEX-JURIDICO',{
    operator:'5561999171717',url:'https://evolution.exemplo.com',key:'x',store:s,
    transcribe:async()=>({ok:false,texto:'',erro:'timeout'}),
    request:async(_url,opt)=>{sent.push(opt.data);return {key:{id:'ok'}};}
  });
  assert.match(sent[1].text,/\[ATENÇÃO\]/);
  assert.match(sent[1].text,/áudio não compreendido/i);
  assert.match(sent[0].text,/não consegui ouvi-lo com segurança/i);
  assert.doesNotMatch(sent.map(x=>x.text).join('\n'),/texto provável|talvez tenha dito/i);
});

test('audio de terceiro continua bloqueado antes do motor juridico',()=>{
  const old=process.env.LEX_OPERATOR_WHATSAPP;process.env.LEX_OPERATOR_WHATSAPP='5561999171717';
  try { assert.equal(incomingWhatsappMessage(bodyAudio(),'LEX-JURIDICO'),false); }
  finally { if(old===undefined) delete process.env.LEX_OPERATOR_WHATSAPP; else process.env.LEX_OPERATOR_WHATSAPP=old; }
});
