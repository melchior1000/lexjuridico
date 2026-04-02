const https = require('https');

const TELEGRAM_TOKEN = '8319651078:AAEMGKWSs67Q_8eRinbpVUs0OpHHtx9xwqM';
const CHAT_ID = '696337324';
const ANTHROPIC_KEY = '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';

let lastUpdateId = 0;

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(data); } });
    }).on('error', reject);
  });
}

function httpsPost(hostname, path, data, headers) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = { hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function enviar(chatId, texto, threadId) {
  const payload = { chat_id: chatId, text: texto.substring(0, 4000) };
  if (threadId) payload.message_thread_id = threadId;
  try {
    await httpsPost('api.telegram.org', `/bot${TELEGRAM_TOKEN}/sendMessage`, payload);
  } catch(e) { console.error('Erro envio:', e.message); }
}

async function baixarArquivo(fileId) {
  const info = await httpsGet(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  if (!info.ok) return null;
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${info.result.file_path}`, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function analisarPdf(base64) {
  const r = await httpsPost('api.anthropic.com', '/v1/messages', {
    model: 'claude-sonnet-4-20250514', max_tokens: 2000,
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
      { type: 'text', text: 'Leia TODO o PDF. Identifique: 1) Tipo do documento 2) Numero do processo 3) Partes 4) Resumo 5) Prazos criticos 6) Proxima acao recomendada. Responda em portugues, objetivamente.' }
    ]}]
  }, { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' });
  return r.content?.[0]?.text || 'Sem resposta.';
}

async function responderIA(pergunta) {
  const r = await httpsPost('api.anthropic.com', '/v1/messages', {
    model: 'claude-sonnet-4-20250514', max_tokens: 800,
    system: 'Voce e o Assessor Juridico IA de Kleuber Melchior de Souza, OAB/MG 118.237, Camargos Advocacia, Unai/MG.',
    messages: [{ role: 'user', content: pergunta }]
  }, { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' });
  return r.content?.[0]?.text || 'Sem resposta.';
}

async function processarMensagem(msg) {
  const chatId = String(msg.chat.id);
  const threadId = msg.message_thread_id || null;

  // Aceita mensagens do dono em qualquer contexto (direto ou topico)
  if (chatId !== CHAT_ID) return;

  console.log('MSG recebida:', msg.text || '[arquivo]', threadId ? '(topico '+threadId+')' : '');

  if (msg.document) {
    const doc = msg.document;
    const nome = doc.file_name || 'documento';
    if (doc.mime_type === 'application/pdf' || nome.toLowerCase().endsWith('.pdf')) {
      await enviar(chatId, 'Recebi ' + nome + '. Analisando... aguarde 20-30 segundos.', threadId);
      try {
        const buffer = await baixarArquivo(doc.file_id);
        const base64 = buffer.toString('base64');
        const analise = await analisarPdf(base64);
        await enviar(chatId, 'ANALISE - ' + nome + '\n\n' + analise, threadId);
      } catch(e) { await enviar(chatId, 'Erro: ' + e.message, threadId); }
      return;
    }
    await enviar(chatId, 'Envie em formato PDF (nao docx).', threadId);
    return;
  }

  if (!msg.text) return;
  const txt = msg.text.trim();
  const lower = txt.toLowerCase();

  if (lower === '/start' || lower === 'oi') {
    await enviar(chatId, 'Lex Bot ativo! Envie um PDF para analise automatica. Ou faca perguntas juridicas.', threadId);
    return;
  }
  if (lower === '/status') {
    await enviar(chatId, 'Bot ativo - IA configurada - ' + new Date().toLocaleString('pt-BR'), threadId);
    return;
  }

  await enviar(chatId, 'Pensando...', threadId);
  const resp = await responderIA(txt);
  await enviar(chatId, resp, threadId);
}

async function poll() {
  try {
    const data = await httpsGet(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${lastUpdateId+1}&timeout=30`);
    if (data.ok && data.result.length > 0) {
      for (const update of data.result) {
        lastUpdateId = update.update_id;
        if (update.message) await processarMensagem(update.message);
      }
    }
  } catch(e) { console.error('Polling erro:', e.message); }
  setTimeout(poll, 3000);
}

console.log('\nLEX BOT - Servidor Telegram');
console.log('Bot: @lex_alertas_bot | IA: OK\n');
enviar(CHAT_ID, 'Lex Bot reiniciado! Envie um PDF para analise.').then(() => poll());
