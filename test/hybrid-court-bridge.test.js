'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Bridge = require('../lib/hybrid-court-bridge');

const NOW = new Date('2026-09-15T12:00:00-03:00');

test('fonte oficial explícita e recente permite carimbo de sincronização', () => {
  const readings=[{source:'djen',ok:true,explicit_no_change:true,observed_at:'2026-09-15T09:00:00-03:00'}];
  assert.equal(Bridge.canStampOfficialSync(readings, NOW), true);
  assert.equal(Bridge.sourceState(readings, NOW).freshness, 'fresh');
});

test('fonte oficial antiga não pode ser marcada como fresh', () => {
  const readings=[{source:'pje',ok:true,explicit_no_change:true,observed_at:'2026-09-14T12:00:00-03:00'}];
  assert.equal(Bridge.canStampOfficialSync(readings, NOW), false);
  assert.equal(Bridge.sourceState(readings, NOW).freshness, 'stale');
});

test('timestamp oficial inválido não pode ser marcado como fresh', () => {
  const readings=[{source:'datajud',ok:true,movement_received:true,observed_at:'data-invalida'}];
  assert.equal(Bridge.canStampOfficialSync(readings, NOW), false);
  assert.equal(Bridge.sourceState(readings, NOW).freshness, 'stale');
});

test('arquivo local nunca confirma sozinho sincronização oficial', () => {
  const readings=[{source:'local_bridge',ok:true,movement_received:true,document_hash:'abc'}];
  assert.equal(Bridge.canStampOfficialSync(readings, NOW), false);
  assert.equal(Bridge.sourceState(readings, NOW).freshness, 'provisional');
});

test('prazo sugerido pela IA não vira verdade jurídica', () => {
  const d=Bridge.deadlineTruth({suggested_due_at:'2026-09-20T23:59:59-03:00'}, NOW);
  assert.equal(d.status,'suggested');
  assert.equal(d.legal_truth,false);
});

test('prazo não confirma sem fonte oficial recente mesmo com autorização', () => {
  const d=Bridge.deadlineTruth({confirmed_due_at:'2026-09-20T23:59:59-03:00',confirmed_at:'2026-09-15T10:00:00-03:00',authorization_id:'auth-1',official_source:'manual',official_observed_at:'2026-09-15T10:00:00-03:00'}, NOW);
  assert.equal(d.status,'suggested');
  assert.equal(d.legal_truth,false);
});

test('prazo só fica confirmado com fonte oficial recente e autorização humana', () => {
  const d=Bridge.deadlineTruth({confirmed_due_at:'2026-09-20T23:59:59-03:00',confirmed_at:'2026-09-15T10:00:00-03:00',authorization_id:'auth-1',official_source:'pje',official_observed_at:'2026-09-15T10:00:00-03:00'}, NOW);
  assert.equal(d.status,'confirmed');
  assert.equal(d.legal_truth,true);
  assert.equal(d.official_source,'pje');
});

test('bridge local é somente entrada e não pratica ato jurídico', () => {
  const e=Bridge.bridgeEnvelope({case_id:'c1',path:'/entrada/intimacao.pdf',sha256:'deadbeef',intent_id:'i1'});
  assert.equal(e.payload.authority,'input_only');
  assert.equal(e.payload.can_confirm_deadline,false);
  assert.equal(e.payload.can_file,false);
});

test('reconciliação nunca fica silenciosa quando só há fonte local', () => {
  const r=Bridge.reconcile({case_id:'c1',intent_id:'i2',now:NOW,readings:[{source:'local_bridge',ok:true,movement_received:true}],deadline:{suggested_due_at:'2026-09-20'}});
  assert.equal(r.requires_human_attention,true);
  assert.match(r.warnings.join(' '),/provisória/i);
  assert.match(r.warnings.join(' '),/fonte oficial/i);
});
