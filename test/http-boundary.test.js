'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {EventEmitter}=require('node:events');
const {classifyHttpRoute}=require('../lib/http-boundary');
const agent=require('../lex_agente_vivo');

function transport(responseBody,status=200){
  const https={request(options,callback){
    const req=new EventEmitter();
    req.setTimeout=()=>{};
    req.destroy=()=>{};
    req.write=()=>{};
    req.end=()=>queueMicrotask(()=>{
      const res=new EventEmitter();res.statusCode=status;callback(res);
      res.emit('data',JSON.stringify(responseBody));res.emit('end');
    });
    return req;
  }};
  return https;
}
async function requestAgent(url,body,extra={}){
  const result={};
  const res={writeHead(status,headers){result.status=status;result.headers=headers},end(text){result.body=JSON.parse(text)}};
  await agent.tratarRota({method:'POST',headers:{}},res,url,{perfil:'admin',body,CORS:{},lerBody:async()=>body,...extra});
  return result;
}

test('fronteira classifica Core oficial, transicao e escritas legadas bloqueadas',()=>{
  assert.equal(classifyHttpRoute('/api/vivo/conversar','POST').classification,'official');
  assert.equal(classifyHttpRoute('/api/escritorio/mover','POST').classification,'official');
  assert.equal(classifyHttpRoute('/api/tarefas','POST').classification,'official');
  assert.equal(classifyHttpRoute('/api/processo/atualizar','POST').classification,'transitional_write');
  assert.equal(classifyHttpRoute('/api/vivo/peca/gerar','POST').classification,'blocked_legacy_write');
  assert.equal(classifyHttpRoute('/api/pericia/gerar','POST').classification,'blocked_legacy_write');
  assert.equal(classifyHttpRoute('/api/processo/distribuir','POST').replacement,'/api/escritorio/distribuir');
});

test('barreira do servidor roda antes do pipeline legado',()=>{
  const source=fs.readFileSync('bot.js','utf8');
  const gate=source.indexOf('enforceHttpBoundary(req,res');
  const legacy=source.indexOf("if(url==='/api/pipeline' && req.method==='POST')");
  assert.ok(gate>0);
  assert.ok(legacy>gate);
});

test('/api/chat permanece compatibilidade somente leitura, sem marcadores de escrita',()=>{
  const source=fs.readFileSync('bot.js','utf8');
  const start=source.indexOf("if(url==='/api/chat' && req.method==='POST')");
  const end=source.indexOf("if(url==='/api/analisar'",start);
  const block=source.slice(start,end);
  assert.match(block,/const acoes = \[\]/);
  assert.doesNotMatch(block,/_processarMarcadoresChat\(/);
});

test('lex-whatsapp usa somente a porta oficial de conversa',()=>{
  const html=fs.readFileSync('lex-whatsapp.html','utf8');
  assert.match(html,/const endpoint = '\/api\/vivo\/conversar'/);
  assert.match(html,/mensagem: texto, historico: msgs/);
  assert.doesNotMatch(html,/endpoint = .*\/api\/chat/);
});

test('gerador legado falha fechado quando processo vinculado nao persiste',async()=>{
  const https=transport({stop_reason:'end_turn',content:[{type:'text',text:'MINUTA TESTE'}]});
  const processo={id:'p1',nome:'Caso Alfa',numero:'5001234-56.2026.8.13.0704',andamentos:[]};
  const result=await requestAgent('/api/vivo/peca/gerar',{
    processo_id:'p1',
    briefing:{tipo_peca:'Contestacao',instrumento_cabivel:true,objeto:'Teste',fundamentos_chave:[]}
  },{
    processos:[processo],
    ANTHROPIC_KEY:'test-key',
    https,
    sbReq:async()=>({ok:false,status:503,body:[]})
  });
  assert.equal(result.status,503);
  assert.equal(result.body.ok,false);
  assert.equal(result.body.codigo,'PERSISTENCIA_NAO_CONFIRMADA');
});
