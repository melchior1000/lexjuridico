'use strict';
const crypto=require('node:crypto');

const STAGES=['recepcao','cadastro','iniciais','processos','prazos','pecas','pericia','revisao','concluidos'];
const CLOSED=new Set(['CONCLUIDO','ENTREGUE','ARQUIVADO','GANHO','PERDIDO']);
const ALLOWED={
  recepcao:new Set(['cadastro','concluidos']),
  cadastro:new Set(['recepcao','iniciais','concluidos']),
  iniciais:new Set(['cadastro','pecas','revisao','processos','concluidos']),
  processos:new Set(['cadastro','prazos','pecas','pericia','revisao','concluidos']),
  prazos:new Set(['cadastro','processos','pecas','pericia','revisao','concluidos']),
  pecas:new Set(['cadastro','processos','revisao','concluidos']),
  pericia:new Set(['cadastro','processos','revisao','concluidos']),
  revisao:new Set(['cadastro','iniciais','processos','prazos','pecas','pericia','concluidos']),
  concluidos:new Set(['processos'])
};
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function array(v){if(Array.isArray(v))return v;try{const x=JSON.parse(v);return Array.isArray(x)?x:[]}catch{return[]}}
function missingDocs(p){return String(p?.docsFaltantes||p?.docs_faltantes||p?.preparacao?.faltando||'').trim()}
function stageOf(p={}){
  const explicit=norm(p.office_stage||p.fluxo_setor||p.setor_fluxo);
  if(STAGES.includes(explicit)) return explicit;
  if(CLOSED.has(String(p.status||'').toUpperCase())) return 'concluidos';
  if(missingDocs(p)) return 'cadastro';
  if(String(p.setor||'').toLowerCase()==='autuacao' || ['EM_PREP','PRONTO','AGUARDANDO_APROVACAO'].includes(String(p.status||'').toUpperCase())) return 'iniciais';
  if(p.prazoReal||p.prazo) return 'prazos';
  return 'processos';
}
function summary(processes=[]){
  const counts=Object.fromEntries(STAGES.map(s=>[s,0]));
  for(const p of array(processes)) counts[stageOf(p)]++;
  counts.total=array(processes).length;
  return counts;
}
function eventFor(from,to,meta={}){
  return {id:crypto.randomUUID(),de:from,para:to,por:String(meta.actor||meta.agent||'LEX'),agente:String(meta.agent||'LEX'),motivo:String(meta.reason||'Transferência de setor'),task_id:meta.taskId||null,criado_em:meta.now||new Date().toISOString()};
}
function validateHandoff(current,to,{allowReopen=false}={}){
  const from=stageOf(current);
  const target=norm(to);
  if(!STAGES.includes(target)) throw new Error('Setor de destino inválido.');
  if(from===target) return {from,target};
  if(from==='concluidos' && target==='processos' && !allowReopen) throw new Error('Reabertura exige confirmação explícita.');
  if(!ALLOWED[from]?.has(target)) throw new Error('Transferência inválida: '+from+' → '+target+'.');
  if(from==='cadastro' && target==='iniciais' && missingDocs(current)) throw new Error('Cadastro incompleto: existem documentos pendentes.');
  if(target==='processos' && from==='iniciais' && !String(current.numero||'').trim()) throw new Error('Processo sem número/protocolo: confirme a distribuição antes de enviar para Processos.');
  return {from,target};
}
function handoff(current,to,meta={}){
  const {from,target}=validateHandoff(current,to,meta);
  if(from===target) return current;
  const ev=eventFor(from,target,meta);
  return {...current,office_stage:target,fluxo_setor:target,office_events:[ev,...array(current.office_events)].slice(0,200),office_last_event:ev,atualizado_em:ev.criado_em};
}
function taskStartStage(type){return ['pericia','quesitos'].includes(type)?'pericia':'pecas'}
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
  if(!task?.processo_id) return null;
  return moveProcess(processStore,task.processo_id,taskStartStage(task.tipo),{actor,agent:task.agente||'LEX',taskId:task.id,reason:'Tarefa '+task.tipo+' iniciada pelo LEX'});
}
async function syncTaskResult(processStore,task,actor='LEX'){
  const target=taskResultStage(task); if(!target||!task?.processo_id) return null;
  return moveProcess(processStore,task.processo_id,target,{actor,agent:task.agente||'LEX',taskId:task.id,reason:target==='revisao'?'Entrega pronta: encaminhada para Revisão':'Pendência detectada: devolvida ao Cadastro'});
}
async function syncTaskReview(processStore,task,actor='LEX'){
  if(!task?.processo_id) return null;
  let current;
  const state=await processStore.read();
  current=state.processes.find(p=>String(p.id)===String(task.processo_id));
  if(!current) throw Object.assign(new Error('Processo não encontrado após revisão.'),{status:404});
  const target=postReviewStage(current,task);
  return moveProcess(processStore,task.processo_id,target,{actor,agent:'LEX Revisão',taskId:task.id,reason:target==='iniciais'?'Minuta aprovada; aguardando distribuição/protocolo':'Revisão concluída; retorno ao fluxo do processo'});
}
module.exports={STAGES,ALLOWED,stageOf,summary,missingDocs,validateHandoff,handoff,taskStartStage,taskResultStage,postReviewStage,moveProcess,syncTaskStart,syncTaskResult,syncTaskReview};
