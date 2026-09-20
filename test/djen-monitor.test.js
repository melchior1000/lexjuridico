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
  row.prazo_sugestao={status:'proposta_calculada',legal_truth:false,due_at_proposto:'2026-09-29',source_hash:DeadlineSuggestion.sourceHash(row)};
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
