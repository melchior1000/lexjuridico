// Trava permanente do white-label: falha se dados do escritório-piloto voltarem
// ao código de produção. A busca ignora maiúsculas/minúsculas e acentos — a
// primeira versão da varredura manual não ignorava e deixou passar "KLEUBER".
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const FORA = new Set(['node_modules', '.git', 'test', 'docs', 'evals']);
const EXT = /\.(js|html|css|json|md)$/i;
const IGNORAR_ARQUIVOS = new Set(['package-lock.json', 'AGENTS.md', 'AUDITORIA.md', 'README.md']);

// Termos do escritório-piloto e de sua carteira (comparados sem acento, minúsculos).
const PROIBIDOS = [
  /\bkleuber\b/, /\bcamargos\b/, /\bwanderson\b/, /\bmelchior\b/,
  /118\.?237/, /\bunai\b/, /\bsilves\b/, /\bbonfinopolis\b/,
  /696337324/, /5561999917171/
];

function arquivosDeProducao(dir = RAIZ, lista = []) {
  for (const nome of fs.readdirSync(dir)) {
    if (FORA.has(nome)) continue;
    const completo = path.join(dir, nome);
    const st = fs.statSync(completo);
    if (st.isDirectory()) arquivosDeProducao(completo, lista);
    else if (EXT.test(nome) && !IGNORAR_ARQUIVOS.has(nome)) lista.push(completo);
  }
  return lista;
}
const normalizar = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const soDigitos = t => String(t||'').replace(/\D/g, '');
const NUMEROS_PROIBIDOS = ['5561999333672','5561999171717','5561999917171'];

test('nenhum dado do escritório-piloto em código de produção (sem diferenciar maiúsculas/acentos)', () => {
  const achados = [];
  const arquivos = arquivosDeProducao();
  assert.ok(arquivos.some(f => f.endsWith('bot.js')) && arquivos.some(f => f.endsWith('index.html')), 'varredura precisa cobrir bot.js e index.html');
  for (const arquivo of arquivos) {
    const bruto = fs.readFileSync(arquivo, 'utf8');
    const linhas = normalizar(bruto).split('\n');
    linhas.forEach((linha, i) => {
      for (const termo of PROIBIDOS) if (termo.test(linha)) achados.push(path.relative(RAIZ, arquivo) + ':' + (i + 1) + ' ' + termo);
    });
    const digitos = soDigitos(bruto);
    for (const numero of NUMEROS_PROIBIDOS) if (digitos.includes(numero)) achados.push(path.relative(RAIZ, arquivo) + ': número-piloto ' + numero);
  }
  assert.deepEqual(achados, [], 'Referências ao escritório-piloto encontradas:\n' + achados.join('\n'));
});

test('a trava detecta variações em maiúsculas e sem acento', () => {
  for (const amostra of ['INSTRUÇÕES DE KLEUBER', 'CAMARGOS ADVOCACIA', 'Comarca de Unai/MG', 'Comarca de Unaí/MG'])
    assert.ok(PROIBIDOS.some(t => t.test(normalizar(amostra))), amostra);
  for (const amostra of ['+55 (61) 99933-3672', '61 99917-1717'])
    assert.ok(NUMEROS_PROIBIDOS.some(n => soDigitos(amostra).includes(n) || n.endsWith(soDigitos(amostra))), amostra);
});

// Extração de cidade: genérica, sem lista fixa da carteira de um escritório.
const fonte = fs.readFileSync(path.join(RAIZ, 'bot.js'), 'utf8');
const ini = fonte.indexOf('function _normTexto('), fimNorm = fonte.indexOf('\n}\n', ini) + 3;
const extrair = new Function(fonte.slice(ini, fimNorm) + fonte.slice(fonte.indexOf('const _UFS_LEX'), fonte.indexOf('// Score 0-30: vara')) +
  ';return t => _extrairCidadeTribunal(_normTexto(t));')();

test('cidade/comarca é extraída para qualquer escritório, não só da carteira do piloto', () => {
  const casos = {
    'TJSP - 1ª Vara Cível de Campinas/SP': 'campinas',
    'Comarca de Chapecó/SC': 'chapeco',
    'TJDFT - Brasília/DF': 'brasilia',
    '2ª Vara Cível de Belo Horizonte/MG': 'belo horizonte',
    'Seção Judiciária de Goiás': 'goias',
    'Vara Federal de Palmas/TO': 'palmas',
    'TJSP 1ª Vara Cível/SP': null,
    'TRF-6': null
  };
  for (const [texto, esperado] of Object.entries(casos)) assert.equal(extrair(texto), esperado, texto);
});
