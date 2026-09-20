'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createReadingLogEntry,verifyReadingLogEntry}=require('../lib/reading-log-schema');

const KEY='0123456789abcdef0123456789abcdef';
function valid(over={}){
  const observed=over.observed_at||'2026-09-20T18:00:00.000Z';
  return createReadingLogEntry({
    reading_id:'r1',processo:'5000000-00.2026.8.13.0001',process_id:'p1',source:'datajud',
    observed_at:observed,ok:true,status_code:200,
    proveniencia:{conector:'lib/datajud',endpoint:'https://api.example/_search',request_id:'req-1',authenticated:true,timestamp_requisicao:'2026-09-20T17:59:59.000Z',timestamp_resposta:observed},
    content_type:'application/json',raw_receipt:'{"hits":[]}',movimentos_encontrados:0,sincronizado:true,explicit_no_change:true,movement_received:false,
    ...over
  },{integrityKey:KEY});
}
test('reading íntegro valida com a mesma chave do servidor',()=>assert.equal(verifyReadingLogEntry(valid(),{integrityKey:KEY}),true));
test('chave diferente não valida o binding',()=>assert.equal(verifyReadingLogEntry(valid(),{integrityKey:'fedcba9876543210fedcba9876543210'}),false));
test('alterar observed_at após persistência invalida a leitura',()=>{const r=structuredClone(valid());r.observed_at='2026-09-20T18:10:00.000Z';assert.equal(verifyReadingLogEntry(r,{integrityKey:KEY}),false)});
test('alterar flag de sincronização após persistência invalida a leitura',()=>{const r=structuredClone(valid());r.explicit_no_change=false;assert.equal(verifyReadingLogEntry(r,{integrityKey:KEY}),false)});
test('alterar flag no topo e no resultado continua invalidando HMAC',()=>{const r=structuredClone(valid());r.explicit_no_change=false;r.resultado.explicit_no_change=false;r.movement_received=true;r.resultado.movement_received=true;assert.equal(verifyReadingLogEntry(r,{integrityKey:KEY}),false)});
test('alterar recibo sem assinatura nova invalida a leitura',()=>{const r=structuredClone(valid());r.recibo.raw_receipt='{"hits":[1]}';r.raw_receipt=r.recibo.raw_receipt;assert.equal(verifyReadingLogEntry(r,{integrityKey:KEY}),false)});
test('process_id é obrigatório na origem',()=>assert.throws(()=>valid({process_id:null}),/READING_PROCESS_ID_REQUIRED/));
test('chave de integridade curta ou ausente é rejeitada',()=>assert.throws(()=>createReadingLogEntry({processo:'x',process_id:'p',source:'datajud',raw_receipt:'{}',observed_at:'2026-09-20T18:00:00Z',proveniencia:{conector:'lib/datajud',endpoint:'x',request_id:'r',authenticated:true,timestamp_requisicao:'2026-09-20T18:00:00Z',timestamp_resposta:'2026-09-20T18:00:00Z'}},{integrityKey:'curta'}),/READING_INTEGRITY_KEY_REQUIRED/));

test('alterar reading_id invalida o HMAC',()=>{const r=structuredClone(valid());r.reading_id='r2';assert.equal(verifyReadingLogEntry(r,{integrityKey:KEY}),false)});
test('alterar content_type invalida o HMAC',()=>{const r=structuredClone(valid());r.integridade.content_type='text/plain';assert.equal(verifyReadingLogEntry(r,{integrityKey:KEY}),false)});
test('alterar metadata invalida o HMAC',()=>{const r=structuredClone(valid({metadata:{request:'a'}}));r.recibo.metadata.request='b';assert.equal(verifyReadingLogEntry(r,{integrityKey:KEY}),false)});
test('query_context rejeita array esparso e undefined',()=>{const sparse=[];sparse.length=1;assert.throws(()=>valid({query_context:{a:sparse}}),/READING_IJSON_INVALID/);assert.throws(()=>valid({query_context:{a:[undefined]}}),/READING_IJSON_INVALID/)});
test('query_context rejeita número não finito',()=>assert.throws(()=>valid({query_context:{a:Infinity}}),/READING_IJSON_INVALID/));
