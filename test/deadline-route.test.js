'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {officeRoutes}=require('../lib/office-routes');

const KEY='0123456789abcdef0123456789abcdef';
function response(){let status=0,body=null;return{res:{writeHead:s=>status=s,end:b=>body=b?JSON.parse(b):null},get:()=>({status,body})}}
function store(initial){
  let processes=structuredClone(initial);
  return{async read(){return{processes:structuredClone(processes),version:1}},async mutate(fn){const next=structuredClone(processes);const value=await fn(next);processes=next;return{value,processes:structuredClone(processes),version:2}},snapshot(){return structuredClone(processes)}};
}
function database(row){
  const patches=[];
  const request=async(method,table,data,query)=>{
    if(table!=='djen_comunicacoes')return{ok:false,status:404,body:null};
    if(method==='GET'){
      if(query?.status==='eq.casada')return{ok:true,status:200,body:row.prazo_cunhado?[]:[structuredClone(row)]};
      return{ok:true,status:200,body:[structuredClone(row)]};
    }
    if(method==='PATCH'){patches.push(data);Object.assign(row,data);return{ok:true,status:200,body:[structuredClone(row)]}}
    return{ok:false,status:405,body:null};
  };
  return{request,patches};
}
function communication(){
  return{djen_id:'dj1',numero_oab:'123456',uf_oab:'MG',cnj:'50000000020268130001',tribunal:'TJMG',tipo:'Intimação',data_disponibilizacao:'2026-09-20',texto:'Manifestar',payload:{id:'dj1'},status:'casada',processo_id:'p1',prazo_cunhado:false,requisitado_em:'2026-09-20T08:00:00Z',observado_em:'2026-09-20T08:00:01Z',endpoint:'https://gateway.example/api/djen/comunicacao',request_id:'req1',raw_receipt:'{"count":1,"items":[{"id":"dj1"}]}',receipt_item_key:'dj1',receipt_page:1};
}

test('fila de cunhagem é consultável sem criar prazo',async()=>{
  const row=communication(),db=database(row),out=response();
  await officeRoutes({url:'/api/escritorio/prazos/cunhar',method:'GET'},out.res,{headers:{},authenticate:()=> 'secretaria',records:{request:db.request}});
  assert.equal(out.get().status,200);assert.equal(out.get().body.total,1);assert.equal(row.prazo_cunhado,false);
});

test('confirmação humana cunha truth e baixa a comunicação',async()=>{
  const row=communication(),db=database(row),ps=store([{id:'p1',numero:'5000000-00.2026.8.13.0001',nome:'Caso',status:'ATIVO'}]),out=response();
  await officeRoutes({url:'/api/escritorio/prazos/cunhar',method:'POST'},out.res,{
    headers:{},authenticate:()=> 'admin',body:async()=>({djen_id:'dj1',due_at:'2026-09-25',regime:'cpc'}),
    records:{request:db.request},processStore:ps,courtReadingIntegrityKey:KEY,deadlineAuthorizationMaxAgeMs:36*60*60*1000
  });
  assert.equal(out.get().status,200);assert.equal(out.get().body.truth.due_at,'2026-09-25');
  assert.equal(ps.snapshot()[0].prazoReal,'2026-09-25');assert.equal(row.prazo_cunhado,true);
});

test('secretaria não pode confirmar prazo jurídico',async()=>{
  const row=communication(),db=database(row),out=response();
  await officeRoutes({url:'/api/escritorio/prazos/cunhar',method:'POST'},out.res,{headers:{},authenticate:()=> 'secretaria',records:{request:db.request}});
  assert.equal(out.get().status,403);
});


test('mesa de trabalho recebe a fila de cunhagem sem fabricar vencimento',async()=>{
  const row=communication(),db=database(row),ps=store([{id:'p1',numero:'5000000-00.2026.8.13.0001',nome:'Caso',status:'ATIVO'}]),out=response();
  const records={request:db.request,async read(){return null}};
  const engine={async recoverStale(){return[]},async list(){return[]}};
  await officeRoutes({url:'/api/trabalho',method:'GET'},out.res,{
    headers:{},authenticate:()=> 'admin',records,engine,processStore:ps,aiAvailable:()=>true,courtReadingIntegrityKey:KEY
  });
  assert.equal(out.get().status,200);
  assert.equal(out.get().body.prazos.cunhar.length,1);
  assert.equal(out.get().body.prazos.correndo.length,0);
  assert.equal(ps.snapshot()[0].prazoReal,undefined);
});
