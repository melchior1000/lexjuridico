'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {evolutionConfig} = require('../lib/evolution-config');

test('aliases e nomes oficiais resolvem a mesma configuracao', () => {
  assert.deepEqual(evolutionConfig({EVO_URL:'https://example.invalid/', EVO_KEY:'fake', EVO_INST:'office'}),
    evolutionConfig({EVOLUTION_URL:'https://example.invalid', EVOLUTION_KEY:'fake', EVOLUTION_INSTANCE:'office'}));
  assert.equal(evolutionConfig({EVOLUTION_KEY:'primary', EVO_KEY:'alias'}).key, 'primary');
  assert.equal(evolutionConfig({}).instance, 'LEX-JURIDICO');
});

async function bootstrap(status, body) {
  const calls = [], logs = [];
  const context = {
    module: {exports:{}},
    require: () => ({evolutionConfig: () => ({url:'https://example.invalid', key:'fake', instance:'office'})}),
    AbortController, setTimeout, clearTimeout,
    console: {log: (...args) => logs.push(args.join(' '))},
    fetch: async (url, options) => {
      calls.push({url, options});
      return {ok:status >= 200 && status < 300, status, text:async () => JSON.stringify(body)};
    }
  };
  await vm.runInNewContext(fs.readFileSync(require.resolve('../scripts/bootstrap-evolution-instance'), 'utf8'), context);
  return {calls, logs};
}

test('chave recusada nao dispara criacao nem registra corpo do provedor', async () => {
  for (const status of [401, 403, 500]) {
    const {calls, logs} = await bootstrap(status, {secret:'never-log-this'});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.apikey, 'fake');
    assert.ok(!logs.join(' ').includes('never-log-this'));
  }
});

test('lista invalida ou instancia existente nao dispara criacao', async () => {
  for (const body of [{error:'invalid'}, [{name:'office'}]]) {
    assert.equal((await bootstrap(200, body)).calls.length, 1);
  }
});

test('lista vazia confirmada permite criar a instancia configurada', async () => {
  const {calls} = await bootstrap(200, []);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].options.body).instanceName, 'office');
});

test('inicialização direta do bot aguarda bootstrap antes de verificar sessão',async()=>{
  const source=fs.readFileSync(require.resolve('../bot'),'utf8');
  const end=source.indexOf("}, 2000);",source.indexOf("setTimeout(async ()=>{\n  try {\n    _configRuntime.whatsapp"))+9;
  const start=source.lastIndexOf('setTimeout(async ()=>{',end);
  const order=[];let run;
  const context={setTimeout:fn=>{run=fn;},console:{log(){},warn(){}},
    WHATSAPP_CONFIG:{ativo:true,numero:'5511999999999'},SECRETARIO_WHATSAPP_CONFIG:{},PJE_CONFIG:{},LEX_WHATSAPP_NUMBER:'5511999999999',
    _configRuntime:{},_estadoWhatsApp:{estado:'aguardando_pareamento',conectado:false},
    _carregarConfigPersistida:async(k,defaults)=>defaults,
    require:()=>Promise.resolve().then(()=>order.push('bootstrap')),
    _inicializarConexaoWhatsApp:async()=>order.push('status')};
  vm.runInNewContext(source.slice(start,end),context);await run();
  assert.deepEqual(order,['bootstrap','status']);
  order.length=0;context.WHATSAPP_CONFIG.ativo=false;await run();assert.equal(order.length,0);
});
