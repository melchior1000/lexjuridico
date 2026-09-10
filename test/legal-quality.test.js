'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {
  OFFICIAL_LEGAL_DOMAINS,
  isOfficialLegalUrl,
  extractOfficialSources,
  jurisprudenceAssurance
} = require('../lib/legal-quality');

test('pesquisa jurídica aceita fontes oficiais e recusa agregadores', () => {
  assert.equal(isOfficialLegalUrl('https://processo.stj.jus.br/SCON/'), true);
  assert.equal(isOfficialLegalUrl('https://portal.trt3.jus.br/acordao'), true);
  assert.equal(isOfficialLegalUrl('http://stj.jus.br/inseguro'), false);
  assert.equal(isOfficialLegalUrl('https://jusbrasil.com.br/jurisprudencia'), false);
  assert.equal(isOfficialLegalUrl('https://stj.jus.br.exemplo.com/falso'), false);
  assert.ok(OFFICIAL_LEGAL_DOMAINS.includes('cnj.jus.br'));
});

test('fontes extraídas preservam apenas URLs oficiais e eliminam duplicações', () => {
  const result = {
    texto: 'Confira https://www.stj.jus.br/acordao e https://conjur.com.br/materia',
    raw: {content:[{citations:[
      {url:'https://www.stj.jus.br/acordao',title:'Acórdão STJ'},
      {url:'https://portal.trt3.jus.br/julgado',title:'Julgado TRT3'}
    ]}]}
  };
  assert.deepEqual(extractOfficialSources(result), [
    {url:'https://www.stj.jus.br/acordao',titulo:'Acórdão STJ'},
    {url:'https://portal.trt3.jus.br/julgado',titulo:'Julgado TRT3'}
  ]);
});

test('garantia registra duas pesquisas e revisão humana obrigatória', () => {
  const first={buscas:[{query:'tema STJ'}],texto:'',raw:{content:[]}};
  const review={buscas:[{query:'confirmar REsp'}],texto:'https://stj.jus.br/resp',raw:{content:[]}};
  const status=jurisprudenceAssurance(first,review);
  assert.equal(status.nivel,'dupla_pesquisa_oficial');
  assert.equal(status.consultas_realizadas,2);
  assert.equal(status.fontes_oficiais.length,1);
  assert.equal(status.revisao_humana_obrigatoria,true);
});

test('rotas críticas fixam modelo forte, dupla checagem e cálculo determinístico', () => {
  const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','bot.js'),'utf8');
  const jurisprudencia=source.slice(source.indexOf("if(url==='/api/jurisprudencia'"),source.indexOf("if(url==='/api/gestor/chat'"));
  assert.match(jurisprudencia,/allowedDomains: OFFICIAL_LEGAL_DOMAINS/);
  assert.match(jurisprudencia,/modelo: MODELO_LEGAL/);
  assert.match(jurisprudencia,/sysRevisor/);
  assert.doesNotMatch(jurisprudencia,/jusbrasil|conjur/i);
  const pericia=source.slice(source.indexOf("if(url==='/api/pericia/triagem'"),source.indexOf("if(url==='/api/pericia/anexar'"));
  assert.match(pericia,/calculos_deterministicos/);
  assert.match(pericia,/sysRevisorPericial/);
  assert.match(pericia,/revisao_humana_obrigatoria:true/);
});

test('gerador Word aplica padrão forense e Edição Azul sem expor marcação bruta', async () => {
  const JSZip=require('jszip');
  const {setup}=require('./runtime');
  const app=setup({JSZip});
  const peticao=app.context._gerarDocxBufferPeca('Petição de teste','# I DOS FATOS\nTexto **jurídico**.','peticao');
  const petZip=await JSZip.loadAsync(peticao,{checkCRC32:true});
  const petXml=await petZip.file('word/document.xml').async('string');
  assert.match(petXml,/w:pgSz w:w="12240" w:h="15840"/);
  assert.match(petXml,/w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701"/);
  assert.match(petXml,/w:rFonts w:ascii="Arial"/);
  assert.match(petXml,/w:spacing w:line="360"/);
  assert.match(petXml,/w:ind w:firstLine="709"/);
  assert.doesNotMatch(petXml,/# I DOS FATOS|\*\*/);

  const laudo=app.context._gerarDocxBufferPeca('Minuta pericial','I METODOLOGIA\nTexto técnico.\n| Item | Valor |\n|---|---|\n| TOTAL | 10 |','laudo_pericial');
  const lauZip=await JSZip.loadAsync(laudo,{checkCRC32:true});
  const lauXml=await lauZip.file('word/document.xml').async('string');
  assert.match(lauXml,/w:fill="0B2545"/);
  assert.match(lauXml,/w:fill="D9E2F3"/);
  assert.match(lauXml,/w:rFonts w:ascii="Cambria"/);
  assert.match(lauXml,/Laudo Institucional Edição Azul/);
});

test('peça final oculta protocolo interno e preserva preparação recursal', () => {
  const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','bot.js'),'utf8');
  const gerar=source.slice(source.indexOf('async function gerarDoc('),source.indexOf('async function gerarEEnviar('));
  assert.match(gerar,/prepare.*STJ\/STF|cadeia recursal/is);
  assert.match(gerar,/não revele diagnóstico interno/i);
  assert.doesNotMatch(gerar,/ao final da peça, inclua seção "ANÁLISE ESTRATÉGICA/);
});
