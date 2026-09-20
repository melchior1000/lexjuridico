'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {confirmDjenDeadline,readingFromCommunication}=require('../lib/deadline-authorization');
const {isLegalTruth}=require('../lib/deadline-truth');

const KEY='0123456789abcdef0123456789abcdef';
function store(initial){
  let processes=structuredClone(initial);
  return{
    async read(){return{processes:structuredClone(processes),version:1}},
    async mutate(fn){const next=structuredClone(processes);const value=await fn(next);processes=next;return{value,processes:structuredClone(processes),version:2}},
    snapshot(){return structuredClone(processes)}
  };
}
function db(row){
  const patches=[];
  return{
    patches,
    async req(method,table,data,query){
      if(table!=='djen_comunicacoes')return{ok:false,status:404,body:null};
      if(method==='GET')return{ok:true,status:200,body:[structuredClone(row)]};
      if(method==='PATCH'){patches.push(structuredClone(data));Object.assign(row,data);return{ok:true,status:200,body:[structuredClone(row)]}}
      return{ok:false,status:405,body:null};
    }
  };
}
function row(over={}){
  return{
    djen_id:'dj1',numero_oab:'123456',uf_oab:'MG',cnj:'50000000020268130001',tribunal:'TJMG',tipo:'Intimação',
    data_disponibilizacao:'2026-09-20',texto:'Intimação para manifestação',payload:{id:'dj1',texto:'Intimação'},
    status:'casada',processo_id:'p1',requisitado_em:'2026-09-20T08:00:00.000Z',observado_em:'2026-09-20T08:00:01.000Z',
    endpoint:'https://gateway.example/comunicacao',request_id:'req-dj1',raw_receipt:'{"count":1,"items":[{"id":"dj1","texto":"Intimação"}]}',receipt_item_key:'dj1',receipt_page:1,prazo_cunhado:false,motivo_cancelamento:null,
    ...over
  };
}
test('leitura DJEN não recebe vencimento; vencimento nasce da autorização humana',async()=>{
  const r=row(),database=db(r),ps=store([{id:'p1',numero:'5000000-00.2026.8.13.0001',nome:'Caso',status:'ATIVO',andamentos:[]}]);
  const reading=readingFromCommunication(r,{integrityKey:KEY});
  assert.equal(reading.due_at,null);
  const out=await confirmDjenDeadline({processStore:ps,sbReq:database.req,djenId:'dj1',dueAt:'2026-09-25',humanId:'admin',regime:'cpc',integrityKey:KEY,now:new Date('2026-09-20T18:00:00Z')});
  assert.equal(out.truth.due_at,'2026-09-25');
  assert.equal(out.truth.source,'DJEN');
  assert.equal(isLegalTruth(out.truth,{integrityKey:KEY}),true);
  const p=ps.snapshot()[0];
  assert.equal(p.prazoReal,'2026-09-25');
  assert.equal(p.djen_id_origem,'dj1');
  assert.equal(p.deadline_authorization.human_id,'admin');
  assert.equal(database.patches[0].prazo_cunhado,true);
});

test('cunhagem aceita leitura do mesmo dia sem exigir que tenha menos de 15 minutos',async()=>{
  const r=row({requisitado_em:'2026-09-20T08:00:00Z',observado_em:'2026-09-20T08:00:01Z'}),database=db(r),ps=store([{id:'p1',numero:'5000000-00.2026.8.13.0001',status:'ATIVO'}]);
  const out=await confirmDjenDeadline({processStore:ps,sbReq:database.req,djenId:'dj1',dueAt:'2026-09-25',humanId:'admin',integrityKey:KEY,now:new Date('2026-09-20T20:00:00Z')});
  assert.equal(out.ok,true);
});

test('comunicação cancelada nunca pode cunhar prazo',async()=>{
  const r=row({status:'cancelada',motivo_cancelamento:'cancelada pelo tribunal'}),database=db(r),ps=store([{id:'p1',numero:'5000000-00.2026.8.13.0001'}]);
  await assert.rejects(()=>confirmDjenDeadline({processStore:ps,sbReq:database.req,djenId:'dj1',dueAt:'2026-09-25',humanId:'admin',integrityKey:KEY}),/vinculada|cancelada/i);
});


test('data civil impossível é rejeitada antes de assinar prazo',async()=>{
  const r=row(),database=db(r),ps=store([{id:'p1',numero:'5000000-00.2026.8.13.0001',status:'ATIVO'}]);
  await assert.rejects(()=>confirmDjenDeadline({processStore:ps,sbReq:database.req,djenId:'dj1',dueAt:'2026-02-31',humanId:'admin',integrityKey:KEY}),/Prazo final inválido/);
});

test('CNJ alterado depois do casamento bloqueia cunhagem',async()=>{
  const r=row(),database=db(r),ps=store([{id:'p1',numero:'5009999-99.2026.8.13.0001',status:'ATIVO'}]);
  await assert.rejects(()=>confirmDjenDeadline({processStore:ps,sbReq:database.req,djenId:'dj1',dueAt:'2026-09-25',humanId:'admin',integrityKey:KEY,now:new Date('2026-09-20T18:00:00Z')}),/CNJ do processo mudou/);
  assert.equal(ps.snapshot()[0].prazoReal,undefined);
});

test('repetir a mesma confirmação devolve a verdade persistida, não artefato novo',async()=>{
  const r=row(),database=db(r),ps=store([{id:'p1',numero:'5000000-00.2026.8.13.0001',status:'ATIVO'}]);
  const first=await confirmDjenDeadline({processStore:ps,sbReq:database.req,djenId:'dj1',dueAt:'2026-09-25',humanId:'admin',integrityKey:KEY,now:new Date('2026-09-20T18:00:00Z')});
  const second=await confirmDjenDeadline({processStore:ps,sbReq:database.req,djenId:'dj1',dueAt:'2026-09-25',humanId:'admin',integrityKey:KEY,now:new Date('2026-09-20T18:05:00Z')});
  assert.equal(second.truth.authorization_id,first.truth.authorization_id);
  assert.equal(second.authorization.id,first.authorization.id);
  assert.equal(ps.snapshot()[0].deadline_history.length,1);
});
