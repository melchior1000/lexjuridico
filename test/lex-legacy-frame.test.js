'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

test('telas antigas ganham voltar, título e a barra padrão (não ficam sem navegação)',()=>{
  const src=read('lex-legacy-frame.js');
  assert.match(src,/lex-shell-back[^']*onclick="lexMais\(\)"/);
  for(const t of ['Início','Processos','LEX','Prazos','Mais'])assert.match(src,new RegExp('<span>'+t+'</span>'));
  assert.match(read('office-ui.js'),/lex-legacy-frame\.js/);
});

test('tela do processo tem estilo para todos os blocos e a barra padrão',()=>{
  const ui=read('office-dossier-ui.js'),css=read('lex-polish.css');
  for(const c of ['lex-dossier-primary','lex-dossier-filters','lex-dossier-timeline','lex-timeline-item','lex-dossier-ask'])assert.match(css,new RegExp('\\.'+c),c+' sem estilo');
  assert.match(ui,/<nav class="lex-dock">/);
  assert.match(ui,/Atualizar do tribunal/);
  assert.match(ui,/function partesOf/);
});

test('dados ausentes não viram "undefined" na tela',()=>{
  const html=read('index.html');
  assert.match(html,/contatos = Array\.isArray\(lista\)/);
  assert.match(html,/'Área não informada'/);
});
