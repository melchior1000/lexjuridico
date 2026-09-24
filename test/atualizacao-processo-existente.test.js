'use strict';
// Regressão: o LEX deve atualizar processos existentes pelo Datajud.
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {source}=require('./runtime');
const {syncProcess,aliasForCnj}=require('../lib/datajud');
const {cnjDigits}=require('../lib/pje-sync');
const Workflow=require('../lib/workflow');

const KEY='chave-de-integridade-de-teste-com-mais-de-32-bytes';

function extrair(nome,proximo){
  const start=source.indexOf(nome);
  const end=source.indexOf(proximo,start);
  assert.ok(start>0&&end>start,'função não encontrada: '+nome);
  return source.slice(start,end);
}

test('tribunal sai da tabela oficial do CNJ (TJDFT, TJTO, TJGO, TRF6)',()=>{
  const ctx=vm.createContext({_datajudAlias:aliasForCnj});
  vm.runInContext(extrair('function _extrairTribunalDoProcesso(','function _linkPjeProcesso('),ctx);
  assert.equal(ctx._extrairTribunalDoProcesso('0703506-31.2024.8.07.0001'),'tjdft');
  assert.equal(ctx._extrairTribunalDoProcesso('0042835-05.2021.8.27.2729'),'tjto');
  assert.equal(ctx._extrairTribunalDoProcesso('5001463-03.2025.8.13.0704'),'tjmg');
  assert.equal(ctx._extrairTribunalDoProcesso('6004199-72.2025.4.06.3818'),'trf6');
  assert.equal(ctx._extrairTribunalDoProcesso('0000001-00.2026.8.09.0001'),'tjgo');
  assert.equal(ctx._extrairTribunalDoProcesso('sem número'),null);
});

function lojaEmMemoria(processes){
  let state={version:1,processes:structuredClone(processes),exists:true};
  let gravacoes=0;
  return {
    get processes(){return state.processes;},
    get gravacoes(){return gravacoes;},
    async read(){return structuredClone(state);},
    async mutate(op){
      const ps=structuredClone(state.processes);
      const value=await op(ps);
      if(JSON.stringify(ps)!==JSON.stringify(state.processes)){state={...state,processes:ps,version:state.version+1};gravacoes++;}
      return {value,processes:ps,version:state.version};
    }
  };
}
function datajudFalso(movimentos){
  return async()=>({ok:true,status:200,headers:{get:()=>''},
    text:async()=>JSON.stringify({hits:{hits:[{_source:{movimentos}}]}})});
}

test('processo existente recebe TODOS os andamentos novos e não duplica os antigos',async()=>{
  const store=lojaEmMemoria([{id:7,numero:'0703506-31.2024.8.07.0001',nome:'Caso sintético',status:'ATIVO',
    andamentos:[{data:'2026-08-01T10:00:00.000Z',txt:'[DATAJUD] Conclusos para decisão',origem:'datajud'}]}]);
  const fetchImpl=datajudFalso([
    {dataHora:'2026-08-01T10:00:00.000Z',nome:'Conclusos para decisão'},
    {dataHora:'2026-09-17T14:00:00.000Z',nome:'Decisão'},
    {dataHora:'2026-09-20T09:00:00.000Z',nome:'Expedição de intimação'}
  ]);
  const r=await syncProcess(store,7,{apiKey:'k',integrityKey:KEY,fetchImpl});
  assert.equal(r.novos,2);assert.equal(r.duplicados,1);
  const p=store.processes[0];
  assert.equal(p.andamentos.length,3);
  assert.equal(p.andamentos[0].txt,'[DATAJUD] Expedição de intimação');
  const again=await syncProcess(store,7,{apiKey:'k',integrityKey:KEY,fetchImpl});
  assert.equal(again.novos,0);
  assert.equal(store.processes[0].andamentos.length,3);
});

function varredura(extra){
  const ctx=vm.createContext({
    process:{env:{DATAJUD_API_KEY:'k',COURT_READING_INTEGRITY_KEY:KEY}},globalThis:{fetch:()=>{}},
    _cnjDigits:cnjDigits,Workflow,_pjeMovCache:{},_pjeUltimoCheck:null,bumps:0,
    _bumpProcessos(){ctx.bumps++;},Promise,Array,Math,String,Date,...extra
  });
  vm.runInContext(extrair('async function _varrerAndamentosPjeAgora()','async function logAtividade('),ctx);
  return ctx;
}

test('primeira varredura depois de reiniciar já grava; VENCIDO entra e ARQUIVADO fica fora',async()=>{
  const chamados=[];
  const ctx=varredura({
    processos:[{id:1,numero:'0703506-31.2024.8.07.0001',status:'ATIVO'},{id:2,numero:'5001463-03.2025.8.13.0704',status:'monitorar'},
      {id:3,numero:'',status:'ATIVO'},{id:4,numero:'0000001-00.2026.8.09.0001',status:'ARQUIVADO'},
      {id:5,numero:'0000002-00.2026.8.09.0001',status:'VENCIDO'}],
    processStore:{},
    _datajudSyncProcess:async(store,id)=>{chamados.push(id);return {novos:id===1?2:0,processo:{andamentos:[{data:'x',txt:'[DATAJUD] Decisão'}]}};}
  });
  const out=await ctx._varrerAndamentosPjeAgora();
  assert.deepEqual(chamados.sort(),[1,2,5]);
  assert.equal(out.novidades,2);assert.equal(out.ok,true);assert.equal(out.monitorados,3);
  assert.equal(ctx.bumps,1);
});

test('falha em um processo não esconde os demais e aparece com o número',async()=>{
  const ctx=varredura({
    processos:[{id:1,numero:'0703506-31.2024.8.07.0001',status:'ATIVO'},{id:2,numero:'5001463-03.2025.8.13.0704',status:'ATIVO'}],
    processStore:{},
    _datajudSyncProcess:async(store,id)=>{if(id===1)throw new Error('READING_INTEGRITY_KEY_REQUIRED');return {novos:1,processo:{andamentos:[{}]}};}
  });
  const out=await ctx._varrerAndamentosPjeAgora();
  assert.equal(out.ok,false);assert.equal(out.falhas,1);assert.equal(out.novidades,1);
  assert.match(out.erros[0].erro,/COURT_READING_INTEGRITY_KEY/);
  assert.equal(out.erros[0].numero,'0703506-31.2024.8.07.0001');
});

test('sem chave do Datajud a varredura não finge sucesso',async()=>{
  const ctx=varredura({process:{env:{}},processos:[{id:1,numero:'0703506-31.2024.8.07.0001',status:'ATIVO'}],processStore:{},
    _datajudSyncProcess:async()=>{throw new Error('não deveria chamar');}});
  const out=await ctx._varrerAndamentosPjeAgora();
  assert.equal(out.ok,false);assert.equal(out.novidades,0);
});
