const http = require('http');

const port = Number(process.env.PORT || 10000);
const evolutionUrl = String(process.env.EVOLUTION_URL || '').replace(/\/$/, '');
const apiKey = String(process.env.EVOLUTION_KEY || '');
const adminSecret = String(process.env.LEX_EVOLUTION_ADMIN_SECRET || '');

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function createInstance(req, res) {
  if (!evolutionUrl || !apiKey || !adminSecret) return json(res, 503, { ok:false, error:'Evolution não configurada' });
  if (req.headers['x-lex-admin-secret'] !== adminSecret) return json(res, 401, { ok:false, error:'Não autorizado' });

  const upstream = await fetch(`${evolutionUrl}/instance/create`, {
    method: 'POST',
    headers: { 'content-type':'application/json', apikey: apiKey },
    body: JSON.stringify({ instanceName:'LEX-JURIDICO', integration:'WHATSAPP-BAILEYS', qrcode:true })
  });
  const text = await upstream.text();
  res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8' });
  res.end(text);
}

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok:true });
    if (req.method === 'POST' && req.url === '/create') return await createInstance(req, res);
    return json(res, 404, { ok:false });
  } catch (e) {
    return json(res, 502, { ok:false, error: e.message });
  }
}).listen(port, '0.0.0.0', () => console.log(`[LEX Evolution Proxy] porta ${port}`));
