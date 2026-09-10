'use strict';
const {withProcessLock}=require('./process-lock');
const {rowsFromResult}=require('./supabase');
// Atualiza campos explícitos, a partir do estado atual, com confirmação de linha.
async function persistProcessChange(deps, id, buildPatch) {
  return withProcessLock(deps.processos,id,async()=>{
    const index=deps.processos.findIndex(p=>String(p.id)===String(id));
    if(index<0) throw new Error('Processo não encontrado.');
    const current=deps.processos[index];
    const patch=await buildPatch(structuredClone(current));
    if(!patch || !Object.keys(patch).length) return {alterado:false,processo:current};
    const response=await deps.sbReq('PATCH','processos',patch,{id:'eq.'+id},{Prefer:'return=representation'});
    const rows=rowsFromResult(response,'Salvar processo');
    if(!rows.some(row=>String(row.id)===String(id))) throw new Error('Banco não confirmou a atualização.');
    const updated={...current,...patch};
    deps.processos[index]=updated;
    if(deps.onPersisted) deps.onPersisted(id);
    return {alterado:true,processo:updated};
  });
}
module.exports={persistProcessChange};
