'use strict';
// 06/10/2026 — Ritmo das mensagens automáticas no WhatsApp. Antes a rodada de lembretes
// podia disparar dezenas de mensagens de uma vez, a qualquer hora, inclusive de madrugada.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {decidePacing,createAutomaticSender,configFromEnv,DEFAULTS}=require('../lib/whatsapp-pacing');

// 2026-10-06 é terça; 2026-10-11 é domingo. Brasília = UTC-3.
const br=(dia,hora)=>new Date(new Date(`${dia}T00:00:00Z`).getTime()+(hora+3)*3600000);
function fakeRecords(){
  const rows=new Map();
  return {rows,async read(k){return rows.has(k)?{value:structuredClone(rows.get(k))}:null;},
    async change(k,fn){const v=await fn(rows.has(k)?structuredClone(rows.get(k)):null);if(v!==undefined)rows.set(k,v);return v;}};
}

test('janela de horário: 8h às 20h, sem domingo',()=>{
  assert.equal(decidePacing({now:br('2026-10-06',7)}).codigo,'fora_da_janela');
  assert.equal(decidePacing({now:br('2026-10-06',8)}).ok,true);
  assert.equal(decidePacing({now:br('2026-10-06',19)}).ok,true);
  assert.equal(decidePacing({now:br('2026-10-06',20)}).codigo,'fora_da_janela');
  assert.equal(decidePacing({now:br('2026-10-11',10)}).codigo,'fora_da_janela','domingo');
  assert.equal(decidePacing({now:br('2026-10-11',10),cfg:{...DEFAULTS,domingo:true}}).ok,true);
  assert.match(decidePacing({now:br('2026-10-06',22)}).motivo,/8h–20h/);
});

test('teto diário e intervalo mínimo com variação',()=>{
  assert.equal(decidePacing({now:br('2026-10-06',10),enviadasHoje:60}).codigo,'teto_diario');
  const agora=br('2026-10-06',10);
  const d=decidePacing({now:agora,ultimoEnvioEm:new Date(agora.getTime()-5000),random:()=>0});
  assert.deepEqual(d,{ok:true,esperarMs:15000});
  assert.equal(decidePacing({now:agora,ultimoEnvioEm:new Date(agora.getTime()-60000),random:()=>0.99}).esperarMs,0);
});

test('configuração pelo ambiente, com valores inválidos ignorados',()=>{
  const c=configFromEnv({LEX_WHATSAPP_JANELA:'9-18',LEX_WHATSAPP_DOMINGO:'1',LEX_WHATSAPP_TETO_DIARIO:'30',LEX_WHATSAPP_INTERVALO_SEG:'45'});
  assert.equal(c.janelaInicio,9);assert.equal(c.janelaFim,18);assert.equal(c.domingo,true);assert.equal(c.tetoDiario,30);assert.equal(c.intervaloMs,45000);
  const bad=configFromEnv({LEX_WHATSAPP_JANELA:'20-8',LEX_WHATSAPP_TETO_DIARIO:'abc'});
  assert.equal(bad.janelaInicio,8);assert.equal(bad.tetoDiario,60);
});

test('envios automáticos saem um de cada vez, espaçados, e o contador sobrevive ao reinício',async()=>{
  const records=fakeRecords();let relogio=br('2026-10-06',10).getTime();
  const enviados=[];const esperas=[];
  const mk=()=>createAutomaticSender({records,cfg:{...DEFAULTS,tetoDiario:3},now:()=>new Date(relogio),random:()=>0,
    sleep:async ms=>{esperas.push(ms);relogio+=ms;},send:async(n,t)=>{enviados.push([n,t]);return true;},log:()=>{}});
  const s=mk();
  const [a,b]=await Promise.all([s.enviar('5561911111111','um'),s.enviar('5561922222222','dois')]);
  assert.equal(a.enviado,true);assert.equal(b.enviado,true);
  assert.deepEqual(esperas,[20000],'segunda espera o intervalo');
  assert.equal(records.rows.get('whatsapp_ritmo_2026-10-06').enviadas,2);
  relogio+=60000;
  const depois=mk(); // reinício
  assert.equal((await depois.enviar('5561933333333','tres')).enviado,true);
  const r=await depois.enviar('5561944444444','quatro');
  assert.equal(r.enviado,false);assert.equal(r.codigo,'teto_diario');
  assert.equal(enviados.length,3);
});

test('contador ilegível não envia; envio sem confirmação fica marcado como tentado',async()=>{
  const quebrado=createAutomaticSender({records:{async read(){throw new Error('fora');},async change(){throw new Error('fora');}},
    now:()=>br('2026-10-06',10),send:async()=>true,log:()=>{}});
  assert.equal((await quebrado.enviar('5561911111111','x')).codigo,'contador_ilegivel');
  const records=fakeRecords();
  const falha=createAutomaticSender({records,now:()=>br('2026-10-06',10),send:async()=>false,log:()=>{}});
  const r=await falha.enviar('5561911111111','x');
  assert.equal(r.codigo,'envio_nao_confirmado');assert.equal(r.tentado,true);
  assert.equal(records.rows.get('whatsapp_ritmo_2026-10-06').enviadas,1,'vaga reservada conta: contar a mais é seguro');
  const noite=createAutomaticSender({records,now:()=>br('2026-10-06',23),send:async()=>{throw new Error('não deveria enviar');},log:()=>{}});
  assert.equal((await noite.enviar('5561911111111','x')).codigo,'fora_da_janela');
});

test('servidor: lembretes ao cliente passam pelo ritmo e só são marcados se saíram',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8');
  assert.match(src,/createAutomaticSender\(\{records:recordStore,send:\(numero,texto,opcoes\)=>envWhatsApp\(texto,numero,opcoes\)\}\)/);
  const f=src.indexOf('async function _executarFollowupClientesPendentes(');
  const corpo=src.slice(f,f+4200);
  assert.match(corpo,/if\(_followupClientesEmCurso\) return;/,'nunca duas rodadas ao mesmo tempo');
  for(const flag of ['lembrete_docs_10d_enviado','lembrete_48h_enviado','lembrete_24h_enviado'])
    assert.match(corpo,new RegExp('if\\(await _lembreteAutomatico\\(c,[\\s\\S]{0,260}?\\)\\)\\s*c\\.'+flag+' = true;'),flag);
  assert.doesNotMatch(corpo,/await env\(/,'nenhum lembrete sai por fora do ritmo');
});

// Revisão de código de 06/10/2026.
test('duas instâncias do servidor dividem o mesmo teto diário',async()=>{
  const records=fakeRecords();let relogio=br('2026-10-06',10).getTime();
  const mk=()=>createAutomaticSender({records,cfg:{...DEFAULTS,tetoDiario:2},now:()=>new Date(relogio),random:()=>0,
    sleep:async ms=>{relogio+=ms;},send:async()=>true,log:()=>{}});
  const a=mk(),b=mk();
  assert.equal((await a.enviar('1','x')).enviado,true);
  relogio+=30000;
  assert.equal((await b.enviar('2','x')).enviado,true);
  relogio+=30000;
  assert.equal((await a.enviar('3','x')).codigo,'teto_diario');
});

test('depois de esperar o intervalo, a janela é conferida de novo',async()=>{
  const records=fakeRecords();let relogio=br('2026-10-06',19).getTime()+59*60000+50000; // 19:59:50
  let enviados=0;
  const s=createAutomaticSender({records,now:()=>new Date(relogio),random:()=>0,sleep:async ms=>{relogio+=ms;},send:async()=>{enviados++;return true;},log:()=>{}});
  assert.equal((await s.enviar('1','x')).enviado,true);
  const r=await s.enviar('2','x'); // espera 20 s → 20:00:10, fora da janela
  assert.equal(r.codigo,'fora_da_janela');assert.equal(enviados,1);
});

test('conferência final antes de sair: contato que pediu para parar não recebe',async()=>{
  let enviados=0;
  const s=createAutomaticSender({records:fakeRecords(),now:()=>br('2026-10-06',10),send:async()=>{enviados++;return true;},log:()=>{}});
  const r=await s.enviar('1','x',{podeEnviar:async()=>false});
  assert.equal(r.codigo,'bloqueado');assert.equal(enviados,0);
});

test('lembrete sem confirmação não se repete antes de 20 h',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8');
  const f=src.indexOf('async function _lembreteAutomatico(');
  const corpo=src.slice(f,f+1400);
  assert.match(corpo,/if\(Date\.now\(\) - ultimaTentativa < 20 \* 3600000\) return false;/);
  assert.match(corpo,/podeEnviar: \(\) => whatsappAutomaticAllowed\(c\.chat_id\)/);
  const g=src.indexOf('async function _executarFollowupClientesPendentes(');
  assert.match(src.slice(g,g+1800),/sbGet\('clientes_pendentes', \{ chat_id: String\(c\.chat_id\) \}/,'relê o cliente antes de agir');
});

// CodeRabbit, PR #156.
test('mesma variação nas tentativas da mesma mensagem: não adia sem motivo',async()=>{
  const sorteios=[0,0.99,0.99,0.99];let i=0;
  const records=fakeRecords();let relogio=br('2026-10-06',10).getTime();
  const s=createAutomaticSender({records,now:()=>new Date(relogio),random:()=>sorteios[i++]??0,sleep:async ms=>{relogio+=ms;},send:async()=>true,log:()=>{}});
  assert.equal((await s.enviar('1','x')).enviado,true);
  const r=await s.enviar('2','x');
  assert.equal(r.enviado,true,'uma espera só, com a variação sorteada para esta mensagem');
});

test('rodada de lembretes pula cliente que sumiu ou não pôde ser relido',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8');
  const g=src.indexOf('async function _executarFollowupClientesPendentes(');
  assert.match(src.slice(g,g+2000),/if\(!atual\) continue;/);
});
