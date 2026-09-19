'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const ui=fs.readFileSync('office-ui-v2.js','utf8');
const css=fs.readFileSync('office-ui-v2.css','utf8');
const routes=fs.readFileSync('lib/office-routes.js','utf8');

test('console comercial usa a Recepção unificada para WhatsApp e Telegram',()=>{
  assert.match(ui,/window\.lexChannel=async function/);
  assert.match(ui,/\/api\/escritorio\/recepcao\?status=/);
  assert.match(ui,/\/api\/escritorio\/recepcao\/historico/);
  assert.match(ui,/\/api\/escritorio\/recepcao\/responder/);
  assert.match(ui,/A resposta sai pelo mesmo canal/);
  assert.doesNotMatch(ui,/goLex\(\\'whatsapp\\'\)/);
  assert.doesNotMatch(ui,/goLex\(\\'telegram\\'\)/);
});

test('console de canais é responsivo para computador tablet e celular',()=>{
  assert.match(css,/\.lex-channel-console\{display:grid;grid-template-columns:/);
  assert.match(css,/@media\(max-width:700px\)/);
  assert.match(css,/\.lex-channel-console\.has-open-chat \.lex-channel-sidebar\{display:none\}/);
  assert.match(css,/\.lex-channel-console\.has-open-chat \.lex-channel-chat\{display:flex\}/);
});

test('secretaria e responsável jurídico podem operar a Recepção sem liberar configuração',()=>{
  assert.match(routes,/secretariaPodeRecepcao=profile==='secretaria'&&path\.startsWith\('\/api\/escritorio\/recepcao'\)/);
  assert.match(routes,/\['admin','advogado','secretaria'\]\.includes\(profile\)/);
  assert.match(routes,/Recepção restrita à equipe autorizada/);
});
