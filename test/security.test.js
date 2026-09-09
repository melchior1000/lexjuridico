const {test} = require('node:test');
const assert = require('node:assert/strict');
const {setup} = require('./runtime');

for (const route of ['sync-status', 'comandos', 'memoria', 'memoria-export', 'fila', 'docx', 'diagnostico', 'teste-vivo', 'teste-ia']) {
  for (const token of [undefined, 'invalid-token']) {
    test(`${route}: bloqueia ${token ? 'token inválido' : 'acesso anônimo'} antes de acessar dependências`, async () => {
      const app = setup();
      assert.equal((await app.request('/api/' + route, token, {}, route === 'docx' ? 'POST' : 'GET')).status, 401);
    });
  }
}
for (const route of ['diagnostico', 'teste-vivo', 'teste-ia']) {
  test(`${route}: secretaria não pode executar diagnóstico`, async () => {
    const app = setup();
    assert.equal((await app.request('/api/' + route, app.token('secretaria'))).status, 403);
  });
}
test('comandos: administrador continua recebendo a fila autenticada', async () => {
  const app = setup({buscarComandosPendentes: async () => [{id: 'test-command'}]});
  const result = await app.request('/api/comandos', app.token('admin'));
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.body).comandos[0].id, 'test-command');
});
test('memoria: sessão válida continua lendo os casos', async () => {
  const app = setup({recuperarTodaMemoria: async () => [{caso_nome: 'Caso fictício'}]});
  const result = await app.request('/api/memoria', app.token('admin'));
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.body).casos.length, 1);
});
test('login sem senha configurada não cadastra senha nem concede sessão', async () => {
  const app = setup({obterSenhaValida: async () => null,
    salvarSenhaSupabase: () => {throw new Error('Não deve gravar');}});
  assert.equal((await app.request('/api/login', null, {perfil: 'admin', senha: 'teste'}, 'POST')).status, 503);
});
for (const perfil of ['constructor', '__proto__', 'inexistente']) {
  test(`login rejeita perfil ${perfil} antes de consultar senhas`, async () => {
    const app = setup();
    assert.equal((await app.request('/api/login', null, {perfil, senha: 'teste'}, 'POST')).status, 401);
  });
}
test('login configurado aceita senha correta e rejeita senha errada', async () => {
  const app = setup({obterSenhaValida: async () => 'correct-test-password'});
  assert.equal((await app.request('/api/login', null, {perfil: 'admin', senha: 'wrong'}, 'POST')).status, 401);
  const result = await app.request('/api/login', null, {perfil: 'admin', senha: 'correct-test-password'}, 'POST');
  assert.equal(result.status, 200);
  assert.equal(app.context.validarToken(JSON.parse(result.body).token), 'admin');
});
test('SSE rejeita token revogado inclusive pela query do EventSource', async () => {
  const app = setup();
  const token = app.token('admin');
  app.context.global._tokensRevogados.add(token);
  assert.equal((await app.request('/api/sse?token=' + token)).status, 401);
});
test('SSE rejeita token com sessão inativa', async () => {
  const app = setup();
  const token = app.token('admin');
  app.context.global._sessaoAtividade.set(token, Date.now() - 1800001);
  assert.equal((await app.request('/api/sse', token)).status, 401);
});
test('health check continua público', async () => {
  assert.equal((await setup().request('/health')).status, 200);
});
