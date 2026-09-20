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
function home(api){
  const nodes={};for(const key of ['h1','p','.lex-today-feedback','.lex-today-list'])nodes[key]={textContent:'',innerHTML:'',appendChild(){},addEventListener(type,fn){this[type]=fn}};
  nodes['.lex-today-head']={querySelector:key=>nodes[key]};
  const surface={isConnected:true,querySelector:key=>nodes[key]};
  const host={firstElementChild:surface,innerHTML:''};const opened=[];
  const window=boot('lex2-interface-core.js',{
    window:{lexTarefas:id=>opened.push(id)},lexApi:api,getProcs:()=>[],
    document:{readyState:'complete',body:{classList:{add(){}}},getElementById:()=>host,createElement:()=>({})}
  });
  return{window,nodes,surface,opened};
}
test('pendência mostra motivo e abre exatamente a tarefa indicada',async()=>{
  const h=home(async path=>path==='/api/trabalho'?{tarefas:[{id:'t-2',status:'aguardando_revisao',processo_nome:'Cliente B',pendencia:'Conferir minuta'}]}:{contatos:[]});
  await h.window.lexHome();assert.match(h.nodes['.lex-today-list'].innerHTML,/Cliente B/);assert.match(h.nodes['.lex-today-list'].innerHTML,/Conferir minuta/);
  h.nodes['.lex-today-list'].click({target:{closest:()=>({dataset:{todayAction:'0'}})}});
  await Promise.resolve();assert.deepEqual(h.opened,['t-2']);
});
test('falha ao consultar tarefas não aparece como tudo resolvido',async()=>{
  const h=home(async path=>{if(path==='/api/trabalho')throw new Error('indisponível');return{contatos:[]}});
  await h.window.lexHome();assert.match(h.nodes.h1.textContent,/Não foi possível/);assert.match(h.nodes['.lex-today-feedback'].textContent,/incompleta/);assert.doesNotMatch(h.nodes['.lex-today-list'].innerHTML,/Você está em dia/);
});
test('resposta tardia da Home não atualiza tela abandonada',async()=>{
  let finish;const deferred=new Promise(r=>{finish=r});
  const second=home(()=>deferred);const pending=second.window.lexHome();second.surface.isConnected=false;
  finish({tarefas:[],contatos:[]});await pending;assert.equal(second.nodes.h1.textContent,'');
});


test('Home mostra intimação DJEN sem prazo na fila Precisa de você',async()=>{
  const h=home(async path=>path==='/api/trabalho'?{
    tarefas:[],
    prazos:{cunhar:[{djen_id:'dj1',processo_id:'p1',cnj:'5000000-00.2026.8.13.0001',data_disponibilizacao:'2026-09-20',tipo:'Intimação',texto:'Manifestar em prazo legal.'}],correndo:[]}
  }:{contatos:[]});
  await h.window.lexHome();
  assert.match(h.nodes['.lex-today-list'].innerHTML,/Intimação sem prazo confirmado/);
  assert.match(h.nodes['.lex-today-list'].innerHTML,/Ler e confirmar prazo/);
  assert.match(h.nodes['.lex-today-list'].innerHTML,/5000000-00\.2026\.8\.13\.0001/);
});

test('Home mostra somente prazo confirmado vindo da mesa do servidor',async()=>{
  const h=home(async path=>path==='/api/trabalho'?{
    tarefas:[],
    prazos:{cunhar:[],correndo:[{case_id:'p1',prazo:'2026-09-21',days_to_due:1,titulo:'Caso prazo',djen_id_origem:'dj2'}]}
  }:{contatos:[]});
  await h.window.lexHome();
  assert.match(h.nodes['.lex-today-list'].innerHTML,/Prazo confirmado vence amanhã/);
  assert.match(h.nodes['.lex-today-list'].innerHTML,/DJEN dj2/);
});
