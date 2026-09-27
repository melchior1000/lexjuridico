'use strict';
// Abertura de painel ao acessar a página (27/09/2026). Trava: aviso legal sob a marca,
// nunca prende o app, respeita "reduzir movimento", pula com toque, uma vez por sessão,
// e o cartão antigo "Bem-vindo ao Lex" não cobre mais o LEX.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const {AVISO_CURTO}=require('../lib/lex-aviso');

test('abertura carrega logo depois da base (que define lexAvisoHtml) e antes das telas',()=>{
  const loader=read('office-ui.js');
  const base=loader.indexOf('office-ui-base.js'),ab=loader.indexOf('lex-abertura.js'),v2=loader.indexOf('office-ui-v2.js');
  assert.ok(base>=0&&ab>base&&v2>ab,'ordem: base → abertura → telas');
});

test('abertura mostra o aviso legal embaixo da marca, mesmo sem a base',()=>{
  const src=read('lex-abertura.js');
  assert.ok(src.includes(AVISO_CURTO),'texto de reserva igual ao da fonte única');
  assert.match(src,/window\.lexAvisoHtml\(\)/);
  assert.ok(src.indexOf('<b>LEX</b>')<src.indexOf('class="aviso"'),'aviso vem depois da marca');
});

test('abertura nunca prende o LEX, pula com toque/tecla e respeita movimento reduzido',()=>{
  const src=read('lex-abertura.js');
  assert.match(src,/TRAVA = 10000/,'trava de segurança');
  assert.match(src,/trava = setTimeout\(sairDesta, TRAVA\)/);
  assert.match(src,/function sairDesta\(\) \{ if \(g === geracao\) sair\(\); \}/,'temporizador antigo não fecha abertura nova (CodeRabbit #145)');
  assert.doesNotMatch(src,/setTimeout\(sair,/,'nenhum temporizador chama sair direto');
  assert.match(src,/addEventListener\('click', sair\)/);
  assert.match(src,/removeEventListener\('keydown', tecla\)/,'solta a tecla ao sair');
  assert.match(src,/prefers-reduced-motion/);
  assert.match(src,/prefers-reduced-motion:reduce\)\{#lex-abertura,#lex-abertura \*\{animation:none!important;transition:none!important\}/,'sem esmaecimento também no próprio painel');
  assert.match(src,/root\.classList\.remove\('lex-abrindo'\)/,'devolve a página ao sair');
});

// Pedido do titular (27/09/2026): a abertura é quando ENTRA no LEX, depois da senha, e com calma.
test('abertura aparece depois que a senha é aceita, não no carregamento da página',()=>{
  const src=read('lex-abertura.js');
  assert.match(src,/window\.lexAbertura = abrir/);
  assert.doesNotMatch(src,/sessionStorage/,'toda entrada com senha mostra a abertura');
  assert.doesNotMatch(src,/visibility:hidden/,'não esconde a tela de login ao carregar');
  assert.doesNotMatch(src,/DOMContentLoaded/,'não abre sozinha ao carregar');
  const html=read('index.html');
  const i=html.indexOf('function ativarApp(perfil){');
  assert.ok(i>=0);
  const corpo=html.slice(i,i+500);
  assert.ok(corpo.indexOf('window.lexAbertura()')>=0,'ativarApp chama a abertura');
  assert.ok(corpo.indexOf('window.lexAbertura()')<corpo.indexOf("getElementById('login-screen').style.display='none'"),'abre antes de esconder o login (sem piscar)');
});

test('abertura dura o bastante para ser vista (~5 s)',()=>{
  const src=read('lex-abertura.js');
  const passo=Number(/PASSO = (\d+)/.exec(src)[1]),segura=Number(/SEGURA = (\d+)/.exec(src)[1]);
  const total=300+4*passo+segura;
  assert.ok(total>=4500&&total<=6500,'duração total '+total+' ms');
});

test('o cartão antigo "Bem-vindo ao Lex" não cobre mais o LEX',()=>{
  const html=read('index.html');
  const i=html.indexOf('function mostrarBoasVindas()');
  assert.ok(i>=0);
  assert.match(html.slice(i,i+400),/^function mostrarBoasVindas\(\) \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*return;/);
});
