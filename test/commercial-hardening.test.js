// Travas permanentes do pacote de endurecimento comercial (23/09/2026).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {setup, source} = require('./runtime');

test('senha: hash scrypt confere, rejeita senha errada e nunca guarda texto', () => {
  const {context} = setup();
  const hash = context.hashSenhaLex('senha-forte-123');
  assert.ok(hash.startsWith('scrypt$16384$'));
  assert.ok(!hash.includes('senha-forte-123'));
  assert.equal(context.conferirSenhaLex('senha-forte-123', hash), true);
  assert.equal(context.conferirSenhaLex('senha-forte-124', hash), false);
  assert.notEqual(context.hashSenhaLex('x'), context.hashSenhaLex('x'), 'salt aleatório');
});

test('senha: valor legado em texto continua aceito; hash malformado falha fechado', () => {
  const {context} = setup();
  assert.equal(context.conferirSenhaLex('legada-1234', 'legada-1234'), true);
  assert.equal(context.conferirSenhaLex('legada-1234', 'outra'), false);
  assert.equal(context.conferirSenhaLex('x', 'scrypt$abc$$'), false);
  assert.equal(context.conferirSenhaLex('x', 'scrypt$99999999$AAAA$AAAA'), false);
  assert.equal(context.conferirSenhaLex('', ''), false);
  assert.equal(context.conferirSenhaLex(undefined, 'a'), false);
});

test('login: senha em hash funciona e senha legada é convertida para hash', async () => {
  const salvas = [];
  const app = setup({obterSenhaValida: async () => 'legada-teste-1', salvarSenhaSupabase: async (p, s) => { salvas.push([p, s]); return true; }});
  const ok = await app.request('/api/login', null, {perfil: 'admin', senha: 'legada-teste-1'}, 'POST');
  assert.equal(ok.status, 200);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(salvas, [['admin', 'legada-teste-1']]);

  const hash = app.context.hashSenhaLex('nova-senha-99');
  const app2 = setup({obterSenhaValida: async () => hash, salvarSenhaSupabase: async () => { throw new Error('não deve regravar hash'); }});
  assert.equal((await app2.request('/api/login', null, {perfil: 'admin', senha: 'nova-senha-99'}, 'POST')).status, 200);
  assert.equal((await app2.request('/api/login', null, {perfil: 'admin', senha: 'errada'}, 'POST')).status, 401);
});

test('rate limit do login usa o IP gravado pelo proxy confiável, não o forjado', async () => {
  const ips = [];
  const app = setup({_checkLoginRate: ip => { ips.push(ip); return true; }, obterSenhaValida: async () => null});
  await app.request('/api/login', null, {perfil: 'admin', senha: 'x'}, 'POST', {'x-forwarded-for': '1.1.1.1, 203.0.113.9'});
  await app.request('/api/login', null, {perfil: 'admin', senha: 'x'}, 'POST', {'x-forwarded-for': '2.2.2.2, 203.0.113.9'});
  assert.deepEqual(ips, ['203.0.113.9', '203.0.113.9'], 'trocar o primeiro valor não burla o limite');
  const semProxy = setup({process: {env: {LEX_TRUSTED_PROXY_HOPS: '0'}}});
  assert.equal(semProxy.context.ipClienteLex({headers: {'x-forwarded-for': '6.6.6.6'}, socket: {remoteAddress: '10.0.0.5'}}), '10.0.0.5');
});

for (const rota of ['/api/processos', '/api/rota-que-nao-existe', '/api/mensagens', '/api/pje/andamentos', '/api/billing/licenca']) {
  test(`negação por padrão: ${rota} sem sessão responde 401`, async () => {
    const app = setup();
    assert.equal((await app.request(rota, null)).status, 401);
    assert.equal((await app.request(rota, 'token-forjado')).status, 401);
  });
}

test('revogar sessão encerra imediatamente o SSE aberto com aquele token', async () => {
  const fechados = [];
  const stream = id => ({write() {}, end() { fechados.push(id); }});
  const _sseClientes = new Map([['a', stream('a')], ['b', stream('b')]]);
  const app = setup({_sseClientes});
  const token = app.token('admin');
  const outro = app.token('secretaria') + 'x';
  app.context.global._sseTokens = new Map([['a', token], ['b', outro]]);
  const r = await app.request('/api/revogar', token, {}, 'POST');
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).streams_encerrados, 1);
  assert.deepEqual(fechados, ['a']);
  assert.ok(_sseClientes.has('b'));
  assert.equal(app.context.sessaoAindaValidaLex(token), false);
});

function carregarLerBody(limiteMb) {
  const trecho = source.slice(source.indexOf('const LEX_MAX_BODY_BYTES'), source.indexOf('// ── CORS seguro'));
  const ctx = vm.createContext({Buffer, process: {env: {LEX_MAX_BODY_MB: String(limiteMb)}}});
  vm.runInContext(trecho + '\nthis.lerBody = lerBody;', ctx);
  return ctx.lerBody;
}
function requisicao(partes) {
  const req = new EventEmitter();
  req.destroyed = false; req.destroy = () => { req.destroyed = true; };
  setImmediate(() => { for (const p of partes) req.emit('data', Buffer.from(p)); req.emit('end'); });
  return req;
}

test('corpo: JSON inválido é recusado com 400 em vez de virar pedido vazio', async () => {
  const lerBody = carregarLerBody(1);
  await assert.rejects(lerBody(requisicao(['{"perfil":'])), e => e.status === 400);
  assert.equal(JSON.stringify(await lerBody(requisicao(['']))), '{}');
  assert.equal(JSON.stringify(await lerBody(requisicao(['{"a":', '1}']))), '{"a":1}');
});

test('corpo: acima do limite responde 413 e para de acumular', async () => {
  const lerBody = carregarLerBody(1);
  const grande = 'x'.repeat(700 * 1024);
  const req = requisicao([grande, grande, grande]);
  await assert.rejects(lerBody(req), e => e.status === 413);
  assert.equal(req.destroyed, true);
});
