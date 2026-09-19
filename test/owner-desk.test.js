const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeOwnerDeskCommand,normalizeOwnerNamedReply}=require('../lib/owner-desk');
const {publicWhatsappReception,handleWhatsappOperatorCommand}=require('../lib/integration-status');

const cfg={operator:'5561999171717',url:'https://evo.example.test',key:'fake'};

function resetReception(){
  global._whatsappPublicInbox=[];
  global._whatsappReceptionEvents=[];
}

function publicBody(number,name,text,id){
  return {data:{pushName:name,key:{id,fromMe:false,remoteJid:number+'@s.whatsapp.net'},message:{conversation:text}}};
}

function ownerBody(text,id='owner-1'){
  return {data:{key:{id,fromMe:false,remoteJid:'5561999171717@s.whatsapp.net'},message:{conversation:text}}};
}

test('mesa do dono entende linguagem natural sem barra',()=>{
  assert.equal(normalizeOwnerDeskCommand('Oi'),'/recepcao');
  assert.equal(normalizeOwnerDeskCommand('mesa'),'/recepcao');
  assert.equal(normalizeOwnerDeskCommand('resumo'),'/recepcao');
  assert.equal(normalizeOwnerDeskCommand('histórico 5561987777777'),'/historico 5561987777777');
  assert.equal(normalizeOwnerDeskCommand('responder 5561987777777 Texto exato'),'/responder 5561987777777 Texto exato');
  assert.equal(normalizeOwnerDeskCommand('resolver 5561987777777'),'/arquivar 5561987777777');
  assert.equal(normalizeOwnerDeskCommand('qual a melhor tese?'),null);
});

test('ordem natural enderecada pelo nome e reconhecida sem inventar destinatario',()=>{
  assert.deepEqual(normalizeOwnerNamedReply('A Leidyanny diga a ela q hj é sábado segunda falo com ela.'),{
    nome:'Leidyanny',
    instrucao:'hj é sábado segunda falo com ela.'
  });
  assert.equal(normalizeOwnerNamedReply('diga a ela qualquer coisa'),null);
});

test('ordem natural por nome envia somente ao contato unico da fila',async()=>{
  const calls=[];
  const events=[];
  const request=async(url,opts)=>{calls.push(opts.data);return {key:{id:'ok-'+calls.length}};};
  const store={
    list:async()=>[
      {nome:'Leidyanny',numero:'5561999522015',classe:'juridico',status:'aguardando_advogado'},
      {nome:'Outro',numero:'5561988888888',classe:'geral',status:'aguardando_advogado'}
    ],
    appendEvent:async event=>events.push(event)
  };
  const ok=await handleWhatsappOperatorCommand(ownerBody('A Leidyanny diga a ela q hj é sábado segunda falo com ela.'),'LEX-JURIDICO',{...cfg,request,store});
  assert.equal(ok,true);
  assert.equal(calls[0].number,'5561999522015');
  assert.equal(calls[0].text,'hoje é sábado segunda falo com você.');
  assert.equal(events[0].direcao,'saida_operador');
  assert.equal(events[0].numero,'5561999522015');
  assert.equal(calls[1].number,'5561999171717');
  assert.match(calls[1].text,/Resposta enviada para Leidyanny/);
});

test('nome ambiguo nao envia mensagem ao cliente',async()=>{
  const calls=[];
  const request=async(url,opts)=>{calls.push(opts.data);return {key:{id:'ok-'+calls.length}};};
  const store={list:async()=>[
    {nome:'Ana Silva',numero:'5561981111111',status:'aguardando_advogado'},
    {nome:'Ana Souza',numero:'5561982222222',status:'aguardando_advogado'}
  ]};
  const ok=await handleWhatsappOperatorCommand(ownerBody('Ana diga a ela que retorno segunda'),'LEX-JURIDICO',{...cfg,request,store});
  assert.equal(ok,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].number,'5561999171717');
  assert.match(calls[0].text,/mais de um contato/i);
});

test('oi no 7171 abre mesa com contatos isolados por numero',async()=>{
  resetReception();
  const calls=[];
  const request=async(url,opts)=>{calls.push(opts.data);return {key:{id:'ok-'+calls.length}};};

  await publicWhatsappReception(publicBody('5561981111111','Ana','Quero saber sobre cobrança','a1'),'LEX-JURIDICO',{...cfg,request});
  await publicWhatsappReception(publicBody('5561982222222','Bruno','Tenho um processo de indenização','b1'),'LEX-JURIDICO',{...cfg,request});
  calls.length=0;

  assert.equal(await handleWhatsappOperatorCommand(ownerBody('Oi'),'LEX-JURIDICO',{...cfg,request}),true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].number,'5561999171717');
  assert.match(calls[0].text,/Ana \(5561981111111\)/);
  assert.match(calls[0].text,/Bruno \(5561982222222\)/);
  assert.match(calls[0].text,/cobrança/i);
  assert.match(calls[0].text,/indenização/i);
});

test('resposta natural do dono vai somente ao numero indicado e nao mistura assuntos',async()=>{
  resetReception();
  const calls=[];
  const request=async(url,opts)=>{calls.push(opts.data);return {key:{id:'ok-'+calls.length}};};

  await publicWhatsappReception(publicBody('5561981111111','Ana','Cobrança de fornecedor','a2'),'LEX-JURIDICO',{...cfg,request});
  await publicWhatsappReception(publicBody('5561982222222','Bruno','Processo de indenização','b2'),'LEX-JURIDICO',{...cfg,request});
  calls.length=0;

  const exact='Ana, recebi sua mensagem. Vou conferir a cobrança.';
  assert.equal(await handleWhatsappOperatorCommand(ownerBody('responder 5561981111111 '+exact),'LEX-JURIDICO',{...cfg,request}),true);
  assert.equal(calls[0].number,'5561981111111');
  assert.equal(calls[0].text,exact);
  assert.doesNotMatch(calls[0].text,/Bruno|indeniza/i);
  assert.equal(calls[1].number,'5561999171717');
});

test('resolver natural arquiva somente o contato indicado',async()=>{
  resetReception();
  const request=async()=>({key:{id:'ok'}});

  await publicWhatsappReception(publicBody('5561983333333','Fornecedor A','Cobrança administrativa','a3'),'LEX-JURIDICO',{...cfg,request});
  await publicWhatsappReception(publicBody('5561984444444','Cliente B','Processo judicial','b3'),'LEX-JURIDICO',{...cfg,request});

  assert.equal(await handleWhatsappOperatorCommand(ownerBody('resolver 5561983333333'),'LEX-JURIDICO',{...cfg,request}),true);
  const a=global._whatsappPublicInbox.find(x=>x.numero==='5561983333333');
  const b=global._whatsappPublicInbox.find(x=>x.numero==='5561984444444');
  assert.equal(a.status,'arquivado');
  assert.equal(b.status,'aguardando_advogado');
});
