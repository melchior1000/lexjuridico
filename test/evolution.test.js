const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {setup, source} = require('./runtime');
const {createSupabaseRequest, requireSuccess, rowsFromResult} = require('../lib/supabase');
const {createAdmission, modelsFor} = require('../lib/ai-runtime');
const agent = require('../lex_agente_vivo');

function transport(responseBody, status = 200) {
  const calls = [];
  const https = {request(options, callback) {
    const req = new EventEmitter();
    const call = {options}; calls.push(call);
    req.setTimeout = (ms, fn) => {call.timeout = fn; call.timeoutMs = ms;};
    req.destroy = () => {call.destroyed = true;};
    req.write = bytes => {call.body = JSON.parse(bytes);};
    req.end = () => queueMicrotask(() => {
      if(responseBody === undefined) return;
      const res = new EventEmitter(); res.statusCode = status; callback(res);
      res.emit('data', JSON.stringify(typeof responseBody === 'function' ? responseBody(call, calls.length) : responseBody));
      res.emit('end');
    });
    return req;
  }};
  return {https, calls};
}
async function requestAgent(url, body, extra = {}) {
  const result = {};
  const res = {writeHead(status, headers) {result.status = status; result.headers = headers;},
    end(text) {result.body = JSON.parse(text);}};
  await agent.tratarRota({method:'POST'}, res, url, {
    perfil: 'admin', body, CORS: {}, lerBody: async () => body,
    ...extra
  });
  return result;
}

test('limite compartilhado recusa excesso e libera vaga após falha', async () => {
  const runtime = createAdmission({maxConcurrent:1});
  let finish;
  const pending = runtime.run(() => new Promise(resolve => {finish = resolve;}));
  await assert.rejects(runtime.run(async () => {}), {code:'LEX_AI_BUSY'});
  finish(); await pending;
  await assert.rejects(runtime.run(async () => {throw new Error('provider');}), /provider/);
  assert.equal(runtime.active, 0);
  assert.equal(await runtime.run(async () => 'ok'), 'ok');
});
test('modelos por ambiente não misturam Anthropic e OpenAI', () => {
  assert.equal(modelsFor('anthropic', {LEX_ANTHROPIC_MODEL_TOP:'homologado'}).top, 'homologado');
  assert.equal(modelsFor('openai', {LEX_ANTHROPIC_MODEL_TOP:'homologado'}).top, 'gpt-4.1');
  assert.throws(() => modelsFor('__proto__'), /invalido/);
});
test('Supabase mantém envelope HTTP, monta filtro e ignora parâmetros ausentes', async () => {
  const {https, calls} = transport([{id:1}]);
  const request = createSupabaseRequest({url:'https://database.invalid', key:'test', https});
  assert.deepEqual(rowsFromResult(await request('GET','processos',null,{id:'eq.1', limit:undefined})), [{id:1}]);
  assert.equal(calls[0].options.path, '/rest/v1/processos?id=eq.1');
});
test('Supabase: DELETE sem filtro não inicia rede', async () => {
  const {https, calls} = transport([]);
  const request = createSupabaseRequest({url:'https://database.invalid', key:'test', https});
  assert.equal((await request('DELETE','processos',null,{limit:1})).ok, false);
  assert.equal(calls.length, 0);
});
test('Supabase: timeout resolve falha e encerra socket', async () => {
  const {https, calls} = transport(undefined);
  const request = createSupabaseRequest({url:'https://database.invalid', key:'test', https});
  const pending = request('GET','processos');
  calls[0].timeout();
  assert.equal((await pending).ok, false);
  assert.equal(calls[0].destroyed, true);
});
test('Supabase: erro HTTP não se transforma em lista vazia ou sucesso', () => {
  assert.throws(() => rowsFromResult({ok:false,status:403,body:[]}), /recusada/);
  assert.throws(() => rowsFromResult({ok:true,status:200,body:{}}), /formato/);
});
test('busca de documentos lê registros e permite filtrar texto', async () => {
  const app = setup({sbRows:async () => [{id:'d1', titulo:'Laudo', texto_extraido:'Teste'}]});
  const response = await app.request('/api/documentos/buscar?q=laudo',app.token('admin'));
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).documentos[0].id, 'd1');
});
test('upload de documento rejeitado não informa sucesso', async () => {
  const app = setup({_extrairTextoPdf:() => 'documento',
    sbReq:async () => ({ok:false,status:403})});
  const result = await app.request('/api/documentos/upload',app.token('admin'),{pdf_base64:'test'},'POST');
  assert.equal(result.status, 500);
  assert.match(result.body, /banco/);
});
test('troca de senha respeita perfilAlvo enviado pelo frontend', async () => {
  let saved;
  const app = setup({salvarSenhaSupabase:async (perfil,senha) => {saved={perfil,senha}; return true;}});
  const result = await app.request('/api/trocar-senha',app.token('admin'),{perfilAlvo:'secretaria',novaSenha:'senha-nova-segura'},'POST');
  assert.equal(result.status,200);
  assert.equal(saved.perfil,'secretaria');
});
test('secretaria não muda senha de administrador', async () => {
  const app = setup();
  assert.equal((await app.request('/api/trocar-senha',app.token('secretaria'),{perfilAlvo:'admin',novaSenha:'senha-nova-segura'},'POST')).status,403);
});
test('falha ao gravar senha mantém senha atual no cache', async () => {
  const senhas = {admin:'old'};
  const code = source.slice(source.indexOf('const _senhasConsultadas ='),source.indexOf('const PERMS ='));
  let count=0;
  const ctx = vm.createContext({SENHAS_WEB:senhas, rowsFromResult,requireSuccess, console:{warn(){},log(){}},
    sbReq:async () => ++count===1 ? {ok:true,status:200,body:[{id:1}]} : {ok:false,status:500}});
  vm.runInContext(code,ctx);
  assert.equal(await ctx.salvarSenhaSupabase('admin','new'),false);
  assert.equal(senhas.admin,'old');
});
test('senha persistida prevalece após reinício, mesmo com variável antiga', async () => {
  const code = source.slice(source.indexOf('const _senhasConsultadas ='),source.indexOf('const PERMS ='));
  const ctx = vm.createContext({SENHAS_WEB:{admin:'old'}, SB_URL:'configured', SB_KEY:'configured',
    rowsFromResult, requireSuccess, sbReq:async () => ({ok:true,status:200,body:[{valor:'new'}]})});
  vm.runInContext(code,ctx);
  assert.equal(await ctx.obterSenhaValida('admin'),'new');
});
test('DOCX legado entrega pacote Word e MIME correto', async () => {
  const app = setup();
  const result = await app.request('/api/docx',app.token('admin'),{texto:'Petição <teste> & ação'},'POST');
  assert.equal(result.status,200);
  assert.equal(result.headers['Content-Type'],'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(result.body.readUInt32LE(0),0x04034b50);
  assert.ok(result.body.includes(Buffer.from('word/document.xml')));
  assert.ok(result.body.includes(Buffer.from('Petição &lt;teste&gt; &amp; ação')));
  const zip = await require('jszip').loadAsync(result.body, {checkCRC32:true});
  assert.ok(await zip.file('[Content_Types].xml').async('string'));
  assert.match(await zip.file('_rels/.rels').async('string'), /Target="word\/document.xml"/);
});
test('PDF preserva tipo específico em vez de application/json', async () => {
  const app = setup({_gerarPecaPdfBuffer:async () => Buffer.from('%PDF-1.7')});
  const result = await app.request('/api/gerar-pdf',app.token('admin'),{conteudo:'Teste'},'POST');
  assert.equal(result.status,200);
  assert.equal(result.headers['Content-Type'],'application/pdf');
});
test('gestor: falha no banco preserva memória e não envia notificação', async () => {
  const original={id:1,status:'URGENTE',prazo:'2026-09-08',andamentos:[]};
  const processos=[structuredClone(original)]; let notices=0;
  const result = await requestAgent('/api/vivo/aplicar',{processo_id:1,proposta:{andamento:'Teste'}},
    {processos,sbPatch:async () => ({ok:false,status:403}),_notificarEquipe:async () => {notices++;}});
  assert.equal(result.status,500);
  assert.deepEqual(processos[0],original);
  assert.equal(notices,0);
});
test('gestor: PATCH sem linha alterada não confirma sucesso', async () => {
  const processos=[{id:1,status:'URGENTE'}];
  const result=await requestAgent('/api/vivo/aplicar',{processo_id:1,proposta:{status:'ATIVO'}},
    {processos,sbPatch:async () => ({ok:true,status:200,body:[]})});
  assert.equal(result.status,500); assert.equal(processos[0].status,'URGENTE');
});
test('gestor: novo andamento mantém prazo próximo e só confirma após gravação', async () => {
  const processos=[{id:1,status:'URGENTE',prazo:'2026-09-08',andamentos:[]}];
  let sincronizacoes=0;
  const result=await requestAgent('/api/vivo/aplicar',{processo_id:1,proposta:{andamento:'Documento recebido'}},
    {processos,sbPatch:async () => ({ok:true,status:200,body:[{id:1}]}),onProcessPersisted:() => {sincronizacoes++;}});
  assert.equal(result.status,200);
  assert.equal(processos[0].prazo,'2026-09-08');
  assert.equal(result.body.persistencia.via,'supabase');
  assert.equal(sincronizacoes,1);
});
test('gestor: data inexistente não altera processo', async () => {
  const processos=[{id:1,status:'URGENTE'}];
  const result=await requestAgent('/api/vivo/aplicar',{processo_id:1,proposta:{prazo:'2026-02-31'}},{processos});
  assert.equal(result.status,400); assert.equal(processos[0].status,'URGENTE');
});
test('gestor: secretaria não aplica alterações', async () => {
  const result=await requestAgent('/api/vivo/aplicar',{processo_id:1,proposta:{status:'ATIVO'}},{perfil:'secretaria'});
  assert.equal(result.status,403);
});
test('ferramenta de proposta não informa uma gravação inexistente à IA', async () => {
  const {https,calls}=transport((call,n) => n===1
    ? {stop_reason:'tool_use',content:[{type:'tool_use',id:'proposal',name:'propor_atualizacao',input:{status:'ATIVO'}}]}
    : {stop_reason:'end_turn',content:[{type:'text',text:'Proposta preparada.'}]});
  const result=await requestAgent('/api/vivo/conversar',{mensagem:'Atualize o processo'}, {https,ANTHROPIC_KEY:'test-key'});
  assert.equal(result.status,200);
  const returned=JSON.parse(calls[1].body.messages.at(-1).content[0].content);
  assert.equal(returned.executado,false); assert.equal(returned.estado,'proposta_preparada');
});
test('ferramenta desconhecida retorna erro em vez de sucesso', async () => {
  const {https,calls}=transport((call,n) => n===1
    ? {stop_reason:'tool_use',content:[{type:'tool_use',id:'unknown',name:'ferramenta_inexistente',input:{}}]}
    : {stop_reason:'end_turn',content:[{type:'text',text:'Não executado.'}]});
  await requestAgent('/api/vivo/conversar',{mensagem:'Teste'},{https,ANTHROPIC_KEY:'test-key'});
  assert.equal(calls[1].body.messages.at(-1).content[0].is_error,true);
});
test('frontend: novo andamento mantém prazo e prazoReal', () => {
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const code=html.slice(html.indexOf('function cicloStatus('),html.indexOf('function fmtPrazo('));
  const processos=[{id:1,status:'ATIVO',prazo:'08/09/2026',prazoReal:'11/09/2026'}];
  const ctx=vm.createContext({getProcs:() => processos,saveProcs() {},diasRestantes:() => 1});
  vm.runInContext(code,ctx);
  ctx.cicloStatus(1,'andamento',{skipRender:true});
  assert.equal(processos[0].prazo,'08/09/2026');
  assert.equal(processos[0].prazoReal,'11/09/2026');
});

test('duas atualizações simultâneas do gestor preservam ambos os andamentos', async () => {
  const processos=[{id:1,status:'ATIVO',andamentos:[]}];
  const deps={processos,sbPatch:async () => {
    await new Promise(resolve => setImmediate(resolve));
    return {ok:true,status:200,body:[{id:1}]};
  }};
  const results=await Promise.all(['A','B'].map(andamento =>
    requestAgent('/api/vivo/aplicar',{processo_id:1,proposta:{andamento}},deps)));
  assert.ok(results.every(result => result.status===200));
  assert.deepEqual(processos[0].andamentos.map(item => item.texto),['A','B']);
});

test('gerador PDF real produz arquivo legível com acentos', async () => {
  const pdf = require('pdf-lib');
  const docs=source.slice(source.indexOf('function _escapeXmlPeca('),source.indexOf('const USUARIOS ='));
  // A biblioteca pdf-lib usa instanceof Array: execute seus helpers na mesma realm.
  const generate=new Function('PDFDocument','StandardFonts','rgb',docs+'; return _gerarPecaPdfBuffer;')(pdf.PDFDocument,pdf.StandardFonts,pdf.rgb);
  const app=setup({_gerarPecaPdfBuffer:generate});
  const result=await app.request('/api/gerar-pdf',app.token('admin'),{titulo:'Verificação',conteudo:'Ação e perícia. Teste de exportação.'},'POST');
  assert.equal(result.status,200);
  const document=await pdf.PDFDocument.load(result.body);
  assert.ok(document.getPageCount()>0);
});

test('email com anexo é montado localmente, sem envio SMTP', async () => {
  const mailer=require('nodemailer');
  const transporter=mailer.createTransport({streamTransport:true,buffer:true,
    disableFileAccess:true,disableUrlAccess:true});
  const app=setup();
  const docx=app.context._gerarDocxBufferPeca('Teste','Conteúdo fictício','peticao');
  const result=await transporter.sendMail({from:'teste@example.invalid',to:'destino@example.invalid',
    subject:'Teste local',text:'Sem envio externo.',attachments:[{filename:'teste.docx',content:docx}]});
  assert.ok(result.message.includes(Buffer.from('filename=teste.docx')) || result.message.includes(Buffer.from('filename="teste.docx"')));
  assert.deepEqual(result.envelope.to,['destino@example.invalid']);
});

test('marcadores de chat não executam escrita para secretaria', async () => {
  // O teste do handler comprova que o perfil real chega ao executor.
  let perfilRecebido;
  const app=setup({MODELO_MID:'test-model',ia:async () => '[ATUALIZAR:1:status:ATIVO]',
    _processarMarcadoresChat:async (texto,perfil) => {perfilRecebido=perfil;return [];}});
  assert.equal((await app.request('/api/chat',app.token('secretaria'),{messages:[{role:'user',content:'teste'}],system:'teste'},'POST')).status,200);
  assert.equal(perfilRecebido,'secretaria');
  const start=source.indexOf('async function _processarMarcadoresChat(');
  const end=source.indexOf('\n}\n',start)+2;
  const ctx=vm.createContext({});
  vm.runInContext(source.slice(start,end),ctx);
  assert.equal((await ctx._processarMarcadoresChat('[ATUALIZAR:1:status:ATIVO]','secretaria')).length,0);
});

test('frontend não chama API Anthropic quando servidor falha', async () => {
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const start=html.indexOf('async function chamarIA(');
  const end=html.indexOf('// Credenciais de IA configuradas',start);
  const code=html.slice(start,end);
  let calls=0;
  const ctx=vm.createContext({console:{warn(){}},
    _chamarIA_hash:() => 'test', _chamarIA_cacheGet:() => null,_chamarIA_cacheSet(){},
    chamarServidor:async () => {calls++;throw new Error('offline');}});
  vm.runInContext(code,ctx);
  const result=await ctx.chamarIA([{role:'user',content:'teste'}],'teste');
  assert.match(result,/indisponivel/);
  assert.equal(calls,1);
});
