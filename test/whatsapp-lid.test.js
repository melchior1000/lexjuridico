'use strict';
// Identidade do escritório-piloto usada nestes cenários (white-label via ambiente).
Object.assign(process.env,{ESCRITORIO_NOME:'LEX Jurídico',ESCRITORIO_RESP:'Kleuber',LEX_TITULAR_TRATAMENTO:'Dr.'});
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
  assert.match(sent[0].text,/LEX Jurídico/i);
});

test('mesa do dono responde pelo mesmo LID recebido',async()=>{
  const sent=[];
  const request=async(_,opts)=>{sent.push(opts.data);return {key:{id:'sent'}};};
  const store={list:async()=>[]};
  const body=lidBody('/recepcao',{lid:'887766554433@lid',phone:'556199171717@s.whatsapp.net',name:'Kleuber'});
  const handled=await handleWhatsappOperatorCommand(body,'LEX',{...cfg,store,request});
  assert.equal(handled,true);
  assert.equal(sent[0].number,'887766554433@lid');
  assert.match(sent[0].text,/Recepção:/);
});

// 27/09/2026: as mensagens do próprio titular ("Oi testando Lex") caíram na fila de clientes.
// A porta do webhook reconhecia o titular pelo remoteJidAlt, mas adapterEvolution e
// processarMensagem conferiam de novo só pelo LID e o rebaixavam a "público".
test('titular em LID: reconhecido pelo telefone alternativo e, depois, pelo mesmo LID confirmado',()=>{
  const {isWhatsappOperator}=require('../lib/integration-status');
  const op='5561999171717';
  assert.equal(isWhatsappOperator('445566778899@lid',op,'556199171717@s.whatsapp.net'),true);
  assert.equal(isWhatsappOperator('445566778899@lid',op),true,'mesmo LID, já confirmado pelo telefone, sem o campo alternativo');
  assert.equal(isWhatsappOperator('445566778899@lid',''),false,'sem titular configurado ninguém é titular');
});

test('LID desconhecido ou de cliente nunca vira titular',()=>{
  const {isWhatsappOperator}=require('../lib/integration-status');
  const op='5561999171717';
  assert.equal(isWhatsappOperator('111222333444@lid',op),false,'LID nunca confirmado');
  assert.equal(isWhatsappOperator('111222333444@lid',op,'5561988888888@s.whatsapp.net'),false,'LID de cliente');
  assert.equal(isWhatsappOperator('111222333444@lid',op),false,'cliente continua cliente');
  assert.equal(isWhatsappOperator('5561988888888@s.whatsapp.net',op),false);
  assert.equal(isWhatsappOperator('556199171717@s.whatsapp.net',op),true,'número direto continua valendo');
});

test('bot.js confere o titular com o telefone alternativo em todas as portas do WhatsApp',()=>{
  const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','bot.js'),'utf8');
  const a=src.indexOf('async function adapterEvolution(body)');
  const corpo=src.slice(a,a+1500);
  assert.match(corpo,/numeroAlt:\s*data\.key\?\.remoteJidAlt\s*\|\|\s*''/,'contexto guarda o telefone alternativo');
  assert.match(corpo,/isWhatsappOperator\(chatIdWpp,process\.env\.LEX_OPERATOR_WHATSAPP,data\.key\?\.remoteJidAlt\)/);
  const p=src.indexOf('async function processarMensagem(ctx, dados)');
  assert.match(src.slice(p,p+300),/isWhatsappOperator\(ctx\.numero\|\|ctx\.chatId,process\.env\.LEX_OPERATOR_WHATSAPP,ctx\.numeroAlt\)/);
  const c=src.indexOf('async function _cadastradorRecebeu(');
  assert.match(src.slice(c,c+300),/isWhatsappOperator\(ctx\.numero\|\|ctx\.chatId,process\.env\.LEX_OPERATOR_WHATSAPP,ctx\.numeroAlt\)/);
  const g=src.indexOf('function getModoAgente(chatId)');
  assert.match(src.slice(g,g+200),/isWhatsappOperator\(String\(chatId\),process\.env\.LEX_OPERATOR_WHATSAPP\)/);
  const o=src.indexOf('function _isOperadorWhatsApp(numeroPlano, jid, alt)');
  assert.ok(o>=0,'perfil do titular também olha o identificador original');
  assert.match(src.slice(o,o+300),/isWhatsappOperator\(jid\|\|/);
  assert.match(src,/_isOperadorWhatsApp\(_numeroPlanoWhats\(ctx\.numero\|\|chatId\),ctx\.numero\|\|chatId,ctx\.numeroAlt\)/);
  assert.doesNotMatch(src,/whatsappAccessMode\(/,'nenhuma porta do bot confere o titular sem o LID confirmado');
});
