'use strict';
// 06/10/2026 — Entrada do WhatsApp:
// (1) a mesma mensagem entregue duas vezes pela Evolution era respondida duas vezes;
// (2) cliente que chega só com LID (sem telefone visível) era descartado sem aviso;
// (3) o LID confirmado do titular ficava só na memória e se perdia no reinício.
Object.assign(process.env,{ESCRITORIO_NOME:'LEX Jurídico',ESCRITORIO_RESP:'Kleuber',LEX_TITULAR_TRATAMENTO:'Dr.'});
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createWhatsappInbound,contactIdFor}=require('../lib/whatsapp-inbound');
const {whatsappDestination}=require('../lib/channel-delivery');

const OPERATOR='5561999171717';
const CLIENT_LID='115375790358554@lid';

// Imita o RecordStore (lib/record-store.js): change(key, fn) com cópia; undefined = não grava.
function fakeRecords(){
  const rows=new Map();let writes=0;
  return {
    rows,get writes(){return writes;},
    async read(key){return rows.has(key)?{value:structuredClone(rows.get(key)),stamp:'t'}:null;},
    async change(key,update){
      const value=await update(rows.has(key)?structuredClone(rows.get(key)):null);
      if(value===undefined) return rows.get(key);
      rows.set(key,value);writes++;return value;
    }
  };
}
function brokenRecords(){
  return {async read(){throw new Error('banco fora');},async change(){throw new Error('banco fora');}};
}
function freshIntegration(){
  delete require.cache[require.resolve('../lib/integration-status')];
  return require('../lib/integration-status');
}
const tick=()=>new Promise(r=>setImmediate(r));

test('mesma mensagem duas vezes: só a primeira passa',async()=>{
  const inbound=createWhatsappInbound({records:fakeRecords()});
  const msg={contact:'5561988888888',instance:'LEX',messageId:'ABC1'};
  assert.equal(await inbound.claim(msg),true);
  assert.equal(await inbound.claim(msg),false,'repetição descartada');
  assert.equal(await inbound.claim({...msg,messageId:'ABC2'}),true,'mensagem nova do mesmo contato passa');
  assert.equal(await inbound.claim({...msg,instance:'OUTRA'}),true,'mesmo id em outra instância é outra mensagem');
});

test('repetição continua descartada depois de reiniciar o servidor',async()=>{
  const records=fakeRecords();
  const msg={contact:'5561988888888',instance:'LEX',messageId:'XYZ'};
  assert.equal(await createWhatsappInbound({records}).claim(msg),true);
  const depoisDoReinicio=createWhatsappInbound({records});
  assert.equal(await depoisDoReinicio.claim(msg),false);
});

test('banco fora do ar: processa (não descarta em silêncio) e a memória ainda pega a repetição',async()=>{
  const inbound=createWhatsappInbound({records:brokenRecords(),log:()=>{}});
  const msg={contact:'5561988888888',instance:'LEX',messageId:'Q1'};
  assert.equal(await inbound.claim(msg),true);
  assert.equal(await inbound.claim(msg),false);
});

test('guarda no máximo 200 ids por contato',async()=>{
  const records=fakeRecords();
  const inbound=createWhatsappInbound({records});
  for(let i=0;i<205;i++) await inbound.claim({contact:'5561988888888',instance:'LEX',messageId:'m'+i});
  assert.equal(records.rows.get('whatsapp_entrada_5561988888888').ids.length,200);
});

test('contato só com LID ganha identificador próprio',()=>{
  assert.equal(contactIdFor({digits:null,lid:CLIENT_LID}),'115375790358554');
  assert.equal(contactIdFor({digits:'5561988888888',lid:CLIENT_LID}),'5561988888888');
  assert.equal(contactIdFor({digits:null,lid:null}),null);
});

test('webhook de cliente só com LID não some mais: passa pela trava de repetição',async()=>{
  const integ=freshIntegration();
  const claims=[];
  await integ.setWhatsappInbound({claim:async m=>{claims.push(m);return false;},loadOperatorLid:async()=>null,saveOperatorLid:async()=>{},rememberLidContact:async()=>{},lidTargetFor:async()=>null},{operator:OPERATOR});
  const before=process.env.LEX_OPERATOR_WHATSAPP;process.env.LEX_OPERATOR_WHATSAPP=OPERATOR;
  try{
    const body={instance:'LEX',event:'messages.upsert',data:{key:{id:'L1',fromMe:false,remoteJid:CLIENT_LID},message:{conversation:'Oi'},pushName:'Maria'}};
    assert.equal(integ.incomingWhatsappMessage(body,'LEX'),false,'cliente não vai para o fluxo do titular');
    await tick();await tick();
    assert.equal(claims.length,1,'a mensagem entrou na recepção');
    assert.deepEqual(claims[0],{contacts:['115375790358554'],instance:'LEX',messageId:'L1'});
  } finally {process.env.LEX_OPERATOR_WHATSAPP=before;}
});

test('recepção responde ao cliente só com LID, registra na fila e avisa o titular',async()=>{
  const integ=freshIntegration();
  const records=fakeRecords();
  await integ.setWhatsappInbound(createWhatsappInbound({records}),{operator:OPERATOR});
  const sent=[];const upserts=[];
  const store={history:async()=>[],upsert:async(n,nome)=>{upserts.push({n,nome});return {classe:'geral',urgente:false};},appendEvent:async()=>{}};
  const request=async(_,opts)=>{sent.push(opts.data);return {key:{id:'ok'}};};
  const body={data:{key:{id:'L2',fromMe:false,remoteJid:CLIENT_LID},message:{conversation:'Oi, quero falar sobre meu processo'},pushName:'Maria'}};
  const ok=await integ.publicWhatsappReception(body,'LEX',{operator:OPERATOR,url:'https://example.invalid',key:'k',store,request});
  assert.equal(ok,true);
  assert.equal(upserts[0].n,'115375790358554','fila usa o código do LID');
  assert.ok(sent.some(m=>m.number===CLIENT_LID),'resposta sai para o LID');
  assert.ok(sent.some(m=>m.number===OPERATOR&&/sem número visível/.test(m.text)),'titular sabe que o contato veio sem número');
  assert.equal(records.rows.get('whatsapp_contato_lid_115375790358554').lid,CLIENT_LID,'LID do contato gravado');
});

test('titular responde ao contato só com LID por /responder e pela tela (envio vai ao LID)',async()=>{
  const integ=freshIntegration();
  const records=fakeRecords();
  const inbound=createWhatsappInbound({records});
  await integ.setWhatsappInbound(inbound,{operator:OPERATOR});
  await inbound.rememberLidContact(CLIENT_LID,'Maria');
  const sent=[];const events=[];
  const request=async(_,opts)=>{sent.push(opts.data);return {key:{id:'ok'}};};
  const store={appendEvent:async e=>events.push(e)};
  const owner={data:{key:{id:'O1',fromMe:false,remoteJid:OPERATOR+'@s.whatsapp.net'},message:{conversation:'/responder 115375790358554 Recebi, retorno amanhã.'},pushName:'Kleuber'}};
  const handled=await integ.handleWhatsappOperatorCommand(owner,'LEX',{operator:OPERATOR,url:'https://example.invalid',key:'k',store,request});
  assert.equal(handled,true);
  assert.deepEqual(sent[0],{number:CLIENT_LID,text:'Recebi, retorno amanhã.'});
  assert.equal(events[0].numero,'115375790358554');
  // Tela do escritório (lib/channel-delivery.js): mesmo contato, mesmo destino.
  const depoisDoReinicio=createWhatsappInbound({records});
  assert.equal(await whatsappDestination('115375790358554',id=>depoisDoReinicio.lidTargetFor(id)),CLIENT_LID);
});

test('destino desconhecido continua recusado; telefone brasileiro continua igual',async()=>{
  const inbound=createWhatsappInbound({records:fakeRecords()});
  const resolver=id=>inbound.lidTargetFor(id);
  assert.equal(await whatsappDestination('999999999999999',resolver),null);
  assert.equal(await whatsappDestination('5561988888888',resolver),'5561988888888');
  assert.equal(await whatsappDestination('+55 (61) 98888-8888',resolver),'5561988888888');
  assert.equal(await whatsappDestination('999999999999999',null),null);
  const integ=freshIntegration();
  await integ.setWhatsappInbound(inbound,{operator:OPERATOR});
  const sent=[];const request=async(_,opts)=>{sent.push(opts.data);return {key:{id:'ok'}};};
  const owner={data:{key:{id:'O2',fromMe:false,remoteJid:OPERATOR+'@s.whatsapp.net'},message:{conversation:'/responder 999999999999999 teste'},pushName:'Kleuber'}};
  await integ.handleWhatsappOperatorCommand(owner,'LEX',{operator:OPERATOR,url:'https://example.invalid',key:'k',store:{},request});
  assert.equal(sent.length,1);assert.equal(sent[0].number,OPERATOR,'só o aviso ao titular');assert.match(sent[0].text,/Número inválido/);
});

test('LID do titular sobrevive ao reinício do servidor',async()=>{
  const records=fakeRecords();
  const ownerLid='445566778899@lid';
  let integ=freshIntegration();
  await integ.setWhatsappInbound(createWhatsappInbound({records}),{operator:OPERATOR});
  assert.equal(integ.isWhatsappOperator(ownerLid,OPERATOR,'556199171717@s.whatsapp.net'),true);
  await tick();
  assert.equal(records.rows.get('whatsapp_titular_lid').lid,ownerLid);
  integ=freshIntegration(); // reinício: memória do processo zerada
  assert.equal(integ.isWhatsappOperator(ownerLid,OPERATOR),false,'sem carregar o banco, o LID sozinho não basta');
  await integ.setWhatsappInbound(createWhatsappInbound({records}),{operator:OPERATOR});
  assert.equal(integ.isWhatsappOperator(ownerLid,OPERATOR),true,'LID confirmado volta do banco');
  assert.equal(integ.isWhatsappOperator('111222333444@lid',OPERATOR),false,'outro LID continua cliente');
});

test('cliente só com LID igual ao do titular não entra na fila de clientes',async()=>{
  const integ=freshIntegration();
  await integ.setWhatsappInbound(createWhatsappInbound({records:fakeRecords()}),{operator:OPERATOR});
  const ownerLid='445566778899@lid';
  integ.isWhatsappOperator(ownerLid,OPERATOR,'556199171717@s.whatsapp.net');
  const sent=[];const request=async(_,opts)=>{sent.push(opts.data);return {key:{id:'ok'}};};
  const store={history:async()=>[],upsert:async()=>{throw new Error('não deveria registrar');},appendEvent:async()=>{}};
  const body={data:{key:{id:'L3',fromMe:false,remoteJid:ownerLid},message:{conversation:'Oi'},pushName:'Kleuber'}};
  assert.equal(await integ.publicWhatsappReception(body,'LEX',{operator:OPERATOR,url:'https://example.invalid',key:'k',store,request}),false);
  assert.equal(sent.length,0);
});

test('servidor confere repetição na entrada do titular e liga a memória persistente',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8');
  const a=src.indexOf('async function adapterEvolution(body)');
  assert.ok(a>=0);
  assert.match(src.slice(a,a+300),/if\(!\(await claimWhatsappEvent\(body,EVO_INST\)\)\)/,'primeira linha do adaptador descarta repetição');
  assert.match(src,/createWhatsappInbound\(\{records:recordStore\}\)/,'memória gravada no banco de registros');
  assert.match(src,/setWhatsappInbound\(whatsappInbound\)/);
  assert.match(src,/setWhatsappTargetResolver\(id=>whatsappInbound\.lidTargetFor\(id\)\)/,'tela e fila de comandos enviam ao LID gravado');
});

// Revisão adversarial de 06/10/2026.
test('mesma mensagem com telefone+LID e depois só com LID continua sendo repetição',async()=>{
  const records=fakeRecords();
  const integ=freshIntegration();
  await integ.setWhatsappInbound(createWhatsappInbound({records}),{operator:OPERATOR});
  const comAmbos={data:{key:{id:'DUP1',fromMe:false,remoteJid:CLIENT_LID,remoteJidAlt:'5561988888888@s.whatsapp.net'},message:{conversation:'Oi'}}};
  const soLid={data:{key:{id:'DUP1',fromMe:false,remoteJid:CLIENT_LID},message:{conversation:'Oi'}}};
  assert.equal(await integ.claimWhatsappEvent(comAmbos,'LEX'),true);
  const depoisDoReinicio=freshIntegration();
  await depoisDoReinicio.setWhatsappInbound(createWhatsappInbound({records}),{operator:OPERATOR});
  assert.equal(await depoisDoReinicio.claimWhatsappEvent(soLid,'LEX'),false);
});

test('resposta por nome a cliente com número antigo de 12 dígitos continua saindo',async()=>{
  const integ=freshIntegration();
  await integ.setWhatsappInbound(createWhatsappInbound({records:fakeRecords()}),{operator:OPERATOR});
  const sent=[];const request=async(_,opts)=>{sent.push(opts.data);return {key:{id:'ok'}};};
  const store={list:async()=>[{numero:'556188888888',nome:'Maria Silva',classe:'geral'}],appendEvent:async()=>{}};
  const owner={data:{key:{id:'O3',fromMe:false,remoteJid:OPERATOR+'@s.whatsapp.net'},message:{conversation:'Maria Silva, diga que falo com ela amanhã'},pushName:'Kleuber'}};
  assert.equal(await integ.handleWhatsappOperatorCommand(owner,'LEX',{operator:OPERATOR,url:'https://example.invalid',key:'k',store,request}),true);
  assert.equal(sent[0].number,'556188888888','envio ao número da fila, como antes');
});

test('LID curto (que poderia ser confundido com telefone) nunca vira destino de envio',async()=>{
  const records=fakeRecords();
  const inbound=createWhatsappInbound({records});
  await inbound.rememberLidContact('61988887777@lid','X');
  assert.equal(await inbound.lidTargetFor('61988887777'),null);
  assert.equal(records.rows.size,0,'nada gravado');
  assert.equal(await whatsappDestination('61988887777',id=>inbound.lidTargetFor(id)),null);
  assert.equal(contactIdFor({digits:null,lid:'61988887777@lid'}),null);
});

test('fila de comandos da tela aceita contato só com LID e entrega no LID',async()=>{
  const {createChannelCommandOutbox}=require('../lib/channel-command-outbox');
  const map=new Map();
  const rec={async read(k){return map.has(k)?{value:structuredClone(map.get(k))}:null;},
    async change(k,fn){const n=await fn(map.has(k)?structuredClone(map.get(k)):null);if(n!==undefined)map.set(k,structuredClone(n));return n;},
    async list(p){return [...map].filter(([k])=>k.startsWith(p)).map(([,v])=>structuredClone(v));}};
  const deliveries=[];
  const out=createChannelCommandOutbox({records:rec,compose:async()=>'Recebi.',log:()=>{},
    deliverDetailed:async input=>{deliveries.push(input);return {ok:true,state:'confirmado',provider_id:'p1'};},
    receptionStore:{appendEvent:async()=>{}}});
  const job=await out.enqueue({origem:'whatsapp',id:'115375790358554',nome:'Maria',comando:'diga que recebi'});
  assert.equal(job.contato_id,'115375790358554');
  await assert.rejects(out.enqueue({origem:'whatsapp',id:'61988887777',comando:'x'}),/contato válidos/);
});

test('LID do titular: nova leitura do banco antes de tratar contato só com LID',async()=>{
  const records=fakeRecords();
  const ownerLid='998877665544332@lid';
  records.rows.set('whatsapp_titular_lid',{operador:OPERATOR,lid:ownerLid});
  const integ=freshIntegration();
  let leituras=0;
  const quebradoNaPartida=createWhatsappInbound({records});
  const original=quebradoNaPartida.loadOperatorLid;
  quebradoNaPartida.loadOperatorLid=async op=>{leituras++;return leituras===1?null:original(op);};
  await integ.setWhatsappInbound(quebradoNaPartida,{operator:OPERATOR});
  assert.equal(integ.isWhatsappOperator(ownerLid,OPERATOR),false,'partida não leu o LID');
  const realDateNow=Date.now;Date.now=()=>realDateNow()+31000;
  try{
    const sent=[];const request=async(_,opts)=>{sent.push(opts.data);return {key:{id:'ok'}};};
    const store={history:async()=>[],upsert:async()=>{throw new Error('titular não pode virar cliente');},appendEvent:async()=>{}};
    const body={data:{key:{id:'L9',fromMe:false,remoteJid:ownerLid},message:{conversation:'Oi'}}};
    assert.equal(await integ.publicWhatsappReception(body,'LEX',{operator:OPERATOR,url:'https://example.invalid',key:'k',store,request}),false);
    assert.equal(sent.length,0);
    assert.equal(integ.isWhatsappOperator(ownerLid,OPERATOR),true,'LID carregado na segunda tentativa');
  } finally {Date.now=realDateNow;}
});

test('sem o vínculo LID gravado: /historico e /arquivar acham o contato, /responder não envia',async()=>{
  const integ=freshIntegration();
  await integ.setWhatsappInbound(createWhatsappInbound({records:fakeRecords()}),{operator:OPERATOR});
  const sent=[];const request=async(_,opts)=>{sent.push(opts.data);return {key:{id:'ok'}};};
  const asked=[];
  const store={history:async n=>{asked.push(['historico',n]);return [];},archive:async n=>{asked.push(['arquivar',n]);return true;},appendEvent:async()=>{}};
  const cmd=(id,text)=>({data:{key:{id,fromMe:false,remoteJid:OPERATOR+'@s.whatsapp.net'},message:{conversation:text},pushName:'Kleuber'}});
  const opts={operator:OPERATOR,url:'https://example.invalid',key:'k',store,request};
  await integ.handleWhatsappOperatorCommand(cmd('H1','/historico 115375790358554'),'LEX',opts);
  await integ.handleWhatsappOperatorCommand(cmd('A1','/arquivar 115375790358554'),'LEX',opts);
  assert.deepEqual(asked,[['historico','115375790358554'],['arquivar','115375790358554']]);
  sent.length=0;
  await integ.handleWhatsappOperatorCommand(cmd('R1','/responder 115375790358554 oi'),'LEX',opts);
  assert.equal(sent.length,1);assert.equal(sent[0].number,OPERATOR);assert.match(sent[0].text,/Número inválido/);
});
