'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const agent=require('../lex_agente_vivo');

function transport(answer='Resposta do LEX'){
  const calls=[];
  const https={request(options,callback){
    const req=new EventEmitter();
    const call={options};calls.push(call);
    req.setTimeout=()=>{};
    req.destroy=()=>{};
    req.write=bytes=>{call.body=JSON.parse(bytes)};
    req.end=()=>queueMicrotask(()=>{
      const res=new EventEmitter();res.statusCode=200;callback(res);
      res.emit('data',JSON.stringify({content:[{type:'text',text:answer}],stop_reason:'end_turn'}));
      res.emit('end');
    });
    return req;
  }};
  return {https,calls};
}

async function request(body,extra={}){
  const out={};
  const res={writeHead(status,headers){out.status=status;out.headers=headers},end(text){out.body=JSON.parse(text)}};
  await agent.tratarRota({method:'POST'},res,'/api/vivo/conversar',{
    perfil:'admin',body,CORS:{},lerBody:async()=>body,processos:[],...extra
  });
  return out;
}

test('frontend mantém histórico separado por conversa e o envia ao Gestor',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../office-ui-v2.js'),'utf8');
  assert.match(src,/lex_chat_history_/);
  assert.match(src,/sessionStorage\.setItem\(chatHistoryKey/);
  assert.match(src,/const payload=\{mensagem:text,historico\}/);
  assert.match(src,/lexSwitchChatProcess/);
  assert.match(src,/CHAT_HISTORY_LIMIT=20/);
});

test('Gestor recebe histórico antes da mensagem atual',async()=>{
  const {https,calls}=transport();
  const body={
    processo_id:'p1',
    mensagem:'E agora?',
    historico:[
      {role:'user',content:'Primeira pergunta'},
      {role:'assistant',content:'Primeira resposta'}
    ]
  };
  const result=await request(body,{processos:[{id:'p1',nome:'Caso teste'}],ANTHROPIC_KEY:'test',https});
  assert.equal(result.status,200);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].body.messages.map(m=>[m.role,m.content]),[
    ['user','Primeira pergunta'],
    ['assistant','Primeira resposta'],
    ['user','E agora?']
  ]);
});

test('processo_id inexistente retorna 404 antes de chamar IA',async()=>{
  let network=false;
  const https={request(){network=true;throw new Error('não deveria chamar rede')}};
  const result=await request({processo_id:'sumiu',mensagem:'Analise este caso'},{processos:[{id:'outro'}],ANTHROPIC_KEY:'test',https});
  assert.equal(result.status,404);
  assert.equal(result.body.codigo,'PROCESSO_CONTEXTO_INVALIDO');
  assert.equal(network,false);
});

test('contexto inválido também é bloqueado quando o corpo vem apenas de lerBody',async()=>{
  let reads=0,network=false;
  const body={processo_id:'sumiu',mensagem:'Analise este caso'};
  const out={};
  const res={writeHead(status,headers){out.status=status;out.headers=headers},end(text){out.body=JSON.parse(text)}};
  await agent.tratarRota({method:'POST'},res,'/api/vivo/conversar',{
    perfil:'admin',
    CORS:{},
    processos:[{id:'outro'}],
    ANTHROPIC_KEY:'test',
    lerBody:async()=>{reads++;return body},
    https:{request(){network=true;throw new Error('não deveria chamar rede')}}
  });
  assert.equal(out.status,404);
  assert.equal(out.body.codigo,'PROCESSO_CONTEXTO_INVALIDO');
  assert.equal(reads,1);
  assert.equal(network,false);
});
