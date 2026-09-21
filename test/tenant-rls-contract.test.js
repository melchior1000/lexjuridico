'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname,'..','supabase','migrations','20260921033243_add_lex_backend_rls_muralha.sql'),
  'utf8'
);

test('muralha cria role sem bypass e sem login', () => {
  assert.match(migration,/create role lex_backend[\s\S]*nologin[\s\S]*nobypassrls/i);
  assert.match(migration,/alter role lex_backend[\s\S]*nologin[\s\S]*nobypassrls/i);
});

test('muralha usa contexto tenant em schema privado', () => {
  assert.match(migration,/create schema if not exists lex_security/i);
  assert.match(migration,/current_setting\('lex\.escritorio_id', true\)/i);
  assert.match(migration,/revoke all on schema lex_security from public/i);
});

test('muralha aplica RLS forçado e policy com USING e WITH CHECK', () => {
  assert.match(migration,/enable row level security/i);
  assert.match(migration,/force row level security/i);
  assert.match(migration,/create policy lex_backend_tenant[\s\S]*using \(escritorio_id = lex_security\.current_escritorio_id\(\)\)[\s\S]*with check \(escritorio_id = lex_security\.current_escritorio_id\(\)\)/i);
});

test('muralha impede reatribuição de tenant', () => {
  assert.match(migration,/new\.escritorio_id is distinct from old\.escritorio_id/i);
  assert.match(migration,/escritorio_id imutavel/i);
  assert.match(migration,/trg_prevent_tenant_reassign/i);
});

test('config legado deixa de ficar exposto sem RLS', () => {
  assert.match(migration,/alter table public\.config enable row level security/i);
  assert.match(migration,/alter table public\.config force row level security/i);
});
