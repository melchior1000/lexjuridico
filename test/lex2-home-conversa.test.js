'use strict';
// Conversa como tela inicial: o LEX fala primeiro, cada aviso com o botão que executa,
// e os mapas de setores/especialistas ficam recolhidos.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const CORE=fs.readFileSync(path.join(__dirname,'..','lex2-interface-core.js'),'utf8');
const UI=fs.readFileSync(path.join(__dirname,'..','lex2-coordinator-ui.js'),'utf8');

function boot(api,procs=[]){
  const host={innerHTML:'',firstElementChild:null};
  const byId=id=>{
    if(id==='content')return host;
    // Elementos criados pelo render: procura por id no HTML e devolve um nó falso vivo.
    const m=host.innerHTML.includes('id="'+id+'"');
    if(!m)return null;
    if(!byId.nodes[id])byId.nodes[id]={innerHTML:'',isConnected:true,scrollTop:0,scrollHeight:0,classList:{toggle(){},add(){},remove(){}}};
    return byId.nodes[id];
  };
  byId.nodes={};
  const document={readyState:'complete',body:{classList:{add(){}}},getElementById:byId,addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[]};
  const timers=[];
  const ctx={document,lexApi:api,getProcs:()=>procs,console,setTimeout:(fn)=>{timers.push(fn);return timers.length},clearTimeout(){},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},localStorage:{getItem:()=>null,setItem(){}},location:{hash:''},history:{replaceState(){}},navigator:{}};
  ctx.window=ctx;ctx.globalThis=ctx;
  vm.createContext(ctx);vm.runInContext(CORE,ctx);vm.runInContext(UI,ctx);
  const flush=async()=>{while(timers.length){const fn=timers.shift();await fn()}for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r))};
  return{ctx,host,byId,flush};
}

const api=async path=>{
  if(path==='/api/trabalho')return{tarefas:[{id:'t1',status:'executando'},{id:'t2',status:'executando'},{id:'r1',status:'aguardando_revisao'}],prazos:{cunhar:[{djen_id:'d1'}],correndo:[{case_id:'p1',prazo:'2026-09-25',days_to_due:-1},{case_id:'p2',prazo:'2026-09-30',days_to_due:4}]}};
  if(path==='/api/escritorio/oab')return{oabs:[{oab:'123456',uf:'MG'}],pje:{configurado:true,tribunais:['TJMG']}};
  return{contatos:[{id:'c1',status:'novo'}]};
};

test('lexHome e lexChat abrem a mesma conversa; avisos do LEX entram no topo com botão que executa',async()=>{
  const b=boot(api);
  await b.flush(); // patch(): lexHome=lexChat=render
  assert.equal(b.ctx.window.lexHome,b.ctx.window.lexChat);
  b.ctx.window.lexHome();
  assert.match(b.host.innerHTML,/EXECUTA · APROVA/);
  assert.match(b.host.innerHTML,/id="lex2-briefing"/);
  assert.match(b.host.innerHTML,/<details class="lex2-tools-details"><summary>Setores e especialistas/,'mapas recolhidos');
  assert.match(b.host.innerHTML,/Dê uma ordem ao LEX/);
  await b.flush(); // renderBriefing + refreshOperationalStatus
  const briefing=b.byId('lex2-briefing').innerHTML;
  assert.match(briefing,/1 prazo oficial venceu[\s\S]*onclick="lexPrazosVencidos\(\)">Resolver agora/);
  assert.match(briefing,/1 publicação aguardando conferência[\s\S]*onclick="lexSetPrazoTab\(&#39;revisar&#39;\)">Conferir/);
  assert.match(briefing,/1 entrega está aguardando sua revisão[\s\S]*onclick="lexTarefas\(\)">Revisar/);
  assert.match(briefing,/1 conversa de cliente[\s\S]*onclick="lexChannel\(&#39;all&#39;\)">Abrir/);
  assert.match(briefing,/TJMG[\s\S]*Atualizar no tribunal/);
  assert.doesNotMatch(briefing,/Nada exige você agora/);
  const status=b.byId('lex2-operational-status').innerHTML;
  assert.match(status,/2 tarefas em andamento · 1 aguarda você/);
});

test('sem pendências o LEX diz que nada exige você; com falha de leitura não finge escritório em dia',async()=>{
  // Conexões ligadas, mas o servidor não devolve nada: só sobra o aviso informativo do PJe.
  const calm=boot(async path=>path==='/api/trabalho'?{tarefas:[],prazos:{cunhar:[],correndo:[]}}:path==='/api/escritorio/oab'?{oabs:[{oab:'1',uf:'MG'}],pje:{configurado:true,tribunais:['TJMG']}}:{contatos:[]});
  await calm.flush();calm.ctx.window.lexHome();await calm.flush();
  const html=calm.byId('lex2-briefing').innerHTML;
  assert.doesNotMatch(html,/venceu|aguardando sua revisão|conversa de cliente|publicação aguardando/);
  assert.match(html,/lex2-says ok[\s\S]*Atualizar no tribunal/);
  assert.match(html,/Nada exige você agora/,'o informativo do PJe não elimina o estado de escritório em dia');
  assert.equal((html.match(/class="lex-msg bot/g)||[]).length,2,'um aviso informativo e um all-clear');
  assert.match(calm.byId('lex2-operational-status').innerHTML,/nenhuma tarefa em andamento · nada aguarda você/);
  const broken=boot(async()=>{throw new Error('indisponível')});
  await broken.flush();broken.ctx.window.lexHome();await broken.flush();
  assert.match(broken.byId('lex2-briefing').innerHTML,/Não consegui ler/);
  assert.doesNotMatch(broken.byId('lex2-briefing').innerHTML,/Nada exige você agora/);
});

test('com processo em contexto a conversa não repete o briefing do escritório',async()=>{
  const b=boot(api,[{id:'p1',nome:'Caso',numero:'5004158-61.2024.8.13.0704',status:'ATIVO',last_court_sync_at:'2026-09-24T10:00:00Z'}]);
  await b.flush();b.ctx.window.lexChat('p1');
  assert.doesNotMatch(b.host.innerHTML,/id="lex2-briefing"/);
  assert.match(b.host.innerHTML,/PROCESSO EM CONTEXTO/);
});
