'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {officeRoutes}=require('../lib/office-routes');

function response(){let status=0,body=null;return{res:{writeHead:s=>status=s,end:b=>body=b?JSON.parse(b):null},get:()=>({status,body})}}
function records(initial={}){
  const map=new Map(Object.entries(initial));
  return {async read(k){return map.has(k)?{value:structuredClone(map.get(k))}:null},async list(prefix){return [...map.entries()].filter(([k])=>k.startsWith(prefix)).map(([,v])=>structuredClone(v))},async change(k,fn){const next=await fn(map.has(k)?structuredClone(map.get(k)):null);if(next!==undefined)map.set(k,structuredClone(next));return structuredClone(map.get(k))}};
}
function deps(profile,rec,body={}){
  return {headers:{},authenticate:()=>profile,body:async()=>body,records:rec,channelDelivery:async()=>true,
    processStore:{read:async()=>({processes:[]}),mutate:async()=>({})},engine:{list:async()=>[],recoverStale:async()=>[]},docx:()=>Buffer.from(''),aiAvailable:()=>false,setOffice:()=>{},log:()=>{}};
}
async function route(url,method,d){const out=response();await officeRoutes({url,method},out.res,d);return out.get()}

test('secretaria e advogado podem abrir a mesa de mensagens, sem liberar rotas jurídicas gerais',async()=>{
  global._whatsappPublicInbox=[];
  const rec=records({'lex_recepcao_telegram_123':{id:'123',nome:'Contato',status:'aguardando_advogado',ultima_mensagem:'oi',atualizado_em:'2026-09-19T22:00:00Z',history:[{direcao:'entrada',texto:'oi'}]}});
  for(const perfil of ['secretaria','advogado']){
    const r=await route('/api/escritorio/recepcao?status=aguardando_advogado','GET',deps(perfil,rec));
    assert.equal(r.status,200);assert.equal(r.body.contatos[0].origem,'telegram');
  }
  const blocked=await route('/api/escritorio','GET',deps('secretaria',rec));
  assert.equal(blocked.status,403);
});

test('mesa comercial usa WhatsApp e Telegram no mesmo layout responsivo e sem prompt nativo',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../office-ui-v2.js'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'../office-ui-v2.css'),'utf8');
  assert.match(js,/window\.lexInbox=async function/);
  assert.match(js,/\/api\/escritorio\/recepcao\/historico/);
  assert.match(js,/\/api\/escritorio\/recepcao\/responder/);
  assert.match(js,/setInterval\(async\(\)=>/);
  assert.doesNotMatch(js,/prompt\(\(lines/);
  assert.match(css,/\.lex-inbox-shell/);
  assert.match(css,/@media\(max-width:700px\)/);
  assert.match(css,/\.lex-inbox-shell\.has-active \.lex-inbox-chat/);
});

test('chat vivo possui fallback para OpenAI quando Anthropic estiver sem crédito',()=>{
  const core=fs.readFileSync(path.join(__dirname,'../lex_agente_vivo_core.js'),'utf8');
  assert.match(core,/erroAnthropicIndisponivel/);
  assert.match(core,/credit balance/);
  assert.match(core,/OPENAI_API_KEY/);
  assert.match(core,/fallback OpenAI/i);
});

test('interface comercial não trata o usuário como advogado',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../office-ui-v2.js'),'utf8');
  assert.doesNotMatch(js,/Olá, Dr\./);
});
