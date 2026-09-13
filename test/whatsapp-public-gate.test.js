const {test}=require('node:test');
const assert=require('node:assert/strict');
const {
  whatsappAccessMode,
  publicWhatsappReply,
  publicWhatsappReception
}=require('../lib/integration-status');

test('somente o operador entra no modo privado, inclusive JID brasileiro legado',()=>{
  const operator='5561999171717';
  assert.equal(whatsappAccessMode('5561999171717@s.whatsapp.net',operator),'operator');
  assert.equal(whatsappAccessMode('556199171717@s.whatsapp.net',operator),'operator');
  assert.equal(whatsappAccessMode('5561988888888@s.whatsapp.net',operator),'public');
  assert.equal(whatsappAccessMode('5511999999999@s.whatsapp.net',''),'legacy');
});

test('recepcao publica nunca fornece andamento ou dado processual',()=>{
  const text=publicWhatsappReply('Oi, quero saber como está meu processo 1234');
  assert.match(text,/seguran[cç]a|sigilo/i);
  assert.match(text,/respons[aá]vel/i);
  assert.doesNotMatch(text,/fase|senten[cç]a|peti[cç][aã]o|prazo de/i);
});

test('recepcao publica identifica o canal para pessoa comum',()=>{
  const text=publicWhatsappReply('De quem é esse número?');
  assert.match(text,/Lex Jur[ií]dico/i);
  assert.match(text,/nome|empresa/i);
});

test('recepcao publica comum responde remetente sem espelho integral ao operador',async()=>{
  const calls=[];
  const request=async(url,opts)=>{calls.push({url,data:opts.data});return {key:{id:'ok-'+calls.length}};};
  const store={upsert:async()=>({numero:'5561988888888',nome:'Pessoa Teste',classe:'geral',urgente:false,status:'aguardando_advogado'}),archive:async()=>true,list:async()=>[]};
  const body={data:{pushName:'Pessoa Teste',key:{id:'m1',fromMe:false,remoteJid:'5561988888888@s.whatsapp.net'},message:{conversation:'Olá, quem fala?'}}};
  const result=await publicWhatsappReception(body,'LEX-JURIDICO',{operator:'5561999171717',url:'https://evo.example.test',key:'fake',request,store});
  assert.equal(result,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].data.number,'5561988888888');
  assert.match(calls[0].data.text,/Lex Jur[ií]dico|nome|empresa/i);
  assert.doesNotMatch(calls[0].data.text,/heur[ií]stica|classifica[cç][aã]o autom[aá]tica/i);
});
