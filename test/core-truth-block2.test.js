'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const agent=require('../lex_agente_vivo');

async function call(method,url,body,extra={}){
  const result={};
  const res={
    writeHead(status,headers){result.status=status;result.headers=headers||{};},
    end(raw){result.body=raw?JSON.parse(String(raw)):null;}
  };
  await agent.tratarRota({method,headers:{},body},res,url,{
    perfil:'admin',
    body,
    processos:[],
    lerBody:async()=>body,
    ...extra
  });
  return result;
}

test('atos processuais sem processo exigem contexto e consulta abstrata nao',()=>{
  assert.equal(agent.requiresProcessContext('Faça uma contestação para esse caso'),true);
  assert.equal(agent.requiresProcessContext('Atualize o status do processo para ativo'),true);
  assert.equal(agent.requiresProcessContext('Confirme o prazo para sexta-feira'),true);
  assert.equal(agent.requiresProcessContext('Qual o prazo em dobro do art. 183 do CPC?'),false);
  assert.equal(agent.requiresProcessContext('Bom dia, o que tenho para hoje?'),false);
});

test('/api/vivo/conversar bloqueia ato processual sem processo antes da IA',async()=>{
  const r=await call('POST','/api/vivo/conversar',{mensagem:'Faça uma contestação para esse caso'});
  assert.equal(r.status,422);
  assert.equal(r.body.codigo,'PROCESSO_CONTEXTO_NECESSARIO');
  assert.equal(r.body.needs_input,true);
});

test('redator conversacional e gerador exigem processo selecionado',async()=>{
  const conversar=await call('POST','/api/vivo/peca/conversar',{mensagem:'Quero preparar contestação'});
  assert.equal(conversar.status,422);
  assert.equal(conversar.body.codigo,'PROCESSO_CONTEXTO_NECESSARIO');

  const gerar=await call('POST','/api/vivo/peca/gerar',{briefing:{tipo_peca:'Contestação'}});
  assert.equal(gerar.status,422);
  assert.equal(gerar.body.codigo,'PROCESSO_CONTEXTO_NECESSARIO');
});

test('Gestor nao grava prazo juridico por proposta',async()=>{
  let persistiu=0;
  const processo={id:'p1',nome:'Caso Alfa',status:'ATIVO',andamentos:[]};
  const r=await call('POST','/api/vivo/aplicar',{
    processo_id:'p1',
    proposta:{andamento:'Intimação informada',status:'ATIVO',proxima_acao:'Analisar',justificativa:'Teste',prazo:'2026-10-01'}
  },{
    processos:[processo],
    sbReq:async()=>{persistiu++;return {ok:true,status:200,body:[{id:'p1'}]};}
  });
  assert.equal(r.status,409);
  assert.equal(r.body.codigo,'PRAZO_EXIGE_FLUXO_OFICIAL');
  assert.equal(r.body.fluxo,'/api/escritorio/prazos/cunhar');
  assert.equal(persistiu,0);
  assert.equal(processo.prazo,undefined);
});

test('CORS sem configuracao nunca abre wildcard',async()=>{
  const r=await call('GET','/api/vivo/health',null,{CORS:undefined});
  assert.equal(r.status,200);
  assert.notEqual(r.headers['Access-Control-Allow-Origin'],'*');
});

test('health nao expoe tamanho da carteira',async()=>{
  const r=await call('GET','/api/vivo/health',null,{processos:[{id:'p1'},{id:'p2'}]});
  assert.equal(r.status,200);
  assert.equal(Object.hasOwn(r.body,'processos_em_memoria'),false);
});

test('export GET aguarda dados e devolve processo real',async()=>{
  const r=await call('GET','/api/vivo/exportar/p1',null,{
    sbGet:async(table,filter)=>{
      if(table==='processos_cache') return [{id:'p1',numero:'5001234-56.2026.8.13.0704',tribunal:'TJMG'}];
      if(table==='vivo_acoes') return [];
      return [];
    }
  });
  assert.equal(r.status,200);
  assert.equal(r.body.processo.id,'p1');
  assert.equal(r.body.pronto_para_consulta_publica,true);
  assert.equal(Object.hasOwn(r.body,'pronto_para_pje'),false);
});

test('prontidao judicial nao promete autenticacao, autos ou protocolo',()=>{
  const d=agent.prepararParaConsultaPublica({numero:'5001234-56.2026.8.13.0704',tribunal:'TJMG'});
  assert.equal(d.pronto,true);
  assert.equal(d.capacidades.consulta_publica,true);
  assert.equal(d.capacidades.captura_assistida,true);
  assert.equal(d.capacidades.autenticacao_pje,false);
  assert.equal(d.capacidades.baixar_autos,false);
  assert.equal(d.capacidades.protocolar_peca,false);
  assert.equal(Object.hasOwn(d,'hooks'),false);
});

test('Core nao fica personalizado com nome do titular nem promete PJe autenticado',()=>{
  const source=fs.readFileSync('lex_agente_vivo_core.js','utf8');
  assert.doesNotMatch(source,/Kleuber/);
  assert.doesNotMatch(source,/pronto para SaaS/);
  assert.doesNotMatch(source,/pje\.protocolarPeca|hooks:\s*\{/);
  assert.doesNotMatch(source,/Erro no Gestor IA:/);
});
