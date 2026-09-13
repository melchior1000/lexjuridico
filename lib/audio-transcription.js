'use strict';

const https = require('node:https');

function safeFilename(name, mimeType) {
  const raw = String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  if (raw) return raw;
  const ext = String(mimeType || 'audio/ogg').split('/')[1]?.split(';')[0] || 'ogg';
  return 'audio.' + ext;
}

async function transcribeAudio(buffer, options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY || '';
  const mimeType = String(options.mimeType || 'audio/ogg').split(';')[0];
  const filename = safeFilename(options.filename, mimeType);
  const transport = options.transport || https;
  const timeoutMs = Number(options.timeoutMs || 45000);

  if (!apiKey) return {ok:false, texto:'', erro:'transcricao_indisponivel'};
  if (!Buffer.isBuffer(buffer) || !buffer.length) return {ok:false, texto:'', erro:'audio_vazio'};
  if (buffer.length > 25 * 1024 * 1024) return {ok:false, texto:'', erro:'audio_muito_grande'};

  const boundary = '----lexaudio' + Date.now().toString(16);
  const head = Buffer.from(
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="model"\r\n\r\n' +
    'whisper-1\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="file"; filename="' + filename + '"\r\n' +
    'Content-Type: ' + mimeType + '\r\n\r\n', 'utf8');
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8');
  const body = Buffer.concat([head, buffer, tail]);

  return await new Promise(resolve => {
    let settled = false;
    const done = value => { if (!settled) { settled = true; resolve(value); } };
    const req = transport.request({
      hostname:'api.openai.com', path:'/v1/audio/transcriptions', method:'POST',
      headers:{
        Authorization:'Bearer ' + apiKey,
        'Content-Type':'multipart/form-data; boundary=' + boundary,
        'Content-Length':body.length
      }
    }, res => {
      const chunks=[]; let size=0;
      res.on('data', c => {
        size += c.length;
        if (size > 1024 * 1024) { req.destroy(); done({ok:false,texto:'',erro:'resposta_excessiva'}); return; }
        chunks.push(Buffer.from(c));
      });
      res.on('end', () => {
        if (settled) return;
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          done({ok:false,texto:'',erro:'provedor_http_' + res.statusCode}); return;
        }
        try {
          const json=JSON.parse(raw);
          const texto=String(json.text || '').trim();
          done(texto ? {ok:true,texto} : {ok:false,texto:'',erro:'transcricao_vazia'});
        } catch { done({ok:false,texto:'',erro:'resposta_invalida'}); }
      });
      res.on('error', () => done({ok:false,texto:'',erro:'resposta_interrompida'}));
    });
    req.on('error', () => done({ok:false,texto:'',erro:'falha_rede'}));
    req.setTimeout(timeoutMs, () => { req.destroy(); done({ok:false,texto:'',erro:'timeout'}); });
    req.write(body); req.end();
  });
}

function audioPayloadFromEvolution(data) {
  const audio = data?.message?.audioMessage;
  if (!audio) return null;
  const base64 = audio.base64 || audio.audioBase64 || data?.base64 || '';
  if (!base64 || typeof base64 !== 'string') return {buffer:null,mimeType:audio.mimetype || 'audio/ogg',filename:'audio_whatsapp.ogg'};
  try {
    const buffer=Buffer.from(base64,'base64');
    return {buffer:buffer.length?buffer:null,mimeType:audio.mimetype || 'audio/ogg',filename:'audio_whatsapp.ogg'};
  } catch { return {buffer:null,mimeType:audio.mimetype || 'audio/ogg',filename:'audio_whatsapp.ogg'}; }
}

module.exports={transcribeAudio,audioPayloadFromEvolution};
