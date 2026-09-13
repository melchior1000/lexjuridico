const {test}=require('node:test');
const assert=require('node:assert/strict');
const {publicWhatsappReception,handleWhatsappOperatorCommand}=require('../lib/integration-status');

function resetInbox(){ global._whatsappPublicInbox=[]; }
const cfg={operator:'5561999171717',url:'https://evo.example.test',key:'fake'};

test('recepcao publica cria fila e marca urgencia',async()=>{
  resetInbox();
  const calls=[];
  const request=async(url,opts)=>{calls.push(opts.data);return {key:{id:'ok'}};};
  const body={data:{pushName:'Contato Urgente',key:{id:'u1',fromMe:false,remoteJid:'5561987777777@s.whatsapp.net'},message:{conversation:'Tenho audiência amanhã, é urgente'}}};
  await publicWhatsappReception(body,'LEX-JURIDICO',{...cfg,request});
  assert.equal(global._whatsappPublicInbox.length,1);
  assert.equal(global._whatsappPublicInbox[0].status,'aguardando_advogado');
  assert.equal(global._whatsappPublicInbox[0].urgent,true);
  assert.match(calls[0].text,/URGENTE/);
});

test('operador lista recepcao e responde contato',async()=>{
  resetInbox();
  const calls=[];
  const request=async(url,opts)=>{calls.push(opts.data);return {key:{id:'ok-'+calls.length}};};
  const publicBody={data:{pushName:'Maria',key:{id:'m2',fromMe:false,remoteJid:'5561986666666@s.whatsapp.net'},message:{conversation:'Boa tarde, queria falar com o responsável'}}};
  await publicWhatsappReception(publicBody,'LEX-JURIDICO',{...cfg,request});
  calls.length=0;
  const listBody={data:{key:{id:'op1',fromMe:false,remoteJid:'5561999171717@s.whatsapp.net'},message:{conversation:'/recepcao'}}};
  assert.equal(await handleWhatsappOperatorCommand(listBody,'LEX-JURIDICO',{...cfg,request}),true);
  assert.equal(calls[0].number,'5561999171717');
  assert.match(calls[0].text,/Maria/);
  calls.length=0;
  const replyBody={data:{key:{id:'op2',fromMe:false,remoteJid:'5561999171717@s.whatsapp.net'},message:{conversation:'/responder 5561986666666 Recebi seu recado. Retorno em breve.'}}};
  assert.equal(await handleWhatsappOperatorCommand(replyBody,'LEX-JURIDICO',{...cfg,request}),true);
  assert.equal(calls[0].number,'5561986666666');
  assert.equal(calls[0].text,'Recebi seu recado. Retorno em breve.');
});

test('operador arquiva contato da fila',async()=>{
  resetInbox();
  const request=async()=>({key:{id:'ok'}});
  const publicBody={data:{pushName:'Fornecedor',key:{id:'m3',fromMe:false,remoteJid:'5561985555555@s.whatsapp.net'},message:{conversation:'Cobrança de fatura'}}};
  await publicWhatsappReception(publicBody,'LEX-JURIDICO',{...cfg,request});
  const archiveBody={data:{key:{id:'op3',fromMe:false,remoteJid:'5561999171717@s.whatsapp.net'},message:{conversation:'/arquivar 5561985555555'}}};
  assert.equal(await handleWhatsappOperatorCommand(archiveBody,'LEX-JURIDICO',{...cfg,request}),true);
  assert.equal(global._whatsappPublicInbox[0].status,'arquivado');
});
