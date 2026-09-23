'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

function loginBlock(html){
  const start=html.indexOf('<!-- TELA DE LOGIN -->');
  const end=html.indexOf('<div id="sidebar">',start);
  assert.ok(start>=0 && end>start,'bloco de login deve existir antes da sidebar');
  return html.slice(start,end);
}

test('login light DOM está limpo e usa classes comerciais',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const block=loginBlock(html);
  assert.doesNotMatch(html,/LOGIN CLARO COMERCIAL — CUT 4/);
  for(const cls of ['login-shell','login-card','login-input','login-submit','login-label','login-footer']) assert.match(block,new RegExp(cls));
  for(const legacy of ['background:#07070f','background:#0d0d1a','color:#e8eaf6','color:#555878']) assert.doesNotMatch(block,new RegExp(legacy.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  for(const id of ['login-bot-url','login-perfil','login-senha','olho-btn','btn-login']) assert.match(block,new RegExp(`id="${id}"`));
  assert.match(block,/onclick="fazerLogin\(\)"/);
  assert.doesNotMatch(block,/resetSenhasPadrao|Esqueceu a senha\?/);
});

test('varredura legada não é agendada diretamente no boot',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  assert.doesNotMatch(html,/setTimeout\(\s*varreduraInicial\s*,\s*2000\s*\)/);
  assert.match(html,/Varredura legada removida do boot comercial/);
});
