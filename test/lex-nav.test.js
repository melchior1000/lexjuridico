// Roteador único da interface: travas contra regressão da navegação.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const navSrc = fs.readFileSync(path.join(RAIZ, 'lex-nav.js'), 'utf8');

function montar({admin = true, telas = {}} = {}) {
  const botoes = [...html.matchAll(/<button class="nav-btn[^"]*" data-route="([\w-]+)"[^>]*>/g)].map(m => {
    const cls = new Set(); const attrs = {'data-route': m[1]};
    return {attrs, classList: {toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), has: c => cls.has(c)},
      getAttribute: k => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; }};
  });
  const el = {content: {innerHTML: ''}, 'page-title': {textContent: ''}, 'lex-nav-mais': {open: false}};
  const chamadas = [];
  const win = {
    podeConfig: () => admin, fecharSidebar: () => chamadas.push('fecharSidebar'), esconderBackBar: () => chamadas.push('esconderBackBar'),
    addEventListener() {}, ...telas
  };
  const ctx = vm.createContext({
    window: win, console: {error() {}, log() {}},
    document: {readyState: 'complete', addEventListener() {}, getElementById: id => el[id] || null,
      querySelectorAll: sel => (sel.includes('nav-btn') ? botoes : []), createElement: () => ({}), head: {appendChild() {}}},
    location: {hash: ''}, history: {replaceState(a, b, h) { ctx.location.hash = h; }}, setTimeout: () => 0
  });
  vm.runInContext('var pag, procAtivo;' + navSrc, ctx);
  win.lexNav.instalar(); // no navegador é chamado no DOMContentLoaded/load
  return {ctx, win, el, botoes, chamadas};
}

test('toda tela do roteador antigo continua acessível no roteador novo', () => {
  const antigo = html.match(/\(\{trabalho:renderTrabalho[^)]*\}\)\[p\]/)[0];
  const ids = [...antigo.matchAll(/(\w+):render\w+/g)].map(m => m[1]);
  assert.ok(ids.length >= 20, 'mapa antigo lido: ' + ids.length);
  const {win} = montar();
  for (const id of [...ids, 'recepcao']) assert.ok(win.lexNav.resolver(id), 'sem rota para ' + id);
});

test('menu: cada botão aponta para rota existente, sem duplicata, e cada rota tem botão', () => {
  const {win, botoes} = montar();
  const doMenu = botoes.map(b => b.attrs['data-route']);
  assert.equal(new Set(doMenu).size, doMenu.length, 'botão duplicado no menu');
  for (const id of doMenu) assert.equal(win.lexNav.resolver(id), id);
  for (const r of win.lexNav.rotas) assert.ok(doMenu.includes(r.id), 'rota sem botão: ' + r.id);
  assert.ok(html.includes('id="import-file"') && html.includes('id="_pjeDot"') && html.includes('id="lex-nav-recepcao"'));
});

test('abrir tela: chama a função atual, título, item ativo, fecha menu e grava endereço', () => {
  let aberta = 0;
  const {win, el, botoes, chamadas, ctx} = montar({telas: {lexProcessos: () => { aberta++; }, renderProcessos: () => { throw new Error('não deve usar a antiga'); }}});
  assert.equal(win.ir('processos'), true);
  assert.equal(aberta, 1);
  assert.equal(el['page-title'].textContent, 'Processos');
  assert.ok(botoes.find(b => b.attrs['data-route'] === 'processos').classList.has('active'));
  assert.ok(!botoes.find(b => b.attrs['data-route'] === 'painel').classList.has('active'));
  assert.deepEqual(chamadas, ['fecharSidebar', 'esconderBackBar']);
  assert.equal(ctx.location.hash, '#/processos');
});

test('sem a versão nova, usa a tela antiga como reserva', () => {
  let antiga = 0;
  const {win} = montar({telas: {renderProcessos: () => { antiga++; }}});
  win.ir('processos');
  assert.equal(antiga, 1);
});

test('camadas antigas não conseguem embrulhar o roteador de novo', () => {
  const {win} = montar();
  assert.ok(win.ir.__commercial && win.ir.__lexToday && win.ir.__commercialProduction);
});

test('tela inexistente mostra aviso em vez de página em branco', () => {
  const {win, el} = montar();
  assert.equal(win.ir('<img src=x onerror=alert(1)>'), false);
  assert.match(el.content.innerHTML, /Tela não encontrada/);
  assert.doesNotMatch(el.content.innerHTML, /<img/);
});

test('secretária não abre configuração nem pelo endereço', () => {
  let aberta = 0;
  const {win, el} = montar({admin: false, telas: {renderGestaoSenhas: () => { aberta++; }}});
  win.ir('senhas');
  assert.equal(aberta, 0);
  assert.match(el.content.innerHTML, /Acesso restrito/);
});

test('erro dentro da tela vira mensagem clara, sem travar a navegação', () => {
  const {win, el} = montar({telas: {renderJuris: () => { throw new Error('quebrou'); }}});
  assert.equal(win.ir('juris'), true);
  assert.match(el.content.innerHTML, /Não foi possível abrir/);
});

test('nome antigo "agentes" leva a Meu escritório', () => {
  const {win} = montar();
  assert.equal(win.lexNav.resolver('agentes'), 'escritorio');
});

test('modal da planilha de dívida tem uma única função de fechar, que permite reabrir', () => {
  assert.equal((html.match(/function fecharPlanilhaDividaModal\s*\(/g) || []).length, 1);
  assert.match(html, /function fecharPlanilhaDividaModal\(\)\{[\s\S]{0,200}classList\.remove\('open'\);\s*ov\.style\.display=''/);
});

test('busca rápida e alertas escapam nome, partes e tribunal do processo', () => {
  const busca = html.slice(html.indexOf('function buscarLive('), html.indexOf('function fecharBusca('));
  assert.match(busca, /\$\{lexEscape\(p\.nome\)\}/);
  assert.doesNotMatch(busca, /\$\{p\.(nome|partes|tribunal)\}/);
  const linhasHtml = html.split('\n').filter(l => l.includes('<') && /\$\{p\.(nome|partes|tribunal)\}/.test(l));
  assert.deepEqual(linhasHtml, []);
});

test('office-ui.js carrega o roteador por último', () => {
  const loader = fs.readFileSync(path.join(RAIZ, 'office-ui.js'), 'utf8').trim().split('\n');
  assert.match(loader[loader.length - 1], /lex-nav\.js/);
});
