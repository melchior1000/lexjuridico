'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {proposeDjenDeadline}=require('../lib/forensic-calendar');

test('DJEN segunda: publicação terça, início quarta e 5 úteis vencem na terça seguinte',()=>{
  const p=proposeDjenDeadline({regime:'cpc',data_disponibilizacao:'2026-09-21',dias:5,calendario_verificado:true});
  assert.equal(p.data_publicacao,'2026-09-22');
  assert.equal(p.termo_inicial,'2026-09-23');
  assert.equal(p.due_at_proposto,'2026-09-29');
  assert.deepEqual(p.dias_contados,['2026-09-23','2026-09-24','2026-09-25','2026-09-28','2026-09-29']);
  assert.equal(p.legal_truth,false);
});

test('disponibilização em 17/12/2026 com 5 úteis atravessa recesso e propõe 27/01/2027',()=>{
  const p=proposeDjenDeadline({regime:'cpc',data_disponibilizacao:'2026-12-17',dias:5,calendario_verificado:true});
  assert.equal(p.data_publicacao,'2026-12-18');
  assert.equal(p.termo_inicial,'2027-01-21');
  assert.equal(p.due_at_proposto,'2027-01-27');
  assert.equal(p.recesso_aplicado,true);
});

test('CLT usa dias úteis e suspensão 20/12 a 20/01 nesta proposta processual',()=>{
  const p=proposeDjenDeadline({regime:'clt',data_disponibilizacao:'2026-12-17',dias:3,calendario_verificado:true});
  assert.equal(p.termo_inicial,'2027-01-21');
  assert.equal(p.due_at_proposto,'2027-01-25');
});

test('feriado informado é pulado e permanece auditável no resultado',()=>{
  const p=proposeDjenDeadline({regime:'cpc',data_disponibilizacao:'2026-09-21',dias:3,feriados:['2026-09-24'],calendario_verificado:true});
  assert.equal(p.due_at_proposto,'2026-09-28');
  assert.ok(p.dias_pulados.some(x=>x.data==='2026-09-24'&&x.motivo==='feriado_informado'));
});

test('sem calendário verificado a data continua apenas proposta e carrega aviso explícito',()=>{
  const p=proposeDjenDeadline({regime:'cpc',data_disponibilizacao:'2026-09-21',dias:3});
  assert.equal(p.status,'proposta');assert.equal(p.legal_truth,false);
  assert.match(p.warnings.join(' '),/Calendário local não marcado como verificado/);
});

test('motor genérico recusa prescrição e decadência para não misturar relógios',()=>{
  assert.throws(()=>proposeDjenDeadline({regime:'prescricional',data_disponibilizacao:'2026-09-21',dias:5}),/cpc ou clt/);
  assert.throws(()=>proposeDjenDeadline({regime:'decadencial',data_disponibilizacao:'2026-09-21',dias:5}),/cpc ou clt/);
});
