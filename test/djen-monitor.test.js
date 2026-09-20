'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {syncWindows,communicationRow}=require('../lib/djen-monitor');

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
