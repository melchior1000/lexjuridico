'use strict';
const fs=require('node:fs');
const path=require('node:path');

const BLOCK=Number(process.env.LEX_AUDIT_BLOCK||1000);
const ROOT=path.resolve(__dirname,'..');
const SKIP=new Set(['.git','node_modules','.vercel','coverage','dist','artifacts']);
const EXT=new Set(['.js','.html','.css']);
const EXCLUDED_TOP=new Set(['docs','test']);

function walk(dir=ROOT){
  const out=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(SKIP.has(entry.name))continue;
    const full=path.join(dir,entry.name);
    const rel=path.relative(ROOT,full).replaceAll('\\','/');
    const top=rel.split('/')[0];
    if(entry.isDirectory()){
      if(EXCLUDED_TOP.has(top))continue;
      out.push(...walk(full));
    }else if(entry.isFile()&&EXT.has(path.extname(entry.name)))out.push(rel);
  }
  return out;
}

const SIGNALS=[
  ['hardcoded_identity',/\b(?:Dr\.?\s+Kleuber|Kleuber)\b/gi],
  ['legacy_chat',/\/api\/(?:gestor\/chat|chat)\b/g],
  ['vivo_chat',/\/api\/vivo\//g],
  ['datajud',/datajud/gi],
  ['pje',/\bpje\b/gi],
  ['supabase',/supabase|processos_cache/gi],
  ['pending_marker',/TODO|FIXME|PENDENTE|não implementad[oa]/gi],
  ['silent_catch',/catch\s*\{\s*\}/g]
];

function countMatches(text,rx){const flags=rx.flags.includes('g')?rx.flags:rx.flags+'g';const r=new RegExp(rx.source,flags);return [...text.matchAll(r)].length}
function auditFile(file){
  const text=fs.readFileSync(path.join(ROOT,file),'utf8');
  const lines=text.split(/\r?\n/);
  const blocks=[];
  for(let start=1;start<=lines.length;start+=BLOCK){
    const end=Math.min(start+BLOCK-1,lines.length);
    const chunk=lines.slice(start-1,end).join('\n');
    const signals={};
    for(const [name,rx] of SIGNALS){const n=countMatches(chunk,rx);if(n)signals[name]=n}
    blocks.push({start,end,signals});
  }
  return {file,lines:lines.length,blocks};
}

const files=walk().sort();
const audited=files.map(auditFile);
const totalLines=audited.reduce((n,f)=>n+f.lines,0);
const totalBlocks=audited.reduce((n,f)=>n+f.blocks.length,0);
const report={generated_at:new Date().toISOString(),block_size:BLOCK,total_files:files.length,total_lines:totalLines,total_blocks:totalBlocks,files:audited};
if(process.argv.includes('--json'))process.stdout.write(JSON.stringify(report,null,2)+'\n');
else{
  console.log(`LEX reverse audit: ${files.length} arquivos, ${totalLines} linhas, ${totalBlocks} blocos de até ${BLOCK}.`);
  for(const f of audited){
    console.log(`\n${f.file} — ${f.lines} linhas`);
    for(const b of f.blocks){
      const tags=Object.entries(b.signals).map(([k,v])=>`${k}:${v}`).join(', ');
      console.log(`  L${b.start}-${b.end}${tags?'  ['+tags+']':''}`);
    }
  }
}
