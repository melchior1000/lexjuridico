'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Datajud=require('../lib/datajud');
const {parseOfficeCommand}=require('../lib/office-command');

function store(initial){
  let processes=structuredClone(initial);
  return {
    async read(){return {processes:structuredClone(processes),version:1}},
    async mutate(fn){const next=structuredClone(processes);const value=await fn(next);processes=next;return {value,processes:structuredClone(processes),version:2}},
    snapshot(){return structuredClone(processes)}
  };
}

const GO='5001234-56.2026.8.09.0001';
const SP='1001234-56.2026.8.26.0001';
const TRF6='6001234-56.2026.4.06.3803';

test('deriva tribunal pelo CNJ',()=>{
  assert.equal(Datajud.aliasForCnj(GO),'tjgo');
  assert.equal(Datajud.aliasForCnj(SP),'tjsp');
  assert.equal(Datajud.aliasForCnj(TRF6),'trf6');
});

test('sem chave não chama a rede',async()=>{
  let calls=0;
  await assert.rejects(()=>Datajud.queryByCnj(GO,{apiKey:'',fetchImpl:async()=>{calls++;}}),/não configurada/);
  assert.equal(calls,0);
});

test('grava movimento novo uma vez e deduplica repetição',async()=>{
  const db=store([{id:'p1',nome:'Caso GO',numero:GO,andamentos:[]}]);
  const payload={hits:{hits:[{_source:{movimentos:[{dataHora:'2026-09-14T12:00:00Z',nome:'Juntada de Petição'}]}}]}};
  const fetchImpl=async()=>({ok:true,status:200,json:async()=>payload});
  let r=await Datajud.syncProcess(db,'p1',{apiKey:'public-key',fetchImpl,actor:'admin'});
  assert.equal(r.novos,1);assert.equal(r.duplicados,0);
  r=await Datajud.syncProcess(db,'p1',{apiKey:'public-key',fetchImpl,actor:'admin'});
  assert.equal(r.novos,0);assert.equal(r.duplicados,1);
  const p=db.snapshot()[0];
  assert.equal(p.andamentos.length,1);
  assert.equal(p.andamentos[0].origem,'datajud');
  assert.match(p.andamentos[0].txt,/^\[DATAJUD\] Juntada de Petição/);
});

test('CNJ duplicado bloqueia a consulta',async()=>{
  const db=store([{id:'a',numero:GO},{id:'b',numero:GO}]);
  await assert.rejects(()=>Datajud.syncProcess(db,'a',{apiKey:'public-key',fetchImpl:async()=>({ok:true,json:async()=>({})})}),/CNJ duplicado/);
});

test('chat reconhece ordem de atualizar andamentos',()=>{
  const cmd=parseOfficeCommand('busca andamentos deste processo',{processo_id:'p1'});
  assert.equal(cmd.action,'datajud');
  assert.equal(cmd.processo_id,'p1');
  assert.equal(cmd.requires_process,true);
});
