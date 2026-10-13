'use strict';
// Telas: o "último andamento" e os dias parado saem da data real (qualquer formato), nunca da
// posição no array — um processo não pode virar URGENTE por "622 dias parado" sem estar parado.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const raiz=path.join(__dirname,'..');

const P={id:'p1',status:'ATIVO',andamentos:[
  {data:'30/01/2025',txt:'Reunião'},{data:'2026-10-10T14:06:24.000Z',txt:'[DATAJUD] Intimação'},
  {data:'2019-05-20T09:00:00.000Z',txt:'[DATAJUD] Distribuição'},{data:'12/10/2026',txt:'Liguei'},null]};

test('app: helper de andamento acha o mais novo em qualquer formato; nenhum ponto lê andamentos[0]',()=>{
  const src=fs.readFileSync(path.join(raiz,'index.html'),'utf8');
  const ini=src.indexOf('// LEX: andamentos — o mais novo pela data real');
  const fim=src.indexOf('// LEX: fim dos andamentos',ini);
  assert.ok(ini>0&&fim>ini,'helper no app');
  const c=vm.createContext({Intl,Date});vm.runInContext(src.slice(ini,fim),c);
  assert.equal(c._lexUltimoAndamento(P).txt,'Liguei');
  assert.equal(c._lexDataBR(c._lexUltimoAndamento(P)),'12/10/2026');
  assert.equal(c._lexDataBR({data:'2026-10-13T02:59:00.000Z'}),'12/10/2026','23h59 de Brasília');
  assert.equal(c._lexDataBR({data:'2026-10-09T00:00:00.000Z'}),'09/10/2026','data sem hora');
  assert.equal(c._lexUltimoAndamento({andamentos:[]}),null);
  for(const proibido of [/ands\[0\]\.data/,/andamentos\[0\]\??\.data/,/ands\[ands\.length-1\]\.data/])
    assert.doesNotMatch(src,proibido,'ainda há leitura pela posição: '+proibido);
});

test('dossiê: linha do tempo em ordem real e com o dia de Brasília',()=>{
  const src=fs.readFileSync(path.join(raiz,'office-dossier-ui.js'),'utf8');
  const win={};
  const c=vm.createContext({window:win,globalThis:{},document:{readyState:'complete',querySelectorAll:()=>[],addEventListener(){}},setTimeout:()=>0,Intl,Date,
    getProcs:()=>[P]});
  vm.runInContext(src,c);
  const t=win.lexDossierTimeline(P).filter(x=>x.kind==='andamentos');
  assert.deepEqual(Array.from(t,x=>x.title),['Liguei','[DATAJUD] Intimação','Reunião','[DATAJUD] Distribuição']);
  assert.equal(win.lexDossierBrDate('2026-10-13T02:59:00.000Z'),'12/10/2026');
});

test('app: lista dos andamentos em ordem real (empate mantém a ordem gravada); último ignora data futura',()=>{
  const src=fs.readFileSync(path.join(raiz,'index.html'),'utf8');
  const ini=src.indexOf('// LEX: andamentos — o mais novo pela data real'),fim=src.indexOf('// LEX: fim dos andamentos',ini);
  const c=vm.createContext({Intl,Date,JSON});vm.runInContext(src.slice(ini,fim),c);
  const lista={andamentos:[{data:'13/10/2026',txt:'segunda do dia'},{data:'13/10/2026',txt:'primeira do dia'},{data:'2026-10-14T10:00:00.000Z',txt:'Datajud'},{txt:'sem data'},{data:'31/02/2026',txt:'data impossível'}]};
  assert.deepEqual(Array.from(c._lexAndamentosRecentes(lista),a=>a.txt),['Datajud','segunda do dia','primeira do dia','sem data','data impossível']);
  assert.deepEqual(Array.from(c._lexAndamentosRecentes(lista,2),a=>a.txt),['Datajud','segunda do dia']);
  assert.deepEqual(Array.from(c._lexAndamentosRecentes({andamentos:JSON.stringify([{data:'01/01/2026',txt:'a'},{data:'02/01/2026',txt:'b'}])}),a=>a.txt),['b','a'],'lista guardada como texto');
  const futuro={andamentos:[{data:'20/11/2099',txt:'Audiência marcada'},{data:'10/10/2026',txt:'Juntada'}]};
  assert.equal(c._lexUltimoAndamento(futuro).txt,'Juntada','data futura não é o último movimento');
  assert.equal(c._lexUltimoAndamento({andamentos:[{data:'20/11/2099',txt:'só futuro'}]}).txt,'só futuro');
});

test('app: excluir andamento apaga o certo mesmo se a lista mudou depois de a tela abrir',()=>{
  const src=fs.readFileSync(path.join(raiz,'index.html'),'utf8');
  const ini=src.indexOf('// LEX: andamentos — o mais novo pela data real'),fim=src.indexOf('// LEX: fim dos andamentos',ini);
  const fn=src.slice(src.indexOf('function excluirAndamento('),src.indexOf('\n}\n',src.indexOf('function excluirAndamento('))+2);
  const tela={andamentos:[{data:'12/10/2026',txt:'Liguei'},{data:'10/10/2026',txt:'Juntada'}]};
  let salvos=null;const avisos=[];
  const ps=[{id:'p1',andamentos:[{data:'13/10/2026',txt:'Entrou depois'},...tela.andamentos]}]; // a lista ganhou um item no início
  const c=vm.createContext({Intl,Date,JSON,confirm:()=>true,getProcs:()=>ps,saveProcs:x=>{salvos=x},toast:t=>avisos.push(t),abrirProc:()=>{}});
  vm.runInContext(src.slice(ini,fim)+'\n'+fn,c);
  const chave=c._lexChaveAttr(tela.andamentos[0]); // a tela mostrou "Liguei" na posição 0
  c.excluirAndamento('p1',0,chave);
  assert.deepEqual(salvos[0].andamentos.map(a=>a.txt),['Entrou depois','Juntada'],'apagou "Liguei", não o que entrou depois');
  salvos=null;c.excluirAndamento('p1',0,c._lexChaveAttr({data:'01/01/2020',txt:'não existe mais'}));
  assert.equal(salvos,null,'não achou: não apaga nada');assert.match(avisos.at(-1),/mudou/);
});

// Trava permanente (auditoria de 13/10/2026): ninguém lê andamento pela posição no array.
// A ordem gravada não é garantida (cada fonte grava de um jeito); use lib/andamentos.js no
// servidor e _lexAndamentosRecentes/_lexUltimoAndamento na tela.
test('nenhum código lê andamentos pela posição (andamentos[0], .slice(0,N), sort por texto)',()=>{
  const arquivos=['index.html','bot.js','lex_agente_vivo_core.js',
    ...fs.readdirSync(raiz).filter(f=>/^office-.*\.js$/.test(f)),
    ...fs.readdirSync(path.join(raiz,'lib')).filter(f=>f.endsWith('.js')&&f!=='andamentos.js').map(f=>'lib/'+f)];
  // Lista já montada em ordem pela própria função (não é o campo do processo).
  const permitido=[{arquivo:'lib/andamento-conversa.js',trecho:'const a=i.andamentos[0];'}];
  const proibidos=[/\bandamentos\s*(?:\|\|\s*\[\]\s*\))?\s*\[\s*0\s*\]/,/\bandamentos\s*(?:\|\|\s*\[\]\s*\))?\s*\.slice\(\s*0\s*,/,/\bandamentos\s*\.sort\(/,/\bands\s*\[\s*0\s*\]/,/\bands\[ands\.length\s*-\s*1\]/];
  const achados=[];
  for(const arquivo of arquivos){
    const linhas=fs.readFileSync(path.join(raiz,arquivo),'utf8').split('\n');
    linhas.forEach((linha,i)=>{
      if(/^\s*\/\//.test(linha))return;
      if(permitido.some(p=>p.arquivo===arquivo&&linha.includes(p.trecho)))return;
      for(const rx of proibidos)if(rx.test(linha))achados.push(arquivo+':'+(i+1)+': '+linha.trim().slice(0,120));
    });
  }
  assert.deepEqual(achados,[]);
});
