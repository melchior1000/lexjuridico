'use strict';
const crypto=require('node:crypto');
const Workflow=require('./workflow');
const Pipeline=require('./office-pipeline');
const Datajud=require('./datajud');
const DjenMonitor=require('./djen-monitor');
const DeadlineAuthorization=require('./deadline-authorization');
const DeadlineWatch=require('./deadline-watch');
const {normalizePartyProfile}=require('./party-profile');
const {inspectIncoming,applyInspection}=require('./process-intake');
const {createReceptionStore}=require('./whatsapp-reception-store');
const {sendChannel}=require('./channel-delivery');
const {parseOfficeCommand,commandResponse,norm:commandNorm}=require('./office-command');
const {resolveCase}=require('./task-engine');
const receptionStore=createReceptionStore();

function normalizeReceptionRow(row,origem){
  const channel=origem==='telegram'?'telegram':'whatsapp';
  const id=channel==='telegram'?String(row?.id||''):String(row?.numero||row?.number||'').replace(/\D/g,'');
  const fallback=receptionStore.categoryFor(row?.ultima_mensagem||row?.last_text||'');
  const classe=String(row?.classe||row?.category||fallback.classe||'geral');
  return {
    origem:channel,id,numero:channel==='whatsapp'?id:null,
    nome:row?.nome||row?.name||'Contato',
    ultima_mensagem:row?.ultima_mensagem||row?.last_text||'',
    classe,status:row?.status||'aguardando_advogado',
    urgente:!!(row?.urgente??row?.urgent??fallback.urgente),
    contador:Number(row?.contador||row?.count||row?.history?.filter?.(x=>x.direcao==='entrada').length||1),
    criado_em:row?.criado_em||row?.created_at||null,
    atualizado_em:row?.atualizado_em||row?.last_at||row?.criado_em||null,
    arquivado_em:row?.arquivado_em||row?.archived_at||null,
    destino:row?.destino||null
  };
}
function receptionMatches(row,filter){
  if(filter==='arquivado') return row.status==='arquivado';
  if(row.status!=='aguardando_advogado') return false;
  if(filter==='urgente') return row.urgente===true;
  if(filter==='administrativo') return !row.urgente&&row.classe==='administrativo';
  if(filter==='aguardando_advogado') return !row.urgente&&row.classe!=='administrativo';
  return false;
}
async function listUnifiedReception(deps,filter){
  if(!['arquivado','urgente','administrativo','aguardando_advogado'].includes(filter)) throw Object.assign(new Error('Filtro de recepção inválido'),{status:400});
  const waStatus=filter==='arquivado'?'arquivado':'aguardando_advogado';
  const [wa,tg]=await Promise.all([
    receptionStore.list({status:waStatus,limit:100}),
    deps.records?.list?deps.records.list('lex_recepcao_telegram_'):[]
  ]);
  return [
    ...wa.map(row=>normalizeReceptionRow(row,'whatsapp')),
    ...(tg||[]).map(row=>normalizeReceptionRow(row,'telegram'))
  ].filter(row=>receptionMatches(row,filter))
    .sort((a,b)=>(Number(b.urgente)-Number(a.urgente))||String(b.atualizado_em||'').localeCompare(String(a.atualizado_em||'')))
    .slice(0,200);
}

async function activeUnifiedReception(deps){
  const store=deps.receptionStore||receptionStore;
  const [wa,tg]=await Promise.all([
    store.list({status:'aguardando_advogado',limit:200}),
    deps.records?.list?deps.records.list('lex_recepcao_telegram_'):[]
  ]);
  return [
    ...(wa||[]).map(row=>normalizeReceptionRow(row,'whatsapp')),
    ...(tg||[]).map(row=>normalizeReceptionRow(row,'telegram'))
  ].filter(row=>row.status==='aguardando_advogado');
}
function receptionCandidates(rows,name){
  const wanted=commandNorm(name);if(!wanted)return[];
  const exact=rows.filter(row=>commandNorm(row.nome)===wanted);
  if(exact.length)return exact;
  return rows.filter(row=>commandNorm(row.nome).startsWith(wanted+' ')||commandNorm(row.nome).includes(wanted));
}
async function resolveCommandProcess(deps,command,text){
  if(!command?.requires_process)return{command};
  if(command.processo_id!=null&&String(command.processo_id).trim())return{command};
  const state=await deps.processStore.read();
  const selection=resolveCase(state.processes||[],{instrucao:String(text||'')});
  if(!selection.process)return{needs_input:true,message:selection.reason||'Informe o processo.',candidates:(selection.candidates||[]).map(p=>({id:p.id,nome:p.nome,numero:p.numero}))};
  return{command:{...command,processo_id:selection.process.id},processo:selection.process};
}
function taskMessage(task,result){
  if(!result)return'Tarefa '+String(task?.id||'').slice(0,8)+' registrada, mas a execução não foi confirmada. Confira a Central de trabalho.';
  if(result.status==='aguardando_revisao')return'Minuta pronta para revisão: '+String(result.processo_nome||result.tipo||task?.tipo)+'. Tarefa '+String(result.id||task?.id||'').slice(0,8)+'. Nenhum protocolo foi realizado.';
  if(['aguardando_dados','aguardando_documento_nitido','aguardando_configuracao','falhou'].includes(result.status))return'Tarefa '+String(result.id||task?.id||'').slice(0,8)+': '+String(result.pendencia||'precisa de revisão humana.');
  return'Tarefa '+String(result.id||task?.id||'').slice(0,8)+': '+String(result.pendencia||result.status||'em execução')+'.';
}
async function executeNaturalOfficeCommand(deps,input={}){
  const text=String(input.text||input.mensagem||'').trim();if(!text)return null;
  let command=parseOfficeCommand(text,{processo_id:input.processo_id});if(!command)return null;
  const profile=input.profile||input.perfil||'admin';
  const permissions={
    task:['admin','advogado'],lex_review:['admin','advogado'],move:['admin','advogado'],
    reply_contact:['admin','advogado','secretaria'],send_previous:['admin','advogado','secretaria'],register_contact:['admin','advogado','secretaria'],work_queue:['admin','advogado','secretaria'],
    datajud:['admin','advogado','secretaria'],court_watch:['admin','advogado','secretaria'],
    confirm_registration:['admin','advogado','secretaria'],distribute:['admin','advogado','secretaria']
  };
  if(permissions[command.action]&&!permissions[command.action].includes(profile))return{handled:true,command,message:'Seu perfil não tem permissão para executar esta ordem.'};
  const resolved=await resolveCommandProcess(deps,command,text);
  if(resolved.needs_input)return{handled:true,command,needs_input:true,message:resolved.message,candidates:resolved.candidates||[]};
  command=resolved.command;
  if(command.action==='task'||command.action==='lex_review'){
    const tipo=command.action==='lex_review'?'revisao':command.tipo;
    const taskInput={tipo,processo_id:command.processo_id,instrucao:command.instrucao||text,request_id:input.request_id||crypto.randomUUID()};
    await assertTaskGate(deps,taskInput);
    const task=await deps.engine.submit(taskInput,profile);
    if(input.defer_task===true){
      runTaskThroughOffice(deps,task,profile).catch(e=>deps.log?.('[LEX Core] '+e.message));
      const queued={...task,status:'na_fila'};
      return{handled:true,command:{...command,tipo},task,result:queued,message:'Ordem registrada para '+tipo+'. Tarefa '+String(task.id||'').slice(0,8)+' enviada ao setor '+String(task.agente||'especializado')+'; a entrega seguirá para Revisão.'};
    }
    const result=await runTaskThroughOffice(deps,task,profile);
    return{handled:true,command:{...command,tipo},task,result,message:taskMessage(task,result)};
  }
  if(command.action==='send_previous'){
    const previous=String(input.previous_text||'').trim();
    if(!command.contato)return{handled:true,command,needs_input:true,message:'Para qual contato devo enviar o texto anterior pelo '+command.canal+'?'};
    if(!previous)return{handled:true,command,needs_input:true,message:'Não encontrei um texto anterior confirmado nesta conversa para enviar. Diga o texto exato.'};
    if(previous.length>3500)return{handled:true,command,needs_input:true,message:'O texto anterior é longo demais para envio automático. Indique o trecho exato que devo mandar.'};
    return executeNaturalOfficeCommand(deps,{...input,text:'Responda a '+command.contato+': '+previous,previous_text:null,force_channel:command.canal});
  }
  if(command.action==='reply_contact'){
    const rows=await activeUnifiedReception(deps);
    const eligible=input.force_channel?rows.filter(row=>row.origem===input.force_channel):rows;
    const matches=receptionCandidates(eligible,command.contato);
    if(matches.length!==1){
      const message=matches.length?'Encontrei mais de um contato com esse nome. Informe o nome completo ou o canal.':'Não encontrei esse contato aguardando na Recepção.';
      return{handled:true,command,needs_input:true,message,candidates:matches.slice(0,8).map(x=>({nome:x.nome,origem:x.origem,id:x.id}))};
    }
    const target=matches[0];
    if(!command.texto)return{handled:true,command,needs_input:true,message:'Encontrei '+target.nome+' no '+target.origem+'. Diga o texto exato que devo enviar.',contact:{nome:target.nome,origem:target.origem,id:target.id}};
    const deliver=deps.channelDelivery||sendChannel;
    const sent=await deliver({origem:target.origem,id:target.id,texto:command.texto});
    if(sent!==true)return{handled:true,command,message:'O provedor não confirmou o envio para '+target.nome+'. Nada foi registrado como enviado.',sent:false};
    const store=deps.receptionStore||receptionStore;
    if(target.origem==='whatsapp')await store.appendEvent({numero:target.id,nome:target.nome,direcao:'saida_operador',texto:command.texto,classe:target.classe||'geral',nivel:'atencao'});
    else if(deps.records?.change)await deps.records.change('lex_recepcao_telegram_'+target.id,row=>({...row,requiresApproval:false,history:[...(row?.history||[]),{direcao:'saida_operador',texto:command.texto,criado_em:new Date().toISOString()}].slice(-50),atualizado_em:new Date().toISOString()}));
    const result={enviado:true,nome:target.nome,origem:target.origem,id:target.id};
    return{handled:true,command,result,message:commandResponse(command,result)};
  }
  if(command.action==='register_contact'){
    const rows=await activeUnifiedReception(deps);
    let matches=[];
    if(input.reception_id){
      matches=rows.filter(row=>String(row.id)===String(input.reception_id)&&(!input.reception_origin||row.origem===input.reception_origin));
    }else if(command.contato){
      matches=receptionCandidates(rows,command.contato);
    }
    if(matches.length!==1){
      const message=matches.length>1?'Encontrei mais de um contato compatível. Informe o nome completo ou o canal.':'Diga qual contato da Recepção devo cadastrar; não vou escolher uma pessoa por suposição.';
      return{handled:true,command,needs_input:true,message,candidates:(matches.length?matches:rows).slice(0,8).map(x=>({nome:x.nome,origem:x.origem,id:x.id}))};
    }
    const target=matches[0],sourceKey=target.origem+':'+target.id;
    const saved=await deps.processStore.mutate(ps=>{
      const existing=ps.find(p=>String(p?.origem_recepcao?.chave||'')===sourceKey);
      if(existing)return existing;
      const pessoa=normalizePartyProfile({nome:target.nome});
      const id='recepcao-'+crypto.createHash('sha256').update(sourceKey).digest('hex').slice(0,16);
      const processo={
        id,nome:target.nome,status:'EM_PREP',setor:'autuacao',office_stage:'cadastro',fluxo_setor:'cadastro',
        descricao:String(target.ultima_mensagem||'').slice(0,4000),cadastro_conferido:false,bloqueio_peca:true,
        tipo_pessoa:pessoa.tipo_pessoa,cpf:pessoa.cpf,cnpj:pessoa.cnpj,documento:pessoa.documento,
        nome_completo:pessoa.nome_completo,razao_social:pessoa.razao_social,nome_fantasia:pessoa.nome_fantasia,
        representante:pessoa.representante,filiais:pessoa.filiais,
        origem_recepcao:{chave:sourceKey,origem:target.origem,id:target.id,nome:target.nome},
        preparacao:{origem:'recepcao',canal:target.origem,contato_id:target.id,ultima_mensagem:target.ultima_mensagem||''}
      };
      ps.push(processo);return processo;
    },profile);
    const result={processo:saved.value,setor:Pipeline.stageOf(saved.value),message:'Cliente '+target.nome+' enviado ao Cadastro. A produção jurídica continua bloqueada até conferência dos dados e documentos.'};
    return{handled:true,command,result,message:result.message};
  }
  if(command.action==='work_queue'){
    const tasks=deps.engine?.list?await deps.engine.list():[];
    const pendingStatuses=new Set(['aguardando_dados','aguardando_documento_nitido','aguardando_configuracao','aguardando_revisao','falhou']);
    const pendentes=(tasks||[]).filter(t=>pendingStatuses.has(t?.status));
    const recepcao=await activeUnifiedReception(deps);
    const urgentes=recepcao.filter(x=>x.urgente).length;
    const message='Precisa de você: '+pendentes.length+' tarefa(s) em revisão/pendência, '+recepcao.length+' contato(s) na Recepção'+(urgentes?' ('+urgentes+' urgente(s))':'')+'.';
    return{handled:true,command,result:{tarefas:pendentes,recepcao,urgentes},message};
  }
  if(command.action==='datajud'){
    const result=await Datajud.syncProcess(deps.processStore,command.processo_id,{actor:profile,apiKey:deps.datajudApiKey??process.env.DATAJUD_API_KEY,fetchImpl:deps.datajudFetch||globalThis.fetch,integrityKey:deps.courtReadingIntegrityKey??process.env.COURT_READING_INTEGRITY_KEY});
    return{handled:true,command,result,message:commandResponse(command,result)};
  }
  if(command.action==='move'){
    const processo=await Pipeline.moveProcess(deps.processStore,command.processo_id,command.target,{actor:profile,agent:'LEX Coordenador',reason:command.reason||text});
    const result={processo,setor:Pipeline.stageOf(processo)};return{handled:true,command,result,message:commandResponse(command,result)};
  }
  if(command.action==='distribute'){
    if(!command.numero)return{handled:true,command,needs_input:true,message:'Informe o número CNJ ou protocolo já confirmado antes de registrar a distribuição.'};
    const saved=await deps.processStore.mutate(ps=>{const i=ps.findIndex(p=>String(p.id)===String(command.processo_id));if(i<0)throw Object.assign(new Error('Processo não encontrado.'),{status:404});if(Pipeline.stageOf(ps[i])!=='iniciais')throw new Error('A distribuição só pode ser confirmada quando o caso estiver em Iniciais.');const distributed=Workflow.distribute({...ps[i],office_stage:'iniciais',fluxo_setor:'iniciais'},{setor:command.setor||'judicial',numero:command.numero});ps[i]=Pipeline.handoff(distributed,'processos',{actor:profile,agent:'LEX Distribuição',reason:'Distribuição confirmada; protocolo '+String(distributed.numero||command.numero)});return ps[i]},profile);
    const result={processo:saved.value,setor:Pipeline.stageOf(saved.value),numero:saved.value?.numero||command.numero};return{handled:true,command,result,message:commandResponse(command,result)};
  }
  if(command.action==='confirm_registration')return{handled:true,command,needs_input:true,message:'Para liberar o Cadastro, confirme o checklist e os documentos na tela de Cadastro. O LEX não presume documento conferido.'};
  if(command.action==='court_watch'){
    const state=await deps.processStore.read();const integrityKey=deps.courtReadingIntegrityKey??process.env.COURT_READING_INTEGRITY_KEY;
    const items=DeadlineWatch.watchlist(state.processes,new Date(),[],[],{integrityKey});
    const result={items,itens:items};return{handled:true,command,result,message:commandResponse(command,result)};
  }
  return null;
}

async function runTaskThroughOffice(deps,task,profile){
  try{
    await Pipeline.syncTaskStart(deps.processStore,task,profile);
    const result=await deps.engine.run(task.id);
    await Pipeline.syncTaskResult(deps.processStore,result,profile);
    return result;
  }catch(e){deps.log?.('[office-pipeline] '+e.message);return null;}
}
async function assertTaskGate(deps,input){
  if(!input?.processo_id) return;
  const state=await deps.processStore.read();
  const p=state.processes.find(x=>String(x.id)===String(input.processo_id));
  if(!p) throw Object.assign(new Error('Processo selecionado não existe.'),{status:404});
  const stage=Pipeline.stageOf(p),target=Pipeline.taskStartStage(input.tipo,stage);
  if(stage==='recepcao') throw new Error('O caso ainda está na Recepção. Encaminhe ao Cadastro antes da produção jurídica.');
  if(stage==='cadastro') {
    if(!Pipeline.checklistStatus(p).conferido) throw new Error('Produção bloqueada: confira o Cadastro e resolva os documentos pendentes antes de criar a tarefa.');
    return;
  }
  if(target && stage!==target) Pipeline.validateHandoff(p,target);
}

async function officeRoutes(req,res,deps) {
  const parsedUrl=new URL(req.url,'http://lex');
  const path=parsedUrl.pathname;
  if(!path.startsWith('/api/escritorio') && !path.startsWith('/api/tarefas') && path!=='/api/trabalho' && path!=='/api/entrada-processual') return false;
  const json=(code,data)=>{res.writeHead(code,deps.headers);res.end(JSON.stringify(data));};
  const profile=deps.authenticate(req);
  if(!profile) {json(401,{error:'Não autenticado'});return true;}
  if(path==='/api/entrada-processual') {
    if(!['admin','advogado','secretaria'].includes(profile)) {json(403,{error:'Perfil sem permissão para receber documentos processuais'});return true;}
    if(req.method!=='POST') {json(405,{error:'Método não permitido'});return true;}
    try {
      const body=await deps.body(req);
      const state=await deps.processStore.read();
      let inspection=inspectIncoming(body,state.processes);
      if(!inspection.processo) {
        const saved=await deps.records.change('lex_process_inbox',old=>{
          const events=Array.isArray(old?.events)?old.events.slice():[];
          events.unshift({id:crypto.randomUUID(),...inspection,base64:undefined});
          return {events:events.slice(0,300),atualizado_em:new Date().toISOString()};
        });
        json(202,{ok:true,resultado:inspection,fila:true,fila_total:saved?.events?.length||1});
        return true;
      }
      const persisted=await deps.processStore.mutate(ps=>{
        const i=ps.findIndex(p=>String(p.id)===String(inspection.processo.id));
        if(i<0) throw new Error('Processo mudou durante a conferência. Atualize a tela.');
        const fresh=inspectIncoming(body,ps);
        if(!fresh.processo || String(fresh.processo.id)!==String(ps[i].id)) throw new Error('Identificação do processo mudou durante a conferência.');
        inspection=fresh;
        ps[i]=applyInspection(ps[i],inspection);
        return ps[i];
      },profile);
      json(200,{ok:true,resultado:inspection,processo:persisted.value,versao:persisted.version,
        mensagem:inspection.novo_andamento?'Novo andamento incorporado.':inspection.status==='provavel_duplicado'?'Arquivo já conhecido; nenhum andamento duplicado foi criado.':inspection.status==='provavel_antigo'?'Arquivo recebido, mas o evento não é posterior ao último andamento.':'Arquivo recebido e registrado para conferência.'});
    } catch(e){json(e.status||422,{error:e.message});}
    return true;
  }
  if(path==='/api/escritorio/datajud') {
    if(!['admin','advogado','secretaria'].includes(profile)) {json(403,{error:'Perfil sem permissão para consultar o Datajud'});return true;}
    if(req.method!=='POST') {json(405,{error:'Método não permitido'});return true;}
    try{
      const b=await deps.body(req);
      const options={actor:profile,apiKey:deps.datajudApiKey??process.env.DATAJUD_API_KEY,fetchImpl:deps.datajudFetch||globalThis.fetch,integrityKey:deps.courtReadingIntegrityKey??process.env.COURT_READING_INTEGRITY_KEY};
      const result=b?.processo_id?await Datajud.syncProcess(deps.processStore,b.processo_id,options):await Datajud.syncRegistered(deps.processStore,options);
      json(200,result);
    }catch(e){json(e.status||422,{error:e.message});}
    return true;
  }
  if(path==='/api/escritorio/prazos/cunhar') {
    const dbReq=typeof deps.sbReq==='function'?deps.sbReq:deps.records?.request;
    if(typeof dbReq!=='function') {json(503,{error:'Persistência de prazos indisponível'});return true;}
    if(req.method==='GET'){
      if(!['admin','advogado','secretaria'].includes(profile)) {json(403,{error:'Perfil sem permissão para consultar a fila de prazos'});return true;}
      try{
        const items=await DjenMonitor.listPendingMint(dbReq,Number(parsedUrl.searchParams.get('limit'))||100);
        json(200,{ok:true,total:items.length,items});
      }catch(e){json(e.status||422,{error:e.message});}
      return true;
    }
    if(req.method==='POST'){
      if(!['admin','advogado'].includes(profile)) {json(403,{error:'Perfil sem permissão para confirmar prazo jurídico'});return true;}
      try{
        const b=await deps.body(req);
        const result=await DeadlineAuthorization.confirmDjenDeadline({
          processStore:deps.processStore,sbReq:dbReq,djenId:b?.djen_id,dueAt:b?.due_at,humanId:profile,
          regime:b?.regime||'manual',note:b?.observacao||'',suggestionSourceHash:b?.suggestion_source_hash||null,
          integrityKey:deps.courtReadingIntegrityKey??process.env.COURT_READING_INTEGRITY_KEY,
          maxAgeMs:Number.isFinite(deps.deadlineAuthorizationMaxAgeMs)?deps.deadlineAuthorizationMaxAgeMs:undefined
        });
        json(200,result);
      }catch(e){json(e.status||422,{error:e.message});}
      return true;
    }
    json(405,{error:'Método não permitido'});return true;
  }
  if(path==='/api/escritorio/cadastro/conferir') {
    if(!['admin','advogado','secretaria'].includes(profile)) {json(403,{error:'Perfil sem permissão para conferir cadastro'});return true;}
    if(req.method!=='POST') {json(405,{error:'Método não permitido'});return true;}
    try{
      const b=await deps.body(req);
      if(!b?.processo_id) throw new Error('Informe o processo para conferência.');
      const processo=await Pipeline.confirmAndForwardRegistration(deps.processStore,b.processo_id,b.checklist,profile);
      const check=Pipeline.checklistStatus(processo);
      json(200,{ok:true,processo,conferido:check.conferido,pendentes:check.pendentes,documentos_faltantes:check.faltando||null,bloqueio_peca:!check.conferido,setor:Pipeline.stageOf(processo)});
    }catch(e){json(e.status||422,{error:e.message});}
    return true;
  }
  if(path==='/api/escritorio/distribuir') {
    if(!['admin','advogado','secretaria'].includes(profile)) {json(403,{error:'Perfil sem permissão para confirmar distribuição'});return true;}
    if(req.method!=='POST') {json(405,{error:'Método não permitido'});return true;}
    try{
      const b=await deps.body(req),processoId=b?.processo_id;
      if(!processoId) throw new Error('Informe o processo para confirmar a distribuição.');
      const destinoLegado=String(b.setor||'judicial').trim().toLowerCase(),numero=String(b.numero||'').trim();
      const saved=await deps.processStore.mutate(ps=>{
        const i=ps.findIndex(p=>String(p.id)===String(processoId));
        if(i<0) throw Object.assign(new Error('Processo não encontrado.'),{status:404});
        if(Pipeline.stageOf(ps[i])!=='iniciais') throw new Error('A distribuição só pode ser confirmada quando o caso estiver em Iniciais.');
        const current={...ps[i],office_stage:'iniciais',fluxo_setor:'iniciais'};
        const distributed=Workflow.distribute(current,{setor:destinoLegado,numero});
        const destinoOffice=destinoLegado==='entregue'?'concluidos':'processos';
        ps[i]=Pipeline.handoff(distributed,destinoOffice,{actor:profile,agent:'LEX Distribuição',reason:destinoLegado==='entregue'?'Entrega confirmada':'Distribuição confirmada; protocolo '+String(distributed.numero||numero)});
        return ps[i];
      },profile);
      const processo=saved.value;
      json(200,{ok:true,processo,setor:Pipeline.stageOf(processo),numero:processo.numero||null,status:processo.status||null,setores:Pipeline.summary(saved.processes)});
    }catch(e){json(e.status||422,{error:e.message});}
    return true;
  }
  const secretariaPodePreparar=profile==='secretaria'&&path==='/api/escritorio/preparacao'&&req.method==='POST';
  const secretariaPodeRecepcao=profile==='secretaria'&&path.startsWith('/api/escritorio/recepcao');
  if(!['admin','advogado'].includes(profile) && !secretariaPodePreparar && !secretariaPodeRecepcao) {json(403,{error:'Acesso restrito ao responsável jurídico'});return true;}
  try {
    if(path==='/api/escritorio/recepcao' && req.method==='GET') {
      if(!['admin','advogado','secretaria'].includes(profile)) {json(403,{error:'Recepção restrita à equipe autorizada'});return true;}
      const filter=String(parsedUrl.searchParams.get('status')||'aguardando_advogado');
      const rows=await listUnifiedReception(deps,filter);
      json(200,{ok:true,status:filter,contatos:rows,canais:['whatsapp','telegram']});
    } else if(path==='/api/escritorio/recepcao/historico' && req.method==='GET') {
      if(!['admin','advogado','secretaria'].includes(profile)) {json(403,{error:'Recepção restrita à equipe autorizada'});return true;}
      const origem=String(parsedUrl.searchParams.get('origem')||'').toLowerCase();
      const id=String(parsedUrl.searchParams.get('id')||'').replace(/\D/g,'');
      if(!['whatsapp','telegram'].includes(origem)||!id) throw new Error('Informe canal e contato.');
      let historico=[];
      if(origem==='whatsapp') historico=(await receptionStore.history(id,{limit:50})).slice().reverse();
      else {
        const row=(await deps.records.read('lex_recepcao_telegram_'+id))?.value;
        if(!row) throw Object.assign(new Error('Contato não encontrado na recepção.'),{status:404});
        historico=Array.isArray(row.history)?row.history.slice(-50):[];
      }
      json(200,{ok:true,origem,id,historico});
    } else if(path==='/api/escritorio/recepcao/responder' && req.method==='POST') {
      if(!['admin','advogado','secretaria'].includes(profile)) {json(403,{error:'Recepção restrita à equipe autorizada'});return true;}
      const body=await deps.body(req),origem=String(body?.origem||'').toLowerCase();
      const id=String(body?.id||body?.numero||'').replace(/\D/g,''),texto=String(body?.texto||'').trim();
      if(!['whatsapp','telegram'].includes(origem)||!id) throw new Error('Informe canal e contato.');
      if(!texto||texto.length>3500) throw new Error('Informe o texto exato, de até 3500 caracteres.');
      const deliver=deps.channelDelivery||sendChannel;
      const sent=await deliver({origem,id,texto});
      if(sent!==true) {json(502,{error:'Envio não confirmado pelo provedor. Nada foi registrado como enviado.'});return true;}
      if(origem==='whatsapp') await receptionStore.appendEvent({numero:id,direcao:'saida_operador',texto});
      else await deps.records.change('lex_recepcao_telegram_'+id,row=>{
        if(!row) throw Object.assign(new Error('Contato não encontrado na recepção.'),{status:404});
        return {...row,requiresApproval:false,history:[...(row.history||[]),{direcao:'saida_operador',texto,criado_em:new Date().toISOString()}].slice(-50),atualizado_em:new Date().toISOString()};
      });
      json(200,{ok:true,origem,id,enviado:true});
    } else if(path==='/api/escritorio/recepcao/arquivar' && req.method==='POST') {
      if(!['admin','advogado','secretaria'].includes(profile)) {json(403,{error:'Recepção restrita à equipe autorizada'});return true;}
      const body=await deps.body(req),origem=String(body?.origem||'whatsapp').toLowerCase();
      const id=String(body?.id||body?.numero||'').replace(/\D/g,'');
      if(origem==='whatsapp') {
        if(!/^55\d{10,11}$/.test(id)) {json(422,{error:'Número de WhatsApp inválido'});return true;}
        if(!await receptionStore.archive(id)) {json(404,{error:'Contato não encontrado na fila'});return true;}
      } else if(origem==='telegram') {
        if(!/^\d{1,20}$/.test(id)) throw new Error('ID de Telegram inválido.');
        const row=(await deps.records.read('lex_recepcao_telegram_'+id))?.value;
        if(!row) {json(404,{error:'Contato não encontrado na fila'});return true;}
        await deps.records.change('lex_recepcao_telegram_'+id,old=>({...old,status:'arquivado',arquivado_em:new Date().toISOString(),atualizado_em:new Date().toISOString()}));
      } else throw new Error('Canal de recepção inválido.');
      json(200,{ok:true,origem,id,status:'arquivado'});
    } else if(path==='/api/escritorio' && req.method==='GET') {
      const office=(await deps.records.read('lex_office'))?.value||{};
      json(200,{ok:true,escritorio:office,isolamento:'instancia_dedicada',configurado:!!(office.nome&&office.registro&&office.responsavel)});
    } else if(path==='/api/escritorio' && req.method==='POST') {
      if(profile!=='admin') {json(403,{error:'Somente administrador configura o escritório'});return true;}
      const body=await deps.body(req);const office={};
      for(const k of ['nome','responsavel','registro','endereco','telefone','email']) office[k]=String(body[k]||'').trim().slice(0,300);
      if(!office.nome || !office.responsavel || !office.registro) throw new Error('Informe escritório, advogado responsável e inscrição profissional.');
      const result=await deps.records.change('lex_office',old=>({...office,id:old?.id||crypto.randomUUID(),configurado:true,atualizado_em:new Date().toISOString()}));
      deps.setOffice(result);json(200,{ok:true,escritorio:result});
    } else if(path==='/api/escritorio/preparacao' && req.method==='POST') {
      const b=await deps.body(req);const c=b.caso;
      if(!c?.id || !c.nome) throw new Error('Caso e nome obrigatórios.');
      const pessoa=normalizePartyProfile(c);
      const result=await deps.processStore.mutate(ps=>{
        const i=ps.findIndex(p=>String(p.id)===String(c.id));
        if(i>=0 && Workflow.sector(ps[i])!=='autuacao' && !['cadastro','iniciais'].includes(Pipeline.stageOf(ps[i]))) throw new Error('Este caso já saiu da preparação. Atualize a tela.');
        const prep={...c,...pessoa};
        const old=i>=0?ps[i]:{};
        const p={...old,id:c.id,nome:String(c.nome),setor:'autuacao',status:c.status||'EM_PREP',office_stage:'cadastro',fluxo_setor:'cadastro',
          area:c.area||'',numero:c.numero||'',partes:c.partes||'',tribunal:c.tribunal||'',descricao:c.obs||c.descricao||'',
          docsFaltantes:c.faltando||'',tipo_pessoa:pessoa.tipo_pessoa,cpf:pessoa.cpf,cnpj:pessoa.cnpj,documento:pessoa.documento,
          nome_completo:pessoa.nome_completo,razao_social:pessoa.razao_social,nome_fantasia:pessoa.nome_fantasia,
          representante:pessoa.representante,filiais:pessoa.filiais,preparacao:prep,cadastro_conferido:false,bloqueio_peca:true,checklist_cadastro:old.checklist_cadastro||{},atualizado_em:new Date().toISOString()};
        if(Array.isArray(b.documentos))p.arquivos=b.documentos;
        if(i<0)ps.push(p);else ps[i]=p;
        return p;
      },profile);
      json(200,{ok:true,processo:result.value,processos:result.processes,versao:result.version,setores:Pipeline.summary(result.processes)});
    } else if(path==='/api/escritorio/mover' && req.method==='POST') {
      const b=await deps.body(req);
      if(!b?.processo_id || !b?.destino) throw new Error('Informe processo e setor de destino.');
      const motivo=String(b.motivo||'').trim();
      if(!motivo) throw new Error('Informe o motivo da transferência.');
      const processo=await Pipeline.moveProcess(deps.processStore,b.processo_id,b.destino,{actor:profile,agent:'LEX Coordenador',reason:motivo,allowReopen:b.reabrir===true});
      const state=await deps.processStore.read();
      json(200,{ok:true,processo,setor:Pipeline.stageOf(processo),setores:Pipeline.summary(state.processes)});
    } else if(path==='/api/trabalho' && req.method==='GET') {
      const recovered=typeof deps.engine.recoverStale==='function'?await deps.engine.recoverStale():[];
      for(const task of recovered) runTaskThroughOffice(deps,task,profile).catch(e=>deps.log?.(e.message));
      const state=await deps.processStore.read();
      const tasks=await deps.engine.list();
      const notices=(await deps.records.read('lex_notifications'))?.value?.events||[];
      const dbReq=typeof deps.sbReq==='function'?deps.sbReq:deps.records?.request;
      let cunhar=[],deadlineError=null;
      if(typeof dbReq==='function'){
        try{cunhar=await DjenMonitor.listPendingMint(dbReq,100)}catch(e){deadlineError=e.message}
      }
      const integrityKey=deps.courtReadingIntegrityKey??process.env.COURT_READING_INTEGRITY_KEY;
      const deadlineWatch=DeadlineWatch.watchlist(state.processes,new Date(),[],[],{integrityKey});
      const todosPrazos=deadlineWatch.filter(x=>x.deadline_legal_truth&&x.days_to_due!=null);
      const correndo=todosPrazos.filter(x=>x.days_to_due<=5);
      const vigia=(await deps.records.read('lex_deadline_daily_job'))?.value||null;
      json(200,{ok:true,contagens:{...Workflow.summary(state.processes),setores:Pipeline.summary(state.processes)},versao:state.version,
        tarefas:tasks.map(({resultado,...task})=>({...task,tem_documento:!!resultado})),avisos:notices.length,
        prazos:{cunhar,correndo,todos:todosPrazos,vigia,erro:deadlineError},
        atualizacao:'banco',ia_configurada:deps.aiAvailable(),versao_aplicacao:'2026.09.20-deadline-desk'});
    } else if(path==='/api/tarefas' && req.method==='POST') {
      const input=await deps.body(req);
      await assertTaskGate(deps,input);
      const task=await deps.engine.submit(input,profile);
      json(202,{ok:true,tarefa:task});
      runTaskThroughOffice(deps,task,profile).catch(e=>deps.log?.(e.message));
    } else if(path==='/api/tarefas' && req.method==='GET') {
      const id=parsedUrl.searchParams.get('id');
      const task=await deps.engine.get(id);
      if(!task) json(404,{error:'Tarefa não encontrada'});else json(200,{ok:true,tarefa:task});
    } else if(path==='/api/tarefas/retomar' && req.method==='POST') {
      const b=await deps.body(req);
      const existing=await deps.engine.get(b.id);
      if(!existing) throw Object.assign(new Error('Tarefa não encontrada.'),{status:404});
      await assertTaskGate(deps,existing);
      const task=await deps.engine.retry(b.id);json(202,{ok:true});
      runTaskThroughOffice(deps,task,profile).catch(e=>deps.log?.(e.message));
    } else if(path==='/api/tarefas/devolver' && req.method==='POST') {
      const b=await deps.body(req);const motivo=String(b.motivo||'').trim();
      const current=await deps.engine.get(b.id);
      if(!current) throw Object.assign(new Error('Tarefa não encontrada.'),{status:404});
      const destino=['pericia','quesitos'].includes(current.tipo)?'pericia':'pecas';
      const task=await deps.engine.returnForCorrection(b.id,motivo,profile);
      const processo=await Pipeline.moveProcess(deps.processStore,task.processo_id,destino,{actor:profile,agent:'LEX Revisão',taskId:task.id,reason:'Revisão devolveu para correção: '+motivo});
      json(202,{ok:true,tarefa:task,processo,setor:Pipeline.stageOf(processo)});
      runTaskThroughOffice(deps,task,profile).catch(e=>deps.log?.(e.message));
    } else if(path==='/api/tarefas/revisar' && req.method==='POST') {
      const b=await deps.body(req);const task=await deps.engine.review(b.id,b.sha256,profile);
      const processo=await Pipeline.syncTaskReview(deps.processStore,task,profile);
      json(200,{ok:true,tarefa:task,processo,setor:processo?Pipeline.stageOf(processo):null});
    } else if(path==='/api/tarefas/documento' && req.method==='GET') {
      const task=await deps.engine.get(parsedUrl.searchParams.get('id'));
      if(!task?.resultado) throw new Error('A tarefa ainda não produziu documento.');
      const bytes=deps.docx(task.processo_nome||task.tipo,task.resultado,'Minuta para revisão');
      res.writeHead(200,{...deps.headers,'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition':'attachment; filename="LEX_'+task.tipo+'_'+task.id.slice(0,8)+'.docx"'});res.end(bytes);
    } else json(404,{error:'Operação não encontrada'});
  }catch(e){json(e.status||422,{error:e.message});}
  return true;
}
module.exports={officeRoutes,runTaskThroughOffice,assertTaskGate,executeNaturalOfficeCommand,activeUnifiedReception};
