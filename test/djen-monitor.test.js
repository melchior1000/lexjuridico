'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {syncWindows}=require('../lib/djen-monitor');

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
