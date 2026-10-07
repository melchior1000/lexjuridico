'use strict';
// Telas antigas não podem pintar por cima da tela nova.
// Defeito reproduzido (06/10/2026): ao abrir o app, a lista antiga de processos aparecia
// com o título "Mais" e depois sumia. Causa: atualizações em segundo plano (comandos do
// Telegram, sincronização, aviso do motor) chamavam renderProcessos()/renderPainel(), que
// escreviam a tela antiga em #content sem conferir qual tela estava aberta.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const {lexLegadoPodePintar, lexMarcarLegado, lexLimparLegado} = require('../lex-legacy-guard.js');

function fakeDoc({comercial = true, telaNova = false, legado = ''} = {}) {
  const host = {dataset: legado ? {lexLegado: legado} : {}, querySelector: sel => (telaNova && /lex-screen/.test(sel) ? {} : null)};
  return {
    host,
    body: {classList: {contains: c => c === 'lex-commercial' && comercial}},
    getElementById: id => (id === 'content' ? host : null)
  };
}
const win = {lexHome() {}, lexProcessos() {}, lexPrazos() {}};

test('tela nova aberta: atualização em segundo plano não pinta a tela antiga por cima', () => {
  for (const tela of ['painel', 'processos', 'prazos']) {
    assert.equal(lexLegadoPodePintar(tela, fakeDoc({telaNova: true}), win), false, tela);
    // Mesmo com marca antiga esquecida (o usuário saiu pela barra de baixo, sem passar pelo roteador).
    assert.equal(lexLegadoPodePintar(tela, fakeDoc({telaNova: true, legado: tela}), win), false, tela);
  }
});

test('ao abrir o app (tela vazia ou de entrada) a tela antiga não aparece', () => {
  assert.equal(lexLegadoPodePintar('processos', fakeDoc(), win), false);
  assert.equal(lexLegadoPodePintar('painel', fakeDoc(), win), false);
});

test('a própria tela antiga, já aberta, continua podendo se atualizar (filtros)', () => {
  assert.equal(lexLegadoPodePintar('processos', fakeDoc({legado: 'processos'}), win), true);
  // Outra tela antiga aberta não é substituída.
  assert.equal(lexLegadoPodePintar('prazos', fakeDoc({legado: 'processos'}), win), false);
});

test('sem a tela nova (ou fora do modo comercial) a tela antiga segue como reserva', () => {
  assert.equal(lexLegadoPodePintar('processos', fakeDoc(), {}), true);
  assert.equal(lexLegadoPodePintar('processos', fakeDoc({comercial: false}), win), true);
  assert.equal(lexLegadoPodePintar('desconhecida', fakeDoc(), win), true);
});

test('marca e limpa qual tela antiga está aberta', () => {
  const doc = fakeDoc();
  lexMarcarLegado('prazos', doc);
  assert.equal(doc.host.dataset.lexLegado, 'prazos');
  lexLimparLegado(doc);
  assert.equal(doc.host.dataset.lexLegado, undefined);
});

test('telas antigas e atualizações usam a trava; roteador limpa a marca; abertura não mostra tela velha', () => {
  const html = read('index.html');
  assert.match(html, /function _renderPainelReal\(\)\{[\s\S]{0,200}lexLegadoPodePintar\('painel'\)/);
  assert.match(html, /function renderProcessosFiltrado\(filtro\)\{[\s\S]{0,200}lexLegadoPodePintar\('processos'\)/);
  assert.match(html, /function renderPrazos\(\)\{[\s\S]{0,200}lexLegadoPodePintar\('prazos'\)/);
  for (const t of ['painel', 'processos', 'prazos']) assert.match(html, new RegExp("lexMarcarLegado\\('" + t + "'\\)"));
  assert.match(read('lex-nav.js'), /call\('lexLimparLegado'\)/);
  assert.match(read('office-ui.js'), /lex-text\.js[\s\S]*lex-legacy-guard\.js[\s\S]*office-ui-base\.js/);
  // Entrada: a área de conteúdo é limpa antes de abrir a primeira tela.
  assert.match(html, /function ativarApp\(perfil\)\{[\s\S]{0,1400}lex-abrindo[\s\S]{0,300}ir\(perfil==='admin'/);
});
