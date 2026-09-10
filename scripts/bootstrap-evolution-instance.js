const evolutionUrl = String(process.env.EVOLUTION_URL || '').replace(/\/$/, '');
const apiKey = String(process.env.EVOLUTION_KEY || '');
const instanceName = String(process.env.EVOLUTION_INSTANCE || 'LEX-JURIDICO');

async function request(path, options = {}) {
  const res = await fetch(`${evolutionUrl}${path}`, {
    ...options,
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
}

(async () => {
  if (!evolutionUrl || !apiKey) {
    console.log('[LEX Evolution] configuração ausente; bootstrap ignorado');
    return;
  }
  try {
    const fetchInstances = await request('/instance/fetchInstances');
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
      const safe = typeof created.body === 'string' ? created.body.slice(0, 500) : created.body;
      console.log('[LEX Evolution] resposta:', safe);
      process.exitCode = 0;
      return;
    }
    console.log(`[LEX Evolution] instância ${instanceName} criada`);
  } catch (error) {
    console.log(`[LEX Evolution] bootstrap falhou sem derrubar o LEX: ${error.message}`);
  }
})();
