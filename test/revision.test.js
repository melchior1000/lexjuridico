const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const JSZip = require('jszip');
const {setup, source} = require('./runtime');
const {modelsFor,legalModelFor} = require('../lib/ai-runtime');
const {requestJson, evolutionEndpoint, webhookAuthStatus} = require('../lib/integration-status');

function load(start, end, extra = {}) {
  const begin = source.indexOf(start);
  const finish = source.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, 'Trecho real do backend deve existir');
  const context = vm.createContext({Buffer, console:{log(){},warn(){},error(){}}, ...extra});
  vm.runInContext(source.slice(begin, finish), context);
  return context;
}

test('Anthropic mantém o modelo TOP em todos os agentes, inclusive com tiers antigos no ambiente', () => {
  const models = modelsFor('anthropic', {LEX_ANTHROPIC_MODEL_MID:'claude-sonnet-4-6',LEX_ANTHROPIC_MODEL_ECO:'claude-haiku-4-5-20251001'});
  assert.deepEqual(models, {top:'claude-opus-5',mid:'claude-opus-5',eco:'claude-opus-5'});
  assert.equal(legalModelFor({}), 'claude-fable-5-1');
});

function scheduler(now, extra = {}) {
  const timers = [];
  const context = load('async function enviarAlertas()', 'setInterval(_executarFollowupClientesPendentes', {
    HORARIOS_NORMAIS:[8,12,17],HORA_LIMITE:18,horaBrasilia:()=>new Date(now),
    getPrazos:()=>[], getProcPrep:()=>[], envTelegram:async()=>true,
    setTimeout:(fn,delay)=>timers.push({fn,delay}), ...extra
  });
  timers.length = 0;
  return {context,timers};
}
test('alerta às 17h exatas agenda 8h do dia seguinte sem repetir a hora atual', () => {
  const {context,timers} = scheduler('2026-09-08T17:00:00');
  context.agendarProximoAlerta();
  assert.equal(timers.length,1);
  assert.equal(timers[0].delay,15*60*60*1000);
});
test('alerta noturno usa a data de Brasília, mesmo quando UTC já está no dia seguinte', () => {
  const {context,timers} = scheduler('2031-12-31T23:30:00');
  context.agendarProximoAlerta();
  assert.equal(timers[0].delay,8.5*60*60*1000);
});
test('recusa de envio não interrompe a programação do próximo alerta', async () => {
  const {context,timers} = scheduler('2026-09-08T09:00:00',{
    getPrazos:max=>max===5?[{dias:1,nome:'Caso de teste',prazo:'09/09/2026'}]:[],
    envTelegram:async()=>false
  });
  context.agendarProximoAlerta();
  await assert.doesNotReject(timers[0].fn());
  assert.equal(timers.length,2);
});

test('arquivo Telegram só confirma sucesso com ok e identificador da mensagem', async () => {
  let result = {ok:true,result:{message_id:42}};
  let payload;
  const context = load('async function envTelegramArq(', 'async function baixarTelegram(', {
    TK:'fake',CHAT_ID:'123',requestJson:async (url,options)=>{payload=options;return result;}
  });
  assert.equal(await context.envTelegramArq(Buffer.from('documento'),'peca.docx',7,'456'),true);
  assert.ok(Buffer.isBuffer(payload.rawBody));
  assert.match(payload.rawBody.toString(),/filename="peca.docx"/);
  assert.match(payload.rawBody.toString(),/\r\n456\r\n/);
  result={ok:false};
  assert.equal(await context.envTelegramArq(Buffer.from('documento'),'peca.docx'),false);
  context.requestJson=async()=>{throw new Error('simulado');};
  assert.equal(await context.envTelegramArq(Buffer.from('documento'),'peca.docx'),false);
});
test('transporte de arquivo preserva bytes e MIME multipart', async () => {
  let sent, headers;
  const rawBody=Buffer.from([0,1,2,255]);
  const transport={request:(url,options,callback)=>{
    headers=options.headers;
    const req=new EventEmitter();
    req.setTimeout=()=>{}; req.write=body=>{sent=body;}; req.destroy=()=>{};
    req.end=()=>{const res=new EventEmitter();res.statusCode=200;callback(res);res.emit('data',Buffer.from('{"ok":true}'));res.emit('end');};
    return req;
  }};
  await requestJson('https://example.test/file',{method:'POST',rawBody,headers:{'Content-Type':'multipart/form-data; boundary=TEST'},transport});
  assert.deepEqual(sent,rawBody);
  assert.equal(headers['Content-Length'],4);
  assert.equal(headers['Content-Type'],'multipart/form-data; boundary=TEST');
});
test('arquivo WhatsApp valida sessão, preserva prefixo da URL e exige ID', async () => {
  let calls=0,url,reply={error:'recusado'};
  const context=load('async function envWhatsAppArq(', '// ── ABSTRAÇÃO DE CANAL', {
    EVO_URL:'https://example.test/api',EVO_KEY:'fake',EVO_INST:'lex',LEX_WHATSAPP_NUMBER:'5511987654321',
    evolutionEndpoint,_inicializarConexaoWhatsApp:async()=>true,
    requestJson:async address=>{calls++;url=address;return reply;}
  });
  assert.equal(await context.envWhatsAppArq(Buffer.from('x'),'peca.docx','123'),false);
  reply={key:{id:'msg-test'}};
  assert.equal(await context.envWhatsAppArq(Buffer.from('x'),'peca.docx','123'),true);
  assert.equal(url,'https://example.test/api/message/sendMedia/lex');
  context._inicializarConexaoWhatsApp=async()=>false;
  assert.equal(await context.envWhatsAppArq(Buffer.from('x'),'peca.docx','123'),false);
  assert.equal(calls,2);
});
test('resposta pelo canal não registra envio na central quando a API recusa', async () => {
  let registered=0;
  const context=load('async function env(texto, ctx)', '// ════════════════════════════════════════════════════════════════════════════', {
    envTelegram:async()=>false,envWhatsApp:async()=>false,_registrarMsgCentral:()=>{registered++;}
  });
  assert.equal(await context.env('teste',{canal:'telegram'}),false);
  assert.equal(await context.env('teste',{canal:'whatsapp',numero:'123'}),false);
  assert.equal(registered,0);
  context.envTelegram=async()=>true;
  assert.equal(await context.env('teste',{canal:'telegram'}),true);
  assert.equal(registered,1);
});
test('persistência de Telegram distingue tentativa recusada de envio confirmado', async () => {
  const directions=[];
  const context=load('const _envTelegramOriginal = envTelegram;', '// Flush da fila',{
    CHAT_ID:'123',envTelegram:async()=>false,_salvarMensagemChat:async (canal,direction)=>{directions.push(direction);}
  });
  assert.equal(await context.envTelegram('teste'),false);
  assert.deepEqual(directions,['falha_envio']);
});

test('fila migra para o resumo persistente e não envia diretamente itens individuais',async()=>{
  const queued=[];let flushes=0;
  const shared={_filaNotificacoes:[{msg:'primeira'},{msg:'segunda'}]};
  const context=load('let _flushNotificacoesEmCurso = false;', 'server.listen(',{
    global:shared,_dentroHorarioNotificacao:()=>true,setInterval:()=>{},CHAT_ID:'123',processos:[],
    notificationDigest:{enqueue:async (...args)=>queued.push(args),flush:async()=>{flushes++;return {enviado:true};}},
    _getSecretariaChatId:()=>''
  });
  await context._flushNotificacoes();
  assert.equal(shared._filaNotificacoes.length,0);assert.equal(queued.length,2);assert.equal(flushes,1);
});

test('secretário Anthropic ignora modelo legado e usa o TOP configurado',async()=>{
  let model;
  const context=load('async function _chamarAnthropicSecretario(', 'async function _escalarParaAdvogado(',{
    AK:'fake',MODELOS_POR_PROVIDER:{anthropic:{top:'claude-opus-5'}},
    httpsPost:async(host,path,payload)=>{model=payload.model;return {content:[{type:'text',text:'Resposta teste'}]};}
  });
  await context._chamarAnthropicSecretario([],null,'claude-sonnet-4-6');
  assert.equal(model,'claude-opus-5');
});

for(const route of ['/api/webhook-whatsapp','/api/whatsapp/webhook']) {
  test(route+': sem segredo ou com credencial inválida, recusa antes de ler corpo',async()=>{
    let read=false;
    const app=setup({_configRuntime:{whatsapp:{}},WHATSAPP_WEBHOOK_SECRET:'',webhookAuthStatus,
      lerBody:async()=>{read=true;throw new Error('Corpo não deve ser consumido');}});
    assert.equal((await app.request(route,null,{},'POST')).status,503);
    app.context.WHATSAPP_WEBHOOK_SECRET='segredo-de-teste';
    assert.equal((await app.request(route,null,{},'POST',{'x-webhook-secret':'errado'})).status,401);
    assert.equal(read,false);
  });
}
test('webhook legado aceita o segredo configurado e delega uma mensagem autenticada',async()=>{
  let calls=0;
  const app=setup({_configRuntime:{whatsapp:{}},WHATSAPP_WEBHOOK_SECRET:'segredo-de-teste',webhookAuthStatus,
    adapterEvolution:async()=>{calls++;}});
  const response=await app.request('/api/webhook-whatsapp',null,{event:'messages.upsert'},'POST',{'x-webhook-secret':'segredo-de-teste'});
  assert.equal(response.status,200);
  assert.equal(calls,1);
});

test('redação pelo canal produz DOCX válido e só confirma após aceitação do arquivo',async()=>{
  const docs=setup({JSZip});
  let accepted=true,file;
  const messages=[];
  const context=load('async function gerarEEnviar(', '// ════════════════════════════════════════════════════════════════════════════',{
    gerarDoc:async()=>'Texto da petição de teste.',env:async text=>{messages.push(text);return true;},
    _gerarDocxBufferPeca:docs.context._gerarDocxBufferPeca,
    envArq:async(buffer,name,ctx,mime)=>{file={buffer,name,mime};return accepted;}
  });
  const args=['Petição',null,'',{},false,{}, {canal:'telegram'}];
  assert.equal(await context.gerarEEnviar(...args),'Texto da petição de teste.');
  assert.match(file.name,/\.docx$/);
  assert.equal(file.mime,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const zip=await JSZip.loadAsync(file.buffer,{checkCRC32:true});
  assert.match(await zip.file('word/document.xml').async('string'),/petição de teste/);
  accepted=false; messages.length=0;
  assert.equal(await context.gerarEEnviar(...args),null);
  assert.ok(messages.every(text=>!text.startsWith('✅')));
});

function motor(extra={}) {
  return load('let _motorUltimaExecucao = 0;', '// Agendar motor proativo',{
    horaBrasilia:()=>new Date('2026-09-08T06:00:00'),processos:[],...extra
  });
}
test('checagem noturna não bloqueia a primeira execução do motor pela manhã',async()=>{
  const context=motor();
  await context._motorProativoLex();
  assert.equal(vm.runInContext('_motorUltimaExecucao',context),0);
  context.horaBrasilia=()=>new Date('2026-09-08T08:00:00');
  await context._motorProativoLex();
  assert.ok(vm.runInContext('_motorUltimaExecucao',context)>0);
});
test('andamento atualizado hoje não oculta um prazo ainda pendente',async()=>{
  let report='';
  const context=motor({horaBrasilia:()=>new Date('2026-09-08T08:00:00'),
    processos:[{id:'teste',nome:'Caso de teste',status:'ATIVO',prazo:'2026-09-08',dias_parado:0}],
    _diasSemAtualizacao:()=>0,CHAT_ID:'123',envTelegramAgendado:async text=>{report=text;return true;},
    _sseNotificar:()=>{},_bumpProcessos:()=>{}
  });
  await context._motorProativoLex();
  assert.match(report,/PRAZO em HOJE/);
});
