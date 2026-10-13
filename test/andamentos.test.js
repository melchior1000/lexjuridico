'use strict';
// Andamentos: quem lê pega o MAIS NOVO de verdade, em qualquer formato de data e em qualquer
// ordem gravada; o dia é o de Brasília. Auditoria de 13/10/2026 (consulta e andamentos).
const test=require('node:test');
const assert=require('node:assert/strict');
const A=require('../lib/andamentos');
const LexTools=require('../lib/lex-tools');
const {processSafetyContext,sourceContext}=require('../lib/task-engine');
const core=require('../lex_agente_vivo_core');
const {mergeMovements}=require('../lib/datajud');
const {mergeCourtData}=require('../lib/pje-process-sync');
const {executeOfficeQuery}=require('../lib/office-queries');

// Como fica depois de uma leitura do Datajud: ISO, do mais novo para o mais antigo, e as
// anotações manuais (dd/mm/aaaa) que existiam antes.
const MISTURA=[
  {data:'2026-10-10T14:06:24.000Z',txt:'[DATAJUD] Expedição de documento — Intimação',origem:'datajud'},
  {data:'2026-03-02T10:00:00.000Z',txt:'[DATAJUD] Conclusos para decisão',origem:'datajud'},
  {data:'2019-05-20T09:00:00.000Z',txt:'[DATAJUD] Distribuição',origem:'datajud'},
  {data:'12/10/2026',txt:'Liguei para o cliente e pedi o extrato',origem:'advogado'},
  {data:'30/01/2025',txt:'Reunião com o cliente',origem:'advogado'},
  null,
  {txt:'Anotação sem data'}
];
const P={id:'p1',nome:'Maria x Banco',numero:'5001234-56.2026.8.13.0704',status:'ATIVO',andamentos:MISTURA};

test('ordem pela data real, com formatos misturados; vazio e sem data não atrapalham',()=>{
  const o=A.ordenarAndamentos(MISTURA);
  assert.deepEqual(o.map(a=>a.txt.slice(0,30)),['Liguei para o cliente e pedi o','[DATAJUD] Expedição de documen','[DATAJUD] Conclusos para decis','Reunião com o cliente','[DATAJUD] Distribuição','Anotação sem data']);
  assert.equal(A.ultimoAndamento(P).txt,'Liguei para o cliente e pedi o extrato');
  assert.equal(A.ordenarAndamentos(JSON.stringify([{data:'01/01/2026',txt:'a'},{data:'02/01/2026',txt:'b'}]))[0].txt,'b','JSON guardado como texto');
  assert.deepEqual(A.ordenarAndamentos(null),[]);assert.deepEqual(A.ordenarAndamentos('texto qualquer'),[]);
});

test('dia em Brasília: meia-noite UTC "sem hora" é o próprio dia; 23h59 de Brasília não vira o dia seguinte',()=>{
  assert.equal(A.diaDoAndamento({data:'2026-10-09T00:00:00.000Z'}),'2026-10-09');
  assert.equal(A.diaDoAndamento({data:'2026-10-13T02:59:00.000Z'}),'2026-10-12','23h59 do dia 12 em Brasília');
  assert.equal(A.diaDoAndamento({data:'12/10/2026'}),'2026-10-12');assert.equal(A.diaDoAndamento({data:'31/02/2026'}),null);
  assert.equal(A.dataLegivel({data:'2026-10-10T14:06:24.000Z'}),'10/10/2026');
});

test('a IA recebe o andamento mais novo como último, e os mais novos na lista',async()=>{
  const deps={processStore:{read:async()=>({processes:[P]})}};
  const c=await LexTools.executar('consultar_processos',{busca:'Maria'},deps,{profile:'admin',now:new Date('2026-10-13T15:00:00Z')});
  const item=(c.processos||c.resultados||[])[0];
  assert.match(JSON.stringify(item.ultimo_andamento),/Liguei para o cliente/);
  const v=await LexTools.executar('ver_processo',{processo_id:'p1'},deps,{profile:'admin',now:new Date('2026-10-13T15:00:00Z')});
  assert.match(v.processo.andamentos[0].texto,/Liguei para o cliente/);
  assert.equal(v.processo.andamentos[0].data,'12/10/2026');
  assert.ok(!v.processo.andamentos.some(a=>a===null));
});

test('o motor de peças vê os andamentos mais novos (não os mais antigos)',()=>{
  const ctx=processSafetyContext(P);
  assert.match(ctx.ultimo_andamento.texto,/Liguei para o cliente/);
  assert.match(ctx.ultimos_andamentos[0].texto,/Liguei para o cliente/);
  const muitos={...P,andamentos:Array.from({length:30},(_,i)=>({data:'2026-01-'+String(i+1).padStart(2,'0'),txt:'Movimento '+(i+1)}))};
  const fontes=sourceContext(muitos).filter(s=>/^A/.test(s.id)).map(s=>s.texto);
  assert.ok(fontes.includes('Movimento 30'),'o mais novo entra');assert.ok(!fontes.includes('Movimento 1'),'o mais antigo de 30 fica de fora');
});

test('contexto do processo na conversa: mais novos primeiro e com o texto do Datajud',()=>{
  const ctx=core.montarContextoProcesso(P);
  assert.match(ctx,/Últimos andamentos \(do mais novo para o mais antigo\)/);
  const i=ctx.indexOf('Liguei para o cliente'),j=ctx.indexOf('Expedição de documento');
  assert.ok(i>0&&j>i,'o mais novo vem primeiro');
  assert.doesNotMatch(ctx,/"txt":/,'texto do Datajud aparece como texto, não como JSON');
  assert.doesNotMatch(ctx,/Anotação sem data/,'o que não tem data fica atrás dos 5 mais novos');
});

test('a leitura do Datajud e a do PJe gravam em ordem real e não derrubam nada',()=>{
  const r=mergeMovements({numero:P.numero,andamentos:[{data:'12/10/2026',txt:'Liguei'},null,{data:'30/01/2025',txt:'Reunião'}]},
    [{data:'2026-10-10T14:06:24.000Z',texto:'Intimação'},{data:'2019-05-20T09:00:00.000Z',texto:'Distribuição'}]);
  assert.deepEqual(r.andamentos.map(a=>a.txt),['Liguei','[DATAJUD] Intimação','Reunião','[DATAJUD] Distribuição']);
  const s=mergeMovements({numero:P.numero,andamentos:'Histórico antigo digitado à mão'},[{data:'2026-10-10T14:06:24.000Z',texto:'Intimação'}]);
  assert.ok(s.andamentos.some(a=>/Histórico antigo digitado à mão/.test(a.txt)),'texto antigo não some');
  const pje=mergeCourtData({id:'p1',numero:P.numero,andamentos:[{data:'12/10/2026',txt:'Liguei'}]},'50012345620268130704',
    {movimentos:[{id:'m1',data:'2026-10-13T02:59:00.000Z',descricao:'Juntada de petição'}],polos:[]},new Date('2026-10-13T12:00:00Z'));
  const novo=(pje.process||pje).andamentos.find(a=>a.origem==='pje');
  assert.equal(novo.data,'2026-10-12','PJe às 23h59 de Brasília fica no dia certo');
  assert.equal((pje.process||pje).andamentos[0].origem,'pje','mais novo primeiro');
});

test('"andamento do processo" sem IA: os 3 mais novos, com data legível, e a hora da leitura em Brasília com a fonte',async()=>{
  const p={...P,last_court_sync_at:'2026-10-13T12:00:00.000Z',last_court_sync_source:'datajud'};
  const out=await executeOfficeQuery({processStore:{read:async()=>({processes:[p]})}},{action:'process_status',processo_id:'p1'},{now:new Date('2026-10-13T13:00:00Z'),profile:'admin'});
  const msg=out.message;
  const linhas=msg.split('\n').filter(l=>l.startsWith('• '));
  assert.match(linhas[0],/^• 12\/10\/2026 — Liguei para o cliente/);
  assert.match(linhas[1],/^• 10\/10\/2026 — \[DATAJUD\] Expedição/);
  assert.match(msg,/Última leitura oficial: 13\/10\/2026 09:00 \(Brasília\), pelo Datajud/);
});

test('mesma data: fica a ordem gravada (o novo entra no início) e ordenar de novo não troca nada',()=>{
  const lista=[{data:'13/10/2026',txt:'segunda nota do dia'},{data:'13/10/2026',txt:'primeira nota do dia'},{txt:'sem data B'},{txt:'sem data A'},{data:'12/10/2026',txt:'ontem'}];
  const uma=A.ordenarAndamentos(lista).map(a=>a.txt);
  assert.deepEqual(uma,['segunda nota do dia','primeira nota do dia','ontem','sem data B','sem data A']);
  assert.deepEqual(A.ordenarAndamentos(A.ordenarAndamentos(lista)).map(a=>a.txt),uma,'estável');
});

test('último que já aconteceu: data futura não conta como último movimento',()=>{
  const p={andamentos:[{data:'20/11/2026',txt:'Audiência marcada (data futura)'},{data:'10/10/2026',txt:'Juntada'},{txt:'sem data'}]};
  assert.equal(A.ultimoAndamentoAte(p,'2026-10-13').txt,'Juntada');
  assert.equal(A.ultimoAndamentoAte({andamentos:[{txt:'sem data'}]},'2026-10-13'),null);
  assert.equal(A.ultimoAndamentoAte(p,'hoje'),null,'dia inválido não chuta');
});

test('Datajud: o mesmo movimento gravado com o texto antigo é corrigido no lugar, não duplicado, e não volta como novo',()=>{
  const {movementsFromPayload}=require('../lib/datajud');
  const {movimentosOficiais}=require('../lib/andamento-conversa');
  const comp=[{codigo:4,valor:80,nome:'Intimação',descricao:'tipo_de_documento'}];
  const payload={hits:{hits:[{_source:{movimentos:[
    {nome:'Expedição de documento',dataHora:'2026-10-10T14:06:24.000Z',complementosTabelados:comp},
    {nome:'Conclusos para decisão',dataHora:'2026-10-09T10:00:00.000Z'},
    {nome:'Juntada de petição',dataHora:'2026-10-08T10:00:00.000Z',complementosTabelados:[{codigo:1,valor:2,nome:'Petição',descricao:'tipo_de_peticao'}]}]}}]}};
  // Como estava gravado antes desta correção: complemento pelo tipo (rotina diária) e só o nome (varredura do servidor).
  const antes={id:'p1',numero:'5001234-56.2026.8.13.0704',andamentos:[
    {data:'2026-10-10T14:06:24.000Z',txt:'[DATAJUD] Expedição de documento — tipo_de_documento',origem:'datajud'},
    {data:'2026-10-09T10:00:00.000Z',txt:'[DATAJUD] Conclusos para decisão',origem:'datajud'},
    {data:'2026-10-08T10:00:00.000Z',txt:'[DATAJUD] Juntada de petição',origem:'datajud'},
    {data:'11/10/2026',txt:'Liguei para o cliente',origem:'advogado'}]};
  const vistos=new Set(movimentosOficiais(antes,'2026-10-13').map(m=>m.fp));
  const r=mergeMovements(antes,movementsFromPayload(payload));
  assert.equal(r.novos,0,'nada novo');assert.equal(r.corrigidos,2);assert.equal(r.duplicados,1);
  assert.equal(r.andamentos.length,4,'sem duplicar');
  const exp=r.andamentos.find(a=>/Expedição/.test(a.txt));
  assert.equal(exp.txt,'[DATAJUD] Expedição de documento — Intimação');assert.equal(exp.txt_anterior,'[DATAJUD] Expedição de documento — tipo_de_documento');
  assert.equal(r.andamentos.find(a=>/Juntada de petição/.test(a.txt)).txt,'[DATAJUD] Juntada de petição — Petição');
  const depois=movimentosOficiais({...antes,andamentos:r.andamentos},'2026-10-13');
  assert.ok(depois.every(m=>vistos.has(m.fp)),'o titular não recebe de novo o que já viu');
  assert.deepEqual(mergeMovements({...antes,andamentos:r.andamentos},movementsFromPayload(payload)).novos,0,'segunda leitura: nada novo');
});

test('mesmo horário, mesmo nome, complementos diferentes: o texto antigo serve a um só; o outro entra como novo',()=>{
  const {movementsFromPayload}=require('../lib/datajud');
  const quando='2026-10-10T14:06:24.000Z';
  const payload={hits:{hits:[{_source:{movimentos:[
    {nome:'Expedição de documento',dataHora:quando},
    {nome:'Expedição de documento',dataHora:quando,complementosTabelados:[{nome:'Intimação',descricao:'tipo_de_documento'}]}]}}]}};
  const r=mergeMovements({numero:'5001234-56.2026.8.13.0704',andamentos:[{data:quando,txt:'[DATAJUD] Expedição de documento',origem:'datajud'}]},movementsFromPayload(payload));
  assert.equal(r.duplicados,1);assert.equal(r.corrigidos,0,'o que já estava igual não é "corrigido"');assert.equal(r.novos,1);
  assert.deepEqual(r.andamentos.map(a=>a.txt).sort(),['[DATAJUD] Expedição de documento','[DATAJUD] Expedição de documento — Intimação']);
});
