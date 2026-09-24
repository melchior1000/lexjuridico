'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMorningBrief}=require('../lib/morning-brief');

function memoryRecords(){
  const rows=new Map();
  return{rows,async read(k){return rows.has(k)?{value:rows.get(k)}:null},async change(k,fn){const v=fn(rows.get(k));rows.set(k,v);return v}};
}
const at=iso=>()=>new Date(iso);

test('envia uma única vez por dia, a partir das 7h de Brasília',async()=>{
  const records=memoryRecords(),sent=[];
  const deliver=async t=>{sent.push(t);return true};
  const early=createMorningBrief({records,compose:async()=>'Resumo',deliver,now:at('2026-09-24T09:30:00Z')});// 6h30
  assert.equal((await early.tick()).skipped,'fora_horario');
  const brief=createMorningBrief({records,compose:async()=>'Resumo',deliver,now:at('2026-09-24T10:05:00Z')});// 7h05
  assert.equal((await brief.tick()).ok,true);
  assert.equal((await brief.tick()).skipped,'ja_enviado');
  assert.deepEqual(sent,['Resumo']);
  const tomorrow=createMorningBrief({records,compose:async()=>'Resumo 2',deliver,now:at('2026-09-25T10:05:00Z')});
  assert.equal((await tomorrow.tick()).ok,true);
  assert.equal(sent.length,2);
});

test('entrega não confirmada não marca o dia e tenta de novo',async()=>{
  const records=memoryRecords();let attempts=0;
  const brief=createMorningBrief({records,compose:async()=>'Resumo',deliver:async()=>{attempts++;return attempts>1},now:at('2026-09-24T11:00:00Z')});
  assert.equal((await brief.tick()).ok,false);
  assert.equal(records.rows.size,0);
  assert.equal((await brief.tick()).ok,true);
  assert.equal(attempts,2);
});

test('falha ao montar o resumo não envia nada nem derruba o processo',async()=>{
  const records=memoryRecords();let delivered=0;
  const brief=createMorningBrief({records,compose:async()=>{throw new Error('banco fora')},deliver:async()=>{delivered++;return true},now:at('2026-09-24T11:00:00Z')});
  const out=await brief.tick();
  assert.equal(out.ok,false);
  assert.equal(delivered,0);
});

test('depois do meio-dia não manda bom dia atrasado',async()=>{
  const brief=createMorningBrief({records:memoryRecords(),compose:async()=>'x',deliver:async()=>true,now:at('2026-09-24T16:00:00Z')});
  assert.equal((await brief.tick()).skipped,'fora_horario');
});
