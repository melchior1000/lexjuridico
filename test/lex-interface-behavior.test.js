'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

function boot(file,extra){
  const context={window:{},setTimeout:fn=>fn(),...extra};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),context,{filename:file});
  return context.window;
}
function chat(){
  const host={innerHTML:''},values=new Map();let selected;
  const window=boot('lex2-coordinator-ui.js',{
    window:{lexSelectChatProcess:id=>{selected=id}},
    document:{readyState:'complete',body:{classList:{add(){}}},getElementById:id=>id==='content'?host:null},
    getProcs:()=>[{id:'a',nome:'Caso A'},{id:'b',nome:'Caso B'}],
    sessionStorage:{getItem:key=>values.get(key)||null}
  });
  return{window,host,values,selected:()=>selected};
}
test('contexto do dossiê é consumido uma vez; entrada geral não reutiliza processo',()=>{
  const h=chat();h.window.__lexDossierContext={case_id:'a'};
  h.window.lexChat();assert.equal(h.selected(),'a');assert.equal(h.window.__lexDossierContext,null);
  h.window.lexChat();assert.equal(h.selected(),'');
  h.window.__lexDossierContext={case_id:'a'};
  h.window.lexChat('');assert.equal(h.selected(),'');
  h.window.lexChat('inexistente');assert.equal(h.selected(),'');
});
test('histórico acompanha seleção explícita e escapa conteúdo recebido',()=>{
  const h=chat();
  h.values.set('lex_chat_history_process_a',JSON.stringify([{role:'user',content:'A exclusivo'}]));
  h.values.set('lex_chat_history_process_b',JSON.stringify([{role:'assistant',content:'<script>B exclusivo</script>'}]));
  h.window.lexChat('a');assert.match(h.host.innerHTML,/A exclusivo/);assert.doesNotMatch(h.host.innerHTML,/B exclusivo/);
  h.window.lexChat('b');assert.equal(h.selected(),'b');assert.match(h.host.innerHTML,/&lt;script&gt;B exclusivo/);assert.doesNotMatch(h.host.innerHTML,/A exclusivo|<script>/);
});
test('chat não exibe identidade manual como se fosse oficial',()=>{
  const host={innerHTML:''};
  const window=boot('lex2-coordinator-ui.js',{
    window:{lexSelectChatProcess(){}},
    document:{readyState:'complete',body:{classList:{add(){}}},getElementById:id=>id==='content'?host:null},
    getProcs:()=>[{id:'x',nome:'CEF — Execução vs. Pessoa Errada',partes:'CEF vs. Pessoa Errada',numero:'6002060-50.2025.4.06.3818'}],
    sessionStorage:{getItem:()=>null}
  });
  window.lexChat('x');
  assert.match(host.innerHTML,/Processo 6002060-50\.2025\.4\.06\.3818 — dados a conferir/);
  assert.doesNotMatch(host.innerHTML,/CEF — Execução vs\. Pessoa Errada|CEF vs\. Pessoa Errada/);
});

function home(api,processes=[]){
  const nodes={};for(const key of ['h1','p','.lex-today-feedback','.lex-today-list'])nodes[key]={textContent:'',innerHTML:'',appendChild(){},addEventListener(type,fn){this[type]=fn}};
  nodes['.lex-today-head']={querySelector:key=>nodes[key]};
  const surface={isConnected:true,querySelector:key=>nodes[key]};
  const host={firstElementChild:surface,innerHTML:''};
  const window=boot('lex2-interface-core.js',{
    window:{},lexApi:api,getProcs:()=>processes,
    document:{readyState:'complete',body:{classList:{add(){}}},getElementById:()=>host,createElement:()=>({})}
  });
  return{window,nodes,surface};
}

test('Home é conversa do LEX e não parede de cartões',async()=>{
  const ps=[
    {id:'legacy',nome:'CEF — Execução vs. Pessoa Errada',numero:'6002060-50.2025.4.06.3818',partes:'CEF vs. Pessoa Errada',status:'URGENTE',prazo:'27/03/2026'},
    {id:'ok',nome:'Caso confirmado',numero:'5004158-61.2024.8.13.0704',status:'ATIVO',last_court_sync_at:'2026-09-24T10:00:00Z',partes_verificadas_em:'2026-09-24T10:00:00Z'}
  ];
  const h=home(async path=>{
    if(path==='/api/trabalho')return{tarefas:[],prazos:{cunhar:[],correndo:[]}};
    if(path==='/api/escritorio/oab')return{oabs:[],pje:{configurado:false,tribunais:[]}};
    return{contatos:[]};
  },ps);
  await h.window.lexHome();
  const html=h.nodes['.lex-today-list'].innerHTML;
  assert.match(h.nodes.h1.textContent,/conferindo/i);
  assert.match(html,/2 processos/);
  assert.match(html,/1 tem leitura oficial/);
  assert.match(html,/1 processo com dados antigos ou manuais/);
  assert.doesNotMatch(html,/CEF — Execução vs\. Pessoa Errada|CEF vs\. Pessoa Errada/,'Home não repete identidade sem fonte oficial');
  assert.doesNotMatch(html,/<article|assuntos precisam de você|Prazo cadastrado vencido/);
});

test('Home deixa claro quando PJe e DJEN não estão ligados',async()=>{
  const h=home(async path=>{
    if(path==='/api/trabalho')return{tarefas:[],prazos:{cunhar:[],correndo:[]}};
    if(path==='/api/escritorio/oab')return{oabs:[],pje:{configurado:false,faltando:['PJE_MNI_CPF','PJE_MNI_SENHA']}};
    return{contatos:[]};
  },[]);
  await h.window.lexHome();
  const html=h.nodes['.lex-today-list'].innerHTML;
  assert.match(html,/PJe\/eproc ainda não está ligado/);
  assert.match(html,/Diário \(DJEN\) ainda não está ligado/);
  assert.match(html,/não vou fingir/i);
});

test('Home relata somente prazos do servidor e publicações pendentes como conferência',async()=>{
  const h=home(async path=>{
    if(path==='/api/trabalho')return{tarefas:[{id:'r1',status:'aguardando_revisao'}],prazos:{cunhar:[{djen_id:'d1'}],correndo:[{case_id:'p1',prazo:'2026-09-30',days_to_due:6}]}};
    if(path==='/api/escritorio/oab')return{oabs:[{oab:'123456',uf:'MG'}],pje:{configurado:true,tribunais:['TJMG']}};
    return{contatos:[{id:'c1',status:'novo'}]};
  },[]);
  await h.window.lexHome();
  const html=h.nodes['.lex-today-list'].innerHTML;
  assert.match(html,/1 prazo oficial em acompanhamento/);
  assert.match(html,/1 publicação aguardando conferência de prazo/);
  assert.match(html,/1 entrega está aguardando sua revisão/);
  assert.match(html,/1 conversa de cliente está em andamento/);
  assert.match(html,/PJe\/eproc está configurado para: TJMG/);
  assert.match(html,/Diário \(DJEN\) está ligado/);
});

test('falha de leitura não vira mensagem de escritório em dia',async()=>{
  const h=home(async()=>{throw new Error('indisponível')},[]);
  await h.window.lexHome();
  assert.match(h.nodes['.lex-today-feedback'].textContent,/Não consegui ler/);
  assert.match(h.nodes['.lex-today-feedback'].textContent,/Não vou interpretar ausência de dado como ausência de problema/);
  assert.doesNotMatch(h.nodes['.lex-today-list'].innerHTML,/Tudo em dia|Você está em dia/);
});

test('resposta tardia da Home não atualiza tela abandonada',async()=>{
  let finish;const deferred=new Promise(r=>{finish=r});
  const h=home(()=>deferred);const pending=h.window.lexHome();h.surface.isConnected=false;
  finish({tarefas:[],prazos:{cunhar:[],correndo:[]}});await pending;assert.equal(h.nodes.h1.textContent,'');
});


test('folha inclui deadline_truth real e baixa/desfaz pelo servidor, sem salvar snapshot local',async()=>{
  const ontem=new Date(Date.now()-2*86400000).toISOString().slice(0,10);
  const data=[{id:'v1',nome:'Caso Vencido',numero:'5004158-61.2024.8.13.0704',status:'ATIVO',
    last_court_sync_at:'2026-09-24T10:00:00Z',deadline_truth:{legal_truth:true,due_at:ontem},andamentos:[{data:'01/09/2026',txt:'antigo'}]}];
  const calls=[];let sheetEl;
  const bodyNode={innerHTML:'',listeners:{},addEventListener(t,f){this.listeners[t]=f},querySelector:()=>({textContent:''})};
  const el=()=>({className:'',innerHTML:'',listeners:{},addEventListener(t,f){this.listeners[t]=f},remove(){this.removed=true},
    querySelector:sel=>sel==='.lex-sheet-body'?bodyNode:null,querySelectorAll:()=>[]});
  const window=boot('lex2-interface-core.js',{
    window:{},getProcs:()=>data,lexApi:async(path,opt)=>{calls.push({path,opt,body:opt?.body?JSON.parse(opt.body):null});return{ok:true}},
    confirm:()=>true,
    document:{readyState:'complete',activeElement:null,body:{classList:{add(){}},appendChild(x){sheetEl=x}},querySelector:()=>null,getElementById:()=>null,createElement:()=>el()}
  });
  window.lexPrazosVencidos();
  const body=bodyNode;
  assert.ok(sheetEl,'folha foi anexada ao DOM');
  assert.match(body.innerHTML,/Caso Vencido[\s\S]*Prazo confirmado:/,'deadline_truth objeto entra na folha');
  const event=attr=>({target:{closest:sel=>sel==='['+attr+']'?{dataset:{[attr==='data-done'?'done':'undo']:'v1'},disabled:false}:null}});
  await body.listeners.click(event('data-done'));
  assert.equal(calls[0].path,'/api/escritorio/prazos/cumprido');assert.equal(calls[0].body.acao,'marcar');
  assert.match(body.innerHTML,/✓ Cumprido · registrado no histórico[\s\S]*Desfazer baixa/);
  await body.listeners.click(event('data-undo'));
  assert.equal(calls[1].body.acao,'desfazer');
});
