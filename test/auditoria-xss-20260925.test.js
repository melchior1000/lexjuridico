'use strict';
// Travas da auditoria de 25/09/2026 — grupo XSS.
// Texto de andamento, proposta do gestor IA e respostas de IA em cache passam
// por lexEscape antes de innerHTML. Não há HTML legítimo nesses campos: o LEX
// só converte "\n" em <br> depois de escapar.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const RAIZ=path.join(__dirname,'..');
const index=fs.readFileSync(path.join(RAIZ,'index.html'),'utf8');
const PAYLOAD='<img src=x onerror=alert(1)>';
const lexEscapeSrc=index.slice(index.indexOf('function lexEscape(value)'),index.indexOf('const LEX_SETORES'));

function fatia(ini,fim){const a=index.indexOf(ini);assert.ok(a>=0,'não achei '+ini);const b=index.indexOf(fim,a);assert.ok(b>a,'não achei '+fim);return index.slice(a,b);}
function semTagViva(html){assert.doesNotMatch(html,/<img/i,'tag viva no HTML');assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);}

test('detalhe do processo escapa texto e data dos andamentos',()=>{
  const trecho=fatia('function abrirProc(id){','const arquivosHtml=');
  // isola só a expressão `const ands=...` do corpo
  const expr=trecho.slice(trecho.indexOf('const ands='));
  const ctx=vm.createContext({});
  vm.runInContext(lexEscapeSrc+'\nfunction andsDe(p){'+expr+'\nreturn ands;}',ctx);
  const html=ctx.andsDe({id:1,andamentos:[{txt:PAYLOAD,data:'<b>2026-09-25</b>'}]});
  semTagViva(html);
  assert.match(html,/&lt;b&gt;2026-09-25&lt;\/b&gt;/);
});

test('impressão/relatório do processo escapa andamentos',()=>{
  const m=index.match(/\$\{p\.andamentos\.map\(a=>`<div class="and-item"><div>\$\{lexEscape\(a\.txt\)\}<\/div><div class="and-data">\$\{lexEscape\(a\.data\)\}<\/div><\/div>`\)\.join\(''\)\}/);
  assert.ok(m,'template do relatório deve escapar a.txt e a.data');
  assert.doesNotMatch(index,/<div class="and-item"><div>\$\{a\.txt\}/);
});

test('proposta do gestor IA escapa andamento, próxima ação, status, setor, prazo e justificativa',()=>{
  const trecho=fatia('function _renderPropostaGestor(p) {','async function aplicarPropostaGestor()');
  const el={innerHTML:''};
  const ctx=vm.createContext({document:{getElementById:()=>el},_gestorProcAtual:{status:'ATIVO',setor:'A'}});
  vm.runInContext(lexEscapeSrc+'\n'+trecho,ctx);
  ctx._renderPropostaGestor({andamento:PAYLOAD,proxima_acao:PAYLOAD,justificativa:PAYLOAD,status:PAYLOAD,setor:PAYLOAD,prazo:PAYLOAD,lembretes_concluidos:[PAYLOAD]});
  semTagViva(el.innerHTML);
  assert.equal((el.innerHTML.match(/&lt;img/g)||[]).length,7,'todos os campos da proposta escapados');
  assert.match(el.innerHTML,/onclick="aplicarPropostaGestor\(\)"/,'botões do LEX continuam funcionais');
});

test('respostas de IA em cache são escapadas antes de virar innerHTML (só \\n vira <br>)',()=>{
  // cache restaurado do localStorage
  const rest=fatia('function _restaurarCacheAnaliseProc(p){','function _restaurarCachePrognostico(p){');
  const container={innerHTML:''};
  const ctx=vm.createContext({document:{getElementById:()=>container},setTimeout:fn=>fn(),_analiseCache:{},_cacheIA_get:()=>({julgador:'Linha 1\n'+PAYLOAD})});
  vm.runInContext(lexEscapeSrc+'\n'+rest,ctx);
  ctx._restaurarCacheAnaliseProc({id:7});
  semTagViva(container.innerHTML);
  assert.match(container.innerHTML,/Linha 1<br>/);
  // caminhos ao vivo/cached na aba de análise
  assert.match(index,/'<div class="ia-txt">'\+lexEscape\(cache\[aba\]\)\.replace\(\/\\n\/g,'<br>'\)/);
  assert.match(index,/'<div class="ia-txt">'\+lexEscape\(_analiseCache\[procId\]\[aba\]\)\.replace\(\/\\n\/g,'<br>'\)/);
  assert.doesNotMatch(index,/'<div class="ia-txt">'\+cache\[aba\]\.replace/);
  assert.doesNotMatch(index,/'<div class="ia-txt">'\+\(_analiseCache\[procId\]\[aba\]\)\.replace/);
  assert.doesNotMatch(index,/String\(cached\.julgador\)\.replace/);
});
