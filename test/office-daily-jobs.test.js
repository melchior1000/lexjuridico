'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {runDailyOfficeJobs}=require('../lib/office-daily-jobs');

const KEY='0123456789abcdef0123456789abcdef';
function store(initial){
  let processes=structuredClone(initial);
  return{
    async read(){return{processes:structuredClone(processes),version:1}},
    async mutate(fn){const next=structuredClone(processes);const value=await fn(next);processes=next;return{value,processes:structuredClone(processes),version:2}}
  };
}
test('rotina diária só marca fonte fresh com evidence cunhada',async()=>{
  const cnj='5001234-56.2026.8.09.0001';
  const db=store([{id:'p1',numero:cnj,nome:'Caso',status:'ATIVO',prazo:'2099-01-01',andamentos:[]}]);
  const payload={hits:{hits:[{_source:{movimentos:[]}}]}},raw=JSON.stringify(payload);
  const out=await runDailyOfficeJobs({
    processStore:db,
    now:new Date(),
    datajudOptions:{apiKey:'public-key',integrityKey:KEY,fetchImpl:async()=>({ok:true,status:200,headers:{get:()=>''},text:async()=>raw})}
  });
  assert.equal(out.ok,true);
  assert.equal(out.datajud.falhas,0);
  assert.equal(out.evidence.validas,1);
  assert.equal(out.evidence.falhas,0);
  assert.equal(out.watch.total,1);
  assert.equal(out.watch.atencao,0);
});

test('leitura concluída depois do relógio inicial não vira future por engano',async()=>{
  const cnj='5001234-56.2026.8.09.0001';
  const db=store([{id:'p1',numero:cnj,nome:'Caso',status:'ATIVO',prazo:'2099-01-01',andamentos:[]}]);
  const payload={hits:{hits:[{_source:{movimentos:[]}}]}},raw=JSON.stringify(payload);
  const out=await runDailyOfficeJobs({
    processStore:db,
    now:new Date('2026-09-20T18:00:00Z'),
    datajudOptions:{apiKey:'public-key',integrityKey:KEY,fetchImpl:async()=>({ok:true,status:200,headers:{get:()=>''},text:async()=>raw})}
  });
  assert.equal(out.evidence.falhas,0);
});
