'use strict';
const crypto=require('node:crypto');
const {rowsFromResult}=require('./supabase');
const {createReadingLogEntry}=require('./reading-log-schema');
const {hasCnj}=require('./pje-sync');
const {mintDeadlineTruth,isLegalTruth}=require('./deadline-truth');
const DeadlineSuggestion=require('./deadline-suggestion');
const PrazosAbertos=require('./prazos-abertos');

const DEFAULT_AUTH_MAX_AGE_MS=36*60*60*1000;

function civilDateSP(value){
  const text=String(value||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(text)){
    const [year,month,day]=text.split('-').map(Number),d=new Date(Date.UTC(year,month-1,day,12));
    if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)throw new Error('Prazo final inválido.');
    return text;
  }
  const ms=Date.parse(text);
  if(!Number.isFinite(ms))throw new Error('Prazo final inválido.');
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date(ms));
}
async function getCommunication(sbReq,djenId){
  const id=String(djenId||'').trim();
  if(!id)throw new Error('Informe a comunicação DJEN.');
  const rows=rowsFromResult(await sbReq('GET','djen_comunicacoes',null,{djen_id:'eq.'+id,limit:'2'}),'Ler comunicação DJEN');
  if(rows.length!==1)throw Object.assign(new Error(rows.length?'Comunicação DJEN duplicada.':'Comunicação DJEN não encontrada.'),{status:rows.length?409:404});
  return rows[0];
}
function readingFromCommunication(row,{integrityKey}={}){
  if(!row||row.status!=='casada'||!row.processo_id)throw new Error('A comunicação ainda não está vinculada a um único processo.');
  if(!row.cnj)throw new Error('A comunicação DJEN não possui CNJ válido.');
  if(!row.endpoint||!row.request_id||!row.requisitado_em||!row.observado_em)throw new Error('A comunicação DJEN não possui proveniência completa.');
  if(row.motivo_cancelamento)throw new Error('Comunicação DJEN cancelada; prazo não pode ser cunhado.');
  const raw=String(row.raw_receipt||'');
  if(!raw)throw new Error('A comunicação DJEN não possui recibo original auditável.');
  return createReadingLogEntry({
    processo:String(row.cnj),process_id:String(row.processo_id),source:'djen',
    observed_at:row.observado_em,ok:true,status_code:200,
    proveniencia:{
      conector:'lib/djen',endpoint:String(row.endpoint),request_id:String(row.request_id),authenticated:true,
      timestamp_requisicao:row.requisitado_em,timestamp_resposta:row.observado_em
    },
    query_context:{source_ref:String(row.djen_id),numero_oab:String(row.numero_oab||''),uf_oab:String(row.uf_oab||''),receipt_item_key:String(row.receipt_item_key||row.djen_id),receipt_page:Number(row.receipt_page)||null},
    raw_receipt:raw,sincronizado:true,explicit_no_change:false,movement_received:true,
    movimentos_encontrados:1,ultimo_movimento:{djen_id:String(row.djen_id),data:row.data_disponibilizacao||null,tipo:row.tipo||null}
  },{integrityKey});
}
async function confirmDjenDeadline({processStore,sbReq,djenId,dueAt,humanId,regime='manual',note='',suggestionSourceHash=null,integrityKey,maxAgeMs=DEFAULT_AUTH_MAX_AGE_MS,now=new Date(),refreshCommunication=null}={}){
  if(!processStore?.mutate||typeof sbReq!=='function')throw new Error('Persistência de prazo indisponível.');
  const human=String(humanId||'').trim();if(!human)throw new Error('Identidade humana obrigatória.');
  const due=String(dueAt||'').trim();civilDateSP(due);
  let row=await getCommunication(sbReq,djenId);
  // O prazo só nasce de leitura recente do Diário. Leitura velha (o monitor relê só o dia corrente)
  // é relida agora; sem conseguir reler, não confirma — e diz por quê.
  const limiteMs=Number.isFinite(maxAgeMs)?maxAgeMs:DEFAULT_AUTH_MAX_AGE_MS;
  const nowMsCheck=now instanceof Date?now.getTime():Date.parse(String(now));
  const idadeMs=(Number.isFinite(nowMsCheck)?nowMsCheck:Date.now())-Date.parse(String(row?.observado_em||''));
  let relida=false;
  if(!(idadeMs<=limiteMs)&&typeof refreshCommunication==='function'){
    try{row=await refreshCommunication(row);relida=true}
    catch(error){throw Object.assign(new Error('A leitura desta intimação no Diário tem mais de '+Math.round(limiteMs/3600000)+' horas e não consegui reler agora ('+error.message+'). O prazo NÃO foi confirmado; tente de novo em instantes.'),{status:503})}
  }
  if(row?.motivo_cancelamento)throw Object.assign(new Error('Esta intimação foi cancelada no Diário ('+String(row.motivo_cancelamento).slice(0,200)+'). O prazo NÃO foi confirmado.'),{status:409});
  const storedSuggestionHash=String(row?.prazo_sugestao?.source_hash||'');
  if(storedSuggestionHash){
    const supplied=String(suggestionSourceHash||'');
    const currentHash=DeadlineSuggestion.sourceHash(row);
    if(!supplied)throw Object.assign(new Error('A sugestão de prazo precisa ser recarregada antes da confirmação.'),{status:409});
    if(supplied!==storedSuggestionHash||currentHash!==storedSuggestionHash)throw Object.assign(new Error('O teor da intimação mudou desde a sugestão. Recarregue e confira antes de confirmar o prazo.'),{status:409});
  }
  const reading=readingFromCommunication(row,{integrityKey});
  // Relida agora: a autorização é registrada depois da releitura (nunca antes da prova).
  const nowMs0=now instanceof Date?now.getTime():Date.parse(String(now));
  const nowMs=relida?Math.max(Number.isFinite(nowMs0)?nowMs0:0,Date.parse(String(row.observado_em||''))||0,Date.now()):nowMs0;
  const authorizedAt=new Date(Number.isFinite(nowMs)?nowMs:Date.now()).toISOString();
  const auth={
    id:crypto.randomUUID(),reading_id:reading.reading_id,process_id:String(row.processo_id),human_id:human,
    authorized_at:authorizedAt,due_at:due,source_ref:String(row.djen_id),regime:String(regime||'manual').slice(0,60),note:String(note||'').slice(0,1000)
  };
  let truth;
  try{
    truth=mintDeadlineTruth(
      {readingId:reading.reading_id,authorizationId:auth.id},
      {readingLog:new Map([[reading.reading_id,reading]]),authorizationLog:new Map([[auth.id,auth]]),integrityKey,now:Date.parse(authorizedAt),maxAgeMs}
    );
  }catch(error){
    if(error?.code==='reading_not_fresh')throw Object.assign(new Error('A leitura desta intimação no Diário está velha (mais de '+Math.round(limiteMs/3600000)+' horas) e o LEX não conseguiu reler. O prazo NÃO foi confirmado.'),{status:409,code:'reading_not_fresh'});
    throw error;
  }
  const civilDue=civilDateSP(truth.due_at);
  const idIntimacao=String(row.djen_id);
  const saved=await processStore.mutate(ps=>{
    const i=ps.findIndex(p=>String(p.id)===String(row.processo_id));
    if(i<0)throw Object.assign(new Error('Processo da comunicação não foi encontrado.'),{status:404});
    const current=ps[i];
    if(!hasCnj(current,String(row.cnj)))throw Object.assign(new Error('O CNJ do processo mudou desde o vínculo da comunicação. Revise antes de confirmar o prazo.'),{status:409});
    // Cada intimação confirmada é um prazo próprio (lib/prazos-abertos.js): confirmar outra intimação
    // do mesmo processo não apaga este; repetir a mesma confirmação não cria nada novo.
    const abertos=PrazosAbertos.prazosAbertos(current);
    const mesmo=abertos.find(x=>String(x.djen_id)===idIntimacao);
    if(mesmo&&mesmo.due_at===civilDue&&isLegalTruth(mesmo.truth,{integrityKey}))return current;
    const lista=[...abertos.filter(x=>String(x.djen_id)!==idIntimacao),{djen_id:idIntimacao,due_at:civilDue,confirmed_at:authorizedAt,truth,authorization:auth}];
    const history=Array.isArray(current.deadline_history)?current.deadline_history.slice():[];
    // Data anotada à mão (sem confirmação oficial) que difere da confirmada fica registrada no histórico.
    const manual=!abertos.length&&!PrazosAbertos.resolvido(current)?PrazosAbertos.civil(current.prazoReal||current.prazo):null;
    history.unshift({djen_id:idIntimacao,truth,authorization:auth,confirmed_at:authorizedAt,...(manual&&manual!==civilDue?{data_manual_substituida:manual}:{})});
    // Prazo novo depois de uma baixa total: a baixa antiga fica no histórico, o processo volta a ter prazo aberto.
    const baixa=current.prazo_baixa?.ativa===true?{prazo_baixa:{...current.prazo_baixa,ativa:false,encerrada_em:authorizedAt,encerrada_por:'novo prazo confirmado (intimação nº '+idIntimacao+')'}}:{};
    ps[i]={...current,...PrazosAbertos.camposDoPrincipal(lista),...baixa,deadline_history:history.slice(0,50),atualizado_em:authorizedAt};
    return ps[i];
  },human);
  let queueUpdated=true,queueError=null;
  try{
    rowsFromResult(await sbReq('PATCH','djen_comunicacoes',{
      prazo_cunhado:true,prazo_cunhado_em:authorizedAt,prazo_cunhado_por:human,atualizado_em:authorizedAt
    },{djen_id:'eq.'+String(row.djen_id)},{Prefer:'return=representation'}),'Baixar comunicação DJEN');
  }catch(error){queueUpdated=false;queueError=error.message}
  // A verdade DESTA intimação (o processo pode ter outro prazo aberto mais próximo como principal).
  const abertosAgora=PrazosAbertos.prazosAbertos(saved.value||{});
  const entrada=abertosAgora.find(x=>String(x.djen_id)===idIntimacao);
  const persistedTruth=entrada?.truth&&isLegalTruth(entrada.truth,{integrityKey})?entrada.truth:truth;
  const persistedAuthorization=entrada?.authorization||auth;
  const outros=abertosAgora.filter(x=>String(x.djen_id)!==idIntimacao).map(x=>({djen_id:x.djen_id,due_at:x.due_at}));
  const substituida=Array.isArray(saved.value?.deadline_history)&&saved.value.deadline_history[0]?.authorization?.id===persistedAuthorization?.id?saved.value.deadline_history[0].data_manual_substituida||null:null;
  return{ok:true,processo:saved.value,truth:persistedTruth,authorization:persistedAuthorization,outros_prazos_abertos:outros,data_manual_substituida:substituida,queue_updated:queueUpdated,queue_error:queueError};
}
module.exports={DEFAULT_AUTH_MAX_AGE_MS,civilDateSP,getCommunication,readingFromCommunication,confirmDjenDeadline};
