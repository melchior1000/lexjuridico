'use strict';

function requireSuccess(result, operation = 'Operacao') {
  if (!result || result.ok !== true) {
    const status = Number(result && result.status) || 0;
    const error = new Error(`${operation}: banco indisponivel ou operacao recusada (${status}).`);
    error.status = 502;
    error.databaseStatus = status;
    throw error;
  }
  return result.body;
}

function rowsFromResult(result, operation = 'Consulta') {
  const body = requireSuccess(result, operation);
  if (!Array.isArray(body)) throw new Error(`${operation}: resposta do banco fora do formato esperado.`);
  return body;
}

function createSupabaseRequest({ url: baseUrl, key, https, timeoutMs = 15000 }) {
  return function request(method, table, data, query, extraHeaders) {
    return new Promise(resolve => {
      let settled = false;
      const done = result => { if (!settled) { settled = true; resolve(result); } };
      try {
        if (!baseUrl || !key) return done({ ok: false, status: 0, body: null });
        if (!/^[a-z_][a-z0-9_]*$/i.test(table)) throw new Error('Tabela invalida');
        const entries = Object.entries(query || {}).filter(([, value]) => value !== undefined && value !== null);
        const modifiers = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);
        if (method === 'DELETE' && !entries.some(([name, value]) => !modifiers.has(name) && String(value).trim())) {
          throw new Error('Exclusao sem filtro bloqueada');
        }
        const url = new URL(`${baseUrl}/rest/v1/${table}`);
        for (const [name, value] of entries) url.searchParams.set(name, value);
        const body = data == null ? null : JSON.stringify(data);
        const req = https.request({
          hostname: url.hostname, port: url.port || undefined,
          path: url.pathname + url.search, method,
          headers: {
            apikey: key, Authorization: 'Bearer ' + key,
            ...(body == null ? {} : {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)}),
            ...(extraHeaders || {})
          }
        }, response => {
          let text = '';
          response.on('data', chunk => { text += chunk; });
          response.on('error', () => done({ok: false, status: 0, body: null}));
          response.on('aborted', () => done({ok: false, status: 0, body: null}));
          response.on('end', () => {
            let parsed;
            try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
            done({ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, body: parsed});
          });
        });
        req.on('error', () => done({ok: false, status: 0, body: null}));
        req.setTimeout(timeoutMs, () => {
          done({ok: false, status: 0, body: null, erro: 'Timeout Supabase'});
          req.destroy();
        });
        if (body != null) req.write(body);
        req.end();
      } catch (error) { done({ok: false, status: 0, body: null, erro: error.message}); }
    });
  };
}

module.exports = { createSupabaseRequest, requireSuccess, rowsFromResult };
