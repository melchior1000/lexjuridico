(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LexWorkflow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const CLOSED = new Set(['CONCLUIDO','ENTREGUE','ARQUIVADO','GANHO','PERDIDO']);
  const PREP = new Set(['EM_PREP','PRONTO','AGUARDANDO_APROVACAO']);
  const status = p => String(p.status || 'ATIVO').toUpperCase();
  function sector(p) {
    if (CLOSED.has(status(p))) return 'concluidos';
    if (PREP.has(status(p))) return 'autuacao';
    // Um registro distribuído não continua na autuação por causa de um campo antigo.
    if (p.setor === 'autuacao' && status(p) !== 'DISTRIBUIDO') return 'autuacao';
    return p.setor === 'administrativo' || p.tipo === 'administrativo' ? 'administrativo' : 'judicial';
  }
  function array(value) {
    if (Array.isArray(value)) return value;
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  function date(value) {
    let s = String(value || '').trim();
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) s = br[3]+'-'+br[2]+'-'+br[1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(s+'T12:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === s ? s : null;
  }
  function summary(processes, preparations = []) {
    const rows = new Map(array(processes).map(p => [String(p.id), p]));
    for (const p of array(preparations)) if (!rows.has(String(p.id))) rows.set(String(p.id), {...p, setor:'autuacao'});
    const counts = {total:rows.size, autuacao:0, judicial:0, administrativo:0, concluidos:0, urgentes:0, distribuidos:0};
    for (const p of rows.values()) {
      counts[sector(p)]++;
      if (!CLOSED.has(status(p)) && status(p) === 'URGENTE') counts.urgentes++;
      if (status(p) === 'DISTRIBUIDO') counts.distribuidos++;
    }
    return counts;
  }
  function distribute(current, request, now = new Date().toISOString()) {
    const target = request.setor;
    if (!['judicial','administrativo','entregue'].includes(target)) throw new Error('Setor de destino inválido.');
    const num = String(request.numero || current.numero || '').trim();
    if (target !== 'entregue' && !num) throw new Error('Informe o número de distribuição ou protocolo confirmado.');
    if (target === 'judicial' && !/^\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}$/.test(num)) throw new Error('Informe o número CNJ completo.');
    if (sector(current) !== 'autuacao') {
      if (current.numero === num && (current.setor === target || (target === 'entregue' && status(current) === 'ENTREGUE'))) return current;
      throw new Error('O caso já saiu da preparação. Atualize a tela antes de alterar o destino.');
    }
    const record = {...current, numero:num, tipo:target === 'administrativo' ? 'administrativo' : 'judicial',
      setor:target === 'administrativo' ? target : 'judicial', status:target === 'entregue' ? 'ENTREGUE' : 'DISTRIBUIDO',
      atualizado_em:now, ultima_atualizacao:now, dias_parado:0,
      proxacao:target === 'entregue' ? 'Entrega concluída' : 'Acompanhar processo distribuído',
      andamentos:[{id:'distribuicao:'+current.id, data:now.slice(0,10), texto:'Distribuição confirmada para '+target+'; protocolo '+num, origem:'advogado'}, ...array(current.andamentos)]};
    // Baixa apenas lembretes da preparação; prazo processual permanece até cumprimento explícito.
    record.lembretes = array(current.lembretes).map(l => ['preparacao','distribuicao'].includes(l.tipo) ? {...l,status:'concluido',concluido_em:now} : l);
    return record;
  }
  function reconcileCalendar(events, preparations) {
    const result = {};
    for (const [day, rows] of Object.entries(events || {})) {
      const kept = array(rows).filter(e => e.prepId == null);
      if (kept.length) result[day] = kept;
    }
    for (const p of preparations) {
      const day = date(p.previsao);
      if (!day || CLOSED.has(status(p))) continue;
      (result[day] ||= []).push({titulo:'[PREP] '+p.nome, tipo:'prazo_entrega', obs:'Em preparação', prepId:p.id, cor:p.status === 'URGENTE' ? '#e84545' : '#9b6ef7'});
    }
    return result;
  }
  function validatePatch(patch) {
    for (const field of ['prazo','prazoReal']) if (patch[field] && !date(patch[field])) throw new Error('Data inválida em '+field+'.');
    if (patch.setor && !['autuacao','judicial','administrativo'].includes(patch.setor)) throw new Error('Setor inválido.');
    if (patch.status && !['URGENTE','ATIVO','DISTRIBUIDO','MONITORAR','AGUARDANDO','VENCIDO','CONCLUIDO','ENTREGUE','ARQUIVADO','EM_PREP','GANHO','PERDIDO','RECURSAL','PRONTO','AGUARDANDO_APROVACAO'].includes(patch.status)) throw new Error('Status inválido.');
    return patch;
  }
  function completeReminders(current, reminderIds, now = new Date().toISOString()) {
    const ids = new Set(array(reminderIds).map(id => String(id || '').trim()).filter(Boolean));
    if (!ids.size) throw new Error('Informe ao menos um lembrete para concluir.');
    let completed = 0;
    const reminders = array(current.lembretes).map(reminder => {
      const id = String(reminder?.id || '').trim();
      if (!id || !ids.has(id) || reminder.status === 'concluido') return reminder;
      completed++;
      return {...reminder, status:'concluido', concluido_em:now, concluido_por:'confirmacao_explicita'};
    });
    if (!completed) throw new Error('Nenhum lembrete pendente corresponde à seleção. Atualize a tela.');
    return {lembretes:reminders, lembretes_concluidos:completed, atualizado_em:now};
  }
  return {CLOSED, PREP, sector, summary, distribute, reconcileCalendar, completeReminders, array, date, validatePatch};
});
