'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('chat comercial delega ordem Datajud ao Core do servidor',()=>{
  const parser=fs.readFileSync('lib/office-command.js','utf8');
  const ui=fs.readFileSync('office-command-ui.js','utf8');
  const chat=fs.readFileSync('office-ui-v2.js','utf8');
  const routes=fs.readFileSync('lib/office-routes.js','utf8');
  assert.match(parser,/action:'datajud'/);
  assert.doesNotMatch(ui,/\/api\/escritorio\/datajud/);
  assert.match(chat,/\/api\/vivo\/conversar/);
  assert.match(routes,/Datajud\.syncProcess/);
  assert.match(routes,/executeNaturalOfficeCommand/);
});
