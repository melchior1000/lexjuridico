// Trava permanente do white-label: falha se dados do escritório-piloto voltarem
// ao código de produção. A busca ignora maiúsculas/minúsculas e acentos.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const FORA = new Set(['node_modules', '.git', 'test', 'evals']);
const EXT = /\.(js|html|css|json|md|diff)$/i;
const IGNORAR_ARQUIVOS = new Set(['package-lock.json', 'AGENTS.md', 'README.md']);

const PROIBIDOS = [
  /\bkleuber\b/, /\bcamargos\b/, /\bwanderson\b/, /\bmelchior\b/, /melchior1000/,
  /118\.?237/, /\bunai\b/, /\bsilves\b/, /\bbonfinopolis\b/,
  /696337324/, /5561999917171/, /61999333672/, /61999171717/,
  /\bvarejao\b/, /\bcofco\b/, /5009280-55/,
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

test('nenhum dado do escritório-piloto em código de produção', () => {
  const achados = [];
  const arquivos = arquivosDeProducao();
  assert.ok(arquivos.some(f => f.endsWith('bot.js')) && arquivos.some(f => f.endsWith('index.html')));
  for (const arquivo of arquivos) {
    const linhas = normalizar(fs.readFileSync(arquivo, 'utf8')).split('\n');
    linhas.forEach((linha, i) => {
      for (const termo of PROIBIDOS) if (termo.test(linha)) achados.push(path.relative(RAIZ, arquivo) + ':' + (i + 1) + ' ' + termo);
    });
  }
  assert.deepEqual(achados, [], 'Referências ao escritório-piloto encontradas:\n' + achados.join('\n'));
});

test('a trava detecta variações de caixa e acento', () => {
  for (const amostra of ['INSTRUÇÕES DE KLEUBER', 'CAMARGOS ADVOCACIA', 'Comarca de Unai/MG', 'Comarca de Unaí/MG'])
    assert.ok(PROIBIDOS.some(t => t.test(normalizar(amostra))), amostra);
});

const fonte = fs.readFileSync(path.join(RAIZ, 'bot.js'), 'utf8');
const ini = fonte.indexOf('function _normTexto('), fimNorm = fonte.indexOf('\n}\n', ini) + 3;
const extrair = new Function(fonte.slice(ini, fimNorm) + fonte.slice(fonte.indexOf('const _UFS_LEX'), fonte.indexOf('// Score 0-20:')) +
  ';return t => _extrairCidadeTribunal(_normTexto(t));')();

test('cidade/comarca é extraída sem lista fixa da carteira', () => {
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
