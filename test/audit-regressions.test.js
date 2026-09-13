'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {createRequire}=require('node:module');
const {setup,source}=require('./runtime');
const {parseDate,inspectIncoming,applyInspection}=require('../lib/process-intake');
const {officeRoutes}=require('../lib/office-routes');
const {webhookAuthStatus}=require('../lib/integration-status');

test('analisador real envia imagens e PDF como conteúdo visual e DOCX como texto',async()=>{
  let sent;
  const ctx=vm.createContext({Buffer,console,require:createRequire(path.join(__dirname,'../bot.js')),
    MODELO_TOP:'test',_extrairTextoDocxBasico:()=> 'texto extraído',ia:async messages=>{sent=messages[0].content;return '{}';}});
  vm.runInContext(source.slice(source.indexOf('async function analisarDoc('),source.indexOf('// FIX-PDF-GIGANTE')),ctx);
  const bytes=Buffer.from([0,255,137,80,78,71]);
  for(const [name,pdf,type,mime] of [['foto.PNG',false,'image','image/png'],['foto.jpeg',false,'image','image/jpeg'],['foto.webp',false,'image','image/webp'],['foto.gif',false,'image','image/gif'],['autos.pdf',true,'document','application/pdf']]){
    await ctx.analisarDoc(bytes,pdf,name);
    assert.equal(sent[0].type,type);assert.equal(sent[0].source.media_type,mime);
    assert.deepEqual(Buffer.from(sent[0].source.data,'base64'),bytes);
    assert.match(sent[1].text,/ilegível/);
  }
  await ctx.analisarDoc(bytes,false,'autos.docx');assert.match(sent[0].text,/texto extraído/);
});

test('datas impossíveis são rejeitadas e comparação respeita fuso ISO',()=>{
  for(const value of ['31/02/2026','2026-02-29','10/09/2026 24:00','2026-13-01','2026-09-10lixo','2026-09-10T12:00:00+25:00'])assert.equal(parseDate(value),null,value);
  assert.equal(parseDate('2024-02-29').toISOString(),'2024-02-29T00:00:00.000Z');
  assert.equal(parseDate('2026-09-10T21:30:10.123-03:00').toISOString(),'2026-09-11T00:30:10.123Z');
});

const proc={id:1,nome:'Caso A',numero:'0000001-00.2026.8.13.0001',andamentos:[]};
const incoming={processo_id:1,base64:Buffer.from('documento').toString('base64'),nome:'autos.pdf',evento_data:'10/09/2026',evento_texto:'Nova intimação'};
test('documento com número divergente ou ID inexistente não muda de processo silenciosamente',()=>{
  assert.throws(()=>inspectIncoming({...incoming,numero_processo:'0000002-00.2026.8.13.0001'},[proc]),/diverge/);
  assert.throws(()=>inspectIncoming({...incoming,processo_id:999,numero_processo:proc.numero},[proc]),/não existe/);
  assert.equal(inspectIncoming({...incoming,evento_data:'31/02/2026'},[proc]).novo_andamento,false);
});

test('entrada processual chega ao módulo pelo handler HTTP real',async()=>{
  const app=setup({officeRoutes,recordStore:{},processStore:{read:async()=>({processes:[proc]}),mutate:async fn=>({value:fn([structuredClone(proc)]),version:2})},
    taskEngine:{},aiAvailable:()=>false});
  const denied=await app.request('/api/entrada-processual',null,incoming,'POST');
  assert.equal(denied.status,401);
  const response=await app.request('/api/entrada-processual',app.token('admin'),incoming,'POST');
  assert.equal(response.status,200);assert.equal(JSON.parse(response.body).processo.andamentos.length,1);
});

test('entrada revalida duplicidade dentro da gravação após leitura concorrente',async()=>{
  const updated=applyInspection(proc,inspectIncoming(incoming,[proc]));
  let status,body;
  await officeRoutes({url:'/api/entrada-processual',method:'POST'},{writeHead:s=>{status=s;},end:b=>{body=JSON.parse(b);}},{headers:{},authenticate:()=> 'admin',body:async()=>incoming,
    processStore:{read:async()=>({processes:[proc]}),mutate:async fn=>({value:fn([updated]),version:2})}});
  assert.equal(status,200);assert.equal(body.processo.andamentos.length,1);assert.equal(body.resultado.novo_andamento,false);
});

for(const route of ['/api/webhook-whatsapp','/api/whatsapp/webhook'])test(route+' ignora eco, grupo e eventos de conexão antes de enviar respostas',async()=>{
  let calls=0;
  const app=setup({_configRuntime:{whatsapp:{}},WHATSAPP_WEBHOOK_SECRET:'test-secret',webhookAuthStatus,adapterEvolution:async()=>{calls++;},
    _resolverClientePorNumero:async()=>{throw Error('Não deve consultar cliente');}});
  const message={event:'messages.upsert',data:{key:{id:'m1',fromMe:false,remoteJid:'5511999999999@s.whatsapp.net'},message:{conversation:'Olá'}}};
  for(const body of [null,{...message,event:'connection.update'},{...message,instance:'OUTRO'},
    {...message,data:{...message.data,key:{...message.data.key,fromMe:true}}},
    {...message,data:{...message.data,key:{...message.data.key,remoteJid:'123@g.us'}}}]){
    const res=await app.request(route,null,body,'POST',{'x-webhook-secret':'test-secret'});
    assert.equal(res.status,200);assert.equal(JSON.parse(res.body).ignorado,true);
  }
  assert.equal(calls,0);
});

test('campo de telefone normaliza dados antigos e respostas com JID',()=>{
  let saved=JSON.stringify({numero:'5511999999999:5@s.whatsapp.net'});
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const ctx=vm.createContext({WA_CFG_KEY:'test',localStorage:{getItem:()=>saved,setItem:(_,v)=>{saved=v;}}});
  vm.runInContext(html.slice(html.indexOf('function getWhatsappCfg('),html.indexOf('function mascararFoneBR(')),ctx);
  assert.equal(ctx.getWhatsappCfg().numero,'5511999999999');
  ctx.saveWhatsappCfg({numero:'5511888888888@s.whatsapp.net'});
  assert.equal(JSON.parse(saved).numero,'5511888888888');
});

test('central consulta e envia com token atual, escapa nome e conserva mensagem recusada',async()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const boxes={_centralContatos:{},_centralChat:{},_centralInput:{value:'teste',focus(){}}};
  const calls=[];
  const contact={chatId:'1',nome:'"<img src=x onerror=alert(1)>',canal:'telegram'};
  const ctx=vm.createContext({console,SERVIDOR:'https://example.invalid',getAuthToken:()=> 'test-token',
    _centralCanalAtivo:'todos',_centralContatoAtivo:contact,_centralMsgsCache:[],toast(){},
    document:{getElementById:id=>boxes[id]},fetchComTimeout:async(url,opts)=>{
      calls.push(opts);return {json:async()=>({ok:!url.endsWith('/enviar'),contatos:[contact],mensagens:[]})};
    }});
  vm.runInContext(html.match(/function _escHtml\(s\)\{[^\n]+/)[0],ctx);
  vm.runInContext(html.slice(html.indexOf('async function _centralCarregarContatos('),html.indexOf('// Auto-refresh a cada 10s se Central aberta')),ctx);
  await ctx._centralCarregarContatos();await ctx._centralCarregarMsgs();await ctx._centralEnviar();
  assert.equal(calls.length,3);for(const call of calls)assert.equal(call.headers.Authorization,'Bearer test-token');
  assert.equal(boxes._centralInput.value,'teste');assert.ok(!boxes._centralContatos.innerHTML.includes('<img'));
  assert.match(boxes._centralContatos.innerHTML,/data-contato=".*&quot;/);
});

test('atendimento usa identidade da sessão no cadastro sem ReferenceError',async()=>{
  let contact;
  const ctx=vm.createContext({console,_configRuntime:{secretario_whatsapp:{ativo:true,max_perguntas_cliente:1}},
    _extrairDadosIdentidadeTexto:()=>({nome_completo:'Cliente Teste',cpf:'000'}),
    _verificarIdentidadeCliente:async()=>({confirmado:true}),_normalizarNumeroWhats:n=>n,
    sbReq:async(method,table,data)=>{contact=data;return {ok:true};},_agoraBrasilia:()=>'',_agoraIso:()=>'',
    _notificarEquipe:async()=>{},_salvarSessaoSecretarioWhatsApp:async()=>{},_MSG_LIMITE_PERGUNTAS:'limite'});
  const start=source.indexOf('async function _conversarWhatsAppCliente(');
  vm.runInContext(source.slice(start,source.indexOf('\nasync function ',start+10)),ctx);
  const result=await ctx._conversarWhatsAppCliente('5511999999999','Olá',{perguntas_feitas:1});
  assert.equal(contact.nome,'Cliente Teste');assert.equal(result.limite,true);
});

test('cadastro pelo canal usa IA existente e confirma registro retornado',async()=>{
  const messages=[];let saved,model;
  const ctx=vm.createContext({console,global:{_intakeSessoes:{}},MODELO_TOP:'test-model',
    env:async m=>messages.push(m),ia:async(m,s,t,mod)=>{model=mod;return JSON.stringify({nome_cliente:'Teste',docs_recebidos:[],docs_faltantes:[]});},
    isAdvogado:()=>true,_normalizarTipoProcesso:()=> 'judicial',sbReq:async(m,t,d)=>{if(t==='processos')saved=d;return {ok:true,body:[{id:123}]};},
    _agoraBrasilia:()=>'',_agoraIso:()=>'',logAtividade:async()=>{}});
  const start=source.indexOf('  async function _finalizarIntake(');
  vm.runInContext(source.slice(start,source.indexOf('  // ── Se está em modo intake',start)),ctx);
  await ctx._finalizarIntake({chatId:'1',imagens:[],textos:['Cadastrar cliente'],arquivos:[]},{canal:'whatsapp'});
  assert.equal(saved.nome,'Teste');assert.equal(model,'test-model');assert.ok(messages.some(m=>m.includes('CASO CADASTRADO')));
});

for(const failWrite of [false,true])test('análise estratégica visual '+(failWrite?'não confirma escrita recusada':'preserva andamentos atuais ao persistir'),async()=>{
  let persisted,content;const events=[];
  const current={andamentos:[{txt:'Atualização concorrente'}],analises_estrategicas:[]};
  const ctx=vm.createContext({Buffer,console,require:createRequire(path.join(__dirname,'../bot.js')),MODELO_TOP:'test',PDF_PGS_POR_CHUNK:50,PDF_MAX_PGS_DIRETO:80,
    _dividirPDFEmChunks:async buffer=>[{buffer,paginas:1}],_bufferDoChunk:c=>c.buffer,_liberarChunk:c=>{c.buffer=null;},_extrairTextoDocxBasico:()=>'',
    ia:async m=>{content=m[0].content;return 'Análise de teste';},processStore:{update:async(id,fn)=>{if(failWrite)throw Error('Banco recusou');persisted=fn(current);}},
    _auditarAcao(){},_sseNotificar:(type,data)=>events.push(data),envTelegramAgendado:async()=>{}});
  const start=source.indexOf('async function _processarAnaliseEstrategicaAsync(');
  vm.runInContext(source.slice(start,source.indexOf("process.on('SIGTERM'",start)),ctx);
  await ctx._processarAnaliseEstrategicaAsync(1,{numero:'teste'}, {nome:'autos.pdf',documento_base64:Buffer.from('pdf').toString('base64')},'admin');
  assert.equal(content[0].type,'document');
  if(failWrite){assert.equal(events[0].erro,true);assert.equal(persisted,undefined);}
  else {assert.equal(events[0].ok,true);assert.equal(persisted.andamentos[1].txt,'Atualização concorrente');assert.equal(persisted.analises_estrategicas.length,1);}
});
