const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const ui=fs.readFileSync('lex2-coordinator-ui.js','utf8');
const css=fs.readFileSync('office-ui-v2.css','utf8');

test('LEX coordenador consome contexto do dossie uma unica vez e valida processo',()=>{
  assert.match(ui,/window\.__lexDossierContext=null/);
  assert.match(ui,/procs\(\)\.some\(p=>String\(p\.id\)===requested\)/);
  assert.match(ui,/Buscar por CNJ, cliente, parte ou nome/);
  assert.match(ui,/searchProcesses\(query,12\)/);
  assert.doesNotMatch(ui,/<select id="lex-chat-process"/);
});

test('LEX coordenador nao abre conversa vazia nem esconde a ordem principal',()=>{
  assert.match(ui,/Estou aqui\. Dê a ordem em linguagem normal/);
  assert.match(ui,/Dê uma ordem ao LEX/);
  assert.match(ui,/quem, o quê e qual ação está pendente/);
});

test('LEX coordenador tem layout responsivo proprio para celular',()=>{
  for(const token of ['.lex2-lex-head','.lex2-context-chips','.lex2-command','.lex2-command-row']) assert.match(css,new RegExp(token.replace(/\./g,'\\.')));
  assert.match(css,/\.lex2-lex \.lex-conversation\{min-height:190px/);
});

// Bug 27/09/2026 (print do iPhone): botões de atalho cortados e conversa com 60px.
// Causa 1: tela de 100dvh em content-box — os 97px de padding ficavam fora da altura e a grade estourava.
// Causa 2: .lex2-office-tools era caixa rolável (max-height) e o WebKit a espremia até cortar os botões.
test('tela do LEX cabe na altura do celular: grade em border-box, atalhos em linha e ferramentas sem caixa rolável',()=>{
  const screen=css.match(/body\.lex-commercial #content \.lex-screen\.lex2-lex\{[^}]*\}/)[0];
  assert.match(screen,/box-sizing:border-box/);
  assert.match(screen,/grid-template-rows:auto auto auto minmax\(140px,1fr\) auto/);
  const tools=css.match(/\n\.lex2-office-tools\{[^}]*\}/)[0];
  assert.match(tools,/overflow:visible/);
  assert.doesNotMatch(tools,/max-height/);
  const chips=css.match(/\n\.lex2-context-chips\{[^}]*\}/)[0];
  assert.match(chips,/display:flex/);
  assert.match(chips,/overflow-x:auto/);
  assert.doesNotMatch(css,/@media\(max-width:620px\)[\s\S]*?\.lex2-context-chips\{[^}]*grid-template-columns/);
  const chipBtn=css.match(/\n\.lex2-context-chips button\{[^}]*\}/)[0];
  assert.match(chipBtn,/flex:0 0 auto/);
  assert.match(chipBtn,/white-space:nowrap/);
  // Só o mapa de setores rola, e só quando aberto.
  assert.match(css,/\.lex2-tools-details\[open\]\{max-height:34vh;overflow:auto/);
  // No celular a dica de exemplo sai e a caixa de ordem fica com 48px para a conversa ter espaço.
  assert.match(css,/@media\(max-width:620px\)\{\.lex2-lex \.lex2-command-note\{display:none\}\}/);
  assert.match(css,/\.lex2-command-row textarea\{font-size:16px;line-height:1\.4;min-height:48px;height:48px\}/);
});
