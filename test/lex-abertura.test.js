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

test('abertura nunca prende o LEX, pula com toque/tecla, respeita movimento reduzido e aparece uma vez por sessão',()=>{
  const src=read('lex-abertura.js');
  assert.match(src,/setTimeout\(sair, 6000\)/,'trava de segurança');
  assert.match(src,/addEventListener\('click', sair\)/);
  assert.match(src,/keydown/);
  assert.match(src,/prefers-reduced-motion/);
  assert.match(src,/prefers-reduced-motion:reduce\)\{#lex-abertura,#lex-abertura \*\{animation:none!important;transition:none!important\}/,'sem esmaecimento também no próprio painel');
  assert.match(src,/sessionStorage\.getItem\(KEY\)/);
  assert.match(src,/root\.classList\.remove\('lex-abrindo'\)/,'devolve a página ao sair');
});

test('o cartão antigo "Bem-vindo ao Lex" não cobre mais o LEX',()=>{
  const html=read('index.html');
  const i=html.indexOf('function mostrarBoasVindas()');
  assert.ok(i>=0);
  assert.match(html.slice(i,i+400),/^function mostrarBoasVindas\(\) \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*return;/);
});
