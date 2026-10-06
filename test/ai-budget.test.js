'use strict';
// 06/10/2026 — Teto de gasto de IA por mês. Antes um escritório podia consumir sem limite o
// crédito da chave do titular.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {lerConfig,decidirOrcamento,createAiBudgetGuard}=require('../lib/ai-budget');
const {mensagemSemIA}=require('../lib/ai-credit');

function fakeRecords(){
  const rows=new Map();
  return {rows,async read(k){return rows.has(k)?{value:structuredClone(rows.get(k))}:null;},
    async change(k,fn){const v=await fn(rows.has(k)?structuredClone(rows.get(k)):null);if(v!==undefined)rows.set(k,v);return v;}};
}
const consumo=g=>async()=>({total:{custo_usd:g}});

test('configuração: sem valor = sem teto; modo padrão só avisa',()=>{
  assert.deepEqual(lerConfig({}),{teto:null,modo:'aviso'});
  assert.deepEqual(lerConfig({LEX_IA_TETO_MENSAL_USD:'50,5',LEX_IA_TETO_MODO:'bloqueio'}),{teto:50.5,modo:'bloqueio'});
  assert.deepEqual(lerConfig({LEX_IA_TETO_MENSAL_USD:'-3'}),{teto:null,modo:'aviso'});
});

test('decisão: avisa a 80% e 100% uma vez; só bloqueia no modo bloqueio',()=>{
  assert.equal(decidirOrcamento({gasto:79,teto:100}).acao,'nada');
  assert.equal(decidirOrcamento({gasto:80,teto:100}).acao,'avisar_oitenta');
  assert.equal(decidirOrcamento({gasto:85,teto:100,avisos:{oitenta:true}}).acao,'nada');
  assert.deepEqual(decidirOrcamento({gasto:100,teto:100}),{acao:'avisar_cem',bloquear:false,fracao:1});
  assert.equal(decidirOrcamento({gasto:120,teto:100,modo:'bloqueio',avisos:{cem:true}}).bloquear,true);
  assert.equal(decidirOrcamento({gasto:999,teto:null}).acao,'sem_teto');
});

test('modo bloqueio: avisa, liga o modo sem IA e desliga quando o teto sobe',async()=>{
  const env={LEX_IA_TETO_MENSAL_USD:'10',LEX_IA_TETO_MODO:'bloqueio'};const avisos=[];const records=fakeRecords();
  let gasto=8;
  const g=createAiBudgetGuard({summary:async()=>({total:{custo_usd:gasto}}),records,env,notify:async t=>{avisos.push(t);return true;},now:()=>new Date('2026-10-06T15:00:00Z'),log:()=>{}});
  await g.verificar();
  assert.match(avisos[0],/80% do teto de US\$ 10,00/);
  await g.verificar();assert.equal(avisos.length,1,'não repete');
  gasto=10.2;
  const r=await g.verificar();
  assert.equal(r.bloqueada,true);assert.equal(env.LEX_AI_NO_CREDIT,'1');assert.equal(env.LEX_AI_SEM_IA_MOTIVO,'teto');
  assert.match(avisos[1],/atingiu o teto do mês: US\$ 10,20 de US\$ 10,00/);
  assert.match(mensagemSemIA(env),/teto de gasto de IA deste mês/);
  env.LEX_IA_TETO_MENSAL_USD='20';
  await g.verificar();
  assert.equal(env.LEX_AI_NO_CREDIT,undefined);assert.match(avisos.at(-1),/voltou/);
});

test('nunca desliga o modo sem IA ligado por falta de crédito',async()=>{
  const env={LEX_AI_NO_CREDIT:'1',LEX_IA_TETO_MENSAL_USD:'10',LEX_IA_TETO_MODO:'bloqueio'};
  const g=createAiBudgetGuard({summary:consumo(1),env,notify:async()=>true,log:()=>{}});
  await g.verificar();
  assert.equal(env.LEX_AI_NO_CREDIT,'1');
  assert.match(mensagemSemIA(env),/sem crédito/);
});

test('modo aviso nunca bloqueia; consumo ilegível não decide nada',async()=>{
  const env={LEX_IA_TETO_MENSAL_USD:'10'};
  const g=createAiBudgetGuard({summary:consumo(50),env,notify:async()=>true,log:()=>{}});
  assert.equal((await g.verificar()).bloqueada,false);assert.equal(env.LEX_AI_NO_CREDIT,undefined);
  const env2={LEX_IA_TETO_MENSAL_USD:'10',LEX_IA_TETO_MODO:'bloqueio'};
  const g2=createAiBudgetGuard({summary:async()=>({leitura_indisponivel:true,total:{custo_usd:0}}),env:env2,notify:async()=>true,log:()=>{}});
  assert.equal((await g2.verificar()).acao,'consumo_indisponivel');
});

test('virada do mês libera a IA bloqueada pelo teto',async()=>{
  const env={LEX_IA_TETO_MENSAL_USD:'10',LEX_IA_TETO_MODO:'bloqueio'};let agora=new Date('2026-10-31T20:00:00Z');
  const g=createAiBudgetGuard({summary:async mes=>({total:{custo_usd:mes==='2026-10'?12:0}}),env,notify:async()=>true,now:()=>agora,log:()=>{}});
  await g.verificar();assert.equal(env.LEX_AI_NO_CREDIT,'1');
  agora=new Date('2026-11-01T10:00:00Z');
  await g.verificar();assert.equal(env.LEX_AI_NO_CREDIT,undefined);
});

test('servidor confere o teto a cada 5 min e a rota de consumo mostra o teto',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8');
  assert.match(src,/createAiBudgetGuard\(\{summary:mes=>aiUsageSummary\(mes\),records:recordStore,notify:text=>avisarTitular\(text\),provider:\(\)=>IA_PROVIDER\}\)/);
  assert.match(src,/setInterval\(\(\)=>\{ aiBudget\.verificar\(\)/);
  assert.match(src,/teto:aiBudget\.estado\(\)/);
});

// Revisão de código de 06/10/2026: no modo bloqueio a IA não pode gastar por NENHUM caminho.
test('com a IA pausada pelo teto, nada sai para o provedor (só a sonda de crédito)',async()=>{
  const vm=require('node:vm');
  const src=fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8');
  const {aiBloqueadaPorTeto,erroTetoAtingido}=require('../lib/ai-budget');
  let saidas=0;
  const c=vm.createContext({aiAdmission:{run:fn=>fn()},_httpsPostRequest:async()=>{saidas++;return {};},
    recordAiResponse:()=>{},currentAiPonto:()=>null,aiBloqueadaPorTeto,erroTetoAtingido});
  vm.runInContext(src.slice(src.indexOf('const AI_HOSTS = '),src.indexOf('function _httpsPostRequest('))+';this.httpsPost=httpsPost;',c);
  process.env.LEX_AI_SEM_IA_MOTIVO='teto';
  try{
    await assert.rejects(c.httpsPost('api.anthropic.com','/v1/messages',{model:'m'},{}),e=>e.code==='LEX_AI_BUDGET');
    await assert.rejects(c.httpsPost('api.openai.com','/v1/chat/completions',{model:'m'},{},{ponto:'recepcao'}),e=>e.code==='LEX_AI_BUDGET');
    await c.httpsPost('api.anthropic.com','/v1/messages',{model:'m'},{},{ponto:'teste_credito'});
    await c.httpsPost('api.telegram.org','/x',{},{});
    assert.equal(saidas,2,'só a sonda de crédito e o que não é IA');
    const {transcribeAudio}=require('../lib/audio-transcription');
    assert.equal((await transcribeAudio(Buffer.from('x'),{apiKey:'k',transport:{request(){throw new Error('não deveria chamar');}}})).erro,'ia_pausada_teto');
    const core=require('../lex_agente_vivo_core');
    if(typeof core._testing?.chamarAnthropicRequest==='function')
      await assert.rejects(core._testing.chamarAnthropicRequest('k',{request(){throw new Error('não deveria chamar');}},{model:'m'}),e=>e.code==='LEX_AI_BUDGET');
  } finally { delete process.env.LEX_AI_SEM_IA_MOTIVO; }
  assert.match(fs.readFileSync(path.join(__dirname,'..','lex_agente_vivo_core.js'),'utf8'),/if \(aiBloqueadaPorTeto\(\)\) return reject\(erroTetoAtingido\(\)\);/);
  assert.match(src,/const aiAvailable=\(\)=>!aiBloqueadaPorTeto\(\)&&/,'tarefas e recepção não contam com a IA');
});

test('teto só vale com o provedor que tem preço conferido; aviso não se repete se o banco falhar',async()=>{
  const env={LEX_IA_TETO_MENSAL_USD:'10',LEX_IA_TETO_MODO:'bloqueio'};
  const g=createAiBudgetGuard({summary:consumo(50),env,notify:async()=>true,provider:()=>'openai',log:()=>{}});
  assert.equal((await g.verificar()).acao,'provedor_sem_preco');assert.equal(env.LEX_AI_NO_CREDIT,undefined);
  const avisos=[];
  const g2=createAiBudgetGuard({summary:consumo(9),env:{LEX_IA_TETO_MENSAL_USD:'10'},records:{async read(){throw new Error('fora');},async change(){throw new Error('fora');}},
    notify:async t=>{avisos.push(t);return true;},log:()=>{}});
  await g2.verificar();await g2.verificar();
  assert.equal(avisos.length,1);
});
