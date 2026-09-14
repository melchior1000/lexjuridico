'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('chat comercial envia ordem Datajud pela rota do escritório',()=>{
  const parser=fs.readFileSync('lib/office-command.js','utf8');
  const ui=fs.readFileSync('office-command-ui.js','utf8');
  assert.match(parser,/action:'datajud'/);
  assert.match(ui,/\/api\/escritorio\/datajud/);
  assert.match(ui,/movimento\(s\) novo\(s\)/);
});
