'use strict';
const {withProcessLock} = require('./process-lock');
const {rowsFromResult} = require('./supabase');
function cnjDigits(value) {
  const text = String(value || '').trim();
  if (!/^[\d.\-\s]+$/.test(text)) return null;
  const digits = text.replace(/\D/g, '');
  return digits.length === 20 ? digits : null;
}
// Recebe somente movimentos de um conector autenticado. Não calcula prazo legal.
async function applyPjeMovement({processos, sbReq, onPersisted, origem='pje'}, dados) {
  const cnj = cnjDigits(dados && dados.cnj);
  if (!cnj) throw new Error('Informe o número CNJ completo.');
  const texto = String(dados.andamento_texto || '').trim();
  const data = String(dados.data || '').trim();
  if (!texto || texto.length > 20000 || !data || data.length > 40) throw new Error('Andamento sem texto ou data válidos.');
  const matches = processos.filter(p => cnjDigits(p.numero) === cnj);
  if (matches.length !== 1) throw new Error(matches.length ? 'CNJ duplicado no LEX; revise o cadastro.' : 'CNJ não cadastrado no LEX.');
  const id = matches[0].id;
  return withProcessLock(processos, id, async () => {
    const index = processos.findIndex(p => String(p.id) === String(id));
    const atual = processos[index];
    if (!atual || cnjDigits(atual.numero) !== cnj) throw new Error('Cadastro alterado durante a importação.');
    const andamentos = Array.isArray(atual.andamentos) ? atual.andamentos : [];
    const fonte = origem === 'datajud' ? 'datajud' : 'pje';
    const txt = (fonte === 'pje' ? '[PJe] ' : '[DATAJUD] ') + texto;
    if (andamentos.some(a => a.data === data && a.txt === txt)) return {sucesso:true, duplicado:true, processo:atual};
    const novo = {...atual, andamentos:[{data, txt, origem:fonte, cnj, importado_em:new Date().toISOString()}, ...andamentos]};
    const result = await sbReq('PATCH', 'processos', {andamentos:JSON.stringify(novo.andamentos)}, {id:'eq.'+id}, {'Prefer':'return=representation'});
    const rows = rowsFromResult(result, 'Importar andamento PJe');
    if (!rows.some(p => String(p.id) === String(id))) throw new Error('Banco não confirmou o cadastro atualizado.');
    processos[index] = novo;
    if (onPersisted) onPersisted();
    return {sucesso:true, duplicado:false, processo:novo};
  });
}
module.exports = {cnjDigits, applyPjeMovement};
