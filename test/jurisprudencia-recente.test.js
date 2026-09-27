'use strict';
// Tarefa 29 (27/09/2026): "temos que pesquisar jurisprudência mais nova". A pesquisa não
// consultava nenhum TJ (processos do escritório em TJMG, TJDFT, TJSP) e o chat buscava em
// qualquer site. Agora: só fonte oficial, com os 27 TJs, priorizando os julgados recentes.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {OFFICIAL_LEGAL_DOMAINS,regraRecencia}=require('../lib/legal-quality');

const TJS=['tjac','tjal','tjap','tjam','tjba','tjce','tjdft','tjes','tjgo','tjma','tjmt','tjms','tjmg','tjpa','tjpb','tjpr','tjpe','tjpi','tjrj','tjrn','tjrs','tjro','tjrr','tjsc','tjsp','tjse','tjto'];

test('fontes oficiais incluem os 27 TJs e mantêm as anteriores',()=>{
  assert.equal(TJS.length,27);
  for(const tj of TJS)assert.ok(OFFICIAL_LEGAL_DOMAINS.includes(tj+'.jus.br'),'faltou '+tj);
  for(const d of ['stf.jus.br','stj.jus.br','trf6.jus.br','planalto.gov.br','lexml.gov.br'])assert.ok(OFFICIAL_LEGAL_DOMAINS.includes(d));
  assert.ok(!OFFICIAL_LEGAL_DOMAINS.some(d=>/jusbrasil|conjur|migalhas/.test(d)),'agregador não é fonte oficial');
});

test('regra de recência traz a data de hoje e exige datas e o julgado mais novo',()=>{
  const r=regraRecencia(new Date('2026-09-27T15:00:00Z'));
  assert.match(r,/27\/09\/2026/);
  assert.match(r,/24 meses/);
  assert.match(r,/data de julgamento/);
  assert.match(r,/mais recente para o mais antigo/);
  assert.match(r,/tese mais nova/);
  assert.match(r,/TJMG/);
});

test('pesquisa da tela: pesquisador e revisor recebem a regra de recência',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8');
  const bloco=src.slice(src.indexOf("if(url==='/api/jurisprudencia'"),src.indexOf("if(url==='/api/gestor/chat'"));
  assert.match(bloco,/const sysJuris = '[^\n]*'\+'\\n\\n'\+regraRecencia\(\);/);
  assert.match(bloco,/const sysRevisor = '[^\n]*'\+'\\n\\n'\+regraRecencia\(\);/);
});

test('pesquisa pelo chat: busca só em fonte oficial, sem agregadores, com a regra de recência',()=>{
  const core=fs.readFileSync(path.join(__dirname,'..','lex_agente_vivo_core.js'),'utf8');
  // CodeRabbit #151: a Anthropic exige name: 'web_search' nessa ferramenta.
  assert.match(core,/type: 'web_search_20250305', name: 'web_search', max_uses: 8, allowed_domains: OFFICIAL_LEGAL_DOMAINS/);
  const p=core.slice(core.indexOf('const PROMPT_PESQUISADOR_JURIS'),core.indexOf('const PROMPT_PESQUISADOR_JURIS')+3000);
  assert.doesNotMatch(p,/Use JusBrasil, Migalhas, ConJur/);
  assert.match(p,/agregadores \(JusBrasil, ConJur, Migalhas\) não servem como fonte/);
  assert.match(core,/const systemPrompt = PROMPT_PESQUISADOR_JURIS \+ ctxProcesso \+ instrucaoPje \+ ctxInicial \+ '\\n\\n' \+ regraRecencia\(\);/);
});

// CodeRabbit #151: o limite de buscas vale para a pesquisa inteira, não por rodada.
test('orçamento de buscas é da operação inteira: cai a cada rodada e avisa quando esgota',()=>{
  const {ajustarOrcamentoBusca}=require('../lex_agente_vivo_core');
  const tools=[{type:'web_search_20250305',name:'web_search',max_uses:8,allowed_domains:['stj.jus.br']},{name:'consolidar_jurisprudencia'}];
  let r=ajustarOrcamentoBusca(tools,3);
  assert.equal(r.tools[0].max_uses,5);assert.equal(r.esgotado,false);
  assert.equal(r.tools[0].name,'web_search');assert.deepEqual(r.tools[0].allowed_domains,['stj.jus.br']);
  assert.deepEqual(r.tools[1],{name:'consolidar_jurisprudencia'});
  assert.equal(tools[0].max_uses,8,'as ferramentas originais não são alteradas');
  r=ajustarOrcamentoBusca(tools,8);
  assert.equal(r.tools[0].max_uses,1);assert.equal(r.esgotado,true);
  r=ajustarOrcamentoBusca(tools,6);
  assert.equal(r.tools[0].max_uses,2,'sempre a partir do limite original (8)');
  assert.equal(ajustarOrcamentoBusca(undefined,5).tools,undefined);
});

test('resolverToolUse aplica o orçamento e avisa a IA quando as buscas acabam',()=>{
  const core=fs.readFileSync(path.join(__dirname,'..','lex_agente_vivo_core.js'),'utf8');
  const i=core.indexOf('async function resolverToolUse(');
  const corpo=core.slice(i,i+4000);
  assert.match(corpo,/const toolsOriginais = payload\.tools;/);
  assert.match(corpo,/ajustarOrcamentoBusca\(toolsOriginais, todasBuscas\.length\)/);
  assert.match(corpo,/ORÇAMENTO DE BUSCAS ESGOTADO/);
});
