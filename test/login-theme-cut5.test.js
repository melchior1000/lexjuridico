const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const css=fs.readFileSync(path.join(__dirname,'../login-theme.css'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../login-theme.js'),'utf8');
const loader=fs.readFileSync(path.join(__dirname,'../office-ui.js'),'utf8');
const syntax=fs.readFileSync(path.join(__dirname,'../scripts/check-syntax.js'),'utf8');

test('login comercial usa tokens e cascade layers sem important',()=>{
  assert.match(css,/@layer reset, tokens, components, utilities;/);
  for(const token of ['--login-bg','--login-card','--login-input','--login-text','--login-line']) assert.match(css,new RegExp(token));
  assert.match(css,/body\.dia,\s*body\.lex-day/);
  assert.match(css,/@layer components\.login/);
  assert.doesNotMatch(css,/!important/);
});

test('componentes de login consomem tokens em vez de cores absolutas de tema',()=>{
  assert.match(css,/\.login-shell\s*\{[\s\S]*background:var\(--login-bg\)/);
  assert.match(css,/\.login-card\s*\{[\s\S]*background:var\(--login-card\)/);
  assert.match(css,/\.login-input\s*\{[\s\S]*background:var\(--login-input\)/);
  assert.match(css,/\.login-title\s*\{[\s\S]*color:var\(--login-text\)/);
  assert.match(css,/\.login-label[\s\S]*color:var\(--login-muted\)/);
});

test('tema do login nao depende mais de normalizador da cascata legada',()=>{
  assert.match(js,/prepareLoginTheme/);
  assert.match(js,/loginThemeReady/);
  assert.doesNotMatch(js,/removeLegacyLoginBridge/);
  assert.doesNotMatch(js,/dropThemeProps/);
  assert.doesNotMatch(js,/deleteRule/);
  assert.doesNotMatch(js,/document\.styleSheets/);
});

test('loader e check de sintaxe cobrem o tema do login',()=>{
  const v2=loader.indexOf('office-ui-v2.css');
  const theme=loader.indexOf('login-theme.css');
  const themeJs=loader.indexOf('login-theme.js');
  assert.ok(v2>=0 && theme>v2);
  assert.ok(themeJs>theme);
  assert.match(syntax,/login-theme\.js/);
});
