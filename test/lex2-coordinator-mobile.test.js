const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const ui=fs.readFileSync('lex2-coordinator-ui.js','utf8');
const css=fs.readFileSync('office-ui-v2.css','utf8');

test('LEX coordenador consome contexto do dossie uma unica vez e valida processo',()=>{
  assert.match(ui,/window\.__lexDossierContext=null/);
  assert.match(ui,/procs\(\)\.some\(p=>String\(p\.id\)===requested\)/);
  assert.match(ui,/Escritório geral — nenhum processo/);
});

test('LEX coordenador nao abre conversa vazia nem esconde a ordem principal',()=>{
  assert.match(ui,/Estou aqui\. Dê a ordem em linguagem normal/);
  assert.match(ui,/Dê uma ordem ao LEX/);
  assert.match(ui,/quem, o quê e qual ação está pendente/);
});

test('LEX coordenador tem layout responsivo proprio para celular',()=>{
  for(const token of ['.lex2-lex-head','.lex2-context-chips','.lex2-command','.lex2-command-row']) assert.match(css,new RegExp(token.replace(/\./g,'\\.')));
  assert.match(css,/@media\(max-width:620px\)[\s\S]*\.lex2-context-chips\{grid-template-columns:repeat\(2/);
  assert.match(css,/\.lex2-lex \.lex-conversation\{min-height:190px/);
});
