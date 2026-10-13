'use strict';
// Vários prazos abertos no mesmo processo (13/10/2026). Antes o processo guardava UMA data:
// confirmar a 2ª intimação apagava o prazo da 1ª; o prazo cumprido continuava na vigia e virava
// "vencido"; e um prazo novo, depois de uma baixa, nascia marcado como cumprido e sumia da tela.
const test=require('node:test');
const assert=require('node:assert/strict');
const {confirmDjenDeadline}=require('../lib/deadline-authorization');
const {watchlist}=require('../lib/deadline-watch');
const {officeRoutes}=require('../lib/office-routes');
const PA=require('../lib/prazos-abertos');

const KEY='0123456789abcdef0123456789abcdef';
const NOW=new Date('2026-10-13T13:00:00Z');
function store(initial){
  let rows=structuredClone(initial);
  return{async read(){return{processes:structuredClone(rows),version:1}},
    async mutate(fn){const next=structuredClone(rows),value=await fn(next);rows=next;return{value,processes:structuredClone(rows),version:2}},
    get p(){return structuredClone(rows[0])}};
}
function intimacao(id,over={}){
  return{djen_id:id,numero_oab:'123456',uf_oab:'MG',cnj:'50000000020268130001',tribunal:'TJMG',tipo:'Intimação',data_disponibilizacao:'2026-10-13',
    texto:'Intimação '+id,status:'casada',processo_id:'p1',requisitado_em:'2026-10-13T12:00:00.000Z',observado_em:'2026-10-13T12:00:01.000Z',
    endpoint:'https://gateway.example/comunicacao',request_id:'req-'+id,raw_receipt:'{"count":1,"items":[{"id":"'+id+'"}]}',receipt_item_key:id,receipt_page:1,
    prazo_cunhado:false,motivo_cancelamento:null,...over};
}
function banco(rows){
  const tabela=new Map(rows.map(r=>[r.djen_id,{...r}]));
  return{tabela,async req(method,table,data,query={}){
    const id=String(query.djen_id||'').replace(/^eq\./,'');
    if(method==='GET')return{ok:true,status:200,body:tabela.has(id)?[{...tabela.get(id)}]:[]};
    if(method==='PATCH'){Object.assign(tabela.get(id),data);return{ok:true,status:200,body:[{...tabela.get(id)}]}}
    return{ok:false,status:405,body:null};
  }};
}
function cenario(processo={}){
  const ps=store([{id:'p1',nome:'Maria x Banco',numero:'5000000-00.2026.8.13.0001',status:'ATIVO',andamentos:[],...processo}]);
  const db=banco([intimacao('dj1'),intimacao('dj2'),intimacao('dj3')]);
  const confirmar=(djenId,dueAt)=>confirmDjenDeadline({processStore:ps,sbReq:db.req,djenId,dueAt,humanId:'advogado',integrityKey:KEY,now:NOW});
  const vigia=()=>watchlist([ps.p],NOW,[],[],{integrityKey:KEY}).filter(i=>i.deadline_legal_truth);
  async function baixa(body){
    let status=0,out=null;
    await officeRoutes({url:'/api/escritorio/prazos/cumprido',method:'POST'},{writeHead:s=>{status=s},end:b=>{out=b?JSON.parse(b):null}},
      {headers:{},authenticate:()=>'advogado',body:async()=>body,processStore:ps,courtReadingIntegrityKey:KEY});
    return{status,body:out};
  }
  return{ps,db,confirmar,vigia,baixa};
}

test('confirmar a 2ª intimação do mesmo processo não apaga o prazo da 1ª; o principal é o mais próximo',async()=>{
  const c=cenario();
  await c.confirmar('dj2','2026-10-27');
  await c.confirmar('dj1','2026-10-20');
  const p=c.ps.p;
  assert.deepEqual(p.prazos_abertos.map(x=>[x.djen_id,x.due_at]),[['dj1','2026-10-20'],['dj2','2026-10-27']]);
  assert.equal(p.prazoReal,'2026-10-20');assert.equal(p.deadline_truth.source_ref,'dj1');
  const v=c.vigia();
  assert.deepEqual(v.map(i=>[i.djen_id_origem,i.prazo,i.days_to_due]),[['dj1','2026-10-20',7],['dj2','2026-10-27',14]],'a vigia olha os dois prazos');
  // Corrigir a data de uma intimação troca o prazo dela, sem duplicar.
  await c.confirmar('dj2','2026-10-28');
  assert.deepEqual(c.ps.p.prazos_abertos.map(x=>[x.djen_id,x.due_at]),[['dj1','2026-10-20'],['dj2','2026-10-28']]);
  // Repetir a mesma confirmação não cria prazo nem histórico novo.
  const antes=c.ps.p.deadline_history.length;
  await c.confirmar('dj1','2026-10-20');
  assert.equal(c.ps.p.deadline_history.length,antes);assert.equal(c.ps.p.prazos_abertos.length,2);
});

test('baixa marca UM prazo e promove o próximo; clique repetido não baixa o seguinte; Desfazer devolve',async()=>{
  const c=cenario();
  await c.confirmar('dj1','2026-10-20');await c.confirmar('dj2','2026-10-27');
  const semDizer=await c.baixa({processo_id:'p1',acao:'marcar'});
  assert.equal(semDizer.status,409);assert.match(semDizer.body.error,/2 prazos abertos[\s\S]*20\/10\/2026[\s\S]*27\/10\/2026/);
  const r=await c.baixa({processo_id:'p1',acao:'marcar',vencimento:'2026-10-20'});
  assert.equal(r.status,200);
  let p=c.ps.p;
  assert.deepEqual(p.prazos_abertos.map(x=>x.djen_id),['dj2']);
  assert.equal(p.prazoReal,'2026-10-27');assert.equal(p.prazo_baixa.ativa,false,'ainda há prazo aberto: o processo não está "cumprido"');
  assert.deepEqual(c.vigia().map(i=>i.prazo),['2026-10-27'],'o prazo cumprido sai da vigia');
  const repetido=await c.baixa({processo_id:'p1',acao:'marcar',vencimento:'2026-10-20'});
  assert.equal(repetido.status,200);assert.deepEqual(c.ps.p.prazos_abertos.map(x=>x.djen_id),['dj2'],'o segundo clique não baixa o prazo seguinte');
  const desfeito=await c.baixa({processo_id:'p1',acao:'desfazer'});
  assert.equal(desfeito.status,200);
  p=c.ps.p;
  assert.deepEqual(p.prazos_abertos.map(x=>x.djen_id),['dj1','dj2']);assert.equal(p.prazoReal,'2026-10-20');
});

test('último prazo cumprido sai da vigia (antes virava "vencido" depois da data)',async()=>{
  const c=cenario();
  await c.confirmar('dj1','2026-10-20');
  assert.equal((await c.baixa({processo_id:'p1',acao:'marcar'})).status,200);
  const p=c.ps.p;
  assert.equal(p.prazo_baixa.ativa,true);assert.equal(p.prazoReal,'');assert.deepEqual(p.prazos_abertos,[]);
  assert.equal(c.vigia().length,0);
  const depois=watchlist([p],new Date('2026-10-25T13:00:00Z'),[],[p.deadline_truth],{integrityKey:KEY});
  assert.ok(!depois.some(i=>i.deadline_legal_truth),'nem passando a verdade antiga por fora');
});

test('prazo novo depois de uma baixa não nasce "cumprido"',async()=>{
  const c=cenario();
  await c.confirmar('dj1','2026-10-20');
  await c.baixa({processo_id:'p1',acao:'marcar'});
  await c.confirmar('dj3','2026-11-05');
  const p=c.ps.p;
  assert.equal(p.prazo_baixa.ativa,false);assert.equal(p.deadline_truth_resolvido_em,'');
  assert.equal(p.prazoReal,'2026-11-05');
  assert.deepEqual(c.vigia().map(i=>i.prazo),['2026-11-05']);
  const desfazer=await c.baixa({processo_id:'p1',acao:'desfazer'});
  assert.equal(desfazer.status,409,'desfazer a baixa antiga agora apagaria o prazo novo');
});

test('processo de antes da mudança (um prazo só) entra na lista sem perder o prazo antigo',async()=>{
  const c=cenario();
  await c.confirmar('dj1','2026-10-20');
  // Simula o registro antigo: sem prazos_abertos, e djen_id_origem regravado por andamento posterior.
  await c.ps.mutate(ps=>{delete ps[0].prazos_abertos;ps[0].djen_id_origem='dj9';return ps[0]});
  assert.deepEqual(PA.prazosAbertos(c.ps.p).map(x=>[x.djen_id,x.due_at]),[['dj1','2026-10-20']],'o nº vem da verdade assinada');
  await c.confirmar('dj2','2026-10-30');
  assert.deepEqual(c.ps.p.prazos_abertos.map(x=>[x.djen_id,x.due_at]),[['dj1','2026-10-20'],['dj2','2026-10-30']]);
});

test('tela Prazos: um item por prazo (dois prazos do mesmo processo aparecem os dois)',()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const ui=fs.readFileSync(path.join(__dirname,'..','office-ui-v2.js'),'utf8');
  const pick=name=>{const i=ui.indexOf('function '+name+'(');assert.ok(i>=0,name);return ui.slice(i,ui.indexOf('\n',i))};
  const ctx=vm.createContext({deadlineServerState:[],procs:()=>[{id:'p1',nome:'Caso',prazoReal:'2026-10-20'},{id:'p2',nome:'Outro',prazoReal:'2026-10-18'}],days:p=>p.prazoReal==='2026-10-18'?5:9999});
  vm.runInContext(['setDeadlineServerState','deadlineTruthMap','deadlineItems'].map(pick).join('\n')+';this.setDeadlineServerState=setDeadlineServerState;this.deadlineItems=deadlineItems;',ctx);
  ctx.setDeadlineServerState({prazos:{todos:[
    {case_id:'p1',deadline_legal_truth:true,prazo:'2026-10-20',days_to_due:7,djen_id_origem:'dj1'},
    {case_id:'p1',deadline_legal_truth:true,prazo:'2026-10-27',days_to_due:14,djen_id_origem:'dj2'}]}});
  const itens=ctx.deadlineItems();
  assert.deepEqual(itens.map(x=>[x.p.id,x.due,x.d,x.confirmed]),[['p2',null,5,false],['p1','2026-10-20',7,true],['p1','2026-10-27',14,true]]);
});

// Lembrete de vencimento (como ADVBOX/Astrea: D-5, D-2, D-1, no dia e vencido) com processo e data.
// Antes saía só "PRAZOS: 2 novo(s) marco(s) de vencimento entraram na fila de alerta" — sem dizer qual.
test('lembrete de vencimento diz o processo, a data e quanto falta — um por prazo',async()=>{
  const {runDailyOfficeJobs}=require('../lib/office-daily-jobs');
  const c=cenario();
  await c.confirmar('dj1','2026-10-14');await c.confirmar('dj2','2026-10-18');
  const criados=[];
  const sbReq=async(method,table,data)=>{
    if(table==='prazo_alertas'&&method==='POST'){const k=data.processo_id+'|'+data.due_at+'|'+data.marco;if(criados.includes(k))return{ok:true,status:200,body:[]};criados.push(k);return{ok:true,status:201,body:[{...data,id:criados.length}]}}
    return{ok:true,status:200,body:[]};
  };
  const r=await runDailyOfficeJobs({processStore:c.ps,sbReq,now:NOW,datajudOptions:{integrityKey:KEY},djenOptions:{oabs:[],integrityKey:KEY}});
  assert.deepEqual(r.lembretes.map(l=>[l.djen_id,l.due_at,l.dias,l.marco]),[['dj1','2026-10-14',1,'d1'],['dj2','2026-10-18',5,'d5']]);
  const texto=require('../lib/deadline-alerts').textoLembretes(r.lembretes);
  assert.match(texto,/amanhã \(14\/10\/2026\): Maria x Banco \(5000000-00\.2026\.8\.13\.0001\) — intimação nº dj1/);
  assert.match(texto,/em 5 dias \(18\/10\/2026\)[\s\S]*intimação nº dj2/);
  // No dia seguinte o mesmo marco não repete; o prazo de amanhã vira "HOJE".
  const r2=await runDailyOfficeJobs({processStore:c.ps,sbReq,now:new Date('2026-10-14T13:00:00Z'),datajudOptions:{integrityKey:KEY},djenOptions:{oabs:[],integrityKey:KEY}});
  assert.deepEqual(r2.lembretes.map(l=>[l.djen_id,l.marco]),[['dj1','d0']]);
  assert.match(require('../lib/deadline-alerts').textoLembretes(r2.lembretes),/HOJE \(14\/10\/2026\)/);
});

test('vigia diária manda o lembrete detalhado (não mais "N marco(s) entraram na fila")',async()=>{
  const {createDeadlineScheduler}=require('../lib/deadline-scheduler');
  const mem=new Map(),avisos=[];
  const records={async read(k){return mem.has(k)?{value:mem.get(k)}:null},async change(k,fn){const v=await fn(mem.get(k)??null);if(v!==undefined)mem.set(k,v);return v}};
  const s=createDeadlineScheduler({records,notify:async t=>{avisos.push(t);return true},now:()=>NOW,
    run:async()=>({ok:true,djen:{enabled:true,ok:true,cunhar_total:0},datajud:{enabled:false},alerts:{novos:1,alertas:[{}]},
      lembretes:[{processo_id:'p1',titulo:'Maria x Banco',numero:'5000000-00.2026.8.13.0001',due_at:'2026-10-13',dias:0,marco:'d0',djen_id:'dj1'}]})});
  await s.tick();
  assert.equal(avisos.length,1);
  assert.match(avisos[0],/⏰ PRAZOS[\s\S]*HOJE \(13\/10\/2026\): Maria x Banco/);
  assert.doesNotMatch(avisos[0],/marco\(s\)/);
});

test('duas intimações com a mesma data: a baixa pelo nº da intimação não leva a outra junto (nem no clique repetido)',async()=>{
  const c=cenario();
  await c.confirmar('dj1','2026-10-20');await c.confirmar('dj2','2026-10-20');
  assert.equal((await c.baixa({processo_id:'p1',acao:'marcar',vencimento:'2026-10-20',djen_id:'dj1'})).status,200);
  assert.equal((await c.baixa({processo_id:'p1',acao:'marcar',vencimento:'2026-10-20',djen_id:'dj1'})).status,200);
  assert.deepEqual(c.ps.p.prazos_abertos.map(x=>x.djen_id),['dj2']);
  // A tela manda o nº da intimação do prazo que está mostrando.
  const core=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','lex2-interface-core.js'),'utf8');
  assert.match(core,/acao:'marcar',vencimento:[^}]*djen_id:alvo\?\.deadline_truth\?\.source_ref/);
});
