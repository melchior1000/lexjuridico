'use strict';
const {rowsFromResult} = require('./supabase');
const {withProcessLock} = require('./process-lock');
const flow = require('./workflow');

// O snapshot existente preserva campos, peças e anexos sem depender de novas
// colunas. CAS no PostgreSQL impede sobrescrita entre aparelhos/instâncias.
class ProcessStore {
  constructor(request, {id='lex_juridico', onCommit=()=>{}}={}) {
    this.request=request; this.id=id; this.onCommit=onCommit;
  }
  async read() {
    const rows=rowsFromResult(await this.request('GET','processos_cache',null,{id:'eq.'+this.id,limit:'1'}),'Ler escritório');
    if (!rows.length) return {version:0, processes:[], exists:false};
    const row=rows[0]; let data=row.dados;
    if (typeof data === 'string') data=JSON.parse(data);
    if (!Array.isArray(data)) throw new Error('Snapshot de processos inválido. Recuperação necessária.');
    return {version:Number(row.versao)||0,processes:data,exists:true,device:row.ultimo_aparelho};
  }
  async write(state, processes, device) {
    if (!Array.isArray(processes) || processes.some(p=>!p || p.id == null)) throw new Error('Cadastros inválidos.');
    if (new Set(processes.map(p=>String(p.id))).size !== processes.length) throw new Error('IDs duplicados no cadastro.');
    const version=Math.max(Date.now(),state.version+1);
    const payload={id:this.id,dados:JSON.stringify(processes),total:processes.length,versao:version,ultimo_aparelho:device||'lex',atualizado_em:new Date().toISOString()};
    const response=await this.request(state.exists?'PATCH':'POST','processos_cache',payload,
      state.exists?{id:'eq.'+this.id,versao:'eq.'+state.version}:{}, {Prefer:'return=representation'});
    if (response.status===409) throw Object.assign(new Error('Outra gravação ocorreu. Atualize e tente novamente.'),{status:409});
    const rows=rowsFromResult(response,'Gravar escritório');
    if (!rows.some(row=>row.id===this.id && Number(row.versao)===version)) throw Object.assign(new Error('Versão alterada por outro aparelho. Atualize antes de salvar.'),{status:409});
    this.onCommit(structuredClone(processes),version,device);
    return {processes,version};
  }
  async replace(processes, expectedVersion, device) {
    return withProcessLock(this,'snapshot',async()=>{
      const state=await this.read();
      if (Number(expectedVersion)!==state.version) throw Object.assign(new Error('Sua cópia está desatualizada.'),{status:409,state});
      return this.write(state,processes,device);
    });
  }
  async mutate(operation, device='lex') {
    return withProcessLock(this,'snapshot',async()=>{
      for (let attempt=0;attempt<3;attempt++) {
        const state=await this.read();
        const processes=structuredClone(state.processes);
        const value=await operation(processes);
        if (JSON.stringify(processes)===JSON.stringify(state.processes)) return {value,processes,version:state.version};
        try { return {...await this.write(state,processes,device),value}; }
        catch(e) { if (e.status!==409 || attempt===2) throw e; }
      }
    });
  }
  async update(id, buildPatch, device) {
    return this.mutate(async ps=>{
      const index=ps.findIndex(p=>String(p.id)===String(id));
      if (index<0) throw Object.assign(new Error('Processo não encontrado.'),{status:404});
      const patch=flow.validatePatch(await buildPatch(structuredClone(ps[index])));
      ps[index]={...ps[index],...patch}; return ps[index];
    },device);
  }
  async distribute(preparation, request, device) {
    return this.mutate(ps=>{
      let index=ps.findIndex(p=>String(p.id)===String(preparation.id));
      if (index<0) { ps.push({...preparation,setor:'autuacao'}); index=ps.length-1; }
      ps[index]=flow.distribute(ps[index],request); return ps[index];
    },device);
  }
  async gateway(method, data, query={}) {
    const matches=p=>Object.entries(query||{}).every(([key,value])=>{
      if(['order','limit','select','offset','on_conflict'].includes(key)) return true;
      if(!String(value).startsWith('eq.')) throw new Error('Filtro de processo não suportado: '+key);
      return String(p[key]??'')===String(value).slice(3);
    });
    const decode=row=>{
      const p={...row};
      for(const k of ['andamentos','prazos','arquivos','pecas']) if(p[k]!==undefined) p[k]=flow.array(p[k]);
      for(const [a,b] of [['resumo','descricao'],['docs_faltantes','docsFaltantes'],['valor_causa','valor']]) if(p[a]!==undefined) p[b]=p[a];
      return p;
    };
    try {
      let body;
      if(method==='GET') {
        const state=await this.read();
        body=state.processes.filter(matches).slice(Number(query.offset)||0, (Number(query.offset)||0)+(Number(query.limit)||2000));
      } else if(method==='PATCH') {
        if(!query.id) throw new Error('Atualização exige ID exato.');
        const patch=flow.validatePatch(decode(data));
        const result=await this.mutate(ps=>{
          const selected=[];
          ps.forEach((p,i)=>{if(matches(p)){ps[i]={...p,...patch};selected.push(ps[i]);}});
          return selected;
        }); body=result.value;
      } else if(method==='POST') {
        const result=await this.mutate(ps=>{
          const saved=[];
          for(const row of Array.isArray(data)?data:[data]) {
            const p=decode(row); p.id??=Date.now()+require('node:crypto').randomInt(1000000);
            flow.validatePatch(p);
            const index=ps.findIndex(old=>String(old.id)===String(p.id));
            if(index<0) ps.push(p); else ps[index]={...ps[index],...p};
            saved.push(index<0?p:ps[index]);
          }
          return saved;
        }); body=result.value;
      } else if(method==='DELETE') {
        if(!query.id) throw new Error('Exclusão exige ID exato.');
        const result=await this.mutate(ps=>{
          const selected=ps.filter(matches);
          for(let i=ps.length-1;i>=0;i--) if(matches(ps[i])) ps.splice(i,1);
          return selected;
        }); body=result.value;
      } else throw new Error('Operação de processo inválida.');
      return {ok:true,status:200,body};
    } catch(e) {return {ok:false,status:e.status||503,body:{error:e.message}};}
  }
}
module.exports={ProcessStore};
