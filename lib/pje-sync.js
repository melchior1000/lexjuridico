'use strict';
const {withProcessLock} = require('./process-lock');
const {rowsFromResult} = require('./supabase');
const {createReadingLogEntry}=require('./reading-log-schema');
function cnjDigits(value) {
  const text = String(value || '').trim();
  if (!/^[\d.\-\s]+$/.test(text)) return null;
  const digits = text.replace(/\D/g, '');
  return digits.length === 20 ? digits : null;
}
function trustedPjeProvenance(value){
  if(!value||value.authenticated!==true)throw new Error('PJe sem proveniência autenticada pelo servidor.');
  if(!value.endpoint||!value.request_id||!value.timestamp_requisicao||!value.timestamp_resposta||!value.raw_receipt)throw new Error('PJe sem recibo/proveniência completa.');
  return value;
}
// Recebe somente movimentos de um conector autenticado. Não calcula prazo legal.
async function applyPjeMovement({processos, sbReq, onPersisted, origem='pje', trustedProvenance}, dados) {
  const cnj = cnjDigits(dados && dados.cnj);
  if (!cnj) throw new Error('Informe o número CNJ completo.');
  const texto = String(dados.andamento_texto || '').trim();
  const data = String(dados.data || '').trim();
  if (!texto || texto.length > 20000 || !data || data.length > 40) throw new Error('Andamento sem texto ou data válidos.');
  const fonte = origem === 'datajud' ? 'datajud' : 'pje';
  const provenance=fonte==='pje'?trustedPjeProvenance(trustedProvenance):trustedProvenance;
  const matches = processos.filter(p => cnjDigits(p.numero) === cnj);
  if (matches.length !== 1) throw new Error(matches.length ? 'CNJ duplicado no LEX; revise o cadastro.' : 'CNJ não cadastrado no LEX.');
  const id = matches[0].id;
  return withProcessLock(processos, id, async () => {
    const index = processos.findIndex(p => String(p.id) === String(id));
    const atual = processos[index];
    if (!atual || cnjDigits(atual.numero) !== cnj) throw new Error('Cadastro alterado durante a importação.');
    const andamentos = Array.isArray(atual.andamentos) ? atual.andamentos : [];
    const txt = (fonte === 'pje' ? '[PJe] ' : '[DATAJUD] ') + texto;
    if (andamentos.some(a => a.data === data && a.txt === txt)) return {sucesso:true, duplicado:true, processo:atual};
    const observedAt=String(provenance?.timestamp_resposta||new Date().toISOString());
    const reading=fonte==='pje'?createReadingLogEntry({
      processo:cnj,process_id:id,source:'pje',observed_at:observedAt,ok:true,
      proveniencia:{conector:'lib/pje-sync',endpoint:String(provenance.endpoint),request_id:String(provenance.request_id),authenticated:true,timestamp_requisicao:String(provenance.timestamp_requisicao),timestamp_resposta:String(provenance.timestamp_resposta)},
      query_context:{cnj,data_informada:data,tipo_operacao:String(provenance.tipo_operacao||'pje_authenticated_import')},
      raw_receipt:String(provenance.raw_receipt),content_type:String(provenance.content_type||'application/octet-stream'),
      metadata:{provenance_type:String(provenance.tipo_operacao||'pje_authenticated_import')},movimentos_encontrados:1,ultimo_movimento:{data,texto},sincronizado:true,movement_received:true
    }):null;
    const readings=Array.isArray(atual.court_readings)?atual.court_readings:[];
    const novo = {...atual, andamentos:[{data, txt, origem:fonte, cnj, importado_em:observedAt}, ...andamentos],court_readings:reading?[reading,...readings].slice(0,50):readings};
    const patch={andamentos:JSON.stringify(novo.andamentos)};
    if(reading)patch.court_readings=JSON.stringify(novo.court_readings);
    const result = await sbReq('PATCH', 'processos', patch, {id:'eq.'+id}, {'Prefer':'return=representation'});
    const rows = rowsFromResult(result, 'Importar andamento PJe');
    if (!rows.some(p => String(p.id) === String(id))) throw new Error('Banco não confirmou o cadastro atualizado.');
    processos[index] = novo;
    if (onPersisted) onPersisted();
    return {sucesso:true, duplicado:false, processo:novo,reading_id:reading?.reading_id||null};
  });
}
module.exports = {cnjDigits, trustedPjeProvenance, applyPjeMovement};
