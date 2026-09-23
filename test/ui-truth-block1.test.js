'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('login publico nao expoe falso reset de senha',()=>{
  const html=read('index.html');
  const start=html.indexOf('<!-- TELA DE LOGIN -->');
  const end=html.indexOf('<div id="sidebar">',start);
  const block=html.slice(start,end);
  assert.doesNotMatch(block,/resetSenhasPadrao|Esqueceu a senha\?/);
  assert.doesNotMatch(html,/function\s+resetSenhasPadrao\s*\(/);
});

test('browser nao declara webhook WhatsApp nem envia carteira pelo window',()=>{
  const html=read('index.html');
  assert.doesNotMatch(html,/window\.receberWebhookWhatsApp/);
  assert.doesNotMatch(html,/receptor nativo para Evolution API/);
});

test('backup client nao inclui configuracoes de canal ou PJe',()=>{
  const html=read('index.html');
  const start=html.indexOf('function _cdColetarTudo(){');
  const end=html.indexOf('function _cdNomeBase()',start);
  assert.ok(start>=0&&end>start);
  const block=html.slice(start,end);
  for(const secretKey of ['lex_whatsapp_cfg_v1','lex_tg_config','lex_pje_config','lex_pje_adv_cfg_v1']){
    assert.doesNotMatch(block,new RegExp(secretKey));
  }
  for(const ref of ['col.whatsapp_config','col.telegram_config','col.pje_config','col.pje_adv_config']){
    assert.doesNotMatch(html,new RegExp(ref.replace('.','\\.')));
  }
});

test('casca comercial nao publica telefones nem nome pessoal como fallback',()=>{
  const bridge=read('office-ui.js');
  const shell=read('office-ui-v2.js');
  assert.doesNotMatch(bridge,/99933-3672|99917-1717|\b7171\b/);
  assert.doesNotMatch(shell,/'Kleuber'/);
  assert.match(shell,/\|\|'você'/);
});

test('chat movel usa a porta oficial e nao sugere nome de titular',()=>{
  const html=read('lex-whatsapp.html');
  assert.match(html,/const endpoint = '\/api\/vivo\/conversar'/);
  assert.doesNotMatch(html,/endpoint\s*=.*\/api\/chat/);
  assert.doesNotMatch(html,/placeholder="Kleuber"/);
});

test('conector se apresenta como captura assistida e nao como login PJe',()=>{
  const popup=read('conector-navegador/popup.html');
  const readme=read('conector-navegador/README.md');
  assert.match(popup,/Importar andamento selecionado/);
  assert.match(popup,/Não conecta nem autentica no PJe/);
  assert.match(readme,/Não conecta nem autentica no PJe/);
});
