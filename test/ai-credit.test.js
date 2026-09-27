'use strict';
// 27/09/2026: crédito da API zerado até a semana seguinte. O LEX precisa perceber sozinho,
// avisar o titular uma vez, operar pelo executor e voltar sozinho quando houver crédito.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createCreditGuard,isCreditError,mensagemSemIA}=require('../lib/ai-credit');

const ERRO_ANTHROPIC=new Error('Anthropic: Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.');

test('reconhece a recusa por falta de crédito e não confunde com outros erros',()=>{
  assert.equal(isCreditError(ERRO_ANTHROPIC),true);
  assert.equal(isCreditError(new Error('Your credit balance is too low')),true);
  assert.equal(isCreditError(new Error('insufficient_quota: You exceeded your current quota')),true);
  assert.equal(isCreditError(new Error('Overloaded (529)')),false);
  assert.equal(isCreditError(new Error('timeout')),false);
  assert.equal(isCreditError(new Error('crédito tributário de PIS')),false,'texto jurídico não é falta de crédito');
  // CodeRabbit #148: texto genérico não pode pausar a IA.
  assert.equal(isCreditError(new Error('Payment required for this document')),false);
  assert.equal(isCreditError(new Error('billing error no cadastro do cliente')),false);
  assert.equal(isCreditError(new Error('Selecione um processo antes de buscar documentos.')),false);
  assert.equal(isCreditError(Object.assign(new Error('x'),{type:'insufficient_quota'})),true,'sinal do provedor pelo tipo');
});

test('primeira recusa liga o modo sem IA e avisa uma vez',()=>{
  const env={},avisos=[];
  const g=createCreditGuard({env,notify:t=>avisos.push(t)});
  assert.equal(g.registrarErro(new Error('timeout')),false);
  assert.equal(env.LEX_AI_NO_CREDIT,undefined);
  assert.equal(g.registrarErro(ERRO_ANTHROPIC),true);
  assert.equal(env.LEX_AI_NO_CREDIT,'1');
  assert.equal(g.registrarErro(ERRO_ANTHROPIC),true);
  assert.equal(avisos.length,1,'não repete o aviso');
  assert.match(avisos[0],/sem crédito/i);
  assert.equal(g.estado().automatico,true);
});

test('teste a cada rodada: continua sem crédito até a recarga, então volta sozinho e avisa',async()=>{
  const env={},avisos=[];let credito=false,sondas=0;
  const g=createCreditGuard({env,notify:t=>avisos.push(t),probe:async()=>{sondas++;if(!credito)throw ERRO_ANTHROPIC;return true}});
  g.registrarErro(ERRO_ANTHROPIC);
  assert.equal((await g.sondar()).ok,false);
  assert.equal(env.LEX_AI_NO_CREDIT,'1');
  credito=true;
  assert.equal((await g.sondar()).ok,true);
  assert.equal(env.LEX_AI_NO_CREDIT,undefined,'IA liberada de novo');
  assert.match(avisos.at(-1),/IA do LEX voltou/);
  assert.equal((await g.sondar()).skipped,true,'com IA ativa não gasta teste');
  assert.equal(sondas,2);
});

// CodeRabbit #148: recusa nova enquanto o teste roda não pode religar a IA.
test('recusa nova durante o teste de crédito mantém o modo sem IA',async()=>{
  const env={};let g;
  let liberar;const pendente=new Promise(r=>{liberar=r});
  g=createCreditGuard({env,probe:async()=>{await pendente;return true}});
  g.registrarErro(ERRO_ANTHROPIC);
  const teste=g.sondar();
  g.registrarErro(ERRO_ANTHROPIC); // outra chamada foi recusada enquanto o teste rodava
  liberar();
  const out=await teste;
  assert.equal(out.ok,false);
  assert.equal(env.LEX_AI_NO_CREDIT,'1');
});

test('modo sem IA ligado à mão no servidor não é desligado pela sonda',async()=>{
  const env={LEX_AI_NO_CREDIT:'1'};let sondas=0;
  const g=createCreditGuard({env,probe:async()=>{sondas++;return true}});
  assert.equal(g.registrarErro(ERRO_ANTHROPIC),true);
  assert.equal((await g.sondar()).skipped,true);
  assert.equal(env.LEX_AI_NO_CREDIT,'1');
  assert.equal(sondas,0);
});

test('start agenda uma sonda por intervalo e não segura o processo',()=>{
  const timers=[];
  const g=createCreditGuard({env:{},probe:async()=>true,setIntervalImpl:(fn,ms)=>{const t={fn,ms,unref(){this.u=true}};timers.push(t);return t}});
  g.start();g.start();
  assert.equal(timers.length,1);assert.equal(timers[0].ms,30*60*1000);assert.equal(timers[0].u,true);
});

test('mensagem sem IA diz a verdade e lista o que funciona',()=>{
  const t=mensagemSemIA();
  assert.match(t,/sem crédito/i);
  assert.match(t,/prazos/i);assert.match(t,/intimação nova/i);assert.match(t,/como está o processo/i);assert.match(t,/precisa de mim/i);
  assert.match(t,/eu aviso/i);
});

test('bot.js: guarda ligado na chamada da IA, no LEX vivo e na resposta sem IA ao titular',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8');
  const a=src.indexOf('async function _iaAnthropic(');
  const corpo=src.slice(a,a+1800);
  assert.match(corpo,/creditGuard\.registrarErro\(e\)/,'recusa por crédito é registrada');
  assert.match(src,/\[LEX vivo\][^\n]*\n?[^\n]*creditGuard\.registrarErro\(e\)|creditGuard\.registrarErro\(e\);console\.warn\('\[LEX vivo\]/);
  assert.match(src,/creditGuard\.start\(\)/);
  const p=src.indexOf('const specialist=lex_agente_vivo?.specializedIntent?.(txt);');
  assert.match(src.slice(p-400,p),/LEX_AI_NO_CREDIT==='1'[^\n]*mensagemSemIA\(\)/,'titular recebe resposta clara sem IA');
});

test('chat do app sem IA responde pelo executor, com aviso legal, e o núcleo informa a recusa de crédito',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8');
  const i=src.indexOf("const vivoUrl = url === '/api/agente-vivo' ? '/api/vivo/conversar' : url;");
  const trecho=src.slice(i,i+1600);
  assert.match(trecho,/process\.env\.LEX_AI_NO_CREDIT==='1'/);
  assert.match(trecho,/executeNaturalOfficeCommand\(/);
  assert.match(trecho,/let texto=mensagemSemIA\(\)/);
  assert.match(trecho,/sem_ia:true,aviso:require\('\.\/lib\/lex-aviso'\)\.AVISO/);
  assert.match(src,/onIaErro:e=>creditGuard\.registrarErro\(e\)/);
  const core=fs.readFileSync(path.join(__dirname,'..','lex_agente_vivo_core.js'),'utf8');
  const h=core.indexOf("console.error('[VIVO] conversar erro:'");
  assert.match(core.slice(h-200,h),/deps\.onIaErro\(e\)/);
});
