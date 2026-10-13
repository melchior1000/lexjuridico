'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {syncWindows,communicationRow,suggestPendingDeadlines}=require('../lib/djen-monitor');
const DeadlineSuggestion=require('../lib/deadline-suggestion');

test('primeira ativação consulta sete dias incluindo hoje',()=>{
  const w=syncWindows(null,new Date('2026-09-20T12:00:00-03:00'),7);
  assert.deepEqual(w,[{inicio:'2026-09-14',fim:'2026-09-20'}]);
});

test('cursor antigo divide recuperação em janelas de no máximo sete dias sem buraco',()=>{
  const w=syncWindows('2026-09-01',new Date('2026-09-20T12:00:00-03:00'),7);
  assert.deepEqual(w,[
    {inicio:'2026-09-01',fim:'2026-09-07'},
    {inicio:'2026-09-08',fim:'2026-09-14'},
    {inicio:'2026-09-15',fim:'2026-09-20'}
  ]);
});

test('cursor futuro é trazido para hoje em vez de pular consulta',()=>{
  const w=syncWindows('2099-01-01',new Date('2026-09-20T12:00:00-03:00'),7);
  assert.deepEqual(w,[{inicio:'2026-09-20',fim:'2026-09-20'}]);
});


test('communicationRow preserva o recibo original e localiza o item',()=>{
  const raw='{"count":1,"items":[{"id":"dj1","numeroProcesso":"50000000020268130001"}]}';
  const row=communicationRow(
    {id:'dj1',numeroProcesso:'50000000020268130001',texto:'Intimação'},
    '123456','MG',
    {raw_receipt:raw,pagina:2,requested_at:'2026-09-20T08:00:00Z',responded_at:'2026-09-20T08:00:01Z',endpoint:'https://gateway.example',request_id:'req1'}
  );
  assert.equal(row.raw_receipt,raw);
  assert.equal(row.receipt_item_key,'dj1');
  assert.equal(row.receipt_page,2);
});


test('sugestão de prazo é persistida mas nunca vira legal_truth',async()=>{
  const row={djen_id:'dj-s1',texto:'Manifeste-se no prazo de 5 dias úteis.',tribunal:'TJMG',data_disponibilizacao:'2026-09-21',status:'casada',prazo_cunhado:false};
  const patches=[];
  const sbReq=async(method,table,data,query)=>{
    assert.equal(table,'djen_comunicacoes');
    if(method==='PATCH'){patches.push(data);return{ok:true,status:200,body:[{...row,...data}]}}
    throw new Error('unexpected '+method);
  };
  const out=await suggestPendingDeadlines(sbReq,[row],{
    calendarioVerificado:true,
    aiAnalyze:async()=>({candidate_index:0,regime:'cpc',confidence:.99,trecho:'Manifeste-se no prazo de 5 dias úteis.'})
  });
  assert.equal(out.failures.length,0);
  assert.equal(out.rows[0].prazo_sugestao.due_at_proposto,'2026-09-29');
  assert.equal(out.rows[0].prazo_sugestao.legal_truth,false);
  assert.equal(patches[0].prazo_sugestao.legal_truth,false);
});

test('sugestão já persistida não chama IA de novo',async()=>{
  let calls=0;
  const row={djen_id:'dj-s2',texto:'Manifeste-se no prazo de 5 dias úteis.',data_disponibilizacao:'2026-09-21',tribunal:'TJMG'};
  row.prazo_sugestao={suggestion_version:DeadlineSuggestion.SUGGESTION_VERSION,status:'proposta_calculada',legal_truth:false,due_at_proposto:'2026-09-29',source_hash:DeadlineSuggestion.sourceHash(row)};
  const out=await suggestPendingDeadlines(async()=>{throw new Error('não deveria persistir')},[row],{aiAnalyze:async()=>{calls++;return{}}});
  assert.equal(calls,0);assert.equal(out.rows[0],row);
});


test('mudança no teor invalida a sugestão anterior e força nova análise',async()=>{
  let calls=0;
  const row={djen_id:'dj-s3',texto:'Manifeste-se no prazo de 10 dias úteis.',data_disponibilizacao:'2026-09-21',tribunal:'TJMG',status:'casada'};
  row.prazo_sugestao={status:'proposta_calculada',legal_truth:false,due_at_proposto:'2026-09-29',source_hash:'hash-antigo'};
  const sbReq=async(method,table,data)=>({ok:true,status:200,body:[{...row,...data}]});
  const out=await suggestPendingDeadlines(sbReq,[row],{
    calendarioVerificado:true,
    aiAnalyze:async()=>{calls++;return{candidate_index:0,regime:'cpc',confidence:.95,trecho:'Manifeste-se no prazo de 10 dias úteis.'}}
  });
  assert.equal(calls,1);
  assert.equal(out.rows[0].prazo_sugestao.dias,10);
  assert.notEqual(out.rows[0].prazo_sugestao.source_hash,'hash-antigo');
});


test('sugestão criada sem IA é enriquecida quando a IA volta',async()=>{
  let calls=0;
  const row={djen_id:'dj-s4',texto:'Manifeste-se no prazo de 5 dias úteis.',data_disponibilizacao:'2026-09-21',tribunal:'TJMG',status:'casada'};
  row.prazo_sugestao={suggestion_version:DeadlineSuggestion.SUGGESTION_VERSION,status:'candidato_sem_ia',legal_truth:false,source_hash:DeadlineSuggestion.sourceHash(row),dias:5,modo:'uteis'};
  const sbReq=async(method,table,data)=>({ok:true,status:200,body:[{...row,...data}]});
  const out=await suggestPendingDeadlines(sbReq,[row],{
    calendarioVerificado:true,
    aiAnalyze:async()=>{calls++;return{candidate_index:0,regime:'cpc',confidence:.98,trecho:'Manifeste-se no prazo de 5 dias úteis.'}}
  });
  assert.equal(calls,1);
  assert.equal(out.rows[0].prazo_sugestao.status,'proposta_calculada');
  assert.equal(out.rows[0].prazo_sugestao.due_at_proposto,'2026-09-29');
});


test('PATCH vazio entra como falha de persistência e não retorna sugestão fantasma',async()=>{
  const row={djen_id:'dj-empty',texto:'Manifeste-se no prazo de 5 dias úteis.',data_disponibilizacao:'2026-09-21',tribunal:'TJMG',status:'casada'};
  const out=await suggestPendingDeadlines(async()=>({ok:true,status:200,body:[]}),[row],{
    calendarioVerificado:true,
    aiAnalyze:async()=>({candidate_index:0,regime:'cpc',confidence:.9,trecho:'Manifeste-se no prazo de 5 dias úteis.'})
  });
  assert.equal(out.failures.length,1);
  assert.equal(out.rows[0],row);
  assert.match(out.failures[0].error,/nenhuma comunicação foi atualizada/);
});

test('comunicação em qualquer grafia do DJEN: data em minúsculas e cancelamento por "ativo"/"data_cancelamento"',()=>{
  const {communicationRow}=require('../lib/djen-monitor');
  const a=communicationRow({id:'1',datadisponibilizacao:'2026-10-13',texto:'x',numeroprocessocommascara:'0000001-00.2026.8.13.0001'},'1','MG');
  assert.equal(a.data_disponibilizacao,'2026-10-13');assert.equal(a.cnj,'00000010020268130001');assert.equal(a.status,'nova');
  assert.equal(communicationRow({id:'2',data_disponibilizacao:'13/10/2026',texto:'x'},'1','MG').data_disponibilizacao,'2026-10-13');
  assert.equal(communicationRow({id:'3',dataDisponibilizacao:'2026-10-13',ativo:false},'1','MG').status,'cancelada');
  const c=communicationRow({id:'4',dataDisponibilizacao:'2026-10-13',data_cancelamento:'2026-10-14T10:00:00'},'1','MG');
  assert.equal(c.status,'cancelada');assert.match(c.motivo_cancelamento,/cancelada no DJEN em 2026-10-14/);
});

test('segunda rede pelo nome: pega a publicação sem a nossa OAB, marca para conferência, não duplica e não trava a leitura',async()=>{
  const {syncDjen}=require('../lib/djen-monitor');
  const response=(body,status=200)=>({ok:status>=200&&status<300,status,headers:{get:()=>null},text:async()=>JSON.stringify(body)});
  const tabela=new Map();const calls=[];
  const sbReq=async(method,table,data,query={})=>{
    calls.push({method,table,query});
    if(table==='djen_sync_state')return{ok:true,status:200,body:method==='GET'?[]:[data]};
    if(table!=='djen_comunicacoes')return{ok:true,status:200,body:[]};
    if(method==='POST'){tabela.set(String(data.djen_id),{...tabela.get(String(data.djen_id)),...data});return{ok:true,status:200,body:[tabela.get(String(data.djen_id))]}}
    if(method==='PATCH'){const id=String(query.djen_id).slice(3);tabela.set(id,{...tabela.get(id),...data});return{ok:true,status:200,body:[tabela.get(id)]}}
    if(method==='GET'&&query.djen_id){const id=String(query.djen_id).slice(3);return{ok:true,status:200,body:tabela.has(id)?[tabela.get(id)]:[]}}
    return{ok:true,status:200,body:[]};
  };
  const store={async read(){return{processes:[]}},async mutate(fn){const ps=[];const value=await fn(ps);return{value}}};
  const itemA={id:'A',dataDisponibilizacao:'2026-10-13',texto:'Intimação A',numeroProcesso:'',destinatarioadvogados:[{advogado:{nome:'FULANO DE TAL',numero_oab:'123456',uf_oab:'MG'}}]};
  const itemB={id:'B',dataDisponibilizacao:'2026-10-13',texto:'Intimação B (OAB errada)',numeroProcesso:'',destinatarioadvogados:[{advogado:{nome:'FULANO DE TAL',numero_oab:'12345',uf_oab:'MG'}}]};
  const fetchImpl=async url=>{
    const u=new URL(url);
    if(u.searchParams.get('nomeAdvogado'))return response({count:2,items:[itemA,itemB]});
    return u.searchParams.get('numeroOab')==='123456'?response({count:1,items:[itemA]}):response({count:0,items:[]});
  };
  const r=await syncDjen({processStore:store,sbReq,oabs:[{oab:'123456',uf:'MG'}],nomes:['Fulano de Tal'],now:new Date('2026-10-13T12:00:00Z'),clientOptions:{fetchImpl,interRequestDelayMs:0}});
  assert.equal(r.ok,true);assert.equal(r.por_nome,1,'só a B veio pelo nome');
  assert.equal(tabela.get('A').numero_oab,'123456');
  assert.equal(tabela.get('B').numero_oab,'NOME');assert.equal(tabela.get('B').payload.lex_nome,'Fulano de Tal');assert.equal(tabela.get('B').status,'orfa');
  // Busca pelo nome fora do ar: a leitura pela OAB continua valendo (cursor salvo, ok).
  const falha=async url=>new URL(url).searchParams.get('nomeAdvogado')?response({message:'erro'},500):response({count:0,items:[]});
  const r2=await syncDjen({processStore:store,sbReq,oabs:[{oab:'123456',uf:'MG'}],nomes:['Fulano de Tal'],now:new Date('2026-10-13T12:00:00Z'),clientOptions:{fetchImpl:falha,interRequestDelayMs:0,retries:0}});
  assert.equal(r2.ok,true);assert.equal(r2.nome_falhas.length,1);
});

// Banco falso com o que a leitura usa: comunicações (upsert/patch/consulta por id e por status) e cursor.
function bancoFalso(){
  const tabela=new Map(),cursores=new Map();
  const sbReq=async(method,table,data,query={})=>{
    if(table==='djen_sync_state'){
      if(method==='GET'){const k=String(query.numero_oab).slice(3)+'/'+String(query.uf_oab).slice(3);return{ok:true,status:200,body:cursores.has(k)?[cursores.get(k)]:[]}}
      cursores.set(data.numero_oab+'/'+data.uf_oab,data);return{ok:true,status:200,body:[data]};
    }
    if(table!=='djen_comunicacoes')return{ok:true,status:200,body:[]};
    if(method==='POST'){tabela.set(String(data.djen_id),{...tabela.get(String(data.djen_id)),...data});return{ok:true,status:200,body:[tabela.get(String(data.djen_id))]}}
    if(method==='PATCH'){const id=String(query.djen_id).slice(3);tabela.set(id,{...tabela.get(id),...data});return{ok:true,status:200,body:[tabela.get(id)]}}
    if(method==='GET'&&query.djen_id){const id=String(query.djen_id).slice(3);return{ok:true,status:200,body:tabela.has(id)?[tabela.get(id)]:[]}}
    if(method==='GET'&&query.status){const st=String(query.status).replace(/^eq\./,'');return{ok:true,status:200,body:[...tabela.values()].filter(r=>r.status===st)}}
    return{ok:true,status:200,body:[]};
  };
  return{tabela,cursores,sbReq};
}
function carteira(processes){
  const ps=processes;
  return{async read(){return{processes:ps}},async mutate(fn){const value=await fn(ps);return{value}}};
}
const respostaDjen=(body,status=200)=>({ok:status>=200&&status<300,status,headers:{get:()=>null},text:async()=>JSON.stringify(body)});

test('uma OAB com falha não derruba as outras; o que chegou é guardado; o cursor só anda na OAB lida por inteiro',async()=>{
  const {syncDjen}=require('../lib/djen-monitor');
  const db=bancoFalso();
  const fetchImpl=async url=>{
    const oab=new URL(url).searchParams.get('numeroOab');
    if(oab==='111111')return respostaDjen({count:3,items:[{id:'i1',dataDisponibilizacao:'2026-10-13',texto:'Intimação 1',numeroProcesso:''}]}); // informou 3, mandou 1
    if(oab==='222222')return respostaDjen({message:'fora'},500);
    if(oab==='333333')return respostaDjen({count:1,items:[{id:'i3',dataDisponibilizacao:'2026-10-13',texto:'Intimação 3',numeroProcesso:''}]});
    return respostaDjen({count:0,items:[]});
  };
  const r=await syncDjen({processStore:carteira([]),sbReq:db.sbReq,oabs:[{oab:'111111',uf:'MG'},{oab:'222222',uf:'MG'},{oab:'333333',uf:'MG'}],nomes:[],
    now:new Date('2026-10-13T15:00:00Z'),clientOptions:{fetchImpl,interRequestDelayMs:0,retries:0}});
  assert.equal(r.ok,false);
  assert.ok(db.tabela.has('i1'),'a intimação que chegou da leitura incompleta foi guardada');
  assert.ok(db.tabela.has('i3'),'a OAB seguinte foi lida mesmo com a anterior fora do ar');
  assert.ok(r.falhas.some(f=>/111111/.test(f.oab)&&/3 informada\(s\), 1 recebida\(s\)/.test(f.error)));
  assert.ok(r.falhas.some(f=>/222222/.test(f.oab)&&/HTTP 500/.test(f.error)));
  assert.ok(!db.cursores.has('111111/MG')&&!db.cursores.has('222222/MG'),'OAB com falha não é dada como lida');
  assert.ok(db.cursores.has('333333/MG'));
  assert.match(r.error,/111111|HTTP 500/,'resumo do erro legível para o aviso');
});

test('intimação longa (sentença inteira) entra no processo; andamento repetido pelo nº da intimação não duplica',async()=>{
  const {syncDjen}=require('../lib/djen-monitor');
  const db=bancoFalso();
  const processes=[{id:'p1',nome:'Caso Longo',numero:'5000001-11.2026.8.13.0001',andamentos:[]}];
  const longo='SENTENÇA. '+'Fundamentação extensa. '.repeat(1300); // ~28 mil caracteres
  let texto=longo;
  const fetchImpl=async url=>new URL(url).searchParams.get('numeroOab')==='123456'
    ?respostaDjen({count:1,items:[{id:'L1',dataDisponibilizacao:'2026-10-13',texto,numeroProcesso:'50000011120268130001',siglaTribunal:'TJMG',tipoComunicacao:'Intimação'}]})
    :respostaDjen({count:0,items:[]});
  const args={processStore:carteira(processes),sbReq:db.sbReq,oabs:[{oab:'123456',uf:'MG'}],nomes:[],now:new Date('2026-10-13T15:00:00Z'),clientOptions:{fetchImpl,interRequestDelayMs:0}};
  const r=await syncDjen(args);
  assert.equal(r.ok,true);assert.equal(r.casadas,1);
  assert.equal(db.tabela.get('L1').status,'casada');
  assert.equal(processes[0].andamentos.length,1);
  assert.ok(processes[0].andamentos[0].txt.length<=20000);
  // O Diário corrige o texto da mesma intimação: não vira um segundo andamento.
  texto=longo.replace('SENTENÇA.','SENTENÇA (retificada).');
  await syncDjen(args);
  assert.equal(processes[0].andamentos.length,1);
});

test('intimação que ficou sem classificar ("nova") é reclassificada na leitura seguinte',async()=>{
  const {syncDjen}=require('../lib/djen-monitor');
  const db=bancoFalso();
  db.tabela.set('V1',{djen_id:'V1',status:'nova',cnj:'50000022220268130001',data_disponibilizacao:'2026-10-10',texto:'Intimação antiga',tipo:'Intimação',tribunal:'TJMG',observado_em:'2026-10-10T12:00:00Z'});
  const processes=[{id:'p2',nome:'Caso Preso',numero:'5000002-22.2026.8.13.0001',andamentos:[]}];
  const fetchImpl=async()=>respostaDjen({count:0,items:[]});
  const r=await syncDjen({processStore:carteira(processes),sbReq:db.sbReq,oabs:[{oab:'123456',uf:'MG'}],nomes:[],now:new Date('2026-10-13T15:00:00Z'),clientOptions:{fetchImpl,interRequestDelayMs:0}});
  assert.equal(r.reclassificadas,1);
  assert.equal(db.tabela.get('V1').status,'casada');
  assert.equal(processes[0].andamentos.length,1);
});

test('duas leituras ao mesmo tempo (rotina, vigia, OAB nova) rodam uma depois da outra',async()=>{
  const {syncDjen}=require('../lib/djen-monitor');
  const db=bancoFalso();
  let ativos=0,maximo=0;
  const fetchImpl=async()=>{ativos++;maximo=Math.max(maximo,ativos);await new Promise(r=>setTimeout(r,5));ativos--;return respostaDjen({count:0,items:[]})};
  const args={processStore:carteira([]),sbReq:db.sbReq,oabs:[{oab:'123456',uf:'MG'}],nomes:[],now:new Date('2026-10-13T15:00:00Z'),clientOptions:{fetchImpl,interRequestDelayMs:0}};
  await Promise.all([syncDjen(args),syncDjen(args),syncDjen(args)]);
  assert.equal(maximo,1);
});
