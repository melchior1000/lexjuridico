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


test('DataJud ausente não derruba a vigia de prazo nem fabrica evidência',async()=>{
  const db=store([{id:'p1',numero:'5001234-56.2026.8.09.0001',nome:'Caso',status:'ATIVO',andamentos:[]}]);
  const out=await runDailyOfficeJobs({processStore:db,now:new Date('2026-09-20T18:00:00Z'),datajudOptions:{integrityKey:KEY}});
  assert.equal(out.datajud.enabled,false);
  assert.equal(out.datajud.skipped,true);
  assert.equal(out.datajud.falhas,0);
  assert.equal(out.evidence.validas,0);
  assert.equal(out.ok,true);
});

// Auditoria de 13/10/2026: processo que o Datajud não acha (segredo de justiça) não pode fazer a
// rotina recomeçar o dia inteiro; nova tentativa no mesmo dia não relê a carteira no Datajud.
test('processo que o Datajud não acha fica registrado à parte e não derruba o dia',async()=>{
  const db=store([{id:'p1',numero:'5001234-56.2026.8.09.0001',nome:'Caso',status:'ATIVO',andamentos:[]}]);
  const out=await runDailyOfficeJobs({processStore:db,now:new Date('2026-09-20T18:00:00Z'),
    datajudOptions:{apiKey:'public-key',integrityKey:KEY,fetchImpl:async()=>({ok:true,status:200,headers:{get:()=>''},text:async()=>JSON.stringify({hits:{hits:[]}})})}});
  assert.equal(out.ok,true,'não achar não é falha de leitura');
  assert.equal(out.datajud.falhas,0);assert.equal(out.datajud.nao_encontrados,1);
  assert.ok(out.exceptions.some(e=>e.type==='datajud_not_found'&&e.processo_id==='p1'));
  assert.ok(!out.exceptions.some(e=>e.type==='datajud_failed'));
});

test('nova tentativa no mesmo dia (pularDatajud): não consulta o Datajud de novo',async()=>{
  const db=store([{id:'p1',numero:'5001234-56.2026.8.09.0001',nome:'Caso',status:'ATIVO',andamentos:[]}]);
  let chamadas=0;
  const out=await runDailyOfficeJobs({processStore:db,now:new Date('2026-09-20T18:00:00Z'),pularDatajud:true,
    datajudOptions:{apiKey:'public-key',integrityKey:KEY,fetchImpl:async()=>{chamadas++;return{ok:true,status:200,headers:{get:()=>''},text:async()=>JSON.stringify({hits:{hits:[]}})}}}});
  assert.equal(chamadas,0);
  assert.equal(out.datajud.enabled,true);assert.equal(out.datajud.skipped,true);assert.equal(out.datajud.reason,'DATAJUD_JA_LIDO_HOJE');assert.equal(out.datajud.total,0);
});
