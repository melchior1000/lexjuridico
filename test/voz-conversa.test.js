'use strict';
// "Liga para a Maria lembrando a perícia": a IA escreve o objetivo, o LEX mostra para quem
// vai ligar e o que vai ser dito, e só o "pode" do titular — conferido no código — disca.
// Mesmo cinto das mensagens ao cliente (lib/andamento-conversa.js).
const test=require('node:test');
const assert=require('node:assert/strict');
const {createAndamentoConversa}=require('../lib/andamento-conversa');
const {createChannelCommandOutbox}=require('../lib/channel-command-outbox');
const LexTools=require('../lib/lex-tools');

function records(){
  const map=new Map();
  return{
    async read(key){return map.has(key)?{value:structuredClone(map.get(key)),stamp:new Date().toISOString()}:null},
    async change(key,fn){const old=map.has(key)?structuredClone(map.get(key)):null;const next=await fn(old);if(next!==undefined)map.set(key,structuredClone(next));return next===undefined?old:structuredClone(next)},
    async list(prefix){return[...map.entries()].filter(([k])=>k.startsWith(prefix)).map(([,v])=>structuredClone(v)).filter(v=>v!=null)},
    map
  };
}
function carteira(rows){
  let ps=structuredClone(rows);
  return{async read(){return{processes:structuredClone(ps),version:1}},
    async mutate(fn){const copy=structuredClone(ps);const value=await fn(copy);ps=copy;return{value}},get rows(){return ps}};
}
const MARIA={id:'p1',nome:'Maria Silva x INSS',cliente:'Maria Silva',status:'ATIVO',
  origem_recepcao:{origem:'whatsapp',id:'5561988887777',nome:'Maria Silva'},andamentos:[]};
const SO_LID={id:'p2',nome:'João x Banco',cliente:'João Souza',status:'ATIVO',origem_recepcao:{origem:'whatsapp',id:'123456789012345',nome:'João'},andamentos:[]};
const SEM_CONTATO={id:'p3',nome:'Ana x Estado',cliente:'Ana Lima',status:'ATIVO',andamentos:[]};
const OBJ='Lembrar a Maria da perícia médica de terça, 25/11, às 9h, no fórum de Unaí, e pedir que leve os exames.';

function vozFalsa(over={}){
  const chamadas=[];
  return{chamadas,
    configurado:()=>over.desligada!==true,
    descricaoJanela:()=>'seg–sex 9h–19h',
    _bloqueado:async tel=>(over.bloqueados||[]).includes(tel),
    async ligar(p){chamadas.push(p);if(over.resposta)return over.resposta;return{ok:true,ligacao_id:p.id,hora:'2026-11-23T13:05:00.000Z'}},
    async ler(id){return over.registros?.[id]||null}};
}
function montar(over={}){
  const rec=records(),store=carteira([MARIA,SO_LID,SEM_CONTATO]);
  const deliveries=[];
  const outbox=createChannelCommandOutbox({records:rec,compose:async()=>{throw new Error('não usar')},
    deliverDetailed:async input=>{deliveries.push(input);return{ok:true,state:'confirmado',provider_id:'m'+deliveries.length}},
    receptionStore:{appendEvent:async()=>{}},log:()=>{}});
  const voz=over.voz||vozFalsa(over);
  let agora=Date.parse('2026-11-23T13:00:00Z');
  const A=createAndamentoConversa({records:rec,processStore:store,outbox,ligacoes:voz,
    podeReceber:async()=>true,contatosDoProcesso:async()=>[],iaDisponivel:()=>true,compor:async()=>'x',
    entregarAoTitular:async()=>[{conversa:'telegram:1',ok:true}],dentroDoHorario:()=>true,
    now:()=>agora,esperaMs:0,esperaTentativas:20,dormir:()=>new Promise(r=>setImmediate(r)),log:()=>{}});
  return{A,rec,store,voz,deliveries,avancar(ms){agora+=ms}};
}
const CTX={conversa:'telegram:1',turno:'T1',perfil:'admin'};

test('preparar a ligação não disca; a prévia mostra número, objetivo e a apresentação como assistente virtual',async()=>{
  const m=montar();
  const r=await m.A.prepararLigacao({processo_id:'p1',objetivo:OBJ,...CTX});
  assert.equal(r.ok,true);assert.equal(r.para.telefone,'+55 61 98888-7777');
  assert.equal(m.voz.chamadas.length,0,'preparar nunca liga');
  const previa=await m.A.previaDoTurno({conversa:'telegram:1',turno:'T1'});
  assert.match(previa,/📞 Ligar para Maria Silva/);assert.match(previa,/\+55 61 98888-7777/);
  assert.match(previa,/assistente virtual/);assert.match(previa,/gravada/);assert.ok(previa.includes(OBJ));
  assert.match(previa,/responder "pode"/);
});

test('"pode" logo depois da prévia disca uma vez; outro "pode" não disca de novo',async()=>{
  const m=montar();
  await m.A.prepararLigacao({processo_id:'p1',objetivo:OBJ,...CTX});
  await m.A.previaDoTurno({conversa:'telegram:1',turno:'T1'});
  const ok=await m.A.confirmarSeFor({conversa:'telegram:1',mensagem:'pode',perfil:'admin'});
  assert.equal(ok.handled,true);assert.equal(ok.enviado,true);
  assert.match(ok.message,/ligação para Maria Silva saiu/i);assert.match(ok.message,/te conto/);
  assert.equal(m.voz.chamadas.length,1);
  const c=m.voz.chamadas[0];
  assert.equal(c.telefone,'+5561988887777');assert.equal(c.objetivo,OBJ);assert.equal(c.processo_id,'p1');assert.equal(c.aprovado_por,'admin');
  assert.match(c.id,/^[0-9a-f]{20}-1$/,'id da ligação = rascunho + tentativa: o mesmo OK não vira duas ligações');
  const de_novo=await m.A.confirmarSeFor({conversa:'telegram:1',mensagem:'pode',perfil:'admin'});
  assert.equal(de_novo.handled,false);assert.equal(m.voz.chamadas.length,1);
  assert.equal(m.deliveries.length,0,'ligação não passa pela fila do WhatsApp');
});

test('sem prévia mostrada, "pode" não liga; outra mensagem fecha a prévia; secretária não autoriza',async()=>{
  const semPrevia=montar();
  await semPrevia.A.prepararLigacao({processo_id:'p1',objetivo:OBJ,...CTX});
  assert.equal((await semPrevia.A.confirmarSeFor({conversa:'telegram:1',mensagem:'pode',perfil:'admin'})).handled,false);
  assert.equal(semPrevia.voz.chamadas.length,0);
  const fechada=montar();
  await fechada.A.prepararLigacao({processo_id:'p1',objetivo:OBJ,...CTX});
  await fechada.A.previaDoTurno({conversa:'telegram:1',turno:'T1'});
  await fechada.A.fecharJanelas({});
  const r=await fechada.A.confirmarSeFor({conversa:'telegram:1',mensagem:'pode',perfil:'admin'});
  assert.equal(fechada.voz.chamadas.length,0);assert.match(r.message||'',/Não enviei|Quer que eu mostre/);
  const sec=montar();
  assert.equal((await sec.A.prepararLigacao({processo_id:'p1',objetivo:OBJ,...CTX,perfil:'secretaria'})).ok,false);
  await sec.A.prepararLigacao({processo_id:'p1',objetivo:OBJ,...CTX});
  await sec.A.previaDoTurno({conversa:'telegram:1',turno:'T1'});
  const s=await sec.A.confirmarSeFor({conversa:'telegram:1',mensagem:'pode',perfil:'secretaria'});
  assert.equal(s.enviado,false);assert.equal(sec.voz.chamadas.length,0);
});

test('destino só por telefone de verdade: LID do WhatsApp e falta de contato pedem o número ao titular',async()=>{
  const m=montar();
  const lid=await m.A.prepararLigacao({processo_id:'p2',objetivo:OBJ,...CTX});
  assert.equal(lid.ok,false);assert.match(lid.erro,/telefone/i);
  const nada=await m.A.prepararLigacao({processo_id:'p3',objetivo:OBJ,...CTX});
  assert.equal(nada.ok,false);assert.match(nada.erro,/Pergunte ao titular o telefone/);
  const informado=await m.A.prepararLigacao({processo_id:'p3',objetivo:OBJ,telefone:'(61) 3333-4444',...CTX});
  assert.equal(informado.ok,true);assert.equal(informado.para.telefone,'+55 61 3333-4444');
  const previa=await m.A.previaDoTurno({conversa:'telegram:1',turno:'T1'});
  assert.match(previa,/número dito agora na conversa — confira/);
  const invalido=await m.A.prepararLigacao({processo_id:'p3',objetivo:OBJ,telefone:'123',...CTX});
  assert.equal(invalido.ok,false);
});

test('ligações desligadas, cliente que pediu PARE e objetivo com marcador: nada é preparado',async()=>{
  const desl=montar({desligada:true});
  const r=await desl.A.prepararLigacao({processo_id:'p1',objetivo:OBJ,...CTX});
  assert.equal(r.ok,false);assert.match(r.erro,/ainda não estão ligadas/);
  const pare=montar({bloqueados:['+5561988887777']});
  assert.match((await pare.A.prepararLigacao({processo_id:'p1',objetivo:OBJ,...CTX})).erro,/não receber/);
  const m=montar();
  assert.equal((await m.A.prepararLigacao({processo_id:'p1',objetivo:'Lembrar da perícia em [DATA]',...CTX})).ok,false);
  assert.equal((await m.A.prepararLigacao({processo_id:'p1',objetivo:'oi',...CTX})).ok,false);
  assert.equal((await m.A.prepararLigacao({processo_id:'nao-existe',objetivo:OBJ,...CTX})).ok,false);
});

test('recusa na hora de discar (fora do horário) é dita ao titular e a ligação não conta como feita',async()=>{
  const m=montar({resposta:{ok:false,codigo:'fora_do_horario',motivo:'fora do horário de ligações (seg–sex 9h–19h)'}});
  await m.A.prepararLigacao({processo_id:'p1',objetivo:OBJ,...CTX});
  await m.A.previaDoTurno({conversa:'telegram:1',turno:'T1'});
  const r=await m.A.confirmarSeFor({conversa:'telegram:1',mensagem:'pode',perfil:'admin'});
  assert.equal(r.enviado,false);assert.match(r.message,/Não liguei para Maria Silva: fora do horário/);
  const lista=await m.A.listar();
  assert.equal(lista.mensagens_preparadas[0].tipo,'ligacao');assert.match(lista.mensagens_preparadas[0].situacao,/esperando o OK/);
});

test('mensagem e ligação no mesmo turno: as duas aparecem na prévia e o "pode" vale para as duas',async()=>{
  const m=montar();
  await m.A.preparar({processo_id:'p1',texto:'Olá, Maria! Sua perícia é terça às 9h. Leve os exames.',conversa:'telegram:1',turno:'T1',perfil:'admin'});
  await m.A.prepararLigacao({processo_id:'p1',objetivo:OBJ,...CTX});
  const previa=await m.A.previaDoTurno({conversa:'telegram:1',turno:'T1'});
  assert.match(previa,/WhatsApp \+55 61 98888-7777/);assert.match(previa,/📞 Ligar para/);
  const r=await m.A.confirmarSeFor({conversa:'telegram:1',mensagem:'pode',perfil:'admin'});
  assert.equal(m.deliveries.length,1);assert.equal(m.voz.chamadas.length,1);
  assert.match(r.message,/mandei para Maria Silva/);assert.match(r.message,/ligação para Maria Silva saiu/);
});

test('ligação presa em "ligando" (reinício no meio) volta ao estado certo pela reconciliação',async()=>{
  const m=montar();
  await m.A.prepararLigacao({processo_id:'p1',objetivo:OBJ,...CTX});
  const [chave]=[...m.rec.map.keys()].filter(k=>k.startsWith('lex_cliente_msg_'));
  const r=m.rec.map.get(chave);
  m.rec.map.set(chave,{...r,status:'ligando',tentativas:1,aprovado_em:'2026-11-23T12:00:00.000Z'});
  await m.A.reconciliarEnvios();
  assert.equal(m.rec.map.get(chave).status,'aguardando_ok','sem registro da ligação: não saiu');
  const m2=montar({registros:{}});
  await m2.A.prepararLigacao({processo_id:'p1',objetivo:OBJ,...CTX});
  const [k2]=[...m2.rec.map.keys()].filter(k=>k.startsWith('lex_cliente_msg_'));
  const r2=m2.rec.map.get(k2);
  m2.voz.ler=async id=>id===r2.id+'-1'?{status:'em_andamento',saiu_em:'2026-11-23T12:01:00.000Z'}:null;
  m2.rec.map.set(k2,{...r2,status:'ligando',tentativas:1,aprovado_em:'2026-11-23T12:00:00.000Z'});
  await m2.A.reconciliarEnvios();
  assert.equal(m2.rec.map.get(k2).status,'enviado','a plataforma registrou: a ligação saiu');
});

test('ferramentas: preparar_ligacao_cliente prepara (não liga) e ligacoes_do_escritorio lê o resultado',async()=>{
  const m=montar();
  const nomes=LexTools.definitions({}).map(d=>d.name);
  assert.ok(nomes.includes('preparar_ligacao_cliente'));assert.ok(nomes.includes('ligacoes_do_escritorio'));
  assert.ok(!nomes.some(n=>/enviar|mandar|send|discar/.test(n)),'nenhuma ferramenta disca sozinha');
  const deps={andamentos:m.A,processStore:m.store,ligacoes:{listar:async q=>({ok:true,ligacoes:[{ligacao_id:'L1',processo_id:q.processo_id||null}]})}};
  const p=await LexTools.executar('preparar_ligacao_cliente',{processo_id:'p1',objetivo:OBJ},deps,{profile:'admin',conversa:'telegram:1',turno:'T9'});
  assert.equal(p.ok,true);assert.equal(m.voz.chamadas.length,0);
  const l=await LexTools.executar('ligacoes_do_escritorio',{processo_id:'p1'},deps,{profile:'admin'});
  assert.equal(l.ok,true);assert.equal(l.ligacoes[0].processo_id,'p1');
  const semVoz=await LexTools.executar('ligacoes_do_escritorio',{},{processStore:m.store,ligacoes:null},{profile:'admin'});
  assert.equal(typeof semVoz.ok,'boolean');
});
