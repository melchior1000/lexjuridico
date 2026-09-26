'use strict';
const {rowsFromResult}=require('./supabase');
const {cnjDigits,hasCnj,applyPjeMovement}=require('./pje-sync');
const Djen=require('./djen');
const DeadlineSuggestion=require('./deadline-suggestion');
const {hojeBrasil}=require('./data-brasil');

// OABs ligadas pela tela/WhatsApp (gravadas na configuração do escritório).
let runtimeOabs=()=>[];
function setOabsProvider(fn){runtimeOabs=typeof fn==='function'?fn:()=>[]}
const UFS=new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
// Aceita "123456/MG", "123.456 MG", "MG 123456", "OAB/MG 123456", várias separadas por vírgula ou "e".
function parseOabInput(text){
  const out=[],seen=new Set(),t=String(text||'').toUpperCase().replace(/(\d)\.(\d)/g,'$1$2');
  const re=/\b(?:OAB\s*[\/-]?\s*)?([A-Z]{2})?\s*[\/-]?\s*(\d{3,7})(?:\s*[\/-]?\s*([A-Z]{2}))?\b/g;
  let m;while((m=re.exec(t))){const uf=m[3]||m[1];if(!uf||!UFS.has(uf))continue;const oab=String(Number(m[2]));const k=oab+'/'+uf;if(!seen.has(k)){seen.add(k);out.push({oab,uf})}}
  return out;
}
function parseOabs(value=process.env.DJEN_OABS||''){
  if(!String(value||'').trim()){try{return(runtimeOabs()||[]).filter(o=>o&&o.oab&&o.uf)}catch{return[]}}
  return String(value).split(',').map(x=>x.trim()).filter(Boolean).map(x=>{const m=x.match(/^(\d+)\s*:\s*([A-Za-z]{2})$/);if(!m)throw new Error('DJEN_OABS inválido: '+x);return{oab:m[1],uf:m[2].toUpperCase()}});
}
function communicationRow(item,oab,uf,audit={}){
  const djenId=item.id??item.hash;if(djenId==null||!String(djenId).trim())return null;
  const cancel=item.motivoCancelamento||item.motivo_cancelamento||null;
  return{
    djen_id:String(djenId),djen_hash:item.hash?String(item.hash):null,numero_oab:String(oab),uf_oab:String(uf).toUpperCase(),
    cnj:cnjDigits(item.numeroProcesso||item.numero_processo||item.numeroprocessocommascara||''),
    tribunal:item.siglaTribunal||item.tribunal||null,tipo:item.tipoComunicacao||item.tipo||null,
    data_disponibilizacao:String(item.dataDisponibilizacao||item.data_disponibilizacao||'').slice(0,10)||null,
    data_publicacao:String(item.dataPublicacao||item.data_publicacao||'').slice(0,10)||null,
    texto:Djen.sanitizeText(item.texto).slice(0,20000),motivo_cancelamento:cancel?String(cancel):null,payload:item,
    raw_receipt:String(audit.raw_receipt||''),receipt_item_key:Djen.itemKey(item),receipt_page:Number(audit.pagina)||null,
    status:cancel?'cancelada':'nova',requisitado_em:audit.requested_at||null,observado_em:audit.responded_at||new Date().toISOString(),endpoint:audit.endpoint||null,request_id:audit.request_id||null
  };
}
async function upsertCommunication(sbReq,row){
  const result=await sbReq('POST','djen_comunicacoes',row,{on_conflict:'djen_id'},{Prefer:'resolution=merge-duplicates,return=representation'});
  const rows=rowsFromResult(result,'Gravar comunicação DJEN');return rows[0]||row;
}
async function markCommunication(sbReq,djenId,patch){
  const result=await sbReq('PATCH','djen_comunicacoes',{...patch,atualizado_em:new Date().toISOString()},{djen_id:'eq.'+djenId},{Prefer:'return=representation'});
  return rowsFromResult(result,'Atualizar comunicação DJEN')[0]||null;
}
async function listPendingMint(sbReq,limit=100){
  return rowsFromResult(await sbReq('GET','djen_comunicacoes',null,{status:'eq.casada',prazo_cunhado:'eq.false',order:'data_disponibilizacao.asc',limit:String(limit)}),'Listar comunicações para cunhagem');
}

// Lê todas as comunicações de um CNJ em páginas. Antes o fluxo de correção/cadastro
// parava silenciosamente em 50 publicações e podia deixar intimação antiga órfã.
async function readCommunicationsByCnj(sbReq,cnj,{status=null,order='data_disponibilizacao.asc',pageSize=200,maxRows=10000}={}){
  const digits=cnjDigits(cnj)||'';
  if(typeof sbReq!=='function'||digits.length!==20)return[];
  const out=[];let offset=0;
  while(offset<maxRows){
    const query={cnj:'eq.'+digits,order,limit:String(pageSize),offset:String(offset)};
    if(status)query.status='eq.'+status;
    const batch=rowsFromResult(await sbReq('GET','djen_comunicacoes',null,query),'Ler publicações do processo');
    out.push(...batch);
    if(batch.length<pageSize)return out;
    offset+=batch.length;
  }
  throw new Error('Há mais de '+maxRows+' publicações para este processo; a leitura foi interrompida para não truncar silenciosamente.');
}

async function persistDeadlineSuggestion(sbReq,djenId,suggestion){
  const patch={prazo_sugestao:suggestion,prazo_sugerido_em:new Date().toISOString(),atualizado_em:new Date().toISOString()};
  const rows=rowsFromResult(await sbReq('PATCH','djen_comunicacoes',patch,{djen_id:'eq.'+String(djenId)},{Prefer:'return=representation'}),'Salvar sugestão de prazo');
  if(!rows[0])throw new Error('Salvar sugestão de prazo: nenhuma comunicação foi atualizada.');
  return rows[0];
}
async function suggestPendingDeadlines(sbReq,rows=[],options={}){
  const out=[],failures=[];
  for(const row of Array.isArray(rows)?rows:[]){
    const currentHash=DeadlineSuggestion.sourceHash(row),stored=row?.prazo_sugestao;
    const sameVersion=stored?.suggestion_version===DeadlineSuggestion.SUGGESTION_VERSION;
    const needsAiUpgrade=stored?.status==='candidato_sem_ia'&&typeof options.aiAnalyze==='function';
    if(stored?.status&&stored.source_hash===currentHash&&sameVersion&&!needsAiUpgrade){out.push(row);continue}
    try{
      const suggestion=await DeadlineSuggestion.buildDeadlineSuggestion({
        communication:row,aiAnalyze:options.aiAnalyze,feriados:options.feriados||[],calendarioVerificado:options.calendarioVerificado===true
      });
      const persisted=await persistDeadlineSuggestion(sbReq,row.djen_id,suggestion);
      out.push(persisted);
    }catch(error){
      failures.push({djen_id:row?.djen_id||null,error:error.message});
      out.push(row);
    }
  }
  return{rows:out,failures};
}

async function readSyncState(sbReq,oab,uf){
  const rows=rowsFromResult(await sbReq('GET','djen_sync_state',null,{numero_oab:'eq.'+String(oab),uf_oab:'eq.'+String(uf).toUpperCase(),limit:'1'}),'Ler cursor DJEN');
  return rows[0]||null;
}
async function saveSyncState(sbReq,oab,uf,date){
  const row={numero_oab:String(oab),uf_oab:String(uf).toUpperCase(),last_success_date:String(date),last_success_at:new Date().toISOString(),last_error:null};
  const rows=rowsFromResult(await sbReq('POST','djen_sync_state',row,{on_conflict:'numero_oab,uf_oab'},{Prefer:'resolution=merge-duplicates,return=representation'}),'Salvar cursor DJEN');
  return rows[0]||row;
}
function syncWindows(lastSuccess,now=new Date(),initialLookbackDays=7){
  const end=Djen.ymdBrasil(now);
  let start=/^\d{4}-\d{2}-\d{2}$/.test(String(lastSuccess||''))?String(lastSuccess):Djen.addDaysYmd(end,-(Math.max(1,initialLookbackDays)-1));
  if(start>end)start=end;
  const out=[];
  for(let cursor=start;cursor<=end;){
    const chunkEnd=[Djen.addDaysYmd(cursor,6),end].sort()[0];
    out.push({inicio:cursor,fim:chunkEnd});
    if(chunkEnd===end)break;
    cursor=Djen.addDaysYmd(chunkEnd,1);
  }
  return out;
}
// Número corrigido/cadastrado: as publicações que ficaram órfãs com esse CNJ
// entram no processo na hora, sem esperar a próxima leitura do Diário.
async function attachOrphans({processStore,sbReq,cnj}){
  const digits=cnjDigits(cnj)||'';
  if(!processStore?.read||typeof sbReq!=='function'||digits.length!==20)return{casadas:0,falhas:[]};
  const rows=await readCommunicationsByCnj(sbReq,digits,{status:'orfa',order:'data_disponibilizacao.asc'});
  const out={casadas:0,falhas:[],lidas:rows.length};
  for(const row of rows){
    try{
      const applied=await applyPjeMovement({processStore,origem:'djen'},{cnj:digits,data:row.data_disponibilizacao||hojeBrasil(),andamento_texto:[row.tipo||'Comunicação DJEN',row.tribunal||'',row.texto||''].filter(Boolean).join(' — '),observed_at:row.observado_em,djen_id:row.djen_id});
      await markCommunication(sbReq,row.djen_id,{status:'casada',processo_id:String(applied.processo.id)});
      if(!applied.duplicado)out.casadas++;
    }catch(error){out.falhas.push({djen_id:row.djen_id,error:error.message})}
  }
  return out;
}
async function syncDjen({processStore,sbReq,oabs=parseOabs(),now=new Date(),clientOptions={}}={}){
  if(!processStore?.read||typeof sbReq!=='function')throw new Error('Persistência DJEN indisponível.');
  const resumo={consultadas:0,casadas:0,orfas:0,canceladas:0,duplicadas:0,sem_id:0,falhas:[]};
  resumo.janelas=0;
  for(const cfg of oabs){
    const cursor=await readSyncState(sbReq,cfg.oab,cfg.uf);
    const windows=syncWindows(cursor?.last_success_date,now,Number(clientOptions.initialLookbackDays||7));
    const failuresBefore=resumo.falhas.length;
    for(const janela of windows){
      resumo.janelas++;
      const result=await Djen.porOab(cfg.oab,cfg.uf,janela,clientOptions);
      for(const item of result.items){
        const audit=result.itemAudits?.[Djen.itemKey(item)]||result.audits[result.audits.length-1]||{},row=communicationRow(item,cfg.oab,cfg.uf,audit);
        if(!row){resumo.sem_id++;continue}
        resumo.consultadas++;await upsertCommunication(sbReq,row);
        if(row.status==='cancelada'){resumo.canceladas++;continue}
        if(!row.cnj){await markCommunication(sbReq,row.djen_id,{status:'orfa',processo_id:null});resumo.orfas++;continue}
        const state=await processStore.read(),matches=state.processes.filter(p=>hasCnj(p,row.cnj));
        if(matches.length!==1){await markCommunication(sbReq,row.djen_id,{status:'orfa',processo_id:null});resumo.orfas++;continue}
        try{
          const applied=await applyPjeMovement({processStore,origem:'djen'},{cnj:row.cnj,data:row.data_disponibilizacao||hojeBrasil(now),andamento_texto:[row.tipo||'Comunicação DJEN',row.tribunal||'',row.texto||''].filter(Boolean).join(' — '),observed_at:row.observado_em,djen_id:row.djen_id});
          await markCommunication(sbReq,row.djen_id,{status:'casada',processo_id:String(applied.processo.id)});
          if(applied.duplicado)resumo.duplicadas++;else resumo.casadas++;
        }catch(error){resumo.falhas.push({djen_id:row.djen_id,error:error.message})}
      }
    }
    if(resumo.falhas.length===failuresBefore)await saveSyncState(sbReq,cfg.oab,cfg.uf,Djen.ymdBrasil(now));
  }
  const cunhar=await listPendingMint(sbReq);
  return{ok:resumo.falhas.length===0,...resumo,cunhar};
}
module.exports={attachOrphans,readCommunicationsByCnj,parseOabs,parseOabInput,setOabsProvider,communicationRow,upsertCommunication,markCommunication,listPendingMint,persistDeadlineSuggestion,suggestPendingDeadlines,readSyncState,saveSyncState,syncWindows,syncDjen};
