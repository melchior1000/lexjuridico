'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {executeNaturalOfficeCommand}=require('../lib/office-routes');
const {parseOfficeCommand}=require('../lib/office-command');
const {parseOfficeQuery,isLegalQuestion,processHint}=require('../lib/office-queries');

const NOW=new Date('2026-09-24T13:00:00Z');// 10h em Brasília
const CNJ_A='5001234-56.2026.8.13.0704';

function processStore(rows){
  return{async read(){return{processes:structuredClone(rows),version:1}},async mutate(){throw new Error('consulta não pode gravar')}};
}
function engine(tasks=[]){return{async list(){return tasks},async submit(){throw new Error('consulta não pode criar tarefa')}}}
const receptionStore={async list(){return[]},async appendEvent(){}};
function db(tables,{fail=false}={}){
  const calls=[];
  const req=async(method,table,body,query)=>{calls.push({method,table,query});if(fail)return{ok:false,status:503};return{ok:true,status:200,body:structuredClone(tables[table]||[])}};
  req.calls=calls;return req;
}
const carteira=[
  {id:'p1',nome:'Maria Silva x Banco Alfa',numero:CNJ_A,status:'ATIVO',prazo:'2026-09-24',tribunal:'TJMG',andamentos:[{data:'2026-09-20',txt:'Intimação para contestar'},{data:'10/09/2026',txt:'Citação expedida'}]},
  {id:'p2',nome:'João Souza x Estado',numero:'5009999-11.2026.8.13.0001',status:'ATIVO',prazo:'2026-09-22'},
  {id:'p3',nome:'Maria Oliveira inventário',numero:'5008888-22.2026.8.13.0002',status:'ATIVO',prazo:'2026-10-20'},
  {id:'p4',nome:'Caso encerrado',numero:'5007777-33.2026.8.13.0003',status:'ARQUIVADO',prazo:'2026-09-24'}
];
function run(text,extra={}){
  return executeNaturalOfficeCommand({processStore:processStore(carteira),engine:engine(),receptionStore,records:{list:async()=>[]},log:()=>{},...extra},{text,profile:'advogado',now:NOW});
}

test('frases do dia a dia viram consultas determinísticas',()=>{
  const cases={
    'quais são meus prazos de hoje?':['deadlines','hoje'],
    'prazos da semana':['deadlines','semana'],
    'Prazos':['deadlines','semana'],
    'prazos vencidos':['deadlines','vencidos'],
    'o que vence essa semana?':['deadlines','semana'],
    'tem intimação nova?':['publications'],
    'o que saiu no diário hoje?':['publications'],
    'publicações de hoje':['publications'],
    'como está o processo da Maria Silva?':['process_status'],
    ['andamento do processo '+CNJ_A]:['process_status'],
    'prazo do processo da Maria':['process_status'],
    'resumo do dia':['daily_brief'],
    'Bom dia, Lex':['daily_brief'],
    'ajuda':['help']
  };
  for(const [text,[action,janela]] of Object.entries(cases)){
    assert.equal(parseOfficeCommand(text,{}),null,text+': não deve colidir com ordens existentes');
    const q=parseOfficeQuery(text);
    assert.equal(q?.action,action,text);
    if(janela)assert.equal(q.janela,janela,text);
  }
});

test('perguntas jurídicas em tese não viram consulta nem tarefa',async()=>{
  for(const text of ['qual o prazo para contestar?','prazo para apelação no CPC','me explique a contagem de prazo em dobro','o que é intimação?','como faço uma contestação?']){
    assert.ok(!parseOfficeQuery(text),text+': não é consulta de carteira');
    assert.equal(await run(text),null,text+': deve seguir para o assessor');
  }
  assert.equal(isLegalQuestion('Faça a contestação do processo '+CNJ_A),false);
  assert.equal(isLegalQuestion('Quero uma contestação desse processo'),false);
});

test('prazos: ordena, inclui vencidos, ignora arquivados e marca não confirmados',async()=>{
  const out=await run('prazos de hoje');
  assert.equal(out.handled,true);
  const ids=out.result.itens.map(i=>i.case_id);
  assert.deepEqual(ids,['p2','p1']);// vencido primeiro, arquivado fora, outubro fora
  assert.match(out.message,/VENCIDO há 2 dias\) — João Souza/);
  assert.match(out.message,/HOJE\) — Maria Silva/);
  assert.match(out.message,/NÃO confirmado/);
  assert.doesNotMatch(out.message,/Caso encerrado/);
});

test('prazos: janela sem itens diz isso sem inventar',async()=>{
  const out=await executeNaturalOfficeCommand({processStore:processStore([]),engine:engine(),log:()=>{}},{text:'prazos da semana',profile:'secretaria',now:NOW});
  assert.match(out.message,/nenhum prazo registrado/);
});

test('intimações: lista, aponta órfãs e leitura atrasada do DJEN',async()=>{
  const sbReq=db({
    djen_comunicacoes:[
      {djen_id:'1',data_disponibilizacao:'2026-09-24',tribunal:'TJMG',tipo:'Intimação',cnj:'50012345620268130704',status:'casada',prazo_cunhado:false},
      {djen_id:'2',data_disponibilizacao:'2026-09-23',tribunal:'TRF1',tipo:'Intimação',cnj:'00000000000000000000',status:'orfa'},
      {djen_id:'3',data_disponibilizacao:'2026-09-23',status:'cancelada'}
    ],
    djen_sync_state:[{last_success_at:'2026-09-22T09:00:00Z'}]
  });
  const out=await run('tem intimação nova?',{sbReq});
  assert.equal(out.result.total,2);
  assert.equal(out.result.orfas,1);
  assert.equal(out.result.aguardando_prazo,1);
  assert.match(out.message,/processo NÃO cadastrado no LEX/);
  assert.match(out.message,/Leitura atrasada/);
  const query=sbReq.calls.find(c=>c.table==='djen_comunicacoes').query;
  assert.equal(query.data_disponibilizacao,'gte.2026-09-18');
});

test('intimações: banco fora do ar falha fechado, nunca "nada novo"',async()=>{
  const out=await run('tem intimação nova?',{sbReq:db({},{fail:true})});
  assert.equal(out.result.disponivel,false);
  assert.match(out.message,/NÃO significa que não há intimações/);
  assert.doesNotMatch(out.message,/Nenhuma intimação/);
});

test('andamento: resolve por nome, mostra o mais recente primeiro',async()=>{
  const out=await run('como está o processo da Maria Silva?');
  assert.equal(out.result.processo_id,'p1');
  const first=out.message.indexOf('Intimação para contestar'),second=out.message.indexOf('Citação expedida');
  assert.ok(first>0&&second>first,'andamento mais novo deve vir antes');
  assert.match(out.message,/Sem leitura oficial registrada/);
});

test('andamento: nome ambíguo lista as opções no texto e não escolhe sozinho',async()=>{
  const out=await run('como está o processo da Maria?');
  assert.equal(out.needs_input,true);
  assert.equal(out.result,undefined);
  assert.match(out.message,/1\) Maria/);
  assert.match(out.message,/2\) Maria/);
});

test('andamento: por número CNJ',async()=>{
  const out=await run('andamento do processo 5009999-11.2026.8.13.0001');
  assert.equal(out.result.processo_id,'p2');
});

test('resumo do dia junta prazos, DJEN e pendências sem gravar nada',async()=>{
  const out=await run('bom dia',{sbReq:db({djen_comunicacoes:[],djen_sync_state:[{last_success_at:'2026-09-24T11:00:00Z'}]})});
  assert.match(out.message,/Prazos \(7 dias\): 2 · 1 VENCIDO\(S\) · 1 HOJE/);
  assert.match(out.message,/DJEN: Nenhuma intimação/);
  assert.match(out.message,/Precisa de você/);
});

test('ajuda explica o uso sem comandos decorados',async()=>{
  const out=await run('ajuda');
  assert.match(out.message,/prazos de hoje/);
});

test('dica de processo remove palavras da pergunta',()=>{
  assert.equal(processHint('como está o processo da Maria Silva?'),'maria silva');
  assert.equal(processHint('andamento do '+CNJ_A),CNJ_A);
});

test('intimações: cursor do DJEN ilegível vira aviso, não quebra a resposta',async()=>{
  const base=db({djen_comunicacoes:[]});
  const sbReq=async(method,table,...rest)=>table==='djen_sync_state'?{ok:false,status:500}:base(method,table,...rest);
  const out=await run('tem intimação nova?',{sbReq});
  assert.equal(out.result.disponivel,true);
  assert.match(out.message,/Não há registro de leitura bem-sucedida do DJEN/);
});

const {pickChoice}=require('../lib/office-queries');
test('escolha curta responde à pergunta "qual processo?"',()=>{
  const opts=[{id:'p1',nome:'Maria Silva x Banco Alfa',numero:CNJ_A},{id:'p3',nome:'Maria Oliveira inventário',numero:'5008888-22.2026.8.13.0002'}];
  assert.equal(pickChoice('1',opts).id,'p1');
  assert.equal(pickChoice('2)',opts).id,'p3');
  assert.equal(pickChoice('o segundo',opts).id,'p3');
  assert.equal(pickChoice('opção 1',opts).id,'p1');
  assert.equal(pickChoice(CNJ_A,opts).id,'p1');
  assert.equal(pickChoice('oliveira',opts).id,'p3');
  assert.equal(pickChoice('3',opts),null);
  assert.equal(pickChoice('maria',opts),null,'nome ainda ambíguo não escolhe');
  assert.equal(pickChoice('prazos da semana',opts),null,'ordem nova não é escolha');
});

test('fluxo completo: pergunta ambígua, escolha e resposta do processo certo',async()=>{
  const first=await run('como está o processo da Maria?');
  assert.equal(first.choice,'processo');
  assert.match(first.message,/Responda com o número da opção/);
  const pick=pickChoice('2',first.candidates);
  const second=await executeNaturalOfficeCommand({processStore:processStore(carteira),engine:engine(),receptionStore,log:()=>{}},{text:'como está o processo da Maria?',processo_id:pick.id,profile:'advogado',now:NOW});
  assert.equal(second.result.processo_id,'p3');
  assert.match(second.message,/Maria Oliveira/);
});

test('canal: áudio do operador é transcrito e a escolha pendente é usada',()=>{
  const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','bot.js'),'utf8');
  const start=src.indexOf('async function processarMensagem');
  const body=src.slice(start,start+6000);
  assert.match(body,/isOperator && !txt && dados\.audio\?\.buffer && !global\._intakeSessoes/);
  assert.match(body,/_transcreverAudioWhisper\(dados\.audio\.buffer/);
  assert.match(body,/pickChoice\(txt,pending\.candidatos\)/);
  assert.match(body,/mem\.lexEscolhaPendente=\{/);
});
