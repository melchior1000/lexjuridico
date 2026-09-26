'use strict';
const crypto=require('node:crypto');
const {rowsFromResult}=require('./supabase');
const {createReadingLogEntry}=require('./reading-log-schema');
const {hasCnj}=require('./pje-sync');
const {mintDeadlineTruth,isLegalTruth}=require('./deadline-truth');
const DeadlineSuggestion=require('./deadline-suggestion');

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
async function confirmDjenDeadline({processStore,sbReq,djenId,dueAt,humanId,regime='manual',note='',suggestionSourceHash=null,integrityKey,maxAgeMs=DEFAULT_AUTH_MAX_AGE_MS,now=new Date()}={}){
  if(!processStore?.mutate||typeof sbReq!=='function')throw new Error('Persistência de prazo indisponível.');
  const human=String(humanId||'').trim();if(!human)throw new Error('Identidade humana obrigatória.');
  const due=String(dueAt||'').trim();civilDateSP(due);
  const row=await getCommunication(sbReq,djenId);
  const storedSuggestionHash=String(row?.prazo_sugestao?.source_hash||'');
  if(storedSuggestionHash){
    const supplied=String(suggestionSourceHash||'');
    const currentHash=DeadlineSuggestion.sourceHash(row);
    if(!supplied)throw Object.assign(new Error('A sugestão de prazo precisa ser recarregada antes da confirmação.'),{status:409});
    if(supplied!==storedSuggestionHash||currentHash!==storedSuggestionHash)throw Object.assign(new Error('O teor da intimação mudou desde a sugestão. Recarregue e confira antes de confirmar o prazo.'),{status:409});
  }
  const reading=readingFromCommunication(row,{integrityKey});
  const nowMs=now instanceof Date?now.getTime():Date.parse(String(now));
  const authorizedAt=new Date(Number.isFinite(nowMs)?nowMs:Date.now()).toISOString();
  const auth={
    id:crypto.randomUUID(),reading_id:reading.reading_id,process_id:String(row.processo_id),human_id:human,
    authorized_at:authorizedAt,due_at:due,source_ref:String(row.djen_id),regime:String(regime||'manual').slice(0,60),note:String(note||'').slice(0,1000)
  };
  const truth=mintDeadlineTruth(
    {readingId:reading.reading_id,authorizationId:auth.id},
    {readingLog:new Map([[reading.reading_id,reading]]),authorizationLog:new Map([[auth.id,auth]]),integrityKey,now:Date.parse(authorizedAt),maxAgeMs}
  );
  const civilDue=civilDateSP(truth.due_at);
  const saved=await processStore.mutate(ps=>{
    const i=ps.findIndex(p=>String(p.id)===String(row.processo_id));
    if(i<0)throw Object.assign(new Error('Processo da comunicação não foi encontrado.'),{status:404});
    const current=ps[i];
    if(!hasCnj(current,String(row.cnj)))throw Object.assign(new Error('O CNJ do processo mudou desde o vínculo da comunicação. Revise antes de confirmar o prazo.'),{status:409});
    if(current.deadline_truth&&current.djen_id_origem===String(row.djen_id)&&isLegalTruth(current.deadline_truth,{integrityKey})&&civilDateSP(current.deadline_truth.due_at)===civilDue){
      return current;
    }
    const history=Array.isArray(current.deadline_history)?current.deadline_history.slice():[];
    history.unshift({djen_id:String(row.djen_id),truth,authorization:auth,confirmed_at:authorizedAt});
    ps[i]={...current,prazoReal:civilDue,prazo_confirmado_em:authorizedAt,djen_id_origem:String(row.djen_id),deadline_truth:truth,deadline_authorization:auth,deadline_history:history.slice(0,50),atualizado_em:authorizedAt};
    return ps[i];
  },human);
  let queueUpdated=true,queueError=null;
  try{
    rowsFromResult(await sbReq('PATCH','djen_comunicacoes',{
      prazo_cunhado:true,prazo_cunhado_em:authorizedAt,prazo_cunhado_por:human,atualizado_em:authorizedAt
    },{djen_id:'eq.'+String(row.djen_id)},{Prefer:'return=representation'}),'Baixar comunicação DJEN');
  }catch(error){queueUpdated=false;queueError=error.message}
  const persistedTruth=saved.value?.deadline_truth&&isLegalTruth(saved.value.deadline_truth,{integrityKey})?saved.value.deadline_truth:truth;
  const persistedAuthorization=saved.value?.deadline_authorization||auth;
  return{ok:true,processo:saved.value,truth:persistedTruth,authorization:persistedAuthorization,queue_updated:queueUpdated,queue_error:queueError};
}
module.exports={DEFAULT_AUTH_MAX_AGE_MS,civilDateSP,getCommunication,readingFromCommunication,confirmDjenDeadline};
