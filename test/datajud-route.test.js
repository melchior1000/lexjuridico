'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {officeRoutes}=require('../lib/office-routes');

function store(initial){
  let processes=structuredClone(initial);
  return {
    async read(){return {processes:structuredClone(processes),version:1}},
    async mutate(fn){const next=structuredClone(processes);const value=await fn(next);processes=next;return {value,processes:structuredClone(processes),version:2}}
  };
}
function response(){let status=0,body=null;return{res:{writeHead:s=>{status=s},end:b=>{body=b?JSON.parse(b):null}},get:()=>({status,body})}}

test('rota do escritório consulta Datajud do processo selecionado sem IA',async()=>{
  const cnj='5001234-56.2026.8.09.0001';
  const db=store([{id:'p1',nome:'Caso',numero:cnj,andamentos:[]}]);
  const deps={
    headers:{'Content-Type':'application/json'},authenticate:()=> 'admin',body:async()=>({processo_id:'p1'}),processStore:db,
    datajudApiKey:'public-key',courtReadingIntegrityKey:'0123456789abcdef0123456789abcdef',datajudFetch:async()=>({ok:true,status:200,json:async()=>({hits:{hits:[{_source:{movimentos:[{dataHora:'2026-09-14T12:00:00Z',nome:'Juntada'}]}}]}})})
  };
  const out=response();
  await officeRoutes({url:'/api/escritorio/datajud',method:'POST'},out.res,deps);
  assert.equal(out.get().status,200);
  assert.equal(out.get().body.alias,'tjgo');
  assert.equal(out.get().body.novos,1);
});

test('rota Datajud sem chave falha fechada',async()=>{
  const db=store([{id:'p1',nome:'Caso',numero:'5001234-56.2026.8.09.0001',andamentos:[]}]);
  const deps={headers:{},authenticate:()=> 'admin',body:async()=>({processo_id:'p1'}),processStore:db,datajudApiKey:''};
  const out=response();
  await officeRoutes({url:'/api/escritorio/datajud',method:'POST'},out.res,deps);
  assert.equal(out.get().status,422);
  assert.match(out.get().body.error,/não configurada/);
});
