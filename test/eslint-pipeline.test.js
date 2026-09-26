'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const pkg=require('../package.json');

test('pipeline executa sintaxe e ESLint no mesmo npm run check',()=>{
  assert.equal(typeof pkg.scripts.lint,'string');
  assert.match(pkg.scripts.check,/check-syntax\.js/);
  assert.match(pkg.scripts.check,/npm run lint/);
});

test('ESLint cobre lib/, test/, scripts/ e toda a casca da raiz, preservando o monólito legado',()=>{
  const cfg=fs.readFileSync('eslint.config.js','utf8');
  assert.match(cfg,/files: \['lib\/\*\*\/\*\.js','scripts\/\*\*\/\*\.js','test\/\*\*\/\*\.js'\]/);
  assert.match(cfg,/files: \['\*\.js'\]/);
  assert.match(cfg,/bot\.js/);
  assert.match(cfg,/lex_agente_vivo/);
  const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
  assert.match(pkg.scripts.lint,/lib\/ scripts\/ test\/ \*\.js/);
});
