'use strict';
const crypto=require('node:crypto');

const STAGES=['recepcao','cadastro','iniciais','processos','prazos','pecas','pericia','revisao','concluidos'];
const CLOSED=new Set(['CONCLUIDO','ENTREGUE','ARQUIVADO','GANHO','PERDIDO']);
const ALLOWED={
  recepcao:new Set(['cadastro','concluidos']),
  cadastro:new Set(['recepcao','iniciais','concluidos']),
  iniciais:new Set(['cadastro','pecas','pericia','revisao','processos','concluidos']),
  processos:new Set(['cadastro','prazos','pecas','pericia','revisao','concluidos']),
  prazos:new Set(['cadastro','processos','pecas','pericia','revisao','concluidos']),
  pecas:new Set(['cadastro','processos','revisao','concluidos']),
  pericia:new Set(['cadastro','processos','revisao','concluidos']),
  revisao:new Set(['cadastro','iniciais','processos','prazos','pecas','pericia','concluidos']),
  concluidos:new Set(['processos'])
};
const OK_CHECK=new Set(['ok','sim','true','1','completo','concluido','concluida','validado','validada','conferido','conferida','entregue','recebido','recebida']);
const BAD_CHECK=new Set(['nao','não','false','0','falta','faltante','pendente','invalido','inválido','invalida','inválida','ilegivel','ilegível','ausente']);
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function array(v){if(Array.isArray(v))return v;try{const x=JSON.parse(v);return Array.isArray(x)?x:[]}catch{return[]}}
function missingDocs(p){return String(p?.docsFaltantes||p?.docs_faltantes||p?.preparacao?.faltando||'').trim()}
function checklistSource(p={}){return p.checklist_cadastro??p.checklistCadastro??p.preparacao?.checklist_cadastro??p.preparacao?.checklist??null}
function checklistPendencies(p={}){
  const source=checklistSource(p); if(source==null||source==='') return [];
  let data=source;
  if(typeof data==='string'){try{data=JSON.parse(data)}catch{return []}}
  const pending=[];
  const inspect=(name,value)=>{
    if(value==null||value==='') return;
    if(typeof value==='object'&&!Array.isArray(value)) {
      const status=value.status??value.estado??value.ok??value.validado;
      if(status!==undefined) return inspect(name,status);
      return;
    }
    if(value===true) return;
    if(value===false){pending.push(name);return}
    const n=norm(value);
    if(OK_CHECK.has(n)) return;
    if(BAD_CHECK.has(n)){pending.push(name);return}
  };
  if(Array.isArray(data)) data.forEach((item,i)=>{
    if(typeof item==='object'&&item) inspect(String(item.id||item.nome||item.label||('item '+(i+1))),item.status??item.estado??item.ok??item.validado);
    else inspect('item '+(i+1),item);
  });
  else if(typeof data==='object') Object.entries(data).forEach(([key,value])=>inspect(key,value));
  return pending;
}
function cadastroPendencies(p={}){
  const result=[]; const docs=missingDocs(p); if(docs) result.push(docs);
  result.push(...checklistPendencies(p));
  return [...new Set(result.map(x=>String(x).trim()).filter(Boolean))];
}
function stageOf(p={}){
  const explicit=norm(p.office_stage||p.fluxo_setor||p.setor_fluxo);
  if(STAGES.includes(explicit)) return explicit;
  if(CLOSED.has(String(p.status||'').toUpperCase())) return 'concluidos';
  if(cadastroPendencies(p).length) return 'cadastro';
  if(String(p.setor||'').toLowerCase()==='autuacao' || ['EM_PREP','PRONTO','AGUARDANDO_APROVACAO'].includes(String(p.status||'').toUpperCase())) return 'iniciais';
  if(p.prazoReal||p.prazo) return 'prazos';
  return 'processos';
}
function summary(processes=[]){
  const rows=array(processes),counts=Object.fromEntries(STAGES.map(s=>[s,0]));
  for(const p of rows) counts[stageOf(p)]++;
  counts.total=rows.length;
  return counts;
}
function eventFor(from,to,meta={}){
  return {id:crypto.randomUUID(),de:from,para:to,por:String(meta.actor||meta.agent||'LEX'),agente:String(meta.agent||'LEX'),motivo:String(meta.reason||'Transferência de setor'),task_id:meta.taskId||null,criado_em:meta.now||new Date().toISOString()};
}
function validateHandoff(current,to,{allowReopen=false}={}){
  const from=stageOf(current),target=norm(to);
  if(!STAGES.includes(target)) throw new Error('Setor de destino inválido.');
  if(from===target) return {from,target};
  if(from==='concluidos' && target==='processos' && !allowReopen) throw new Error('Reabertura exige confirmação explícita.');
  if(!ALLOWED[from]?.has(target)) throw new Error('Transferência inválida: '+from+' → '+target+'.');
  if(from==='cadastro' && target==='iniciais') {
    const pending=cadastroPendencies(current);
    if(pending.length) throw new Error('Cadastro incompleto: '+pending.join(', ')+'.');
  }
  if(target==='processos' && from==='iniciais' && !String(current.numero||'').trim()) throw new Error('Processo sem número/protocolo: confirme a distribuição antes de enviar para Processos.');
  return {from,target};
}
function handoff(current,to,meta={}){
  const {from,target}=validateHandoff(current,to,meta);
  if(from===target) return current;
  const ev=eventFor(from,target,meta);
  return {...current,office_stage:target,fluxo_setor:target,office_events:[ev,...array(current.office_events)].slice(0,200),office_last_event:ev,atualizado_em:ev.criado_em};
}
function taskStartStage(type){
  const t=norm(type);
  if(['pericia','quesitos'].includes(t)) return 'pericia';
  if(['peticao','contestacao','recurso'].includes(t)) return 'pecas';
  if(t==='revisao') return 'revisao';
  return null;
}
function taskResultStage(task){
  if(['aguardando_dados','aguardando_documento_nitido'].includes(task?.status)) return 'cadastro';
  if(task?.status==='aguardando_revisao') return 'revisao';
  return null;
}
function postReviewStage(process,task){
  if(CLOSED.has(String(process?.status||'').toUpperCase())) return 'concluidos';
  if(!String(process?.numero||'').trim()) return 'iniciais';
  if(task?.tipo==='revisao' && (process?.prazoReal||process?.prazo)) return 'prazos';
  return 'processos';
}
function preflightTask(processes,task){
  if(!task?.processo_id) return {process:null,target:taskStartStage(task?.tipo),stage:null};
  const process=array(processes).find(p=>String(p.id)===String(task.processo_id));
  if(!process) throw Object.assign(new Error('O processo selecionado não existe.'),{status:404});
  const stage=stageOf(process),target=taskStartStage(task.tipo);
  if(stage==='recepcao') throw Object.assign(new Error('O caso ainda está na Recepção. Conclua o Cadastro antes da produção jurídica.'),{status:422});
  if(target && stage==='cadastro') {
    const pending=cadastroPendencies(process);
    if(pending.length) throw Object.assign(new Error('Cadastro incompleto: '+pending.join(', ')+'.'),{status:422,pendencias:pending});
    validateHandoff(process,'iniciais');
  }
  return {process,target,stage,pendencias:cadastroPendencies(process)};
}
async function moveProcess(processStore,processId,to,meta={}){
  if(!processStore?.mutate) return null;
  const result=await processStore.mutate(ps=>{
    const i=ps.findIndex(p=>String(p.id)===String(processId));
    if(i<0) throw Object.assign(new Error('Processo não encontrado para transferência.'),{status:404});
    ps[i]=handoff(ps[i],to,meta);
    return ps[i];
  },meta.actor||'LEX');
  return result.value;
}
async function syncTaskStart(processStore,task,actor='LEX'){
  if(!task?.processo_id || !processStore?.mutate) return null;
  const target=taskStartStage(task.tipo);
  if(!target) {
    const state=await processStore.read();
    preflightTask(state.processes,task);
    return state.processes.find(p=>String(p.id)===String(task.processo_id))||null;
  }
  const result=await processStore.mutate(ps=>{
    preflightTask(ps,task);
    const i=ps.findIndex(p=>String(p.id)===String(task.processo_id));
    let p=ps[i],from=stageOf(p);
    if(from==='cadastro') {
      p=handoff(p,'iniciais',{actor,agent:'LEX Cadastro',taskId:task.id,reason:'Cadastro conferido; documentação liberada para produção'});
      from='iniciais';
    }
    if(from!==target) p=handoff(p,target,{actor,agent:task.agente||'LEX',taskId:task.id,reason:'Tarefa '+task.tipo+' iniciada pelo LEX'});
    ps[i]=p;return p;
  },actor);
  return result.value;
}
async function syncTaskResult(processStore,task,actor='LEX'){
  const target=taskResultStage(task); if(!target||!task?.processo_id) return null;
  return moveProcess(processStore,task.processo_id,target,{actor,agent:task.agente||'LEX',taskId:task.id,reason:target==='revisao'?'Entrega pronta: encaminhada para Revisão':'Pendência detectada: devolvida ao Cadastro'});
}
async function syncTaskReview(processStore,task,actor='LEX'){
  if(!task?.processo_id) return null;
  const state=await processStore.read();
  const current=state.processes.find(p=>String(p.id)===String(task.processo_id));
  if(!current) throw Object.assign(new Error('Processo não encontrado após revisão.'),{status:404});
  const target=postReviewStage(current,task);
  return moveProcess(processStore,task.processo_id,target,{actor,agent:'LEX Revisão',taskId:task.id,reason:target==='iniciais'?'Minuta aprovada; aguardando distribuição/protocolo':'Revisão concluída; retorno ao fluxo do processo'});
}
module.exports={STAGES,ALLOWED,stageOf,summary,missingDocs,checklistPendencies,cadastroPendencies,validateHandoff,handoff,taskStartStage,taskResultStage,postReviewStage,preflightTask,moveProcess,syncTaskStart,syncTaskResult,syncTaskReview};
