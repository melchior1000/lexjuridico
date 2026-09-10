const evolutionUrl = String(
  process.env.EVOLUTION_URL || process.env.EVO_URL || ''
).replace(/\/$/, '');
const apiKey = String(
  process.env.EVOLUTION_KEY || process.env.EVO_KEY || ''
);
const instanceName = String(
  process.env.EVOLUTION_INSTANCE || process.env.EVO_INSTANCE || process.env.EVO_INST || 'LEX-JURIDICO'
);

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`${evolutionUrl}${path}`, {
      ...options,
      signal: controller.signal,
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

(async () => {
  if (!evolutionUrl || !apiKey) {
    console.log(`[LEX Evolution] configuração ausente; url=${!!evolutionUrl} chave=${!!apiKey}; bootstrap ignorado`);
    return;
  }
  try {
    const fetchInstances = await request('/instance/fetchInstances');
    if (!fetchInstances.ok) {
      console.log(`[LEX Evolution] listar instâncias: HTTP ${fetchInstances.status}`);
    }
    const list = Array.isArray(fetchInstances.body) ? fetchInstances.body : [];
    const exists = list.some((item) => {
      const name = item?.name || item?.instance?.instanceName || item?.instanceName;
      return String(name || '').toLowerCase() === instanceName.toLowerCase();
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
      const safe = typeof created.body === 'string'
        ? created.body.slice(0, 500)
        : created.body;
      console.log('[LEX Evolution] resposta:', safe);
      return;
    }
    console.log(`[LEX Evolution] instância ${instanceName} criada`);
  } catch (error) {
    const reason = error && error.name === 'AbortError' ? 'timeout de 25s' : (error?.message || String(error));
    console.log(`[LEX Evolution] bootstrap falhou sem derrubar o LEX: ${reason}`);
  }
})();
