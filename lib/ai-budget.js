'use strict';

// Teto de gasto de IA do escritório, por mês.
//
// Ideia inspirada no orçamento por organização do DeskcommCRM
// (lib/agent-engine/edge/llm/orcamento.ts — MIT): avisar antes de bloquear e, na dúvida,
// deixar seguir. Código próprio, apoiado na medição de lib/ai-usage.js.
//
// LEX_IA_TETO_MENSAL_USD  valor do teto em dólares (vazio = sem teto)
// LEX_IA_TETO_MODO        "aviso" (padrão: só avisa) ou "bloqueio" (para a IA ao atingir)
//
// Avisa o titular ao chegar a 80% e a 100% (uma vez por mês cada). No modo bloqueio, ao
// atingir 100% liga o mesmo modo "sem IA" que já existe para crédito zerado
// (LEX_AI_NO_CREDIT): o LEX continua operando prazos, intimações e a fila pelo executor, e
// diz com clareza por que está sem IA. Desliga sozinho na virada do mês, se o teto subir ou
// se o modo voltar a "aviso". Nunca desliga um modo sem IA que não foi ele que ligou.
// A conferência roda a cada 5 min: o gasto pode passar um pouco do teto antes do bloqueio.

const {monthOf} = require('./ai-usage');

function lerConfig(env = process.env) {
  const teto = Number(String(env.LEX_IA_TETO_MENSAL_USD || '').replace(',', '.'));
  return {teto: Number.isFinite(teto) && teto > 0 ? teto : null, modo: env.LEX_IA_TETO_MODO === 'bloqueio' ? 'bloqueio' : 'aviso'};
}

// Decisão pura. avisos = {oitenta:bool, cem:bool} já enviados neste mês.
function decidirOrcamento({gasto, teto, modo = 'aviso', avisos = {}}) {
  if (!teto) return {acao: 'sem_teto', bloquear: false};
  const fracao = (Number(gasto) || 0) / teto;
  const bloquear = modo === 'bloqueio' && fracao >= 1;
  if (fracao >= 1 && !avisos.cem) return {acao: 'avisar_cem', bloquear, fracao};
  if (fracao >= 0.8 && fracao < 1 && !avisos.oitenta) return {acao: 'avisar_oitenta', bloquear, fracao};
  return {acao: 'nada', bloquear, fracao};
}

const dolar = v => 'US$ ' + (Math.round((Number(v) || 0) * 100) / 100).toFixed(2).replace('.', ',');

function createAiBudgetGuard({summary, records = null, notify = async () => true, env = process.env,
  now = () => new Date(), log = msg => console.warn(msg), provider = () => 'anthropic'} = {}) {
  let ligouSemIA = false; // só desliga o que ele mesmo ligou
  const avisadosAqui = new Set(); // reserva se o banco falhar: não repete aviso no mesmo processo

  async function verificar() {
    const {teto, modo} = lerConfig(env);
    const mes = monthOf(now());
    // O custo só é calculado para a Anthropic (preços conferidos): com outro provedor o teto
    // não teria como valer, então não se promete nada.
    if (teto && provider() !== 'anthropic') return {acao: 'provedor_sem_preco'};
    let consumo;
    try { consumo = await summary(mes); }
    catch (error) { log('[IA teto] consumo indisponível: ' + (error?.message || error)); return {acao: 'consumo_indisponivel'}; }
    // Banco de consumo ilegível: na dúvida, não bloqueia nem libera por conta própria.
    if (consumo?.leitura_indisponivel) return {acao: 'consumo_indisponivel'};
    const gasto = Number(consumo?.total?.custo_usd) || 0;
    const chave = 'ia_teto_avisos_' + mes;
    let avisos = {};
    if (records) { try { avisos = (await records.read(chave))?.value || {}; } catch { avisos = {}; } }
    if (avisadosAqui.has(mes + ':oitenta')) avisos.oitenta = true;
    if (avisadosAqui.has(mes + ':cem')) avisos.cem = true;
    const d = decidirOrcamento({gasto, teto, modo, avisos});

    if (d.acao === 'avisar_oitenta' || d.acao === 'avisar_cem') {
      const texto = d.acao === 'avisar_oitenta'
        ? `⚠️ A IA do LEX já gastou ${dolar(gasto)} este mês: 80% do teto de ${dolar(teto)}.${modo === 'bloqueio' ? ' Ao chegar a 100% a IA para até o próximo mês (ou até o teto subir).' : ''}`
        : `🛑 A IA do LEX atingiu o teto do mês: ${dolar(gasto)} de ${dolar(teto)}.${modo === 'bloqueio' ? ' A IA está pausada até o próximo mês; prazos, intimações e a fila seguem pelo executor. Para liberar, aumente LEX_IA_TETO_MENSAL_USD.' : ' O modo é só aviso: a IA continua funcionando.'}`;
      const ok = await notify(texto).catch(() => false);
      const campo = d.acao === 'avisar_oitenta' ? 'oitenta' : 'cem';
      if (ok) avisadosAqui.add(mes + ':' + campo);
      if (ok && records) {
        try { await records.change(chave, old => ({...(old || {}), [campo]: true, [campo + '_em']: now().toISOString()})); }
        catch (error) { log('[IA teto] aviso enviado, mas não gravado: ' + (error?.message || error)); }
      }
    }

    if (d.bloquear && env.LEX_AI_NO_CREDIT !== '1') {
      env.LEX_AI_NO_CREDIT = '1';
      env.LEX_AI_SEM_IA_MOTIVO = 'teto';
      ligouSemIA = true;
      log('[IA teto] teto mensal atingido; LEX em modo sem IA até o próximo mês ou até o teto subir.');
    } else if (!d.bloquear && ligouSemIA && env.LEX_AI_SEM_IA_MOTIVO === 'teto') {
      delete env.LEX_AI_NO_CREDIT;
      delete env.LEX_AI_SEM_IA_MOTIVO;
      ligouSemIA = false;
      log('[IA teto] teto liberado; modo sem IA desligado.');
      await notify('✅ A IA do LEX voltou: o gasto do mês está abaixo do teto.').catch(() => false);
    }
    return {acao: d.acao, bloqueada: env.LEX_AI_SEM_IA_MOTIVO === 'teto', gasto, teto, modo};
  }

  function estado() {
    const {teto, modo} = lerConfig(env);
    return {teto_mensal_usd: teto, modo, bloqueada_por_teto: env.LEX_AI_SEM_IA_MOTIVO === 'teto',
      vale_para_provedor: provider() === 'anthropic'};
  }

  return {verificar, estado};
}

// Trava no ponto de saída de TODA chamada de IA: com a IA pausada pelo teto nada é gasto
// (só a sonda de crédito passa). A transcrição de áudio e a leitura de imagem de cliente
// também passam pela trava: com teto atingido, o LEX não ouve áudio nem lê imagem por IA.
function aiBloqueadaPorTeto(env = process.env) { return env.LEX_AI_SEM_IA_MOTIVO === 'teto'; }
function erroTetoAtingido() {
  return Object.assign(new Error('IA pausada: teto mensal de gasto do escritório atingido.'), {code: 'LEX_AI_BUDGET'});
}

module.exports = {lerConfig, decidirOrcamento, createAiBudgetGuard, aiBloqueadaPorTeto, erroTetoAtingido};
