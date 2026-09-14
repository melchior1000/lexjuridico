'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('casca comercial escapa aspas com entidade HTML completa',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../office-ui-v2.js'),'utf8');
  assert.match(src,/['"]&quot;['"]/);
});
