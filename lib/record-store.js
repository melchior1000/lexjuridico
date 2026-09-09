'use strict';
const {rowsFromResult}=require('./supabase');
const {withProcessLock}=require('./process-lock');
class RecordStore {
  constructor(request, table='configuracoes') { this.request=request; this.table=table; }
  async read(key) {
    const rows=rowsFromResult(await this.request('GET',this.table,null,{chave:'eq.'+key,limit:'1'}),'Ler registro');
    if(!rows.length) return null;
    const row=rows[0];
    return {value:typeof row.valor==='string'?JSON.parse(row.valor):row.valor, stamp:row.atualizado_em};
  }
  async list(prefix) {
    const rows=rowsFromResult(await this.request('GET',this.table,null,{chave:'like.'+prefix+'*',order:'atualizado_em.desc',limit:'100'}),'Listar tarefas');
    return rows.map(r=>typeof r.valor==='string'?JSON.parse(r.valor):r.valor);
  }
  async change(key, update) {
    return withProcessLock(this,key,async()=>{
      for(let attempt=0;attempt<4;attempt++) {
        const row=await this.read(key);
        const value=await update(row?structuredClone(row.value):null);
        if(value===undefined) return row?.value;
        const stamp=new Date(Math.max(Date.now(),(Date.parse(row?.stamp)||0)+1)).toISOString();
        const result=await this.request(row?'PATCH':'POST',this.table,{chave:key,valor:value,atualizado_em:stamp},
          row?{chave:'eq.'+key,atualizado_em:'eq.'+row.stamp}:{},{Prefer:'return=representation'});
        if(result.status===409) continue;
        const rows=rowsFromResult(result,'Gravar registro');
        if(rows.some(r=>r.chave===key)) return value;
      }
      throw Object.assign(new Error('Conflito ao salvar. Atualize e tente novamente.'),{status:409});
    });
  }
}
module.exports={RecordStore};
