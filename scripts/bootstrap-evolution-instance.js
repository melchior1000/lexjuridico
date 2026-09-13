const {url:evolutionUrl, key:apiKey, instance:instanceName} = require('../lib/evolution-config').evolutionConfig();

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`${evolutionUrl}${path}`, {
      ...options,
      signal: controller.signal,
      redirect: 'error',
      headers: {
        ...(options.headers || {}),
        apikey: apiKey,
        'content-type': 'application/json',
      },
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

// Apenas categorias conhecidas: o corpo pode conter segredos em qualquer campo.
function safeBody(body) {
  let text;
  try { text = typeof body === 'string' ? body : JSON.stringify(body); }
  catch { return 'resposta_nao_serializavel'; }
  if (/Cannot read properties of undefined.*reading ['"]state['"]/.test(text || '')) return 'auth_state_indisponivel';
  return 'detalhes_omitidos';
}

(async () => {
  if (!evolutionUrl || !apiKey) {
    console.log(`[LEX Evolution] configuração ausente; url=${!!evolutionUrl} chave=${!!apiKey}; bootstrap ignorado`);
    return;
  }
  try {
    const fetchInstances = await request('/instance/fetchInstances');
    if (!fetchInstances.ok) {
      console.log(`[LEX Evolution] listar instâncias: HTTP ${fetchInstances.status}; resposta=${safeBody(fetchInstances.body)}; criação cancelada`);
      return;
    }
    if (!Array.isArray(fetchInstances.body)) {
      console.log(`[LEX Evolution] lista de instâncias inválida; resposta=${safeBody(fetchInstances.body)}; criação cancelada`);
      return;
    }
    const list = fetchInstances.body;
    const exists = list.some((item) => {
      const name = item?.name || item?.instance?.instanceName || item?.instanceName;
      return String(name || '') === instanceName;
    });
    if (exists) {
      console.log(`[LEX Evolution] instância ${instanceName} já existe`);
      return;
    }

    const created = await request('/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
      }),
    });

    console.log(`[LEX Evolution] criar ${instanceName}: HTTP ${created.status}`);
    if (!created.ok) {
      console.log(`[LEX Evolution] criação recusada; resposta=${safeBody(created.body)}`);
      return;
    }
    console.log(`[LEX Evolution] instância ${instanceName} criada`);
  } catch (error) {
    const reason = error && error.name === 'AbortError' ? 'timeout de 25s' : 'falha de rede ou resposta inválida';
    console.log(`[LEX Evolution] bootstrap falhou sem derrubar o LEX: ${reason}`);
  }
})();
