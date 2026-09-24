'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const {lexFixText}=require('../lex-text.js');

test('página não é encolhida: sem zoom/scale no body (faixa vazia à direita no celular)',()=>{
  const html=read('index.html');
  assert.doesNotMatch(html,/body\{[^}]*zoom\s*:/);
  assert.doesNotMatch(html,/body\{transform:scale\(/);
});

test('texto corrompido é exibido recuperado e texto íntegro não muda',()=>{
  assert.equal(lexFixText('Banco do Brasil �� Exceç��o de Pré-Executividade'),'Banco do Brasil — Exceção de Pré-Executividade');
  assert.equal(lexFixText('Intimaç�es'),'Intimações');
  assert.equal(lexFixText('n��o cumprido'),'não cumprido');
  assert.equal(lexFixText('Execução — íntegro'),'Execução — íntegro');
  for(const f of ['lex2-interface-core.js','office-ui-v2.js','lex2-coordinator-ui.js','office-dossier-ui.js','office-flow-ui.js'])
    assert.match(read(f),/const esc=v=>\(globalThis\.lexFixText\|\|String\)\(v\?\?''\)/,f);
  assert.match(read('office-ui.js'),/lex-text\.js[\s\S]*office-ui-base\.js/);
});

test('acabamento: seletor legível, número na fonte normal e camada carregada por último',()=>{
  const css=read('lex-polish.css');
  assert.match(css,/\.lex-sort select\{color:var\(--text\)/);
  assert.match(css,/\.lex-proc-row code[\s\S]*font-family:inherit/);
  const ui=read('office-ui.js');
  assert.ok(ui.indexOf('lex-polish.css')>ui.indexOf('office-dossier-ui.css'));
});

test('sem jargão técnico nos cartões e acentos no boas-vindas',()=>{
  const all=read('lex2-interface-core.js')+read('office-ui-v2.js');
  assert.doesNotMatch(all,/verdade jurídica assinada|confirmação auditável/);
  const html=read('index.html');
  for(const t of ['Gestão Jurídica','peças e responde dúvidas jurídicas','Notificações via Telegram','Começar o tour guiado'])assert.ok(html.includes(t),t);
});
