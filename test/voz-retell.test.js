'use strict';
// Plataforma de voz (Retell): pedido da ligação e conferência da assinatura do aviso de fim.
// Contrato conferido na documentação oficial (21/11/2026):
// - POST https://api.retellai.com/v2/create-phone-call, Authorization: Bearer <chave>;
// - aviso assinado em X-Retell-Signature: "v=<ms>,d=<hex>", HMAC-SHA256(corpo cru + ms, chave),
//   recusado fora de 5 minutos.
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createRetellProvider}=require('../lib/voz-retell');

const ENV={RETELL_API_KEY:'key_teste',RETELL_AGENT_ID:'agent_1',LEX_VOZ_NUMERO:'+5561933334444'};
const assinar=(corpo,ms,chave='key_teste')=>'v='+ms+',d='+crypto.createHmac('sha256',chave).update(corpo+ms).digest('hex');

test('sem chave, agente ou número da plataforma, as ligações ficam desligadas',()=>{
  assert.equal(createRetellProvider({env:{}}).configurado(),false);
  assert.equal(createRetellProvider({env:{...ENV,RETELL_AGENT_ID:''}}).configurado(),false);
  assert.equal(createRetellProvider({env:{...ENV,LEX_VOZ_NUMERO:'61 3333-4444'}}).configurado(),false,'número de origem precisa estar no formato +55...');
  assert.equal(createRetellProvider({env:ENV}).configurado(),true);
});

test('pedido da ligação: número de origem, agente, metadados, variáveis e chave idempotente',async()=>{
  const pedidos=[];
  const fetchImpl=async(url,opts)=>{pedidos.push({url,opts});return{status:201,ok:true,text:async()=>JSON.stringify({call_id:'call_9',call_status:'registered'})}};
  const P=createRetellProvider({env:ENV,fetchImpl});
  const r=await P.criarLigacao({para:'+5561988887777',metadata:{ligacao_id:'L1',processo_id:'p1'},variaveis:{abertura:'Olá',instrucoes:'Lembrar a perícia'},chave:'L1'});
  assert.deepEqual(r,{ok:true,call_id:'call_9',status:'registered'});
  assert.equal(pedidos[0].url,'https://api.retellai.com/v2/create-phone-call');
  assert.equal(pedidos[0].opts.method,'POST');
  assert.equal(pedidos[0].opts.headers.Authorization,'Bearer key_teste');
  const corpo=JSON.parse(pedidos[0].opts.body);
  assert.deepEqual(corpo,{from_number:'+5561933334444',to_number:'+5561988887777',override_agent_id:'agent_1',
    metadata:{ligacao_id:'L1',processo_id:'p1'},retell_llm_dynamic_variables:{abertura:'Olá',instrucoes:'Lembrar a perícia'},idempotency_key:'L1'});
});

test('recusa da plataforma vira erro legível, sem vazar a chave',async()=>{
  const fetchImpl=async()=>({status:402,ok:false,text:async()=>JSON.stringify({error_message:'Insufficient balance'})});
  const r=await createRetellProvider({env:ENV,fetchImpl}).criarLigacao({para:'+5561988887777',metadata:{},variaveis:{},chave:'L2'});
  assert.equal(r.ok,false);assert.equal(r.http,402);
  assert.match(r.erro,/saldo|crédito/i);assert.doesNotMatch(r.erro,/key_teste/);
  const caiu=await createRetellProvider({env:ENV,fetchImpl:async()=>{throw new Error('ECONNRESET')}}).criarLigacao({para:'+5561988887777',metadata:{},variaveis:{},chave:'L3'});
  assert.equal(caiu.ok,false);assert.equal(caiu.incerto,true,'queda de rede: a ligação pode ter saído; não repetir às cegas');
});

test('sem configuração, nada é pedido à plataforma',async()=>{
  let chamou=false;
  const r=await createRetellProvider({env:{},fetchImpl:async()=>{chamou=true}}).criarLigacao({para:'+5561988887777',metadata:{},variaveis:{},chave:'L4'});
  assert.equal(r.ok,false);assert.equal(chamou,false);
});

test('assinatura do aviso: aceita a verdadeira; recusa corpo trocado, chave errada, hora velha e cabeçalho torto',()=>{
  const agora=Date.parse('2026-11-21T20:00:00Z');
  const P=createRetellProvider({env:ENV,now:()=>agora});
  const corpo='{"event":"call_ended","call":{"call_id":"call_9"}}';
  assert.equal(P.verificarAssinatura(corpo,assinar(corpo,agora)),true);
  assert.equal(P.verificarAssinatura(corpo+' ',assinar(corpo,agora)),false,'corpo alterado');
  assert.equal(P.verificarAssinatura(corpo,assinar(corpo,agora,'outra')),false,'chave errada');
  assert.equal(P.verificarAssinatura(corpo,assinar(corpo,agora-6*60*1000)),false,'mais de 5 minutos');
  assert.equal(P.verificarAssinatura(corpo,assinar(corpo,agora+6*60*1000)),false,'do futuro');
  assert.equal(P.verificarAssinatura(corpo,''),false);
  assert.equal(P.verificarAssinatura(corpo,'v=abc,d=00'),false);
  assert.equal(P.verificarAssinatura(corpo,undefined),false);
  // Chave própria do aviso, quando a conta usa outra chave para o aviso (selo "webhook").
  const P2=createRetellProvider({env:{...ENV,RETELL_WEBHOOK_KEY:'key_webhook'},now:()=>agora});
  assert.equal(P2.verificarAssinatura(corpo,assinar(corpo,agora,'key_webhook')),true);
  assert.equal(P2.verificarAssinatura(corpo,assinar(corpo,agora)),false);
  // Sem chave nenhuma, ninguém passa.
  assert.equal(createRetellProvider({env:{},now:()=>agora}).verificarAssinatura(corpo,assinar(corpo,agora,'')),false);
});

test('aviso de fim vira um formato só do LEX',()=>{
  const P=createRetellProvider({env:ENV});
  const fim=P.interpretarEvento({event:'call_ended',call:{call_id:'call_9',call_status:'ended',metadata:{ligacao_id:'L1'},
    start_timestamp:1000,end_timestamp:126000,disconnection_reason:'user_hangup',transcript:'Agent: Olá\nUser: Oi',recording_url:'https://x/rec.wav'}});
  assert.deepEqual(fim,{evento:'encerrada',call_id:'call_9',ligacao_id:'L1',status:'ended',duracao_s:125,motivo:'user_hangup',
    atendeu:true,caixa_postal:false,transcricao:'Agent: Olá\nUser: Oi',gravacao_url:'https://x/rec.wav',resumo_provedor:null});
  const naoAtendeu=P.interpretarEvento({event:'call_ended',call:{call_id:'c2',call_status:'not_connected',metadata:{ligacao_id:'L2'},disconnection_reason:'dial_no_answer'}});
  assert.equal(naoAtendeu.atendeu,false);assert.equal(naoAtendeu.duracao_s,0);
  const analise=P.interpretarEvento({event:'call_analyzed',call:{call_id:'call_9',metadata:{ligacao_id:'L1'},call_analysis:{call_summary:'Cliente confirmou',in_voicemail:true}}});
  assert.equal(analise.evento,'analisada');assert.equal(analise.resumo_provedor,'Cliente confirmou');assert.equal(analise.caixa_postal,true);
  assert.equal(P.interpretarEvento({event:'call_started',call:{call_id:'c'}}).evento,'iniciada');
  assert.equal(P.interpretarEvento({nada:1}),null);
});

test('configuração única do agente: roteiro vem do LEX, português do Brasil, aviso no /api/voz/aviso',async()=>{
  const {configurar,vozesEmPortugues}=require('../scripts/configurar-voz');
  const pedidos=[];
  const fetchImpl=async(url,opts)=>{pedidos.push({url,opts});
    const corpo=url.endsWith('/create-retell-llm')?{llm_id:'llm_1'}:url.endsWith('/create-agent')?{agent_id:'agent_9'}:[{voice_id:'v1',voice_name:'Camila',accent:'Brazilian Portuguese',gender:'female'},{voice_id:'v2',voice_name:'John',accent:'American',gender:'male'}];
    return{status:201,text:async()=>JSON.stringify(corpo)}};
  const saida=[];
  const lista=await configurar({env:{RETELL_API_KEY:'k',LEX_SERVIDOR_URL:'https://lex.exemplo'},fetchImpl,saida:t=>saida.push(t)});
  assert.equal(lista.ok,false);assert.deepEqual(lista.vozes.map(v=>v.voice_id),['v1'],'sem voz escolhida, só lista as de português');
  assert.equal(pedidos.length,1);
  pedidos.length=0;
  const r=await configurar({env:{RETELL_API_KEY:'k',LEX_SERVIDOR_URL:'https://lex.exemplo/',LEX_VOZ_VOICE_ID:'v1',ESCRITORIO_NOME:'Camargos Advocacia'},fetchImpl,saida:t=>saida.push(t)});
  assert.equal(r.agent_id,'agent_9');
  const llm=JSON.parse(pedidos[0].opts.body),ag=JSON.parse(pedidos[1].opts.body);
  assert.equal(llm.general_prompt,'{{instrucoes}}');assert.equal(llm.begin_message,'{{abertura}}');assert.equal(llm.start_speaker,'agent');
  assert.match(llm.default_dynamic_variables.abertura,/assistente virtual/);
  assert.equal(ag.language,'pt-BR');assert.equal(ag.webhook_url,'https://lex.exemplo/api/voz/aviso');assert.equal(ag.response_engine.llm_id,'llm_1');
  assert.doesNotMatch(ag.voicemail_option.action.text,/processo|audiência|perícia/i,'caixa postal sem detalhe do caso');
  assert.ok(saida.some(t=>/RETELL_AGENT_ID=agent_9/.test(t)));
  await assert.rejects(configurar({env:{LEX_SERVIDOR_URL:'https://x'},fetchImpl}),/RETELL_API_KEY/);
  await assert.rejects(configurar({env:{RETELL_API_KEY:'k',LEX_SERVIDOR_URL:'http://x'},fetchImpl}),/https/);
  assert.deepEqual(vozesEmPortugues(null),[]);
});
