'use strict';
// 06/10/2026 — Medição do consumo de IA. Antes nenhum trecho lia o consumo devolvido pelo
// provedor: o LEX não sabia quanto gastava, por escritório, por função ou por modelo.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createAiUsageMeter,normalizeUsage,monthOf,googleModelFromPath}=require('../lib/ai-usage');
const {costUsd,priceFor}=require('../lib/ai-prices');

const ROOT=path.join(__dirname,'..');
const fixed=iso=>()=>new Date(iso);

function fakeRecords({failTimes=0}={}){
  const rows=new Map();let fails=failTimes;
  return {rows,
    async read(k){return rows.has(k)?{value:structuredClone(rows.get(k))}:null;},
    async change(k,fn){if(fails>0){fails--;throw new Error('banco fora');}const v=await fn(rows.has(k)?structuredClone(rows.get(k)):null);if(v!==undefined)rows.set(k,v);return v;}};
}

test('preço exato por modelo, sem confundir versões',()=>{
  assert.equal(priceFor('claude-opus-5').entrada,5);
  assert.equal(priceFor('claude-opus-5-5').entrada,4,'opus 5.5 não cai no preço do opus 5');
  assert.equal(priceFor('claude-haiku-4-5-20251001').saida,5,'sufixo de data ignorado');
  assert.equal(priceFor('gpt-4.1'),null,'sem preço conferido = desconhecido');
  // 1000 entrada×5 + 2000 saída×25 + 500 leitura×0,5 + 100 escrita×6,25 (por milhão) + 2 buscas×US$0,01
  assert.equal(Math.round(costUsd('claude-opus-5',{entrada:1000,saida:2000,leitura_cache:500,escrita_cache:100,buscas_web:2})*1e6),75875);
});

test('lê o consumo devolvido por Anthropic, OpenAI (texto e áudio) e Google',()=>{
  assert.deepEqual(normalizeUsage('anthropic',{usage:{input_tokens:10,output_tokens:20,cache_read_input_tokens:3,cache_creation_input_tokens:4,server_tool_use:{web_search_requests:1}}}),
    {entrada:10,saida:20,leitura_cache:3,escrita_cache:4,buscas_web:1,segundos_audio:0});
  assert.deepEqual(normalizeUsage('openai',{usage:{prompt_tokens:100,completion_tokens:7,prompt_tokens_details:{cached_tokens:40}}}),
    {entrada:60,saida:7,leitura_cache:40,escrita_cache:0,buscas_web:0,segundos_audio:0});
  assert.equal(normalizeUsage('openai',{usage:{type:'duration',seconds:12}}).segundos_audio,12);
  assert.deepEqual(normalizeUsage('google',{usageMetadata:{promptTokenCount:50,candidatesTokenCount:5,thoughtsTokenCount:2,cachedContentTokenCount:10}}),
    {entrada:40,saida:7,leitura_cache:10,escrita_cache:0,buscas_web:0,segundos_audio:0});
  assert.equal(normalizeUsage('anthropic',{content:[]}),null);
  assert.equal(googleModelFromPath('/v1beta/models/gemini-2.5-pro:generateContent?key=x'),'gemini-2.5-pro');
});

test('mês no fuso de Brasília',()=>{
  assert.equal(monthOf(new Date('2026-11-01T02:00:00Z')),'2026-10');
  assert.equal(monthOf(new Date('2026-11-01T03:00:00Z')),'2026-11');
});

test('acumula por mês, ponto de uso e modelo, e grava no banco',async()=>{
  const records=fakeRecords();
  const meter=createAiUsageMeter({records,now:fixed('2026-10-06T15:00:00Z'),escritorioId:'lex-atual',flushMs:60000,log:()=>{}});
  meter.record({provider:'anthropic',model:'claude-opus-5',ponto:'lex_vivo',usage:{entrada:1000,saida:2000}});
  meter.record({provider:'anthropic',model:'claude-haiku-4-5',ponto:'recepcao',usage:{entrada:1000,saida:0}});
  meter.record({provider:'openai',model:'gpt-4.1',ponto:'leitura_documento',usage:{entrada:10,saida:1}});
  meter.record({provider:'anthropic',model:'claude-opus-5',ponto:'lex_vivo',usage:null,ok:false});
  const antes=await meter.summary('2026-10');
  assert.equal(antes.pendente_gravacao,true,'resumo já mostra o que ainda não foi gravado');
  await meter.flush();
  const row=records.rows.get('ia_consumo_lex-atual_2026-10');
  assert.equal(row.total.chamadas,4);
  assert.equal(row.total.erros,1);
  assert.equal(row.total.chamadas_sem_preco,1,'gpt-4.1 sem preço conferido');
  assert.equal(row.total.custo_usd,0.056,'0,055 (opus) + 0,001 (haiku)');
  assert.equal(row.por_ponto.lex_vivo.chamadas,2);
  assert.equal(row.por_modelo['claude-haiku-4-5'].entrada,1000);
  assert.equal(row.fonte_precos,'https://platform.claude.com/docs/en/about-claude/pricing');
  const depois=await meter.summary('2026-10');
  assert.equal(depois.pendente_gravacao,false);
  assert.equal(depois.total.chamadas,4);
});

test('banco fora do ar: nada se perde nem conta duas vezes',async()=>{
  const records=fakeRecords({failTimes:1});
  const meter=createAiUsageMeter({records,now:fixed('2026-10-06T15:00:00Z'),flushMs:60000,log:()=>{}});
  meter.record({provider:'anthropic',model:'claude-opus-5',ponto:'a',usage:{entrada:10}});
  await meter.flush(); // falha: volta para a fila
  assert.equal(records.rows.size,0);
  meter.record({provider:'anthropic',model:'claude-opus-5',ponto:'a',usage:{entrada:5}});
  await meter.flush();
  const row=[...records.rows.values()][0];
  assert.equal(row.total.chamadas,2);assert.equal(row.total.entrada,15);
  await meter.flush();
  assert.equal([...records.rows.values()][0].total.chamadas,2,'nova gravação sem nada pendente não soma de novo');
});

test('medir nunca derruba a chamada de IA',()=>{
  const meter=createAiUsageMeter({now:()=>{throw new Error('relógio quebrado');},log:()=>{}});
  assert.doesNotThrow(()=>meter.record({provider:'anthropic',model:'x',usage:{entrada:1}}));
});

test('httpsPost do servidor mede toda chamada de IA e devolve a resposta intacta',async()=>{
  const src=fs.readFileSync(path.join(ROOT,'bot.js'),'utf8');
  const a=src.indexOf('const AI_HOSTS = ');
  const b=src.indexOf('function _httpsPostRequest(');
  assert.ok(a>0&&b>a);
  const calls=[];const resposta={content:[{type:'text',text:'ok'}],usage:{input_tokens:1,output_tokens:1}};
  let fail=false;
  const c=vm.createContext({
    aiAdmission:{run:fn=>fn()},
    _httpsPostRequest:async()=>{if(fail)throw new Error('rede');return resposta;},
    recordAiResponse:x=>calls.push(x),
    currentAiPonto:()=>null
  });
  vm.runInContext(src.slice(a,b)+';this.httpsPost=httpsPost;',c);
  const r=await c.httpsPost('api.anthropic.com','/v1/messages',{model:'claude-opus-5'},{},{ponto:'lex_vivo'});
  assert.equal(r,resposta,'mesma resposta, sem cópia nem alteração');
  assert.deepEqual({...calls[0],response:undefined},{host:'api.anthropic.com',path:'/v1/messages',model:'claude-opus-5',response:undefined,ponto:'lex_vivo'});
  await c.httpsPost('api.openai.com','/v1/chat/completions',{model:'gpt-4.1'},{});
  assert.equal(calls[1].ponto,'ia_geral','ponto padrão');
  fail=true;
  await assert.rejects(c.httpsPost('api.anthropic.com','/v1/messages',{model:'m'},{}),/rede/);
  assert.ok(calls[2].error,'erro também é medido');
  fail=false;
  await c.httpsPost('api.telegram.org','/x',{},{});
  assert.equal(calls.length,3,'chamada que não é de IA não é medida');
});

// Trava permanente: nenhuma chamada nova de IA pode nascer sem medição.
test('toda chamada de IA do código passa pela medição',()=>{
  const HOSTS=/api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com/;
  const files=[];
  (function walk(dir){
    for(const e of fs.readdirSync(dir,{withFileTypes:true})){
      if(['node_modules','.git','test','evals','.claude'].includes(e.name)) continue;
      const full=path.join(dir,e.name);
      if(e.isDirectory()) walk(full); else if(e.name.endsWith('.js')) files.push(full);
    }
  })(ROOT);
  const comIA=files.filter(f=>HOSTS.test(fs.readFileSync(f,'utf8'))).map(f=>path.relative(ROOT,f).split(path.sep).join('/')).sort();
  assert.deepEqual(comIA,['bot.js','lex_agente_vivo_core.js','lib/ai-usage.js','lib/audio-transcription.js','lib/document-reader.js'],
    'arquivo novo chamando IA: meça o consumo (lib/ai-usage.js) e inclua-o aqui');
  // Cada menção a um endereço de IA precisa ser: o 1º argumento de httpsPost (que mede por
  // dentro) ou ter recordAiResponse( logo em seguida (até 30 linhas).
  for(const f of comIA.filter(f=>f!=='lib/ai-usage.js')){
    const lines=fs.readFileSync(path.join(ROOT,f),'utf8').split('\n');
    lines.forEach((l,i)=>{
      if(!HOSTS.test(l)) return;
      if(/httpsPost\(\s*['"](api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com)['"]/.test(l)) return;
      assert.ok(lines.slice(i,i+30).some(x=>/recordAiResponse\(/.test(x)),f+':'+(i+1)+' chama IA sem medir o consumo');
    });
  }
});

test('rota de consumo é só do titular e o servidor grava ao desligar',()=>{
  const src=fs.readFileSync(path.join(ROOT,'bot.js'),'utf8');
  const a=src.indexOf("url==='/api/ia/consumo'");
  assert.ok(a>0);
  assert.match(src.slice(a,a+300),/validarToken\(getToken\(req\)\)!=='admin'/);
  assert.match(src,/configureAiUsage\(\{records:recordStore\}\)/);
  const g=src.indexOf('async function _gracefulShutdown(');
  assert.match(src.slice(g,g+900),/flushAiUsage\(\)/);
});

// Revisão de código de 06/10/2026.
test('gravação confirmada sem resposta do banco: o lote não é somado de novo',async()=>{
  const rows=new Map();let perderResposta=true;
  const records={async read(k){return rows.has(k)?{value:structuredClone(rows.get(k))}:null;},
    async change(k,fn){const v=await fn(rows.has(k)?structuredClone(rows.get(k)):null);if(v!==undefined)rows.set(k,v);
      if(perderResposta){perderResposta=false;throw new Error('tempo esgotado depois de gravar');}return v;}};
  const meter=createAiUsageMeter({records,now:fixed('2026-10-06T15:00:00Z'),flushMs:60000,log:()=>{}});
  meter.record({provider:'anthropic',model:'claude-opus-5',ponto:'a',usage:{entrada:10}});
  await meter.flush();
  const meio=await meter.summary('2026-10');
  assert.equal(meio.total.chamadas,1,'resumo não soma o lote que já está no banco');
  await meter.flush();
  assert.equal([...rows.values()][0].total.chamadas,1);
});

test('resumo inclui o que está sendo gravado e avisa quando o banco não pôde ser lido',async()=>{
  let liberar;const travado=new Promise(r=>{liberar=r;});
  const rows=new Map();
  const records={async read(){throw new Error('leitura fora');},
    async change(k,fn){await travado;const v=await fn(null);rows.set(k,v);return v;}};
  const meter=createAiUsageMeter({records,now:fixed('2026-10-06T15:00:00Z'),flushMs:60000,log:()=>{}});
  meter.record({provider:'anthropic',model:'claude-opus-5',ponto:'a',usage:{entrada:10}});
  const gravando=meter.flush();
  const r=await meter.summary('2026-10');
  assert.equal(r.total.chamadas,1,'lote em gravação aparece');
  assert.equal(r.leitura_indisponivel,true);
  liberar();await gravando;
});

test('consumo de modelo sem preço é contado à parte mesmo em chamada recusada',()=>{
  const meter=createAiUsageMeter({now:fixed('2026-10-06T15:00:00Z'),log:()=>{}});
  meter.record({provider:'openai',model:'gpt-4.1',usage:{entrada:100},ok:false});
  return meter.summary('2026-10').then(r=>{assert.equal(r.total.chamadas_sem_preco,1);assert.equal(r.total.custo_usd,0);});
});

test('fila local cheia (LEX_AI_BUSY) não conta como chamada ao provedor',async()=>{
  const src=fs.readFileSync(path.join(ROOT,'bot.js'),'utf8');
  const calls=[];
  const c=vm.createContext({aiAdmission:{run:()=>Promise.reject(Object.assign(new Error('ocupado'),{code:'LEX_AI_BUSY'}))},
    _httpsPostRequest:async()=>({}),recordAiResponse:x=>calls.push(x),currentAiPonto:()=>null});
  vm.runInContext(src.slice(src.indexOf('const AI_HOSTS = '),src.indexOf('function _httpsPostRequest('))+';this.httpsPost=httpsPost;',c);
  await assert.rejects(c.httpsPost('api.anthropic.com','/v1/messages',{model:'m'},{}),/ocupado/);
  assert.equal(calls.length,0);
});

test('ponto de uso herdado pelo fluxo assíncrono',async()=>{
  const {runWithAiPonto,currentAiPonto}=require('../lib/ai-usage');
  assert.equal(currentAiPonto(),null);
  const visto=await runWithAiPonto('recepcao',async()=>{await new Promise(r=>setImmediate(r));return currentAiPonto();});
  assert.equal(visto,'recepcao');
});
