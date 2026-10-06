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

async function radarDaRecepcao({store, now = new Date(), limites = LIMITES, maxContatos = 200} = {}) {
  if (!store || typeof store.list !== 'function' || typeof store.history !== 'function') return [];
  const itens = [];
  // Começa pelo cursor '0': com cursor a lista vem em ordem de número, sem pular ninguém.
  let cursor = '0';
  while (itens.length < maxContatos) {
    const rows = await store.list({status: 'aguardando_advogado', limit: 100, afterNumero: cursor});
    const lista = Array.isArray(rows) ? rows : [];
    for (const row of lista) {
      if (!row?.numero || itens.length >= maxContatos) continue;
      const historico = await store.history(row.numero, {limit: 50});
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

// Aviso ao titular: cada espera crítica é avisada uma vez (até o escritório responder e o
// cliente voltar a esperar). Só dentro do horário de trabalho.
function createReceptionRadarAlerts({records, store, notify, now = () => new Date(), dentroDoHorario = () => true,
  limites = LIMITES, log = msg => console.warn(msg)} = {}) {
  const CHAVE = 'recepcao_radar_avisados';
  const memoria = new Map(); // reserva, se o banco falhar ao gravar: não repete no mesmo processo
  let emCurso = false;

  // É a MESMA espera já avisada enquanto o escritório não respondeu depois do aviso — mesmo
  // que o início calculado mude (histórico longo, formato de data).
  const mesmaEspera = (item, avisadoDesde) => {
    if (!avisadoDesde) return false;
    return !(item.ultima_resposta_em && Date.parse(item.ultima_resposta_em) > Date.parse(avisadoDesde));
  };

  async function executar() {
    if (emCurso) return {avisados: 0, motivo: 'em_curso'};
    emCurso = true;
    try {
      const agora = now();
      if (!dentroDoHorario(agora)) return {avisados: 0, motivo: 'fora_do_horario'};
      // Sem o banco, a fila vem só da memória do processo: incompleta e com datas diferentes.
      if (typeof store?.healthcheck === 'function' && !(await store.healthcheck())?.ok) return {avisados: 0, motivo: 'banco_indisponivel'};
      const radar = await radarDaRecepcao({store, now: agora, limites});
      let avisados = {};
      try { avisados = (await records.read(CHAVE))?.value?.itens || {}; }
      catch (error) { log('[Radar recepção] não consegui ler avisos anteriores: ' + (error?.message || error)); return {avisados: 0, motivo: 'leitura_indisponivel'}; }
      for (const [numero, desde] of memoria) if (!avisados[numero]) avisados[numero] = desde;
      const criticos = radar.filter(i => i.faixa === 'critico');
      const novos = criticos.filter(i => !mesmaEspera(i, avisados[i.numero]));
      // Guarda só quem ainda está esperando (a lista não cresce sem fim), mantendo a data do
      // primeiro aviso de quem continua na mesma espera.
      const ainda = Object.fromEntries(criticos.map(i => [i.numero, mesmaEspera(i, avisados[i.numero]) ? avisados[i.numero] : i.esperando_desde]));
      if (!novos.length) return {avisados: 0};
      const linhas = novos.slice(0, 15).map((i, n) => `${n + 1}. ${i.urgente ? '🔴 ' : ''}${String(i.nome).slice(0, 40)} (${i.numero}) — esperando ${textoEspera(i.minutos)}${i.ultima_mensagem ? ' — "' + i.ultima_mensagem.slice(0, 100) + '"' : ''}`);
      const extra = novos.length > 15 ? `\n…e mais ${novos.length - 15}.` : '';
      const texto = `[ATENÇÃO] Clientes esperando resposta do escritório há mais de ${Math.round(limites.criticoMin / 60)} h:\n${linhas.join('\n')}${extra}\n\nResponda pelo app (Mensagens) ou com /responder NÚMERO TEXTO.`;
      const ok = await notify(texto);
      if (!ok) return {avisados: 0, motivo: 'aviso_nao_confirmado'};
      for (const [numero, desde] of Object.entries(ainda)) memoria.set(numero, desde);
      for (const numero of [...memoria.keys()]) if (!ainda[numero]) memoria.delete(numero);
      try { await records.change(CHAVE, () => ({itens: ainda, atualizado_em: agora.toISOString()})); }
      catch (error) { log('[Radar recepção] aviso enviado, mas não gravado no banco: ' + (error?.message || error)); }
      return {avisados: novos.length};
    } finally { emCurso = false; }
  }
  return {executar};
}

module.exports = {LIMITES, faixaDeEspera, textoEspera, esperandoDesde, ultimaResposta, radarDaRecepcao, createReceptionRadarAlerts};
