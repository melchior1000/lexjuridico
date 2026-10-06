'use strict';

// Radar da recepção: quem escreveu ao escritório e está esperando resposta de uma pessoa.
//
// Ideia inspirada no "Radar" do DeskcommCRM (lib/leads/risk-radar.ts — MIT); código próprio.
// A resposta automática do LEX ("recebi sua mensagem…") NÃO conta como resposta: a fila é
// de quem aguarda o advogado. Conta a partir da PRIMEIRA mensagem do cliente ainda sem
// resposta do escritório. Tudo é calculado do histórico gravado no banco, então sobrevive
// a reinício do servidor (antes os avisos de 5/15/30 min viviam em temporizadores na memória).

const LIMITES = {emRiscoMin: 60, criticoMin: 240};

function faixaDeEspera(minutos, limites = LIMITES) {
  if (minutos >= limites.criticoMin) return 'critico';
  if (minutos >= limites.emRiscoMin) return 'em_risco';
  return 'em_dia';
}

function textoEspera(minutos) {
  if (!Number.isFinite(Number(minutos))) return 'há tempo indeterminado';
  const m = Math.max(0, Math.floor(minutos));
  if (m < 60) return 'há ' + m + ' min';
  if (m < 48 * 60) return 'há ' + Math.floor(m / 60) + ' h';
  return 'há ' + Math.floor(m / 1440) + ' dias';
}

// history: mais recentes primeiro (como devolve o store). Devolve o instante desde quando o
// contato espera, ou null se a última palavra foi do escritório.
const iso = v => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

function linhaDoTempo(history) {
  return (Array.isArray(history) ? history : [])
    .map(e => ({...e, quando: iso(e?.criado_em)}))
    .filter(e => e.quando && ['entrada', 'saida_operador'].includes(e.direcao))
    .sort((a, b) => a.quando.localeCompare(b.quando));
}

// Devolve o instante (ISO) desde quando o contato espera, ou null se a última palavra foi do
// escritório.
function esperandoDesde(history) {
  let desde = null;
  for (const e of linhaDoTempo(history)) {
    if (e.direcao === 'saida_operador') desde = null;
    else if (!desde) desde = e.quando;
  }
  return desde;
}

function ultimaResposta(history) {
  const respostas = linhaDoTempo(history).filter(e => e.direcao === 'saida_operador');
  return respostas.length ? respostas.at(-1).quando : null;
}

// Histórico do contato até a última resposta do escritório (ou o começo), em páginas de 50.
// Leitura estrita: se o banco falhar, o erro sobe e a rodada inteira é abandonada.
async function historicoAteUltimaResposta(store, numero, maxPaginas = 10) {
  const eventos = [];
  let antes = '';
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const lote = await store.history(numero, {limit: 50, before: antes, strict: true});
    const lista = Array.isArray(lote) ? lote : [];
    eventos.push(...lista);
    if (lista.length < 50 || lista.some(e => e?.direcao === 'saida_operador')) break;
    antes = lista.at(-1)?.criado_em || '';
    if (!antes) break;
  }
  return eventos;
}

async function radarDaRecepcao({store, now = new Date(), limites = LIMITES, maxContatos = 200} = {}) {
  if (!store || typeof store.list !== 'function' || typeof store.history !== 'function') return [];
  const itens = [];
  // Começa pelo cursor '0': com cursor a lista vem em ordem de número, sem pular ninguém.
  let cursor = '0';
  while (itens.length < maxContatos) {
    const rows = await store.list({status: 'aguardando_advogado', limit: 100, afterNumero: cursor, strict: true});
    const lista = Array.isArray(rows) ? rows : [];
    for (const row of lista) {
      if (!row?.numero || itens.length >= maxContatos) continue;
      const historico = await historicoAteUltimaResposta(store, row.numero);
      const desde = esperandoDesde(historico);
      if (!desde) continue;
      const minutos = Math.max(0, (now.getTime() - Date.parse(desde)) / 60000);
      itens.push({numero: String(row.numero), nome: row.nome || 'Contato', ultima_mensagem: String(row.ultima_mensagem || '').slice(0, 120),
        urgente: !!row.urgente, esperando_desde: desde, ultima_resposta_em: ultimaResposta(historico),
        minutos: Math.floor(minutos), faixa: faixaDeEspera(minutos, limites)});
    }
    if (lista.length < 100) break;
    const next = String(lista.at(-1)?.numero || '').replace(/\D/g, '');
    if (!next || next === cursor) break;
    cursor = next;
  }
  return itens.sort((a, b) => b.minutos - a.minutos);
}

// Aviso ao titular: cada espera crítica é avisada uma vez POR CANAL (Telegram e WhatsApp têm
// controles separados: falha num não se perde no outro, e o que já recebeu não recebe de novo),
// até o escritório responder e o cliente voltar a esperar. Só no horário de trabalho.
// canais: () => ({telegram: async texto => bool, whatsapp: async texto => bool}).
// (notify: forma antiga, um canal só.)
const MAX_POR_AVISO = 15;
function createReceptionRadarAlerts({records, store, canais, notify, now = () => new Date(), dentroDoHorario = () => true,
  limites = LIMITES, log = msg => console.warn(msg)} = {}) {
  const listaDeCanais = () => (typeof canais === 'function' ? canais() : (notify ? {titular: notify} : {})) || {};
  const memoria = new Map(); // canal -> Map(numero -> desde): reserva se o banco falhar ao gravar
  let emCurso = false;

  // É a MESMA espera já avisada enquanto o escritório não respondeu depois do aviso — mesmo
  // que o início calculado mude (histórico longo, formato de data).
  const mesmaEspera = (item, avisadoDesde) => {
    if (!avisadoDesde) return false;
    return !(item.ultima_resposta_em && Date.parse(item.ultima_resposta_em) > Date.parse(avisadoDesde));
  };

  async function avisarCanal(canal, enviar, criticos, agora) {
    const chave = 'recepcao_radar_avisados_' + canal;
    let avisados = {};
    try { avisados = (await records.read(chave))?.value?.itens || {}; }
    catch (error) { log('[Radar recepção] ' + canal + ': não consegui ler avisos anteriores: ' + (error?.message || error)); return 0; }
    const reserva = memoria.get(canal) || new Map();
    memoria.set(canal, reserva);
    // A reserva em memória é mais nova que o banco: prevalece para o mesmo contato.
    for (const [numero, desde] of reserva) avisados[numero] = desde;
    const novos = criticos.filter(i => !mesmaEspera(i, avisados[i.numero]));
    // Mantém quem continua na mesma espera; guarda só quem ainda está esperando.
    const ainda = Object.fromEntries(criticos.filter(i => mesmaEspera(i, avisados[i.numero])).map(i => [i.numero, avisados[i.numero]]));
    if (!novos.length) return 0;
    // Só os nomeados no aviso contam como avisados; o resto entra na próxima rodada.
    const nomeados = novos.slice(0, MAX_POR_AVISO);
    const linhas = nomeados.map((i, n) => `${n + 1}. ${i.urgente ? '🔴 ' : ''}${String(i.nome).slice(0, 40)} (${i.numero}) — esperando ${textoEspera(i.minutos)}${i.ultima_mensagem ? ' — "' + i.ultima_mensagem.slice(0, 100) + '"' : ''}`);
    const extra = novos.length > MAX_POR_AVISO ? `\n…e mais ${novos.length - MAX_POR_AVISO} (no próximo aviso).` : '';
    const texto = `[ATENÇÃO] Clientes esperando resposta do escritório há mais de ${Math.round(limites.criticoMin / 60)} h:\n${linhas.join('\n')}${extra}\n\nResponda pelo app (Mensagens) ou com /responder NÚMERO TEXTO.`;
    const ok = await Promise.resolve(enviar(texto)).catch(() => false);
    if (ok !== true) { log('[Radar recepção] ' + canal + ': aviso não confirmado; tenta na próxima rodada'); return 0; }
    for (const i of nomeados) { ainda[i.numero] = i.esperando_desde; reserva.set(i.numero, i.esperando_desde); }
    for (const numero of [...reserva.keys()]) if (!ainda[numero]) reserva.delete(numero);
    try { await records.change(chave, () => ({itens: ainda, atualizado_em: agora.toISOString()})); }
    catch (error) { log('[Radar recepção] ' + canal + ': aviso enviado, mas não gravado no banco: ' + (error?.message || error)); }
    return nomeados.length;
  }

  async function executar() {
    if (emCurso) return {avisados: 0, motivo: 'em_curso'};
    emCurso = true;
    try {
      const agora = now();
      if (!dentroDoHorario(agora)) return {avisados: 0, motivo: 'fora_do_horario'};
      if (typeof store?.healthcheck === 'function' && !(await store.healthcheck())?.ok) return {avisados: 0, motivo: 'banco_indisponivel'};
      let radar;
      // Leitura estrita: banco falhou no meio da varredura = rodada abandonada (nada de fila parcial).
      try { radar = await radarDaRecepcao({store, now: agora, limites}); }
      catch (error) { log('[Radar recepção] leitura da fila falhou; rodada abandonada: ' + (error?.message || error)); return {avisados: 0, motivo: 'banco_indisponivel'}; }
      const criticos = radar.filter(i => i.faixa === 'critico');
      const porCanal = {};
      for (const [canal, enviar] of Object.entries(listaDeCanais())) porCanal[canal] = await avisarCanal(canal, enviar, criticos, agora);
      return {avisados: Math.max(0, ...Object.values(porCanal)), por_canal: porCanal};
    } finally { emCurso = false; }
  }
  return {executar};
}

module.exports = {LIMITES, faixaDeEspera, textoEspera, esperandoDesde, ultimaResposta, radarDaRecepcao, createReceptionRadarAlerts};
