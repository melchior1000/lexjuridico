'use strict';

const TENANT_TABLES = new Set([
  'agente_logs',
  'clientes_pendentes',
  'comandos_pendentes',
  'config',
  'configuracoes',
  'conversas',
  'djen_comunicacoes',
  'djen_sync_state',
  'lex_status',
  'memoria_casos',
  'prazo_alertas',
  'processos_cache',
  'processos_prep',
  'processos_sync',
  'whatsapp_recepcao_eventos',
  'whatsapp_recepcao_publica',
  // Isoladas em 24/09/2026 (migração tenantize_remaining_tables).
  'arquivo_morto_indice',
  'auditoria',
  'cobrancas_pix',
  'contatos',
  'documentos_indexados',
  'documentos_processo',
  'memoria_checkpoints',
  'mensagens_chat',
  'perfis_juizes',
  'tempo_uso',
  'vivo_acoes',
  'whatsapp_sessoes'
]);

// Tabelas de plataforma (cadastro de escritórios e usuários): não têm a
// coluna escritorio_id, mas o banco aplica RLS própria (o runtime só vê o
// próprio escritório). Nenhum dado de trabalho fica aqui.
// Com escritório configurado, tabela fora de TENANT_TABLES e GLOBAL_TABLES é
// recusada (falha fechada): tabela nova exige declaração e migração com RLS.
const GLOBAL_TABLES = new Set(['escritorios', 'usuarios', 'escritorio_membros']);

const TENANT_CONFLICTS = Object.freeze({
  config: {legacy:'chave', composite:'escritorio_id,chave'},
  configuracoes: {legacy:'chave', composite:'escritorio_id,chave'},
  whatsapp_recepcao_publica: {legacy:'numero', composite:'escritorio_id,numero'},
  clientes_pendentes: {legacy:'chat_id', composite:'escritorio_id,chat_id'},
  conversas: {legacy:'chat_id,thread_id', composite:'escritorio_id,chat_id,thread_id'},
  djen_comunicacoes: {legacy:'djen_id', composite:'escritorio_id,djen_id'},
  djen_sync_state: {legacy:'numero_oab,uf_oab', composite:'escritorio_id,numero_oab,uf_oab'},
  lex_status: {legacy:'agente_id', composite:'escritorio_id,agente_id'},
  memoria_casos: {legacy:'caso_id', composite:'escritorio_id,caso_id'},
  prazo_alertas: {legacy:'processo_id,due_at,marco', composite:'escritorio_id,processo_id,due_at,marco'},
  processos_cache: {legacy:'id', composite:'escritorio_id,id'},
  processos_sync: {legacy:'processo_id', composite:'escritorio_id,processo_id'},
  whatsapp_sessoes: {legacy:'numero', composite:'escritorio_id,numero'},
  memoria_checkpoints: {legacy:'task_id', composite:'escritorio_id,task_id'},
  arquivo_morto_indice: {legacy:'id_indice', composite:'escritorio_id,id_indice'}
});

function assertTableIsolated(table, tenantActive, tenantTables = TENANT_TABLES) {
  if (!tenantActive) return;
  const set = tenantTables instanceof Set ? tenantTables : new Set(tenantTables || []);
  if (!set.has(table) && !GLOBAL_TABLES.has(table)) {
    throw new Error(`Tabela sem isolamento por escritório: ${table}`);
  }
}

function normalizeTenantId(value) {
  const id = String(value || '').trim();
  if (!id) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('LEX_ESCRITORIO_ID invalido');
  }
  return id.toLowerCase();
}

function rewriteConflict(table, value) {
  if (!value || !TENANT_CONFLICTS[table]) return value;
  const normalized = String(value).split(',').map(v => v.trim()).filter(Boolean).join(',');
  const spec = TENANT_CONFLICTS[table];
  if (normalized === spec.legacy || normalized === spec.composite) return spec.composite;
  return value;
}

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

function createSupabaseRequest({
  url: baseUrl,
  key,
  https,
  timeoutMs = 15000,
  tenantId = process.env.LEX_ESCRITORIO_ID,
  tenancyRequired = process.env.LEX_TENANCY_REQUIRED === '1',
  tenantTables = TENANT_TABLES,
  databaseMode = process.env.LEX_DB_MODE || 'rest',
  databaseUrl = process.env.LEX_DATABASE_URL
}) {
  const mode=String(databaseMode||'rest').trim().toLowerCase();
  if(mode==='postgres'){
    const {createTenantPostgresRequest}=require('./postgres-tenant');
    return createTenantPostgresRequest({
      connectionString:databaseUrl,
      tenantId
    });
  }
  if(mode!=='rest') throw new Error('LEX_DB_MODE invalido');

  const resolvedTenant = normalizeTenantId(tenantId);
  const tenantTableSet = tenantTables instanceof Set ? tenantTables : new Set(tenantTables || []);

  return function request(method, table, data, query, extraHeaders) {
    return new Promise(resolve => {
      let settled = false;
      const done = result => { if (!settled) { settled = true; resolve(result); } };
      try {
        if (!baseUrl || !key) return done({ ok: false, status: 0, body: null });
        if (!/^[a-z_][a-z0-9_]*$/i.test(table)) throw new Error('Tabela invalida');

        const originalQuery = {...(query || {})};
        const modifiers = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);
        if (method === 'DELETE' && !Object.entries(originalQuery).some(([name, value]) =>
          !modifiers.has(name) && name !== 'escritorio_id' && value !== undefined && value !== null && String(value).trim()
        )) throw new Error('Exclusao sem filtro bloqueada');

        assertTableIsolated(table, !!resolvedTenant || tenancyRequired, tenantTableSet);
        const tenantScoped = tenantTableSet.has(table);
        let payload = data;
        const effectiveQuery = {...originalQuery};

        if (tenantScoped) {
          if (!resolvedTenant) {
            if (tenancyRequired) throw new Error(`Tenant obrigatorio para ${table}`);
          } else {
            if (effectiveQuery.escritorio_id && effectiveQuery.escritorio_id !== 'eq.' + resolvedTenant) {
              throw new Error('Tenant divergente na consulta');
            }

            if (method !== 'POST') effectiveQuery.escritorio_id = 'eq.' + resolvedTenant;
            if (effectiveQuery.on_conflict) effectiveQuery.on_conflict = rewriteConflict(table, effectiveQuery.on_conflict);

            if (payload != null && ['POST','PATCH','PUT'].includes(method)) {
              const inject = row => {
                if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Payload tenant invalido');
                if (row.escritorio_id && String(row.escritorio_id).toLowerCase() !== resolvedTenant) {
                  throw new Error('Tenant divergente no payload');
                }
                return {...row, escritorio_id: resolvedTenant};
              };
              payload = Array.isArray(payload) ? payload.map(inject) : inject(payload);
            }
          }
        }

        const entries = Object.entries(effectiveQuery).filter(([, value]) => value !== undefined && value !== null);
        const url = new URL(`${baseUrl}/rest/v1/${table}`);
        for (const [name, value] of entries) url.searchParams.set(name, value);
        const body = payload == null ? null : JSON.stringify(payload);
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
      } catch (error) {
        done({ok:false, status:0, body:null, erro:error.message});
      }
    });
  };
}

module.exports = {
  GLOBAL_TABLES,
  assertTableIsolated,
  TENANT_TABLES,
  TENANT_CONFLICTS,
  normalizeTenantId,
  createSupabaseRequest,
  requireSuccess,
  rowsFromResult
};
