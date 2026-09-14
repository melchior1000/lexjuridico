'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ui=fs.readFileSync('office-ui-v2.js','utf8');
const syntax=fs.readFileSync('scripts/check-syntax.js','utf8');

test('Escritório monta quadro sem concatenação quebrada e usa contagem oficial',()=>{
  assert.match(ui,/function officeBoardHtml\(counts\)/);
  assert.match(ui,/officeGrid\(tasks,procs\(\),quadro\)/);
  assert.match(ui,/quadro=officeCounts\(d\)/);
  assert.doesNotMatch(ui,/officeGrid\(tasks,\s*procs\(\),\s*quadro\)[^;\n]*['"]\s*\+\s*\(/);
});

test('check de sintaxe descobre JavaScript recursivamente em vez de lista fixa',()=>{
  assert.match(syntax,/function walk\(dir='\.'\)/);
  assert.match(syntax,/const jsFiles=walk\(\)\.sort\(\)/);
  assert.doesNotMatch(syntax,/for\(const name of \['bot\.js'/);
});
