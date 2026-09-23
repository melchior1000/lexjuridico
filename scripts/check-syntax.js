const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
let failures = 0, checked = 0;
function check(label, input, filename) {
  const r=spawnSync(process.execPath,['--check',...(filename ? [filename] : [])],{input,encoding:'utf8'});
  checked++;
  if(r.status!==0){failures++; console.error(label+'\n'+r.stderr);}
}
const SKIP=new Set(['.git','node_modules','.vercel','coverage','dist','artifacts']);
const CRITICAL=[
  'bot.js','lex_agente_vivo.js','lex_agente_vivo_core.js',
  'office-ui.js','lex-nav.js','office-ui-base.js','office-ui-device.js','office-ui-v2.js','office-flow-ui.js',
  'login-theme.js','conector-navegador/popup.js'
];
function walk(dir='.'){
  const out=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(SKIP.has(entry.name)) continue;
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()) out.push(...walk(full));
    else if(entry.isFile()&&entry.name.endsWith('.js')) out.push(full.replace(/^\.\//,''));
  }
  return out;
}
const jsFiles=walk().sort();
for(const name of CRITICAL){
  if(!jsFiles.includes(name)){failures++;console.error('Arquivo JavaScript crítico ausente: '+name);}
}
for(const name of jsFiles) check(name,null,name);
for(const name of ['index.html','lex-whatsapp.html']) {
  const html=fs.readFileSync(name,'utf8'); let n=0;
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if(/\bsrc\s*=/.test(match[1]) || /type\s*=\s*["'](?:application\/json|application\/ld\+json|importmap)/i.test(match[1])) continue;
    check(name+' script '+(++n),match[2]);
  }
}
if(failures) process.exitCode=1;
else console.log('Sintaxe validada em '+checked+' unidades: todo JavaScript rastreado, arquivos críticos presentes, casca comercial, fluxo do escritório, tema do login e scripts inline.');