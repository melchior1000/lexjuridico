'use strict';

// Ritmo das mensagens AUTOMÁTICAS do LEX no WhatsApp (lembretes ao cliente).
//
// Adaptado de DeskcommCRM (lib/agent-engine/pacing/engine.ts) — MIT, Copyright (c) 2026
// Rafael Melgaço (aviso completo da licença em THIRD_PARTY_NOTICES.md). Reescrito em
// CommonJS e ajustado ao escritório:
// - janela de horário (padrão 8h–20h, sem domingo, fuso de Brasília): ninguém recebe lembrete
//   do escritório de madrugada — é cortesia e também reduz denúncia de spam;
// - teto diário de mensagens automáticas por número do escritório (padrão 60);
// - intervalo mínimo entre automáticas, com variação aleatória (padrão 20 s + até 10 s):
//   rajada de mensagens é o padrão que mais derruba número na conexão não oficial.
// Resposta a quem acabou de escrever NÃO passa por aqui: é conversa, não disparo.
// Contador ilegível: na dúvida, não envia (o lembrete volta na próxima rodada).

const DEFAULTS = {janelaInicio: 8, janelaFim: 20, domingo: false, tetoDiario: 60,
  intervaloMs: 20000, variacaoMs: 10000, esperaMaximaMs: 60000, fuso: 'America/Sao_Paulo'};

function intEnv(value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

// LEX_WHATSAPP_JANELA=8-20 · LEX_WHATSAPP_DOMINGO=1 · LEX_WHATSAPP_TETO_DIARIO=60 ·
// LEX_WHATSAPP_INTERVALO_SEG=20
function configFromEnv(env = process.env) {
  const cfg = {...DEFAULTS};
  const m = String(env.LEX_WHATSAPP_JANELA || '').match(/^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/);
  if (m && Number(m[1]) < Number(m[2]) && Number(m[2]) <= 24) { cfg.janelaInicio = Number(m[1]); cfg.janelaFim = Number(m[2]); }
  cfg.domingo = env.LEX_WHATSAPP_DOMINGO === '1';
  cfg.tetoDiario = intEnv(env.LEX_WHATSAPP_TETO_DIARIO, DEFAULTS.tetoDiario, 1, 1000);
  cfg.intervaloMs = intEnv(env.LEX_WHATSAPP_INTERVALO_SEG, DEFAULTS.intervaloMs / 1000, 1, 50) * 1000;
  return cfg;
}

function relogio(now, fuso) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'}).formatToParts(now);
  const get = t => parts.find(p => p.type === t)?.value;
  return {dia: `${get('year')}-${get('month')}-${get('day')}`, hora: Number(get('hour')), minuto: Number(get('minute')),
    domingo: get('weekday') === 'Sun'};
}

// Horário de trabalho do escritório (mesma janela das automáticas): também usado para não
// mandar aviso ao titular de madrugada.
function dentroDaJanela(now, cfg = DEFAULTS) {
  const r = relogio(now, cfg.fuso);
  return !(r.domingo && !cfg.domingo) && r.hora >= cfg.janelaInicio && r.hora < cfg.janelaFim;
}

// Decisão pura (sem banco, sem relógio próprio): {ok:true, esperarMs} ou {ok:false, codigo, motivo}.
function decidePacing({now, cfg = DEFAULTS, enviadasHoje = 0, ultimoEnvioEm = null, random = Math.random}) {
  const r = relogio(now, cfg.fuso);
  if ((r.domingo && !cfg.domingo) || r.hora < cfg.janelaInicio || r.hora >= cfg.janelaFim) {
    return {ok: false, codigo: 'fora_da_janela',
      motivo: `fora do horário de mensagens automáticas (${cfg.janelaInicio}h–${cfg.janelaFim}h${cfg.domingo ? '' : ', sem domingo'}); sai na próxima rodada dentro do horário`};
  }
  if (enviadasHoje >= cfg.tetoDiario) {
    return {ok: false, codigo: 'teto_diario', motivo: `teto de ${cfg.tetoDiario} mensagens automáticas por dia atingido; sai amanhã`};
  }
  let esperarMs = 0;
  if (ultimoEnvioEm) {
    const intervalo = cfg.intervaloMs + Math.floor(random() * cfg.variacaoMs);
    esperarMs = Math.max(0, intervalo - (now.getTime() - new Date(ultimoEnvioEm).getTime()));
  }
  return {ok: true, esperarMs};
}

// Envio automático com ritmo. A vaga do dia é RESERVADA no banco antes de enviar (o contador
// gravado é a verdade, valendo entre reinícios e entre duas instâncias do servidor). Envio que
// falha depois da reserva conta assim mesmo: contar a mais é seguro, a menos não.
function createAutomaticSender({records = null, send, log = msg => console.warn(msg), cfg = configFromEnv(),
  now = () => new Date(), sleep = ms => new Promise(r => setTimeout(r, ms)), random = Math.random} = {}) {
  if (typeof send !== 'function') throw new Error('Envio automático requer função de envio.');
  const esperaMaxima = Math.max(cfg.esperaMaximaMs || 0, cfg.intervaloMs + cfg.variacaoMs);
  let memoria = {dia: null, enviadas: 0, ultimo_envio_em: null}; // só sem banco (testes)
  let fila = Promise.resolve();

  // Tenta reservar a vaga agora. {reservado:true} | {reservado:false, decisao}
  // `sorteio`: a mesma variação vale para todas as tentativas da MESMA mensagem (um sorteio
  // novo a cada tentativa poderia empurrar o lembrete para a próxima rodada sem motivo).
  async function reservar(momento, sorteio) {
    const dia = relogio(momento, cfg.fuso).dia;
    let decisao = null;
    const atualizar = old => {
      const enviadas = Math.max(Number(old?.enviadas) || 0, 0);
      decisao = decidePacing({now: momento, cfg, enviadasHoje: enviadas, ultimoEnvioEm: old?.ultimo_envio_em || null, random: () => sorteio});
      if (!decisao.ok || decisao.esperarMs > 0) return undefined;
      return {enviadas: enviadas + 1, ultimo_envio_em: momento.toISOString()};
    };
    if (!records) {
      if (memoria.dia !== dia) memoria = {dia, enviadas: 0, ultimo_envio_em: null};
      const next = atualizar(memoria);
      if (next) memoria = {dia, ...next};
      return {reservado: !!next, decisao};
    }
    await records.change('whatsapp_ritmo_' + dia, atualizar); // erro sobe: na dúvida, não envia
    return {reservado: decisao?.ok === true && decisao.esperarMs === 0, decisao};
  }

  async function enviarAgora(destino, texto, {podeEnviar} = {}) {
    const sorteio = random();
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      let r;
      try { r = await reservar(now(), sorteio); }
      catch (error) {
        log('[WhatsApp ritmo] contador indisponível; automática adiada: ' + (error?.message || error));
        return {enviado: false, codigo: 'contador_ilegivel', motivo: 'não consegui gravar o contador de mensagens automáticas; sai na próxima rodada'};
      }
      if (r.reservado) {
        // Última conferência antes de sair (ex.: o contato pediu para parar nesse meio tempo).
        if (typeof podeEnviar === 'function' && !(await podeEnviar())) return {enviado: false, codigo: 'bloqueado', motivo: 'contato não aceita mais mensagens automáticas'};
        let ok = false;
        // podeEnviar segue junto: o envio confere de novo depois de acordar a conexão.
        try { ok = (await send(destino, texto, {podeEnviar})) === true; } catch { ok = false; }
        return ok ? {enviado: true} : {enviado: false, tentado: true, codigo: 'envio_nao_confirmado', motivo: 'o WhatsApp não confirmou o envio'};
      }
      const d = r.decisao || {};
      if (!d.ok) return {enviado: false, codigo: d.codigo, motivo: d.motivo};
      if (d.esperarMs > esperaMaxima) break;
      await sleep(d.esperarMs); // depois da espera, confere de novo (janela, teto, outra instância)
    }
    return {enviado: false, codigo: 'ritmo', motivo: 'intervalo mínimo entre automáticas; sai na próxima rodada'};
  }

  function enviar(destino, texto, opcoes) {
    const resultado = fila.then(() => enviarAgora(destino, texto, opcoes));
    fila = resultado.catch(() => {});
    return resultado;
  }

  return {enviar};
}

module.exports = {DEFAULTS, configFromEnv, decidePacing, dentroDaJanela, createAutomaticSender};
