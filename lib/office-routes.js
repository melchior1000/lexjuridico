'use strict';
const crypto=require('node:crypto');
const Workflow=require('./workflow');
const Pipeline=require('./office-pipeline');
const {normalizePartyProfile}=require('./party-profile');
const {inspectIncoming,applyInspection}=require('./process-intake');
const {createReceptionStore}=require('./whatsapp-reception-store');
const receptionStore=createReceptionStore();

async function runTaskThroughOffice(deps,task,profile){
  try{
    await Pipeline.syncTaskStart(deps.processStore,task,profile);
    const result=await deps.engine.run(task.id);
    await Pipeline.syncTaskResult(deps.processStore,result,profile);
    return result;
  }catch(e){deps.log?.('[office-pipeline] '+e.message);return null;}
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

  if(path==='/api/escritorio/cadastro/conferir') {
    if(!['admin','advogado','secretaria'].includes(profile)) {json(403,{error:'Perfil sem permissão para conferir cadastro'});return true;}
    if(req.method!=='POST') {json(405,{error:'Método não permitido'});return true;}
    try{
      const b=await deps.body(req);
      if(!b?.processo_id) throw new Error('Informe o processo para conferência.');
      const processo=await Pipeline.confirmProcessRegistration(deps.processStore,b.processo_id,b.checklist,profile);
      const check=Pipeline.checklistStatus(processo);
      json(200,{ok:true,processo,conferido:check.conferido,pendentes:check.pendentes,documentos_faltantes:check.faltando||null,bloqueio_peca:!check.conferido});
    }catch(e){json(e.status||422,{error:e.message});}
    return true;
  }

  if(!['admin','advogado'].includes(profile)) {json(403,{error:'Acesso restrito ao responsável jurídico'});return true;}
  try {
    if(path==='/api/escritorio/recepcao' && req.method==='GET') {
      if(profile!=='admin') {json(403,{error:'Recepção restrita ao administrador'});return true;}
      const filter=String(parsedUrl.searchParams.get('status')||'aguardando_advogado');
      let rows;
      if(filter==='arquivado') rows=await receptionStore.list({status:'arquivado',limit:100});
      else {
        const pending=await receptionStore.list({status:'aguardando_advogado',limit:100});
        if(filter==='urgente') rows=pending.filter(x=>x.urgente===true);
        else if(filter==='administrativo') rows=pending.filter(x=>x.classe==='administrativo' && x.urgente!==true);
        else if(filter==='aguardando_advogado') rows=pending.filter(x=>x.urgente!==true && x.classe!=='administrativo');
        else {json(400,{error:'Filtro de recepção inválido'});return true;}
      }
      json(200,{ok:true,status:filter,contatos:rows});
    } else if(path==='/api/escritorio/recepcao/arquivar' && req.method==='POST') {
      if(profile!=='admin') {json(403,{error:'Recepção restrita ao administrador'});return true;}
      const body=await deps.body(req);
      const numero=String(body?.numero||'').replace(/\D/g,'');
      if(!/^55\d{10,11}$/.test(numero)) {json(422,{error:'Número de WhatsApp inválido'});return true;}
      const archived=await receptionStore.archive(numero);
      if(!archived) {json(404,{error:'Contato não encontrado na fila'});return true;}
      json(200,{ok:true,numero,status:'arquivado'});
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
      const state=await deps.processStore.read();
      const tasks=await deps.engine.list();
      const notices=(await deps.records.read('lex_notifications'))?.value?.events||[];
      json(200,{ok:true,contagens:{...Workflow.summary(state.processes),setores:Pipeline.summary(state.processes)},versao:state.version,
        tarefas:tasks.map(({resultado,...task})=>({...task,tem_documento:!!resultado})),avisos: notices.length,
        atualizacao:'banco',ia_configurada:deps.aiAvailable(),versao_aplicacao:'2026.09.14-office-checklist'});
    } else if(path==='/api/tarefas' && req.method==='POST') {
      const task=await deps.engine.submit(await deps.body(req),profile);
      json(202,{ok:true,tarefa:task});
      runTaskThroughOffice(deps,task,profile).catch(e=>deps.log?.(e.message));
    } else if(path==='/api/tarefas' && req.method==='GET') {
      const id=parsedUrl.searchParams.get('id');
      const task=await deps.engine.get(id);
      if(!task) json(404,{error:'Tarefa não encontrada'});else json(200,{ok:true,tarefa:task});
    } else if(path==='/api/tarefas/retomar' && req.method==='POST') {
      const b=await deps.body(req);const task=await deps.engine.retry(b.id);json(202,{ok:true});
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
module.exports={officeRoutes,runTaskThroughOffice};
