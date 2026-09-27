'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDjenAlerts,KEY}=require('../lib/djen-alerts');

function memoryRecords(){
  const rows=new Map();
  return{rows,async read(k){return rows.has(k)?{value:rows.get(k)}:null},async change(k,fn){const v=await fn(rows.has(k)?structuredClone(rows.get(k)):null);rows.set(k,v);return v}};
}
// Banco falso: devolve as publicações gravadas, no formato {status,body} do Supabase.
function fakeDb(rows){
  const calls=[];
  const sbReq=async(method,table,body,query)=>{calls.push({method,table,query});return{ok:true,status:200,body:rows.slice()}};
  return{sbReq,calls};
}
const processStore={async read(){return{processes:[{id:'p1',nome:'Cliente Exemplo A — Cobrança'}]}}};
const pub=(id,extra={})=>({djen_id:id,status:'casada',processo_id:'p1',cnj:'50000011120268130704',tribunal:'TJMG',tipo:'Intimação',data_disponibilizacao:'2026-09-25',numero_oab:'123456',uf_oab:'MG',...extra});
const now=()=>new Date('2026-09-27T14:00:00Z');

test('primeira vez liga os avisos sem despejar o acervo antigo',async()=>{
  const records=memoryRecords(),sent=[];
  const db=fakeDb([pub('a'),pub('b')]);
  const alerts=createDjenAlerts({sbReq:db.sbReq,records,processStore,deliver:async t=>{sent.push(t);return true},now});
  const out=await alerts.tick();
  assert.equal(out.ok,true);assert.equal(out.primeira,true);
  assert.equal(sent.length,1);
  assert.match(sent[0],/Avisos do Diário \(DJEN\) ligados/);
  assert.match(sent[0],/2 publicaç/);
  assert.deepEqual(records.rows.get(KEY).ids.sort(),['a','b']);
});

test('publicação nova depois disso vira aviso imediato com processo, tribunal e OAB',async()=>{
  const records=memoryRecords(),sent=[];
  records.rows.set(KEY,{ids:['a']});
  const db=fakeDb([pub('a'),pub('b'),pub('c',{status:'orfa',processo_id:null,cnj:'07000033320268070001',tribunal:'TJDFT'})]);
  const alerts=createDjenAlerts({sbReq:db.sbReq,records,processStore,deliver:async t=>{sent.push(t);return true},now});
  const out=await alerts.tick();
  assert.equal(out.novas,2);
  assert.equal(sent.length,1);
  const t=sent[0];
  assert.match(t,/2 intimaç(ão|ões)\/publicaç(ão|ões) nova/);
  assert.match(t,/Cliente Exemplo A — Cobrança/);
  assert.match(t,/5000001-11\.2026\.8\.13\.0704/);
  assert.match(t,/0700003-33\.2026\.8\.07\.0001 — não está cadastrado no LEX/);
  assert.match(t,/OAB 123456\/MG/);
  assert.match(t,/só vale depois da sua confirmação/);
  // A consulta pede só publicações já classificadas (casada/órfã) de uma janela recente.
  assert.equal(db.calls[0].table,'djen_comunicacoes');
  assert.equal(db.calls[0].query.status,'in.(casada,orfa)');
  assert.match(db.calls[0].query.data_disponibilizacao,/^gte\.2026-09-1\d$/);
});

test('não repete aviso: a mesma publicação só é avisada uma vez',async()=>{
  const records=memoryRecords(),sent=[];
  records.rows.set(KEY,{ids:[]});
  const db=fakeDb([pub('x')]);
  const alerts=createDjenAlerts({sbReq:db.sbReq,records,processStore,deliver:async t=>{sent.push(t);return true},now});
  assert.equal((await alerts.tick()).novas,1);
  assert.equal((await alerts.tick()).novas,0);
  assert.equal(sent.length,1);
});

test('canal não confirmou: nada é marcado e a próxima rodada tenta de novo',async()=>{
  const records=memoryRecords();let tentativas=0;
  records.rows.set(KEY,{ids:[]});
  const db=fakeDb([pub('x')]);
  const alerts=createDjenAlerts({sbReq:db.sbReq,records,processStore,deliver:async()=>{tentativas++;return tentativas>1},now});
  const first=await alerts.tick();
  assert.equal(first.ok,false);assert.equal(first.reason,'entrega_nao_confirmada');
  assert.deepEqual(records.rows.get(KEY).ids,[]);
  assert.equal((await alerts.tick()).novas,1);
  assert.deepEqual(records.rows.get(KEY).ids,['x']);
});

test('muitas publicações: mostra as primeiras e diz quantas faltam',async()=>{
  const records=memoryRecords(),sent=[];
  records.rows.set(KEY,{ids:[]});
  const db=fakeDb(Array.from({length:12},(_,i)=>pub('n'+i)));
  const alerts=createDjenAlerts({sbReq:db.sbReq,records,processStore,deliver:async t=>{sent.push(t);return true},now});
  assert.equal((await alerts.tick()).novas,12);
  assert.match(sent[0],/e mais 4/);
  assert.equal(records.rows.get(KEY).ids.length,12);
});

test('banco fora do ar: falha fechada, não envia nada e não marca nada',async()=>{
  const records=memoryRecords();let delivered=0;
  records.rows.set(KEY,{ids:[]});
  const alerts=createDjenAlerts({sbReq:async()=>({ok:false,status:503,body:{message:'fora'}}),records,processStore,deliver:async()=>{delivered++;return true},now});
  const out=await alerts.tick();
  assert.equal(out.ok,false);
  assert.equal(delivered,0);
  assert.deepEqual(records.rows.get(KEY).ids,[]);
});

test('bot.js chama o aviso do DJEN depois da leitura diária e entrega pelo avisarTitular',()=>{
  const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','bot.js'),'utf8');
  assert.match(src,/createDjenAlerts\(\{[^]{0,300}deliver:\s*text\s*=>\s*avisarTitular\(text\)/);
  assert.match(src,/runDailyOfficeJobs\([^]{0,900}djenAlerts\.tick\(\)/);
});
