'use strict';
const {rowsFromResult}=require('./supabase');
const {cnjDigits,applyPjeMovement}=require('./pje-sync');
const Djen=require('./djen');

function parseOabs(value=process.env.DJEN_OABS||''){
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
async function syncDjen({processStore,sbReq,oabs=parseOabs(),now=new Date(),clientOptions={}}={}){
  if(!processStore?.read||typeof sbReq!=='function')throw new Error('Persistência DJEN indisponível.');
  const resumo={consultadas:0,casadas:0,orfas:0,canceladas:0,duplicadas:0,sem_id:0,falhas:[]};
  for(const cfg of oabs){
    const result=await Djen.porOab(cfg.oab,cfg.uf,Djen.ontemHoje(now),clientOptions);
    for(const item of result.items){
      const audit=result.itemAudits?.[Djen.itemKey(item)]||result.audits[result.audits.length-1]||{},row=communicationRow(item,cfg.oab,cfg.uf,audit);
      if(!row){resumo.sem_id++;continue}
      resumo.consultadas++;await upsertCommunication(sbReq,row);
      if(row.status==='cancelada'){resumo.canceladas++;continue}
      if(!row.cnj){await markCommunication(sbReq,row.djen_id,{status:'orfa',processo_id:null});resumo.orfas++;continue}
      const state=await processStore.read(),matches=state.processes.filter(p=>cnjDigits(p.numero)===row.cnj);
      if(matches.length!==1){await markCommunication(sbReq,row.djen_id,{status:'orfa',processo_id:null});resumo.orfas++;continue}
      try{
        const applied=await applyPjeMovement({processStore,origem:'djen'},{cnj:row.cnj,data:row.data_disponibilizacao||now.toISOString().slice(0,10),andamento_texto:[row.tipo||'Comunicação DJEN',row.tribunal||'',row.texto||''].filter(Boolean).join(' — '),observed_at:row.observado_em,djen_id:row.djen_id});
        await markCommunication(sbReq,row.djen_id,{status:'casada',processo_id:String(matches[0].id)});
        if(applied.duplicado)resumo.duplicadas++;else resumo.casadas++;
      }catch(error){resumo.falhas.push({djen_id:row.djen_id,error:error.message})}
    }
  }
  const cunhar=await listPendingMint(sbReq);
  return{ok:resumo.falhas.length===0,...resumo,cunhar};
}
module.exports={parseOabs,communicationRow,upsertCommunication,markCommunication,listPendingMint,syncDjen};
