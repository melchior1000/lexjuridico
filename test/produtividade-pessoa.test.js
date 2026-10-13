'use strict';
// Produtividade por pessoa (o Taskscore do ADVBOX) e painel semanal no WhatsApp do titular.
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMorningBrief,KEY}=require('../lib/morning-brief');
const {TaskEngine}=require('../lib/task-engine');
const {officeRoutes}=require('../lib/office-routes');
const I=require('../lib/office-insights');

function records(){
  const map=new Map();
  return{map,
    async read(k){return map.has(k)?{value:structuredClone(map.get(k))}:null},
    async change(k,fn){const old=map.has(k)?structuredClone(map.get(k)):null;const next=await fn(old);if(next!==undefined)map.set(k,structuredClone(next));return next===undefined?old:structuredClone(next)},
    async list(prefix){return[...map.entries()].filter(([k])=>k.startsWith(prefix)).map(([,v])=>structuredClone(v)).filter(Boolean)}};
}

test('painel semanal: só na segunda, uma vez, sem disputar o registro do bom dia',async()=>{
  const rec=records(),enviados=[];
  await rec.change(KEY,()=>({date:'2026-10-12',status:'enviado'})); // bom dia de hoje já foi
  const mk=iso=>createMorningBrief({records:rec,key:'lex_painel_semanal',weekdays:[1],hour:8,compose:async()=>'Painel',deliver:async t=>{enviados.push(t);return true},now:()=>new Date(iso)});
  assert.equal((await mk('2026-10-12T11:05:00Z').tick()).ok,true,'segunda, 8h05 em Brasília');
  assert.equal((await mk('2026-10-12T12:00:00Z').tick()).skipped,'ja_enviado');
  assert.equal((await mk('2026-10-13T11:05:00Z').tick()).skipped,'fora_do_dia','terça não');
  assert.equal((await mk('2026-10-19T10:30:00Z').tick()).skipped,'fora_horario','segunda seguinte antes das 8h');
  assert.equal((await mk('2026-10-19T11:30:00Z').tick()).ok,true);
  assert.deepEqual(enviados,['Painel','Painel']);
});

test('o motor de tarefas grava a conta de quem pediu, revisou e devolveu, sem perder o perfil',async()=>{
  const rec=records();
  const engine=new TaskEngine({store:rec,processes:async()=>[],ai:async()=>''});
  const ana={id:'u1',nome:'Dra. Ana'};
  const t=await engine.submit({tipo:'analise',instrucao:'Analise'},'advogado',{conta:ana});
  assert.equal(t.ator,'advogado');assert.deepEqual(t.ator_conta,ana);
  const sem=await engine.submit({tipo:'analise',instrucao:'Outra'},'admin');
  assert.equal(sem.ator_conta,null);
  await rec.change('lex_task:'+t.id,x=>({...x,status:'aguardando_revisao',sha256:'abc'}));
  const dev=await engine.returnForCorrection(t.id,'ajuste o pedido','advogado',{conta:{id:'u2',nome:'Dr. Beto'}});
  assert.deepEqual(dev.devolvido_por_conta,{id:'u2',nome:'Dr. Beto'});
  await rec.change('lex_task:'+t.id,x=>({...x,status:'aguardando_revisao',sha256:'def'}));
  const rev=await engine.review(t.id,'def','admin',{conta:{id:'u3',nome:'Dr. Titular'}});
  assert.equal(rev.revisado_por,'admin');assert.deepEqual(rev.revisado_por_conta,{id:'u3',nome:'Dr. Titular'});
});

test('as rotas do app passam a conta da sessão para o motor',async()=>{
  const chamadas=[];
  const engine={
    async submit(input,perfil,meta){chamadas.push(['submit',perfil,meta]);return{id:'t1',...input,status:'na_fila'}},
    async run(){return{id:'t1',status:'na_fila'}},
    async review(id,sha,perfil,meta){chamadas.push(['review',perfil,meta]);return{id,status:'concluida',processo_id:null}}
  };
  const deps={headers:{},authenticate:()=>'advogado',conta:()=>({id:'u1',nome:'Dra. Ana'}),processStore:{read:async()=>({processes:[]}),mutate:async fn=>({value:await fn([])})},
    engine,records:{read:async()=>null},aiAvailable:()=>true,log:()=>{}};
  const rota=async(url,body)=>{deps.body=async()=>body;let status=0;await officeRoutes({url,method:'POST'},{writeHead:s=>{status=s},end:()=>{}},deps);return status};
  assert.equal(await rota('/api/tarefas',{tipo:'analise',instrucao:'Analise o caso'}),202);
  assert.equal(await rota('/api/tarefas/revisar',{id:'t1',sha256:'x'}),200);
  assert.deepEqual(chamadas.map(c=>[c[0],c[1],c[2]?.conta?.nome]),[['submit','advogado','Dra. Ana'],['review','advogado','Dra. Ana']]);
});

test('o painel separa a equipe por pessoa quando há conta; só por perfil, ele explica',()=>{
  const NOW=new Date('2026-10-13T13:00:00Z'),ontem='2026-10-12T15:00:00Z';
  const tarefas=[
    {id:'a',tipo:'analise',status:'concluida',ator:'advogado',ator_conta:{id:'u1',nome:'Dra. Ana'},criada_em:ontem,atualizada_em:ontem,revisado_em:'2026-10-12T18:00:00Z',revisado_por:'admin',revisado_por_conta:{id:'u3',nome:'Dr. Titular'}},
    {id:'b',tipo:'peticao',status:'na_fila',ator:'advogado',ator_conta:{id:'u2',nome:'Dr. Beto'},criada_em:ontem},
    {id:'c',tipo:'peticao',status:'na_fila',ator:'advogado',ator_conta:{id:'u1',nome:'Dra. Ana'},criada_em:ontem}
  ];
  const r=I.computeOfficeInsights({processes:[],tasks:tarefas,prazos:[],now:NOW});
  const nomes=Object.fromEntries(r.equipe.pessoas.map(p=>[p.nome,p]));
  assert.equal(nomes['Dra. Ana'].ordens,2);assert.equal(nomes['Dr. Beto'].ordens,1);assert.equal(nomes['Dr. Titular'].revisoes,1);
  assert.equal(nomes['Dr. Titular'].revisao_media_horas,3);
  assert.equal(r.equipe.observacao,null);
  const soPerfil=I.computeOfficeInsights({processes:[],tasks:[{id:'d',tipo:'analise',status:'na_fila',ator:'admin',criada_em:ontem}],prazos:[],now:NOW});
  assert.match(soPerfil.equipe.observacao,/própria conta/);
  assert.match(I.officeInsightsMessage(r),/• Dra\. Ana: 2 ordens, 0 revisões\./);
});

test('painel marcado para 12h ou mais tarde não é pulado em silêncio (CodeRabbit #163)',async()=>{
  const rec=records(),enviados=[];
  const mk=(iso,hour)=>createMorningBrief({records:rec,key:'lex_painel_semanal',weekdays:[1],hour,compose:async()=>'Painel',deliver:async t=>{enviados.push(t);return true},now:()=>new Date(iso)});
  assert.equal((await mk('2026-10-12T16:05:00Z',13).tick()).ok,true,'segunda, 13h05 em Brasília');
  assert.equal((await mk('2026-10-19T21:30:00Z',13).tick()).skipped,'fora_horario','depois da janela de 4 horas');
  assert.equal((await mk('2026-10-19T12:00:00Z',99).tick()).ok,true,'hora inválida volta ao padrão');
});
