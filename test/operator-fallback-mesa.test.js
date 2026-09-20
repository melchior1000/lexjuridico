const {test}=require('node:test');
const assert=require('node:assert/strict');
const {handleWhatsappOperatorCommand}=require('../lib/integration-status');

function ownerBody(text,id='owner-free-1'){
  return {data:{key:{id,fromMe:false,remoteJid:'5561999171717@s.whatsapp.net'},message:{conversation:text}}};
}

test('texto livre do dono não vira mesa e segue para o LEX vivo',async()=>{
  const calls=[];
  const request=async(url,opts)=>{calls.push(opts.data);return {key:{id:'ok-'+calls.length}};};
  const store={list:async()=>[{nome:'Joao',numero:'5561988888888',classe:'geral',ultima_mensagem:'Preciso falar com o escritorio',urgente:false}]};
  const ok=await handleWhatsappOperatorCommand(ownerBody('Está aí fala comigo'),'LEX-JURIDICO',{
    operator:'5561999171717',url:'https://evo.example.test',key:'fake',request,store
  });
  assert.equal(ok,false);
  assert.equal(calls.length,0);
});
