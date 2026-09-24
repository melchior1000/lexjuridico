'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {directReplyFromCommand,noCreditMessage}=require('../lib/channel-direct-reply');

test('keep-alive externo do Render roda a cada 5 minutos',()=>{
  const yml=fs.readFileSync('.github/workflows/manter-servidor-acordado.yml','utf8');
  assert.match(yml,/cron:\s*['"]\*\/5 \* \* \* \*['"]/);
  assert.match(yml,/\/health/);
  assert.doesNotMatch(yml,/\*\/10 \* \* \* \*/);
});

test('contexto de processo usa busca escalável e nunca renderiza milhares de options',()=>{
  const src=fs.readFileSync('lex2-coordinator-ui.js','utf8');
  assert.match(src,/searchProcesses\(query,12\)/);
  assert.match(src,/Buscar por CNJ, cliente, parte ou nome/);
  assert.match(src,/Mostrando no máximo 12 resultados/);
  assert.match(src,/lexChooseProcessContext/);
  assert.match(src,/lex_recent_processes/);
  assert.doesNotMatch(src,/<select id="lex-chat-process"[^>]*>[\s\S]*procs\(\)\.map/);
  assert.match(src,/<input id="lex-chat-process" type="hidden"/);
});

test('busca mantém identidade não confirmada protegida na exibição',()=>{
  const src=fs.readFileSync('lex2-coordinator-ui.js','utf8');
  assert.match(src,/safeLabel\(p\)/);
  assert.match(src,/dados a conferir/);
  assert.match(src,/processSearchText/,'nome/parte podem servir de índice interno sem virar rótulo oficial');
});

test('ordem literal pode ser executada sem IA',()=>{
  assert.equal(directReplyFromCommand('responda exatamente: Recebi os documentos e retorno em seguida.'),'Recebi os documentos e retorno em seguida.');
  assert.equal(directReplyFromCommand('mande: Bom dia, recebi. Obrigado.'),'Bom dia, recebi. Obrigado.');
  assert.equal(directReplyFromCommand('diga a ele "Pode enviar o documento."'),'Pode enviar o documento.');
  assert.equal(directReplyFromCommand('responda o cliente sobre o processo'),null,'ordem livre não pode ser adivinhada sem IA');
  assert.match(noCreditMessage(),/sem crédito/i);
  assert.match(noCreditMessage(),/responda exatamente/i);
});

test('outbox diferencia falta de crédito de IA não configurada',()=>{
  const bot=fs.readFileSync('bot.js','utf8');
  assert.match(bot,/LEX_AI_NO_CREDIT/);
  assert.match(bot,/directReplyFromCommand/);
  assert.match(bot,/resposta_direta_sem_ia/);
  const compose=bot.slice(bot.indexOf('async function _comporRespostaComandoCanal'),bot.indexOf('const channelOutbox=',bot.indexOf('async function _comporRespostaComandoCanal')));
  assert.doesNotMatch(compose,/IA do LEX não está configurada no servidor/);
});
