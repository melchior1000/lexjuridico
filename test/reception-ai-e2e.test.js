'use strict';
// Ponta a ponta: cliente escreve pelo WhatsApp e pelo Telegram; a IA (simulada) escreve a
// resposta; o código continua decidindo classe/escalonamento; histórico e resumo ao titular.
Object.assign(process.env,{ESCRITORIO_NOME:'Silva Advogados',ESCRITORIO_RESP:'Ana',LEX_TITULAR_TRATAMENTO:'Dra.'});
const test=require('node:test');
const assert=require('node:assert/strict');
const {publicWhatsappReception,setReceptionComposer}=require('../lib/integration-status');
const {createTelegramReception}=require('../lib/telegram-reception');
const {createReceptionComposer}=require('../lib/reception-ai');

const cfg={operator:'5561999171717',url:'https://example.invalid',key:'test'};
const body=(text,id,sender='5561988888888')=>({data:{key:{id,fromMe:false,remoteJid:sender+'@s.whatsapp.net'},message:{conversation:text},pushName:'Carlos'}});
const identity=()=>require('../lib/office-identity').getIdentity();

test('WhatsApp: a resposta que sai pelo canal é a da IA, registrada como saida_lex, e o titular recebe o resumo',async()=>{
  const history=[],sent=[];
  const store={history:async()=>[...history].reverse(),upsert:async(_,nome)=>({classe:'geral',nome}),appendEvent:async e=>history.push(e)};
  const request=async(_,opts)=>{sent.push(opts.data);return {key:{id:'sent'}};};
  const calls=[];
  const composer=createReceptionComposer({ia:async(messages,system)=>{calls.push({messages,system});return 'Sinto muito, Carlos. Vou organizar seu relato para a Dra. Ana avaliar. Você ainda trabalha na empresa ou já foi desligado?';},aiAvailable:()=>true,identity,log:{warn(){}}});
  await publicWhatsappReception(body('meu patrão não pagou minhas horas extras, o que eu faço?','m1'),'LEX',{...cfg,store,request,compose:composer.compose});
  const toClient=sent.find(s=>s.number==='5561988888888');
  assert.match(toClient.text,/Dra\. Ana avaliar/,'cliente recebeu a resposta da IA');
  assert.match(history.find(e=>e.direcao==='saida_lex').texto,/Dra\. Ana avaliar/,'histórico guardou a resposta da IA');
  const toOwner=sent.filter(s=>s.number!=='5561988888888');
  assert.ok(toOwner.length>=1,'titular recebeu o resumo');
  assert.match(toOwner.at(-1).text,/caso novo|cadastro/);
  assert.equal(calls.length,1);
  assert.match(calls[0].system,/tipo "new_case"/);
  // Segundo turno: o histórico vai para a IA e a mensagem atual fica por último.
  await publicWhatsappReception(body('fui desligado mês passado','m2'),'LEX',{...cfg,store,request,compose:composer.compose});
  const msgs=calls[1].messages;
  assert.equal(msgs.at(-1).role,'user');assert.equal(msgs.at(-1).content,'fui desligado mês passado');
  assert.ok(msgs.some(m=>m.role==='assistant'&&/Dra\. Ana avaliar/.test(m.content)),'resposta anterior entrou como assistant');
});

test('WhatsApp: sem crédito de IA o cliente recebe a frase fixa e o atendimento segue normal',async()=>{
  const history=[],sent=[];
  const store={history:async()=>[...history].reverse(),upsert:async()=>({classe:'geral'}),appendEvent:async e=>history.push(e)};
  const request=async(_,opts)=>{sent.push(opts.data);return {key:{id:'sent'}};};
  const composer=createReceptionComposer({ia:async()=>{throw new Error('credit balance is too low');},aiAvailable:()=>true,identity,log:{warn(){}}});
  await publicWhatsappReception(body('bom dia','c1'),'LEX',{...cfg,store,request,compose:composer.compose});
  const toClient=sent.find(s=>s.number==='5561988888888');
  assert.match(toClient.text,/Olá, meu nome é LEX/);
  assert.equal(composer.stats().motivos.sem_credito,1);
});

test('WhatsApp: IA que tenta dar posição jurídica é barrada; sai a frase fixa',async()=>{
  const history=[],sent=[];
  const store={history:async()=>[...history].reverse(),upsert:async()=>({classe:'geral'}),appendEvent:async e=>history.push(e)};
  const request=async(_,opts)=>{sent.push(opts.data);return {key:{id:'sent'}};};
  const composer=createReceptionComposer({ia:async()=>'Você tem direito a R$ 30.000 e o prazo é de 2 anos, pode processar.',aiAvailable:()=>true,identity,log:{warn(){}}});
  await publicWhatsappReception(body('quanto eu ganho se processar?','p1'),'LEX',{...cfg,store,request,compose:composer.compose});
  const toClient=sent.find(s=>s.number==='5561988888888');
  assert.doesNotMatch(toClient.text,/R\$|prazo é/);
  assert.match(toClient.text,/Dra\. Ana|advogad/);
});

test('Telegram: mesma composição, histórico registrado e resumo ao titular quando urgente',async()=>{
  const map=new Map();
  const records={read:async k=>map.has(k)?{value:structuredClone(map.get(k))}:null,list:async()=>[...map.values()],change:async(k,fn)=>{const v=await fn(structuredClone(map.get(k)||null));if(v!==undefined)map.set(k,v);return v;}};
  const sent=[],reported=[];
  const composer=createReceptionComposer({ia:async()=>'Entendi a urgência, Carlos. Vou avisar a Dra. Ana agora mesmo e ela retorna a você.',aiAvailable:()=>true,identity,log:{warn(){}}});
  const service=createTelegramReception({records,owner:'7171',send:async(id,text)=>{sent.push({id,text});return true;},report:async t=>{reported.push(t);return true;},compose:composer.compose});
  await service.receive({chat:{id:'123',type:'private'},from:{id:'123',first_name:'Carlos'},message_id:1,text:'urgente, tenho audiência amanhã e não sei o que fazer'});
  assert.equal(sent.length,1);
  assert.match(sent[0].text,/Vou avisar a Dra\. Ana/);
  const row=map.get('lex_recepcao_telegram_123');
  assert.equal(row.urgente,true);
  assert.equal(row.history.at(-1).direcao,'saida_lex');
  assert.match(row.history.at(-1).texto,/Vou avisar a Dra\. Ana/);
  assert.ok(reported.some(t=>/URGENTE/.test(t)));
});

test('sem compositor registrado, WhatsApp e Telegram seguem com as frases fixas (compatibilidade)',async()=>{
  setReceptionComposer(null);
  const history=[],sent=[];
  const store={history:async()=>[...history].reverse(),upsert:async()=>({classe:'geral'}),appendEvent:async e=>history.push(e)};
  const request=async(_,opts)=>{sent.push(opts.data);return {key:{id:'sent'}};};
  await publicWhatsappReception(body('oi','z1'),'LEX',{...cfg,store,request});
  assert.match(sent.find(s=>s.number==='5561988888888').text,/Olá, meu nome é LEX/);
});
