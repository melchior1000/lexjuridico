'use strict';
// Tela Processos: carteira por cliente (não uma fileira de cartões iguais).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const SRC=fs.readFileSync(path.join(__dirname,'..','office-ui-v2.js'),'utf8');
const iso=n=>{const d=new Date();d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)};

function load(list){
  const nodes={'#content':{innerHTML:'',offsetParent:null,querySelector:()=>null}};
  const document={
    querySelector:s=>{if(s==='#lex-proc-list'||s==='#lex-proc-summary'){const m=nodes['#content'].innerHTML.includes('id="'+s.slice(1)+'"');return m?(nodes[s]||(nodes[s]={innerHTML:'',textContent:''})):null}return nodes[s]||null},
    querySelectorAll:()=>[],addEventListener(){},documentElement:{classList:{add(){},remove(){},toggle(){},contains:()=>false},setAttribute(){}},
    body:{classList:{add(){},remove(){},toggle(){},contains:()=>false}},getElementById:()=>null,createElement:()=>({style:{},setAttribute(){},appendChild(){}}),head:{appendChild(){}}
  };
  const ctx={document,getProcs:()=>list,localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,setItem(){}},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,console,matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},location:{hash:''},history:{replaceState(){},pushState(){}},navigator:{}};
  ctx.window=ctx;ctx.globalThis=ctx;
  vm.createContext(ctx);vm.runInContext(SRC,ctx);
  return{ctx,html:()=>nodes['#content'].innerHTML,list:()=>nodes['#lex-proc-list']?.innerHTML||''};
}

function carteira(){
  const out=[];
  for(let i=0;i<300;i++)out.push({id:'c'+i,nome:'CEF — Execução '+i,numero:String(1000000+i)+'-10.2025.4.06.3818',tribunal:'TRF-6',status:'ATIVO',prazo:i===5?iso(-2):undefined});
  for(let i=0;i<200;i++)out.push({id:'b'+i,nome:'Banco do Brasil x Fulano '+i,numero:'',status:'ATIVO',prazo:i===1?iso(0):undefined});
  out.push({id:'s1',nome:'Maria Souza',numero:'5004158-61.2024.8.13.0704',status:'ATIVO'});
  return out;
}

test('com 500 processos a tela mostra clientes recolhidos, não 500 cartões',()=>{
  const ui=load(carteira());
  ui.ctx.lexProcessos();
  const html=ui.html();
  assert.equal((html.match(/class="lex-proc-group/g)||[]).length,3,'CEF, Banco do Brasil e demais');
  assert.equal((html.match(/class="lex-proc-line"/g)||[]).length,0,'nada aberto de início');
  assert.doesNotMatch(html,/class="lex-proc-row"/);
  // Urgência no topo e grupo mais urgente primeiro (vencido > hoje).
  assert.match(html,/lex-proc-urgent[\s\S]*<b>1<\/b><span>Vencidos[\s\S]*<b>1<\/b><span>Prazo hoje/);
  assert.ok(html.indexOf('>CEF<')<html.indexOf('>Banco do Brasil<'));
  assert.match(html,/501 processos · 2 clientes/);
});

test('abrir o cliente mostra linhas compactas em lotes, com o urgente primeiro e sem repetir o cliente',()=>{
  const ui=load(carteira());
  ui.ctx.lexProcessos();
  ui.ctx.lexToggleProcGroup('cef');
  const list=ui.list();
  assert.equal((list.match(/class="lex-proc-line"/g)||[]).length,30);
  assert.match(list,/^[\s\S]*?<strong>Execução 5<\/strong>[\s\S]*?Vencido/,'vencido no topo do grupo');
  assert.doesNotMatch(list,/<strong>CEF — /);
  assert.match(list,/Mostrar mais 30 de 270 restantes/);
  ui.ctx.lexMoreProcGroup('cef');
  assert.equal((ui.list().match(/class="lex-proc-line"/g)||[]).length,60);
  ui.ctx.lexToggleProcGroup('cef');
  assert.equal((ui.list().match(/class="lex-proc-line"/g)||[]).length,0);
});

test('quadro de urgência filtra; busca e modo lista saem dos grupos',()=>{
  const ui=load(carteira());
  ui.ctx.lexSetProcFilter('hoje');
  assert.equal((ui.html().match(/class="lex-proc-line"/g)||[]).length,1);
  assert.match(ui.html(),/Fulano 1/);
  ui.ctx.lexSetProcFilter('semcnj');
  assert.match(ui.html(),/200 processos sem número CNJ/);
  ui.ctx.lexSetProcFilter('todos');
  ui.ctx.lexFilterProc('maria');
  assert.equal((ui.list().match(/class="lex-proc-line"/g)||[]).length,1);
  ui.ctx.lexFilterProc('');
  ui.ctx.lexSetProcView('lista');
  assert.equal((ui.html().match(/class="lex-proc-line"/g)||[]).length,40,'lista paginada');
  assert.match(ui.html(),/Página 1 de 13/);
});

test('cliente vem do campo cliente ou do nome, e carteira pequena sem grupos abre direto',()=>{
  const ui=load([{id:1,nome:'Ação de cobrança',cliente:'Sicoob',numero:''},{id:2,nome:'Sicoob — Monitória',numero:''},{id:3,nome:'Inventário',numero:''}]);
  ui.ctx.lexProcessos();
  assert.match(ui.html(),/>Sicoob<[\s\S]*2 processos/);
  const solo=load([{id:1,nome:'Inventário',numero:''}]);
  solo.ctx.lexProcessos();
  assert.equal((solo.html().match(/class="lex-proc-line"/g)||[]).length,1,'um só grupo já vem aberto');
});
