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
  // Lista enxuta para varreduras periódicas: só os campos pedidos de dentro do JSON
  // (valor->>campo), sem o corpo do registro, e só os status pedidos. A lista completa a
  // cada poucos segundos estourou a cota de tráfego do banco (out/2026).
  // Devolve null quando o banco não entende campo JSON (modo PostgreSQL direto).
  // Atenção: em coluna TEXTO o PostgREST não recusa — devolve o campo vazio (null) e o filtro
  // por status volta vazio. Quem usa deve conferir numa linha antes de confiar no filtro.
  async listFields(prefix, fields, {status, limit=100}={}) {
    if(!this.request?.jsonFields) return null;
    if(!Array.isArray(fields)||!fields.length||!fields.every(f=>/^[a-z_][a-z0-9_]*$/i.test(String(f)))) throw new Error('Campo inválido na lista enxuta');
    const max=Number(limit);
    if(!Number.isInteger(max)||max<1||max>1000) throw new Error('Limite inválido na lista enxuta');
    const query={chave:'like.'+prefix+'*',select:['chave',...fields.map(f=>f+':valor->>'+f)].join(','),order:'atualizado_em.desc',limit:String(max)};
    if(status!==undefined){
      if(!Array.isArray(status)||!status.length||!status.every(s=>/^[a-z_]+$/i.test(String(s)))) throw new Error('Status inválido na lista enxuta');
      query['valor->>status']='in.('+status.join(',')+')';
    }
    return rowsFromResult(await this.request('GET',this.table,null,query),'Listar tarefas');
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
