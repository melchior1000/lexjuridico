'use strict';
// 06/10/2026 — Pedido para não receber mais mensagens. Antes o LEX não reconhecia "PARE" nem
// "não quero mais receber mensagens" e seguia mandando lembretes automáticos ao contato.
Object.assign(process.env,{ESCRITORIO_NOME:'LEX Jurídico',ESCRITORIO_RESP:'Kleuber',LEX_TITULAR_TRATAMENTO:'Dr.'});
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {ehPedidoDeOptOut,ehOptOutProvavel,nivelDeSaida}=require('../lib/whatsapp-optout');
const {createWhatsappInbound}=require('../lib/whatsapp-inbound');

const OPERATOR='5561999171717';
function fakeRecords(){
  const rows=new Map();
  return {rows,async read(k){return rows.has(k)?{value:structuredClone(rows.get(k))}:null;},
    async change(k,fn){const v=await fn(rows.has(k)?structuredClone(rows.get(k)):null);if(v!==undefined)rows.set(k,v);return v;}};
}
function freshIntegration(){
  delete require.cache[require.resolve('../lib/integration-status')];
  return require('../lib/integration-status');
}
const opts=(extra={})=>({operator:OPERATOR,url:'https://example.invalid',key:'k',...extra});

test('pedido de saída inequívoco: a palavra sozinha ou o pedido sobre as MENSAGENS',()=>{
  for(const t of ['PARE','Stop.','sair!','pare de me mandar mensagem','parem de enviar isso',
    'Não quero mais receber mensagens','não quero receber mais nada','não me mande mais mensagens',
    'me tira da lista','quero sair dessa lista','pode me descadastrar','não entrem mais em contato'])
    assert.equal(ehPedidoDeOptOut(t),true,t);
});

test('não é pedido de saída: parar/sair com outro objeto, fato contado por terceiro, pergunta',()=>{
  for(const t of ['tem como parar a cobrança?','posso sair mais cedo da audiência?','ele não me manda mais a pensão',
    'meu ex não me liga mais','pare de mandar o boleto, já paguei','quero cancelar a audiência de amanhã',
    'me tira da lista de espera','Oi, tudo bem?','vou parar no escritório amanhã','não me recebe mais o advogado?',
    'entre em contato com o meu advogado'])
    assert.equal(ehPedidoDeOptOut(t),false,t);
});

test('em escritório, "cancelar" sozinho e "me deixa em paz" vão para o advogado (provável)',()=>{
  assert.equal(nivelDeSaida('Cancelar'),'provavel');
  assert.equal(nivelDeSaida('remover'),'provavel');
  assert.equal(nivelDeSaida('me deixa em paz'),'provavel');
  assert.equal(nivelDeSaida('PARE'),'inequivoco');
  assert.equal(nivelDeSaida('Bom dia'),null);
  assert.equal(ehOptOutProvavel('cancelar a consulta'),false);
});

test('recepção: "PARE" confirma uma vez, avisa o advogado e suspende mensagens automáticas',async()=>{
  const integ=freshIntegration();
  const records=fakeRecords();
  await integ.setWhatsappInbound(createWhatsappInbound({records}),{operator:OPERATOR});
  const sent=[];let composerCalls=0;
  const request=async(_,o)=>{sent.push(o.data);return {key:{id:'ok'}};};
  const store={history:async()=>[],upsert:async()=>({classe:'geral',urgente:false}),appendEvent:async()=>{}};
  const body={data:{key:{id:'S1',fromMe:false,remoteJid:'556188887777@s.whatsapp.net'},message:{conversation:'PARE'},pushName:'Maria'}};
  assert.equal(await integ.whatsappAutomaticAllowed('5561988887777'),true);
  assert.equal(await integ.publicWhatsappReception(body,'LEX',opts({store,request,compose:async()=>{composerCalls++;return {reply:'oi'};}})),true);
  assert.equal(composerCalls,0,'a IA não escreve a resposta ao pedido de saída');
  const toClient=sent.filter(m=>m.number==='556188887777');
  assert.equal(toClient.length,1);assert.match(toClient[0].text,/não vamos mais enviar mensagens automáticas/);
  assert.ok(sent.some(m=>m.number===OPERATOR&&/pediu para não receber mais mensagens automáticas/.test(m.text)));
  assert.equal(await integ.whatsappAutomaticAllowed('5561988887777'),false,'vale também para a forma com o 9');
  assert.equal(await integ.whatsappAutomaticAllowed('556188887777'),false);
  // depois de reiniciar, continua valendo (gravado no banco)
  const depois=freshIntegration();
  await depois.setWhatsappInbound(createWhatsappInbound({records}),{operator:OPERATOR});
  assert.equal(await depois.whatsappAutomaticAllowed('556188887777@s.whatsapp.net'),false);
  // só o advogado desfaz
  const owner={data:{key:{id:'O1',fromMe:false,remoteJid:OPERATOR+'@s.whatsapp.net'},message:{conversation:'/liberar 556188887777'},pushName:'Kleuber'}};
  sent.length=0;
  assert.equal(await depois.handleWhatsappOperatorCommand(owner,'LEX',opts({store,request})),true);
  assert.match(sent[0].text,/liberado/);
  assert.equal(await depois.whatsappAutomaticAllowed('5561988887777'),true);
});

test('recepção: pedido provável — o LEX não responde ao contato e pede decisão ao advogado',async()=>{
  const integ=freshIntegration();
  await integ.setWhatsappInbound(createWhatsappInbound({records:fakeRecords()}),{operator:OPERATOR});
  const sent=[];const request=async(_,o)=>{sent.push(o.data);return {key:{id:'ok'}};};
  const store={history:async()=>[],upsert:async()=>({classe:'geral',urgente:false}),appendEvent:async()=>{}};
  const body={data:{key:{id:'S2',fromMe:false,remoteJid:'5561977776666@s.whatsapp.net'},message:{conversation:'me deixa em paz'},pushName:'João'}};
  assert.equal(await integ.publicWhatsappReception(body,'LEX',opts({store,request})),true);
  assert.equal(sent.filter(m=>m.number==='5561977776666').length,0,'nada ao contato');
  const aviso=sent.find(m=>m.number===OPERATOR);
  assert.match(aviso.text,/decida você/);assert.match(aviso.text,/AGUARDA SUA DECISÃO/);assert.match(aviso.text,/não respondeu ao contato/);
  assert.equal(await integ.whatsappAutomaticAllowed('5561977776666'),false,'automáticas suspensas até o advogado decidir');
});

test('mensagem comum não é afetada e banco ilegível suspende automáticas na dúvida',async()=>{
  const inbound=createWhatsappInbound({records:{async read(){throw new Error('fora');},async change(){throw new Error('fora');}},log:()=>{}});
  assert.ok(await inbound.optOutStatus('5561955554444'),'banco ilegível: não manda automática');
  const ok=createWhatsappInbound({records:fakeRecords()});
  assert.equal(await ok.optOutStatus('5561955554444'),null);
});

test('servidor: lembretes e avisos automáticos ao cliente passam pela checagem',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8');
  const f=src.indexOf('async function _executarFollowupClientesPendentes(');
  const corpo=src.slice(f,f+4000);
  assert.match(corpo,/const podeLembrar = c\.canal !== 'whatsapp' \|\| await whatsappAutomaticAllowed\(c\.chat_id\);/);
  for(const lembrete of ['lembrete_docs_10d_enviado)','lembrete_48h_enviado','lembrete_24h_enviado'])
    assert.ok(corpo.includes(lembrete+' && podeLembrar'),lembrete);
  for(const envio of ['await envWhatsApp(msgCliente, clienteNum);','await envWhatsApp(msgCliente2, clienteNum);']){
    const i=src.indexOf(envio);
    assert.match(src.slice(i-200,i),/if\(await whatsappAutomaticAllowed\(clienteNum\)\) \{\s*$/,envio+' (a cobrança da equipe continua)');
  }
});

// Revisão de código de 06/10/2026 — falsos positivos que calariam um cliente do escritório.
test('relato de assédio, citação, pensão, gov.br e troca de canal NÃO são pedido de saída',()=>{
  for(const t of ['ele não para de me ligar, quero medida protetiva','meu ex não para de me mandar mensagem',
    'quero que ele pare de me ligar','o juiz mandou ele parar de me ligar','ela não para de mandar mensagem pro meu filho',
    'não quero receber a citação','não quero receber a intimação','não quero receber a pensão em dinheiro','não quero receber o acordo',
    'não quero mais contato com o meu ex','me descadastrei do gov.br','descadastro no INSS','quero descadastrar meu CPF do Bolsa Família',
    'não me liga mais, só por whatsapp','não me manda mais áudio, manda texto','não me envia mais o processo',
    'não me manda mais o link da audiência','não me chama mais de senhora'])
    assert.equal(nivelDeSaida(t),null,t);
});

test('pedidos claros continuam reconhecidos, inclusive em mensagens agrupadas',()=>{
  for(const t of ['por favor pare de me ligar','não quero mais receber','não mande mais','não quero mais contato',
    'quero que vocês parem de me mandar mensagem','não quero mais ser incomodado','me descadastra','PARE | obrigado'])
    assert.equal(nivelDeSaida(t),'inequivoco',t);
  for(const t of ['me deixe em paz','pare com isso','pode parar','pare por favor'])
    assert.equal(nivelDeSaida(t),'provavel',t);
});

test('segundo "PARE" não gera nova confirmação; falha ao gravar avisa o advogado',async()=>{
  const integ=freshIntegration();
  await integ.setWhatsappInbound(createWhatsappInbound({records:fakeRecords()}),{operator:OPERATOR});
  const sent=[];const request=async(_,o)=>{sent.push(o.data);return {key:{id:'ok'}};};
  const store={history:async()=>[],upsert:async()=>({classe:'geral',urgente:false}),appendEvent:async()=>{}};
  const msg=id=>({data:{key:{id,fromMe:false,remoteJid:'5561944443333@s.whatsapp.net'},message:{conversation:'PARE'},pushName:'Ana'}});
  await integ.publicWhatsappReception(msg('P1'),'LEX',opts({store,request}));
  await integ.publicWhatsappReception(msg('P2'),'LEX',opts({store,request}));
  assert.equal(sent.filter(m=>m.number==='5561944443333').length,1,'confirmação uma vez só');

  const quebrado=freshIntegration();
  await quebrado.setWhatsappInbound(createWhatsappInbound({records:{async read(){return null;},async change(){throw new Error('fora');}},log:()=>{}}),{operator:OPERATOR});
  sent.length=0;
  await quebrado.publicWhatsappReception(msg('P3'),'LEX',opts({store,request}));
  assert.ok(sent.some(m=>m.number===OPERATOR&&/NÃO GRAVADO/.test(m.text)));
});

test('/liberar que falha ao gravar mantém o contato bloqueado',async()=>{
  const rows=new Map();let falhar=false;
  const records={rows,async read(k){return rows.has(k)?{value:structuredClone(rows.get(k))}:null;},
    async change(k,fn){if(falhar)throw new Error('fora');const v=await fn(rows.has(k)?structuredClone(rows.get(k)):null);if(v!==undefined)rows.set(k,v);return v;}};
  const inbound=createWhatsappInbound({records,log:()=>{}});
  await inbound.markOptOut('5561933332222',{nivel:'inequivoco'});
  falhar=true;
  await assert.rejects(inbound.clearOptOut('5561933332222'));
  assert.ok(await inbound.optOutStatus('5561933332222'),'continua bloqueado');
});

test('número com sufixo de aparelho cai na mesma chave',()=>{
  const {contactVariants}=require('../lib/whatsapp-inbound');
  assert.deepEqual(contactVariants('5561988887777:12@s.whatsapp.net'),['5561988887777','556188887777']);
});
