const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
let failures = 0;
function check(label, input, filename) {
  const r=spawnSync(process.execPath,['--check',...(filename ? [filename] : [])],{input,encoding:'utf8'});
  if(r.status!==0){failures++; console.error(label+'\n'+r.stderr);}
}
for(const name of ['bot.js','lex_agente_vivo.js','office-ui.js','conector-navegador/popup.js',...['lib','scripts','test'].flatMap(dir=>fs.readdirSync(dir).filter(f=>f.endsWith('.js')).map(f=>path.join(dir,f)))]) check(name,null,name);
for(const name of ['index.html','lex-whatsapp.html']) {
  const html=fs.readFileSync(name,'utf8'); let n=0;
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if(/\bsrc\s*=/.test(match[1]) || /type\s*=\s*["'](?:application\/json|application\/ld\+json|importmap)/i.test(match[1])) continue;
    check(name+' script '+(++n),match[2]);
  }
}
if(failures) process.exitCode=1;
else console.log('Sintaxe validada: backend, módulos e scripts inline.');
