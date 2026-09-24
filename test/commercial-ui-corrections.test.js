'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const js=fs.readFileSync(path.join(__dirname,'../office-ui-v2.js'),'utf8');

test('tema comercial sincroniza com tema legado',()=>{
  assert.match(js,/lex_commercial_theme/);
  assert.match(js,/lex_tema/);
  assert.match(js,/classList\.toggle\('dia'/);
  assert.match(js,/classList\.toggle\('noite'/);
});

test('varredura antiga e desativada no boot comercial',()=>{
  assert.match(js,/function\s+disableLegacySweep\s*\(/);
  assert.match(js,/window\.varreduraInicial\s*=\s*function/);
  assert.match(js,/varredura-overlay/);
  assert.match(js,/setInterval/);
});

test('abas de processos e prazos possuem filtros ativos',()=>{
  assert.match(js,/lexSetProcFilter/);
  assert.match(js,/onclick=\"lexSetProcFilter/);
  assert.match(js,/lexSetPrazoTab/);
  assert.match(js,/onclick=\"lexSetPrazoTab/);
});

test('chat do LEX envia contexto do processo selecionado',()=>{
  assert.match(js,/id=\"lex-chat-process\"/);
  assert.match(js,/processo_id/);
  assert.match(js,/numero_processo/);
  assert.match(js,/payload\.setor/);
  assert.match(js,/\/api\/vivo\/conversar/);
});


test('filtros de prazo separam legado de prazo confirmado',()=>{
  assert.match(js,/function deadlineConfirmed\(p\)/);
  assert.match(js,/revisar:all\.filter\(x=>!x\.confirmed\)/);
  assert.match(js,/vencidos:all\.filter\(x=>x\.confirmed&&x\.d<0\)/);
  assert.match(js,/hoje:all\.filter\(x=>x\.confirmed&&x\.d===0\)/);
  assert.match(js,/dias7:all\.filter\(x=>x\.confirmed&&x\.d>0&&x\.d<=7\)/);
  assert.match(js,/Revisar <b>/);
  assert.match(js,/Vencidos <b>/);
  assert.match(js,/Todos <b>/);
  assert.match(js,/Nenhum prazo confirmado vence hoje/);
  assert.match(js,/Nenhum prazo confirmado vence nos próximos 7 dias/);
  assert.match(js,/Anotado no LEX, ainda não conferido no tribunal/);
  assert.match(js,/PRAZO A CONFERIR NO TRIBUNAL/);
});

test('Organizar com o LEX envia contexto real de prazos ao Core em vez de abrir chat vazio',()=>{
  assert.match(js,/window\.lexOrganizeDeadlines=function/);
  assert.match(js,/deadlineOrganizeCommand\(\)/);
  assert.match(js,/window\.lexChat\(''\)/);
  assert.match(js,/input\.value=command/);
  assert.match(js,/form\.requestSubmit\(\)/);
  assert.match(js,/onclick="lexOrganizeDeadlines\(\)">Organizar com o LEX/);
  assert.doesNotMatch(js,/onclick="lexChat\(\)">Organizar com o LEX/);
});


test('navegação comercial possui voltar contextual em vez de forçar início',()=>{
  assert.match(js,/let navCurrent=null,navTrail=\[\],navRestoring=false/);
  assert.match(js,/window\.lexBack=function/);
  assert.match(js,/const target=navTrail\.pop\(\)\|\|'home'/);
  assert.match(js,/class="lex-shell-back" onclick="lexBack\(\)"/);
});

test('carteira grande usa paginação explícita e não corta silenciosamente em 30',()=>{
  assert.match(js,/const PROC_PAGE_SIZE=40,DEADLINE_PAGE_SIZE=40/);
  assert.match(js,/function pageSlice\(list,page,size\)/);
  assert.match(js,/function pagerHtml\(meta,kind\)/);
  assert.match(js,/lexSetProcPage/);
  assert.match(js,/Página /);
  assert.doesNotMatch(js,/function procRows\(list\)\{return list\.slice\(0,30\)/);
});

test('processos possuem busca global, encerrados e ordenação',()=>{
  assert.match(js,/procTab==='arquivados'/);
  assert.match(js,/lexSetProcSort/);
  assert.match(js,/Atualizados/);
  assert.match(js,/Buscar número, cliente, parte, assunto/);
  assert.match(js,/cliente/);
  assert.match(js,/responsavel/);
});

test('prazos também paginam e avisam quando servidor auditável falha',()=>{
  assert.match(js,/lexSetPrazoPage/);
  assert.match(js,/DEADLINE_PAGE_SIZE/);
  assert.match(js,/Não consegui confirmar os prazos auditáveis no servidor/);
  assert.doesNotMatch(js,/function deadlineRows\(list,emptyMessage=deadlineEmptyMessage\(\)\)\{return list\.slice\(0,30\)/);
});
