'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {test}=require('node:test');
const assert=require('node:assert/strict');

test('perfil responsivo usa viewport e capacidade, nao user-agent',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../office-ui-device.js'),'utf8');
  assert.match(js,/function\s+deviceProfile\s*\(/);
  assert.match(js,/visualViewport/);
  assert.match(js,/matchMedia\?\.\('\(pointer: coarse\)'\)/);
  assert.match(js,/data-lex-device/);
  assert.doesNotMatch(js,/navigator\.userAgent/);
});

test('css cobre quatro classes de dispositivo e safe area',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../office-ui-device.css'),'utf8');
  for(const kind of ['phone','tablet','notebook','desktop']) assert.match(css,new RegExp(`data-lex-device=\\"${kind}\\"`));
  assert.match(css,/safe-area-inset-bottom/);
  assert.match(css,/overflow-x:hidden/);
});
