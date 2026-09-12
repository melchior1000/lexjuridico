const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const html = fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const code = html.slice(html.indexOf('function whatsappStatusTexto('),html.indexOf('async function salvarPjeAvancado('));
function ui(fetch){
  const elements = {'wa-status':{},'wa-ultima-msg':{}};
  const messages=[];
  const context = vm.createContext({document:{getElementById:id=>elements[id]},SERVIDOR:'https://example.test',
    getAuthToken:()=> 'fake',getWhatsappCfg:()=>({ativo:true,status:'conectado'}),saveWhatsappCfg:()=>{},
    fetchComTimeout:fetch,toast:(...args)=>messages.push(args)});
  vm.runInContext(code,context);
  return {context,elements,messages};
}
test('active but disconnected never renders connecting or success',async()=>{
  const {context,elements,messages}=ui(async()=>({ok:true,json:async()=>({ativo:true,conectado:false,estado:'aguardando_pareamento'})}));
  await context.testarWhatsappConexao();
  assert.match(elements['wa-status'].innerHTML,/aguardando pareamento/);
  assert.equal(messages[0][1],'erro');
});
test('network failure replaces cached connected status',async()=>{
  const {context,elements,messages}=ui(async()=>{throw Error('network');});
  await context.testarWhatsappConexao();
  assert.match(elements['wa-status'].innerHTML,/não foi possível/);
  assert.equal(messages[0][1],'erro');
});
test('unauthorized response asks for login',async()=>{
  const {context,elements}=ui(async()=>({ok:false,status:401}));
  await context.testarWhatsappConexao();
  assert.match(elements['wa-status'].innerHTML,/entre novamente/);
});
test('only confirmed connection renders success',async()=>{
  const {context,messages}=ui(async()=>({ok:true,json:async()=>({ativo:true,conectado:true,estado:'conectado'})}));
  await context.testarWhatsappConexao();
  assert.equal(messages[0][1],'ok');
});
