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

test('letras quebradas da tela antiga (06/10/2026): ç perdido, ª/º, travessão e nomes de cidade', () => {
  assert.equal(lexFixText('Execu��ão'), 'Execução');
  assert.equal(lexFixText('Impugnaç��o à penhora'), 'Impugnação à penhora');
  assert.equal(lexFixText('2�� Vara Cível ��� Itabira/MG'), '2ª Vara Cível — Itabira/MG');
  // Nome de cidade não fica no código (produto para qualquer escritório): é aprendido dos
  // dados do próprio escritório, onde aparece escrito certo. Sem aprender, não adivinha.
  assert.equal(lexFixText('Vara de Itaj���/SC'), 'Vara de Itaj/SC');
  lexFixText.aprender([{tribunal: '1ª Vara — Itajaí/SC'}, {nome: 'Simões'}, {nome: 'Simães'}]);
  assert.equal(lexFixText('2ª Vara Cível ��� Itaja�������/SC'), '2ª Vara Cível — Itajaí/SC');
  assert.equal(lexFixText('ITAJA��/SC'), 'ITAJAÍ/SC');
  assert.equal(lexFixText('Sim��es'), 'Simes'); // ambíguo: não escolhe
  // Ambiguidade conferida sem diferenciar maiúsculas (revisão do PR #160).
  lexFixText.aprender([{nome: 'Simões'}, {nome: 'SIMÃES'}], 'teste');
  assert.equal(lexFixText('SIM��ES'), 'SIMES');
  assert.equal(lexFixText('1�� Juizado Especial'), '1º Juizado Especial');
  assert.equal(lexFixText('C�vel e Fam�lia'), 'Cível e Família');
  assert.equal(lexFixText('Fazenda P�blica — S�o Jo�o'), 'Fazenda Pública — São João');
  assert.equal(lexFixText('Notificaç�ões'), 'Notificações');
  assert.equal(lexFixText('2ª Vara Cível — Itajaí/SC'), '2ª Vara Cível — Itajaí/SC');
  // Tela antiga também passa pelo conserto e não injeta área/frentes sem escapar.
  const html = read('index.html');
  assert.match(html, /function lexEscape\(value\) \{\s*return String\(\(globalThis\.lexFixText\|\|String\)\(value \?\? ''\)\)/);
  assert.match(html, /<span class="tag">\$\{lexEscape\(p\.area\)\}<\/span>/);
  assert.match(html, /<span class="tag">\$\{lexEscape\(f\)\}<\/span>/);
  assert.doesNotMatch(read('office-dossier-ui.js'), /'&quot'[,}]/);
});

test('conserto de texto: maiúsculas, "ã" perdido no fim da palavra e nada inventado', () => {
  assert.equal(lexFixText('EXECU��ÃO'), 'EXECUÇÃO');
  assert.equal(lexFixText('Pens��o aliment�cia'), 'Pensão alimentícia');
  assert.equal(lexFixText('Quest�o e Certid�o'), 'Questão e Certidão');
  assert.equal(lexFixText('CERTID��O'), 'CERTIDÃO');
  for (const t of ['Sessão de julgamento', 'São Paulo', '3ª Vara', 'Serviço', 'caso isso'])
    assert.equal(lexFixText(t), t);
});

test('aprender: cadastro do escritório não se perde quando os processos são regravados; texto longo fica fora', () => {
  lexFixText.aprender({endereco: 'Rua 1 — Chapecó/SC'}, 'escritorio');
  lexFixText.aprender([{nome: 'Ação de cobrança'}], 'processos');
  assert.equal(lexFixText('Chapec��/SC'), 'Chapecó/SC');
  lexFixText.aprender([{andamentos: [{txt: 'Juntada em Xanxerê'}], nome: 'x'}, {nome: 'y'.repeat(10) + ' ' + 'Xaxim'}], 'processos');
  assert.equal(lexFixText('Xanxer��'), 'Xanxer'); // andamento não ensina
  assert.equal(lexFixText('Chapec��/SC'), 'Chapecó/SC');
});

test('aprender: dados grandes não travam a tela', () => {
  const nomes = Array.from({length: 4000}, (_, i) => ({nome: 'Cliente Joãozinho' + 'abcdefghij'[i % 10] + i, tribunal: 'Vara de Itaú' + i, andamentos: [{txt: 'x'.repeat(2000)}]}));
  let t = Date.now();
  lexFixText.aprender(nomes, 'carga');
  assert.ok(Date.now() - t < 1500, 'aprender demorou ' + (Date.now() - t) + ' ms');
  t = Date.now();
  for (let i = 0; i < 300; i++) lexFixText('Execu��ão na 2�� Vara de Chapec�� ' + i);
  assert.ok(Date.now() - t < 300, '300 campos demoraram ' + (Date.now() - t) + ' ms');
  lexFixText.aprender([], 'carga');
});
