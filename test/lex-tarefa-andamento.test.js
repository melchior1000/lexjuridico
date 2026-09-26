'use strict';
// Tarefa em andamento: linha do tempo a partir dos carimbos reais do Task Engine,
// bloco "Precisa de você" só quando o motor espera o humano, sem botão sem rota.
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

function bootBase(){
  const ctx={addEventListener(){},removeEventListener(){},document:{getElementById:()=>null,addEventListener(){},body:{classList:{add(){},remove(){}}}},lexEscape:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),localStorage:{getItem:()=>null,setItem(){}},console};
  ctx.window=ctx;ctx.globalThis=ctx;
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('office-ui-base.js','utf8'),ctx);
  return ctx;
}
const base=bootBase();
const task={id:'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',tipo:'contestacao',agente:'LEX Redator',instrucao:'faça a contestação do processo do Banco Alfa',processo_id:'p1',processo_nome:'Banco Alfa · Execução 1.0042',
  criada_em:'2026-09-26T12:41:00Z',iniciada_em:'2026-09-26T12:43:00Z',triagem:{cabivel:true,faltantes:[]},tentativas:1,atualizada_em:'2026-09-26T12:50:00Z'};

test('linha do tempo segue os carimbos reais, em ordem, e o status atual fecha a lista',()=>{
  const ev=base.lexTaskTimeline({...task,status:'executando'});
  assert.equal(ev.map(e=>e.titulo).join('|'),'Recebi a ordem|Identifiquei o processo|Comecei a executar|Conferi cabimento e fontes|Executando agora');
  assert.equal(ev[0].estado,'feito');assert.equal(ev.at(-1).estado,'agora');
  assert.match(ev[1].detalhe,/Banco Alfa/);
  assert.ok(ev[0].hora,'evento com carimbo tem hora');assert.equal(ev.at(-1).hora,'','evento sem carimbo não inventa hora');
});

test('Precisa de você aparece só quando o motor espera o humano, com quem/o quê/por quê e ação real',()=>{
  const waiting=base.lexTaskDetailHtml({...task,status:'aguardando_revisao',tem_documento:true});
  assert.match(waiting,/PRECISA DE VOCÊ/);
  assert.match(waiting,/<dt>Quem<\/dt><dd>Banco Alfa/);
  assert.match(waiting,/<dt>O quê<\/dt><dd>Revisar a minuta/);
  assert.match(waiting,/lexReviewTask\('a1b2c3d4/);
  assert.match(waiting,/lexReturnTask\('a1b2c3d4/);
  assert.match(waiting,/lexDownloadTask\('a1b2c3d4/);
  assert.match(waiting,/Minuta pronta — aguarda sua revisão/);
  assert.match(waiting,/ETAPA<\/small><strong>3 de 4/);
  const running=base.lexTaskDetailHtml({...task,status:'executando'});
  assert.doesNotMatch(running,/PRECISA DE VOCÊ|Pausar|Parar/,'sem rota de pausa não há botão');
  assert.match(running,/Executando agora/);
  const failed=base.lexTaskDetailHtml({...task,status:'falhou',pendencia:'Fonte indisponível'});
  assert.match(failed,/PRECISA DE VOCÊ[\s\S]*Fonte indisponível[\s\S]*lexRetryTask/);
  const done=base.lexTaskDetailHtml({...task,status:'concluida',revisado_em:'2026-09-26T14:00:00Z',revisado_por:'admin',resultado:'x'});
  assert.match(done,/Aprovada por você/);assert.doesNotMatch(done,/PRECISA DE VOCÊ/);
});

test('conteúdo da tarefa é escapado antes de ir ao HTML',()=>{
  const html=base.lexTaskDetailHtml({...task,status:'aguardando_dados',pendencia:'<img src=x onerror=alert(1)>'});
  assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
});

test('tela de tarefas abre uma tarefa em detalhe e re-lê a cada 15 s só enquanto executa',async()=>{
  const SRC=fs.readFileSync('office-ui-v2.js','utf8');
  const nodes={'#content':{innerHTML:'',isConnected:true}};
  let status='executando',calls=0;const intervals=[];
  const document={querySelector:s=>{if(s==='#lex-task-detail'){if(!nodes['#content'].innerHTML.includes('id="lex-task-detail"'))return null;return nodes[s]||(nodes[s]={innerHTML:'',isConnected:true})}return nodes[s]||null},querySelectorAll:()=>[],addEventListener(){},documentElement:{classList:{add(){},remove(){},toggle(){},contains:()=>false},setAttribute(){}},body:{classList:{add(){},remove(){},toggle(){},contains:()=>false}},getElementById:()=>null,createElement:()=>({style:{},setAttribute(){},appendChild(){}}),head:{appendChild(){}}};
  const ctx={document,getProcs:()=>[],localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,setItem(){}},setTimeout:()=>0,clearTimeout(){},setInterval:(fn,ms)=>{if(ms!==15000)return 0;intervals.push({fn,ms});return intervals.length},clearInterval:id=>{if(id>0)intervals[id-1]=null},console,matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},location:{hash:''},history:{replaceState(){},pushState(){}},navigator:{},
    lexApi:async()=>{calls++;return{tarefas:[{...task,status}]}},lexTaskDetailHtml:base.lexTaskDetailHtml,lexTaskCard:t=>'<article class="work-task">'+t.status+'</article>'};
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(SRC,ctx);
  await ctx.lexTarefas(task.id);
  assert.match(nodes['#lex-task-detail'].innerHTML,/Executando agora/);
  assert.equal(intervals.filter(Boolean).length,1);assert.equal(intervals[0].ms,15000);
  status='aguardando_revisao';await intervals[0].fn();
  assert.match(nodes['#lex-task-detail'].innerHTML,/PRECISA DE VOCÊ/);
  assert.equal(intervals.filter(Boolean).length,0,'relógio para quando a tarefa deixa de executar');
  await ctx.lexTarefas();
  assert.match(nodes['#lex-task-detail'].innerHTML,/lex-task-row/);
  assert.ok(calls>=3);
});
