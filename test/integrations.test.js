const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {setup,source} = require('./runtime');
const {brazilMobile,requestJson,evolutionEndpoint,whatsappStatus,telegramStatus} = require('../lib/integration-status');
const cfg = {url:'https://evolution.example.test/api',key:'fake',instance:'lex',number:'5511987654321'};
const connected = {instance:{instanceName:'lex',state:'open'}};

test('linha do LEX: normaliza DDD e recusa grupo ou celular invalido', () => {
  assert.equal(brazilMobile('(11) 98765-4321'),'5511987654321');
  assert.equal(brazilMobile('+55 11 98765-4321'),'5511987654321');
  assert.equal(brazilMobile(''),null);
  assert.throws(()=>brazilMobile('5511987654321@g.us'));
  assert.throws(()=>brazilMobile('1234'));
});
test('URL Evolution preserva prefixo e recusa credencial embutida ou HTTP', () => {
  assert.equal(evolutionEndpoint(cfg.url,'instance/connectionState/lex'),'https://evolution.example.test/api/instance/connectionState/lex');
  assert.throws(()=>evolutionEndpoint('http://example.test','x'));
  assert.throws(()=>evolutionEndpoint('https://key@example.test','x'));
});
test('WhatsApp desativado ou incompleto nao faz rede', async () => {
  const noNetwork=()=>{throw new Error('Nao deveria chamar');};
  assert.equal((await whatsappStatus({...cfg,enabled:false},noNetwork)).estado,'desativado');
  assert.equal((await whatsappStatus({...cfg,key:''},noNetwork)).estado,'nao_configurado');
});
test('WhatsApp so conecta apos sessao aberta e ownerJid da linha esperada', async () => {
  const calls=[];
  const result=await whatsappStatus(cfg,async url=>{calls.push(url); return calls.length===1?connected:[{name:'lex',ownerJid:'5511987654321:2@s.whatsapp.net',token:'nao-expor'}];});
  assert.equal(result.conectado,true);
  assert.match(calls[1],/instanceName=lex$/);
  assert.ok(!JSON.stringify(result).includes('nao-expor'));
});
test('WhatsApp recusa conta diferente mesmo com number configurado igual', async () => {
  let n=0;
  const result=await whatsappStatus(cfg,async ()=>++n===1?connected:[{name:'lex',number:cfg.number,ownerJid:'5511912345678@s.whatsapp.net'}]);
  assert.equal(result.estado,'numero_divergente'); assert.equal(result.conectado,false);
});
test('WhatsApp nao confunde string URL, estado connecting ou dono ausente com conexao', async () => {
  assert.equal((await whatsappStatus(cfg,async()=>({instance:{instanceName:'lex',state:'connecting'}}))).conectado,false);
  let n=0;
  assert.equal((await whatsappStatus(cfg,async()=>++n===1?connected:[{name:'lex',number:cfg.number}])).estado,'numero_nao_confirmado');
});
test('WhatsApp exige instancia exata e trata erro sem vazar chave', async () => {
  assert.equal((await whatsappStatus(cfg,async()=>({instance:{instanceName:'outro',state:'open'}}))).estado,'instancia_nao_confirmada');
  const r=await whatsappStatus(cfg,async()=>{throw new Error('token-secreto');});
  assert.equal(r.conectado,false); assert.ok(!JSON.stringify(r).includes('token-secreto'));
});
test('Telegram detecta webhook que impede polling, sem apagar configuracao', async () => {
  const calls=[];
  const result=await telegramStatus({token:'fake',admin:'123'},async url=>{
    calls.push(url);return calls.length===1?{ok:true,result:{is_bot:true}}:{ok:true,result:{url:'https://old.example.test/webhook'}};
  });
  assert.equal(result.estado,'webhook_conflita_com_polling');
  assert.ok(calls.every(url=>!url.includes('deleteWebhook')));
});
test('Telegram distingue API disponivel de mensagem efetivamente enviada', async () => {
  let n=0;
  const result=await telegramStatus({token:'fake',admin:'123'},async()=>++n===1?{ok:true,result:{is_bot:true,username:'lex_test'}}:{ok:true,result:{url:''}});
  assert.equal(result.estado,'api_disponivel'); assert.equal(result.envio_confirmado,false);
  assert.equal((await telegramStatus({token:'fake',admin:'123'},async()=>({ok:false}))).conectado,false);
});
function sender(name,nextName,extra={}) {
  const code=source.slice(source.indexOf('async function '+name+'('),source.indexOf('async function '+nextName+'('));
  const ctx=vm.createContext({console:{warn(){}}, TK:'fake',CHAT_ID:'123',EVO_URL:cfg.url,EVO_KEY:'fake',EVO_INST:'lex',
    LEX_WHATSAPP_NUMBER:null,evolutionEndpoint,...extra});
  vm.runInContext(code,ctx);return ctx[name];
}
test('envTelegram exige confirmacao da API e preserva destino/thread', async () => {
  let sent;
  const send=sender('envTelegram','envTelegramArq',{requestJson:async(url,options)=>{sent=options.data;return {ok:true,result:{message_id:12}};}});
  assert.equal(await send('Teste',9,'456'),true); assert.equal(sent.chat_id,'456'); assert.equal(sent.message_thread_id,9);
  assert.equal(await sender('envTelegram','envTelegramArq',{requestJson:async()=>({ok:false})})('Teste'),false);
  assert.equal(await sender('envTelegram','envTelegramArq',{TK:'',requestJson:()=>{throw new Error('rede');}})('Teste'),false);
});
test('envWhatsApp exige ID do provedor e recusa envio com sessao divergente', async () => {
  assert.equal(await sender('envWhatsApp','envWhatsAppArq',{requestJson:async()=>({key:{id:'msg-test'}})})('Teste','destino'),true);
  assert.equal(await sender('envWhatsApp','envWhatsAppArq',{requestJson:async()=>({error:'falha'})})('Teste','destino'),false);
  let sent=false;
  const send=sender('envWhatsApp','envWhatsAppArq',{LEX_WHATSAPP_NUMBER:cfg.number,_inicializarConexaoWhatsApp:async()=>false,requestJson:async()=>{sent=true;}});
  assert.equal(await send('Teste','destino'),false);assert.equal(sent,false);
});
for(const canal of ['telegram','whatsapp']) {
  test('central '+canal+': envio recusado nao e registrado como sucesso',async()=>{
    let registered=false;
    const app=setup({envTelegram:async()=>false,envWhatsApp:async()=>false,_registrarMsgCentral:()=>{registered=true;}});
    const result=await app.request('/api/mensagens/enviar',app.token('admin'),{canal,destino:'123',texto:'teste'},'POST');
    assert.equal(result.status,502); assert.equal(registered,false); assert.equal(JSON.parse(result.body).enviado,false);
  });
}
test('notificacao Telegram responde falha quando o provedor nao confirmou',async()=>{
  const app=setup({TK:'fake',CHAT_ID:'123',envTelegram:async()=>false});
  assert.equal((await app.request('/api/notificar-telegram',app.token('admin'),{mensagem:'teste'},'POST')).status,502);
});
test('status dos canais exige sessao e diagnostico exige administrador',async()=>{
  const app=setup();
  assert.equal((await app.request('/api/whatsapp/status')).status,401);
  assert.equal((await app.request('/api/whatsapp/mensagem',null,{},'POST')).status,401);
  assert.equal((await app.request('/api/integracoes/status')).status,401);
  assert.equal((await app.request('/api/integracoes/status',app.token('secretaria'))).status,403);
  assert.equal((await app.request('/api/whatsapp/configurar',app.token('secretaria'),{},'POST')).status,403);
});
test('falha na gravacao da configuracao WhatsApp preserva estado anterior',async()=>{
  const runtime={whatsapp:{ativo:false,numero:null}};
  const app=setup({_configRuntime:runtime,_configMemCache:{},LEX_WHATSAPP_NUMBER:null,brazilMobile,_normalizarNumeroWhats:n=>n+'@s.whatsapp.net',
    _configTabela:()=> 'configuracoes',sbUpsert:async()=>({ok:false,status:403})});
  const result=await app.request('/api/whatsapp/configurar',app.token('admin'),{numero:cfg.number,ativo:true},'POST');
  assert.equal(result.status,500);assert.equal(runtime.whatsapp.ativo,false);assert.equal(runtime.whatsapp.numero,null);
});
test('configuracao WhatsApp nao pode trocar linha fixada no servidor',async()=>{
  const app=setup({LEX_WHATSAPP_NUMBER:cfg.number,brazilMobile});
  assert.equal((await app.request('/api/whatsapp/configurar',app.token('admin'),{numero:'5511912345678'},'POST')).status,409);
});
test('HTTP das integracoes trata resposta 401 sem expor corpo e encerra timeout',async()=>{
  const req=new EventEmitter();req.write=()=>{};req.end=()=>{};req.setTimeout=()=>{};
  const transport={request(url,options,callback){queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=401;callback(res);res.emit('data','{"secret":"nao-mostrar"}');res.emit('end');});return req;}};
  await assert.rejects(requestJson('https://example.test',{transport}),/HTTP 401/);
  let destroyed=false;
  req.setTimeout=(ms,cb)=>queueMicrotask(cb);req.destroy=()=>{destroyed=true;};
  await assert.rejects(requestJson('https://example.test',{transport:{request:()=>req}}),/excedido/);
  assert.equal(destroyed,true);
});
