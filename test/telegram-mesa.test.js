'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTelegramReception,telegramDesk}=require('../lib/telegram-reception');

function recordsFake(){
  const map=new Map();
  return {
    map,
    async change(key,fn){const next=fn(map.get(key));if(next!==undefined)map.set(key,next);return {value:map.get(key)};},
    async read(key){return map.has(key)?{value:map.get(key)}:null;},
    async list(prefix){return [...map.entries()].filter(([k])=>k.startsWith(prefix)).map(([,v])=>v);}
  };
}
function msg(id,text,n=1){return {message_id:n,chat:{id,type:'private'},from:{id,first_name:'Pessoa',is_bot:false},text};}

test('mensagem comum fica na fila sem notificar dono na hora',async()=>{
  const records=recordsFake(),reported=[],sent=[];
  const service=createTelegramReception({records,owner:'7171',send:async(id,text)=>{sent.push({id,text});return true;},report:async text=>{reported.push(text);return true;}});
  assert.equal(await service.receive(msg('123','Oi')),true);
  assert.equal(reported.length,0);
  assert.equal(sent.length,1);
  assert.equal((await records.list('lex_recepcao_telegram_')).length,1);
});

test('urgência real gera um único ping e não copia resposta do LEX',async()=>{
  const records=recordsFake(),reported=[];
  const service=createTelegramReception({records,owner:'7171',send:async()=>true,report:async text=>{reported.push(text);return true;}});
  assert.equal(await service.receive(msg('123','Tenho audiência amanhã, é urgente')),true);
  assert.equal(reported.length,1);
  assert.match(reported[0],/^\[URGENTE\]/);
  assert.doesNotMatch(reported[0],/\[LEX\] respondeu/);
});

test('/resumo entrega mesa consolidada da recepção Telegram',async()=>{
  const records=recordsFake(),sent=[];
  await records.change('lex_recepcao_telegram_123',()=>({id:'123',nome:'Fornecedor',status:'aguardando_advogado',urgente:false,destino:'administrativo',ultima_mensagem:'Tenho uma fatura'}));
  const service=createTelegramReception({records,owner:'7171',send:async(id,text)=>{sent.push({id,text});return true;},report:async()=>true});
  assert.equal(await service.ownerCommand(msg('7171','/resumo')),true);
  assert.equal(sent.length,1);
  assert.match(sent[0].text,/LEX · Mesa/);
  assert.match(sent[0].text,/Fornecedor \(TG\)/);
  assert.match(sent[0].text,/1 aguardando/);
});

test('/resumo usa agregador externo quando fornecido',async()=>{
  const records=recordsFake(),sent=[];
  const service=createTelegramReception({records,owner:'7171',send:async(id,text)=>{sent.push({id,text});return true;},report:async()=>true,summary:async()=> 'LEX · Mesa\nRecepção: 3 aguardando\nPrazos: 2 hoje'});
  assert.equal(await service.ownerCommand(msg('7171','/resumo')),true);
  assert.match(sent[0].text,/Prazos: 2 hoje/);
});

test('telegramDesk limita saída e marca urgentes',()=>{
  const rows=[{id:'1',nome:'Maria',status:'aguardando_advogado',urgente:true,destino:'processos',ultima_mensagem:'Processo 123'}];
  const out=telegramDesk(rows);
  assert.match(out,/1 aguardando · 1 urgente/);
  assert.ok(out.length<=3500);
});
