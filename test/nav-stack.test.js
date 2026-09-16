const test = require('node:test');
const assert = require('node:assert/strict');
const LexNav = require('../lex-nav.js');

test('createStack: push / back / close e affordances', () => {
  const s = LexNav.createStack();
  s.root({ view: 'processos', title: 'Processos' });
  assert.equal(s.depth, 1);
  assert.equal(s.affordances().back, false);
  assert.equal(s.affordances().close, false);
  s.push({ view: 'processo', title: 'Proc 001', params: { id: 1 } });
  assert.equal(s.depth, 2);
  assert.equal(s.affordances().back, true);
  assert.equal(s.affordances().close, true);
  assert.equal(s.affordances().title, 'Proc 001');
  s.push({ view: 'documento', title: 'Petição' });
  s.push({ view: 'chat', title: 'Chat IA' });
  assert.equal(s.depth, 4);
  assert.equal(s.back().view, 'documento');
  assert.equal(s.depth, 3);
  assert.equal(s.close().view, 'processos');
  assert.equal(s.depth, 1);
});

test('createStack: back/close nunca esvaziam abaixo da raiz', () => {
  const s = LexNav.createStack();
  s.root({ view: 'inicio', title: 'Início' });
  s.back(); s.close();
  assert.equal(s.depth, 1);
  assert.equal(s.top.view, 'inicio');
});

test('create(): fallback sem History muta a pilha e dispara onNavigate', () => {
  const seen = [];
  const nav = LexNav.create({ onNavigate: (f) => seen.push(f && f.view) });
  nav.root({ view: 'processos', title: 'Processos' });
  nav.push({ view: 'processo', title: 'Proc' });
  nav.push({ view: 'chat', title: 'Chat' });
  assert.equal(nav.state().depth, 3);
  nav.back();
  assert.equal(nav.state().depth, 2);
  nav.close();
  assert.equal(nav.state().depth, 1);
  assert.equal(nav.state().frame.view, 'processos');
  assert.equal(seen[seen.length - 1], 'processos');
});

test('create(): confirmLeave=false bloqueia voltar e fechar', () => {
  const nav = LexNav.create({ confirmLeave: () => false });
  nav.root({ view: 'processos', title: 'P' });
  nav.push({ view: 'chat', title: 'Chat com rascunho' });
  nav.back();
  assert.equal(nav.state().depth, 2);
  nav.close();
  assert.equal(nav.state().depth, 2);
});

test('escapeHtml protege o título contra injeção', () => {
  assert.equal(LexNav._escapeHtml('<b>x</b>&"\''), '&lt;b&gt;x&lt;/b&gt;&amp;&quot;&#39;');
});
