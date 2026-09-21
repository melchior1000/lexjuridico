'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createSupabaseRequest}=require('../lib/supabase');

const TENANT='3369b6cc-39dc-466f-84a7-7b65e196dbea';
const runtimeMigration=fs.readFileSync(
  path.join(__dirname,'..','supabase','migrations','20260921034118_add_lex_runtime_role.sql'),
  'utf8'
);
const configMigration=fs.readFileSync(
  path.join(__dirname,'..','supabase','migrations','20260921034444_tenantize_legacy_config.sql'),
  'utf8'
);

test('role de runtime tem login mas nunca BYPASSRLS',()=>{
  assert.match(runtimeMigration,/create role lex_runtime[\s\S]*login[\s\S]*nobypassrls/i);
  assert.match(runtimeMigration,/grant lex_backend to lex_runtime/i);
  assert.doesNotMatch(runtimeMigration,/bypassrls(?!\s*;)/i);
});

test('config legado passa a ter tenant, unique composto e RLS',()=>{
  assert.match(configMigration,/add column if not exists escritorio_id uuid/i);
  assert.match(configMigration,/unique\(escritorio_id,chave\)/i);
  assert.match(configMigration,/create policy lex_backend_tenant/i);
  assert.match(configMigration,/force row level security/i);
});

test('modo postgres falha fechado sem string de conexao',()=>{
  assert.throws(
    ()=>createSupabaseRequest({
      databaseMode:'postgres',
      databaseUrl:'',
      tenantId:TENANT,
      tenancyRequired:true
    }),
    /LEX_DATABASE_URL obrigatoria/
  );
});

test('modo de banco desconhecido falha fechado',()=>{
  assert.throws(
    ()=>createSupabaseRequest({
      databaseMode:'qualquer',
      url:'https://database.invalid',
      key:'x',
      https:{},
      tenantId:TENANT
    }),
    /LEX_DB_MODE invalido/
  );
});
