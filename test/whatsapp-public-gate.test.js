const {test}=require('node:test');
const assert=require('node:assert/strict');
const {whatsappAccessMode,publicWhatsappReply,publicWhatsappReception}=require('../lib/integration-status');

test('somente o operador entra no modo privado, inclusive JID brasileiro legado',()=>{
  const operator='5561999171717';
  assert.equal(whatsappAccessMode('5561999171717@s.whatsapp.net',operator),'operator');
  assert.equal(whatsappAccessMode('556199171717@s.whatsapp.net',operator),'operator');
  assert.equal(whatsappAccessMode('5561988888888@s.whatsapp.net',operator),'public');
  assert.equal(whatsappAccessMode('5511999999999@s.whatsapp.net',''),'public');
});

test('recepcao publica nunca fornece andamento ou dado processual',()=>{
  const text=publicWhatsappReply('Oi, quero saber como esta meu processo 1234');
  assert.match(text,/seguran[cç]a|respons[aá]vel/i);
  assert.doesNotMatch(text,/fase|senten[cç]a|peti[cç][aã]o|prazo de/i);
});

test('recepcao publica identifica o canal para pessoa comum',()=>{
  const text=publicWhatsappReply('De quem e esse numero?');
  assert.match(text,/Lex Jur[ií]dico/i);
  assert.match(text,/nome|empresa/i);
});

test('toda mensagem publica gera ciencia e mostra a resposta do LEX ao operador',async()=>{
  const calls=[];
  const request=async(url,opts)=>{calls.push({url,data:opts.data});return {key:{id:'ok-'+calls.length}};};
  const store={upsert:async()=>({numero:'5561988888888',nome:'Pessoa Teste',classe:'geral',urgente:false,status:'aguardando_advogado'}),archive:async()=>true,list:async()=>[]};
  const body={data:{pushName:'Pessoa Teste',key:{id:'m1',fromMe:false,remoteJid:'5561988888888@s.whatsapp.net'},message:{conversation:'Ola, quem fala?'}}};
  const result=await publicWhatsappReception(body,'LEX-JURIDICO',{operator:'5561999171717',url:'https://evo.example.test',key:'fake',request,store});
  assert.equal(result,true);
  assert.equal(calls.length,2);
  assert.equal(calls[1].data.number,'5561999171717');
  assert.match(calls[1].data.text,/\[CI.NCIA\]/);
  assert.equal(calls[0].data.number,'5561988888888');
  assert.equal(calls[1].data.number,'5561999171717');
  assert.match(calls[1].data.text,/\[LEX\] respondeu/i);
  assert.doesNotMatch(calls.map(x=>x.data.text).join('\n'),/heur[ií]stica|classifica[cç][aã]o autom[aá]tica/i);
});
