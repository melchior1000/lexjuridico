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

test('ESLint cobre a casca comercial crítica e preserva o monólito legado',()=>{
  const cfg=fs.readFileSync('eslint.config.js','utf8');
  for(const file of ['office-ui-v2.js','office-flow-ui.js','office-command-ui.js','reception-handoff-ui.js','login-theme.js','lib/office-pipeline.js']) assert.match(cfg,new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(cfg,/bot\.js/);
  assert.match(cfg,/lex_agente_vivo/);
});
