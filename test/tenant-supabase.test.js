'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createSupabaseRequest} = require('../lib/supabase');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function transport(responseBody = []) {
  const calls = [];
  const https = {
    request(options, callback) {
      const req = new EventEmitter();
      const call = {options};
      calls.push(call);
      req.setTimeout = () => {};
      req.destroy = () => {};
      req.write = bytes => { call.body = JSON.parse(bytes); };
      req.end = () => queueMicrotask(() => {
        const res = new EventEmitter();
        res.statusCode = 200;
        callback(res);
        res.emit('data', JSON.stringify(responseBody));
        res.emit('end');
      });
      return req;
    }
  };
  return {https,calls};
}

test('consulta tenant-aware injeta escritorio_id sem depender do caller', async () => {
  const {https,calls} = transport([]);
  const request = createSupabaseRequest({
    url:'https://database.invalid', key:'test', https,
    tenantId:TENANT_A, tenancyRequired:true
  });
  const result = await request('GET','configuracoes',null,{chave:'eq.whatsapp'});
  assert.equal(result.ok,true);
  assert.match(calls[0].options.path,/chave=eq\.whatsapp/);
  assert.match(calls[0].options.path,new RegExp('escritorio_id=eq\\.'+TENANT_A));
});

test('write tenant-aware injeta tenant e migra on_conflict para chave composta', async () => {
  const {https,calls} = transport([]);
  const request = createSupabaseRequest({
    url:'https://database.invalid', key:'test', https,
    tenantId:TENANT_A, tenancyRequired:true
  });
  const result = await request(
    'POST','configuracoes',
    {chave:'whatsapp',valor:{ativo:true}},
    {on_conflict:'chave'}
  );
  assert.equal(result.ok,true);
  assert.equal(calls[0].body.escritorio_id,TENANT_A);
  assert.equal(calls[0].body.chave,'whatsapp');
  const url = new URL('https://database.invalid'+calls[0].options.path);
  assert.equal(url.searchParams.get('on_conflict'),'escritorio_id,chave');
});

test('caller nao consegue sobrescrever tenant no filtro nem no payload', async () => {
  const {https,calls} = transport([]);
  const request = createSupabaseRequest({
    url:'https://database.invalid', key:'test', https,
    tenantId:TENANT_A, tenancyRequired:true
  });
  const q = await request('GET','conversas',null,{escritorio_id:'eq.'+TENANT_B});
  assert.equal(q.ok,false);
  assert.match(q.erro,/Tenant divergente/);

  const p = await request('POST','conversas',{escritorio_id:TENANT_B,chat_id:'x'},null);
  assert.equal(p.ok,false);
  assert.match(p.erro,/Tenant divergente/);
  assert.equal(calls.length,0);
});

test('tenancyRequired falha fechado quando o tenant nao existe', async () => {
  const {https,calls} = transport([]);
  const request = createSupabaseRequest({
    url:'https://database.invalid', key:'test', https,
    tenantId:null, tenancyRequired:true
  });
  const result = await request('GET','processos_cache',null,{id:'eq.lex_juridico'});
  assert.equal(result.ok,false);
  assert.match(result.erro,/Tenant obrigatorio/);
  assert.equal(calls.length,0);
});

test('DELETE continua exigindo filtro de negocio alem do tenant', async () => {
  const {https,calls} = transport([]);
  const request = createSupabaseRequest({
    url:'https://database.invalid', key:'test', https,
    tenantId:TENANT_A, tenancyRequired:true
  });
  const result = await request('DELETE','conversas',null,{limit:10});
  assert.equal(result.ok,false);
  assert.match(result.erro,/Exclusao sem filtro/);
  assert.equal(calls.length,0);
});

test('config legado agora recebe escritorio_id', async () => {
  const {https,calls} = transport([]);
  const request = createSupabaseRequest({
    url:'https://database.invalid', key:'test', https,
    tenantId:TENANT_A, tenancyRequired:true
  });
  const result = await request('GET','config',null,{chave:'eq.SENHA_ADMIN'});
  assert.equal(result.ok,true);
  assert.match(calls[0].options.path,new RegExp('escritorio_id=eq\\.'+TENANT_A));
});

test('tabela de plataforma fora da lista tenant nao recebe filtro automatico', async () => {
  const {https,calls} = transport([]);
  const request = createSupabaseRequest({
    url:'https://database.invalid', key:'test', https,
    tenantId:TENANT_A, tenancyRequired:true
  });
  const result = await request('GET','escritorios',null,{slug:'eq.lex-atual'});
  assert.equal(result.ok,true);
  assert.doesNotMatch(calls[0].options.path,/escritorio_id/);
});

test('instancias A e B produzem consultas fisicamente separadas', async () => {
  const ta = transport([]);
  const tb = transport([]);
  const a = createSupabaseRequest({url:'https://database.invalid',key:'test',https:ta.https,tenantId:TENANT_A,tenancyRequired:true});
  const b = createSupabaseRequest({url:'https://database.invalid',key:'test',https:tb.https,tenantId:TENANT_B,tenancyRequired:true});
  await a('GET','memoria_casos',null,{caso_id:'eq.caso-1'});
  await b('GET','memoria_casos',null,{caso_id:'eq.caso-1'});
  assert.match(ta.calls[0].options.path,new RegExp(TENANT_A));
  assert.match(tb.calls[0].options.path,new RegExp(TENANT_B));
  assert.doesNotMatch(ta.calls[0].options.path,new RegExp(TENANT_B));
  assert.doesNotMatch(tb.calls[0].options.path,new RegExp(TENANT_A));
});
