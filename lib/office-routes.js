'use strict';
const crypto=require('node:crypto');
const Workflow=require('./workflow');
const {normalizePartyProfile}=require('./party-profile');
async function officeRoutes(req,res,deps) {
  const path=new URL(req.url,'http://lex').pathname;
  if(!path.startsWith('/api/escritorio') && !path.startsWith('/api/tarefas') && path!=='/api/trabalho') return false;
  const json=(code,data)=>{res.writeHead(code,deps.headers);res.end(JSON.stringify(data));};
  const profile=deps.authenticate(req);
  if(!profile) {json(401,{error:'Não autenticado'});return true;}
  if(!['admin','advogado'].includes(profile)) {json(403,{error:'Acesso restrito ao responsável jurídico'});return true;}
  try {
    if(path==='/api/escritorio' && req.method==='GET') {
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
        if(i>=0 && Workflow.sector(ps[i])!=='autuacao') throw new Error('Este caso já saiu da preparação. Atualize a tela.');
        const prep={...c,...pessoa};
        const p={...(i>=0?ps[i]:{}),id:c.id,nome:String(c.nome),setor:'autuacao',status:c.status||'EM_PREP',
          area:c.area||'',numero:c.numero||'',partes:c.partes||'',tribunal:c.tribunal||'',descricao:c.obs||c.descricao||'',
          docsFaltantes:c.faltando||'',tipo_pessoa:pessoa.tipo_pessoa,cpf:pessoa.cpf,cnpj:pessoa.cnpj,documento:pessoa.documento,
          nome_completo:pessoa.nome_completo,razao_social:pessoa.razao_social,nome_fantasia:pessoa.nome_fantasia,
          representante:pessoa.representante,filiais:pessoa.filiais,preparacao:prep,atualizado_em:new Date().toISOString()};
        if(Array.isArray(b.documentos))p.arquivos=b.documentos;
        if(i<0)ps.push(p);else ps[i]=p;
        return p;
      },profile);
      json(200,{ok:true,processo:result.value,processos:result.processes,versao:result.version});
    } else if(path==='/api/trabalho' && req.method==='GET') {
      const state=await deps.processStore.read();
      const tasks=await deps.engine.list();
      const notices=(await deps.records.read('lex_notifications'))?.value?.events||[];
      json(200,{ok:true,contagens:Workflow.summary(state.processes),versao:state.version,
        tarefas:tasks.map(({resultado,...task})=>({...task,tem_documento:!!resultado})),avisos: notices.length,
        atualizacao:'banco',ia_configurada:deps.aiAvailable(),versao_aplicacao:'2026.09.10-pfpj'});
    } else if(path==='/api/tarefas' && req.method==='POST') {
      const task=await deps.engine.submit(await deps.body(req),profile);
      json(202,{ok:true,tarefa:task});
      deps.engine.run(task.id).catch(e=>deps.log(e.message));
    } else if(path==='/api/tarefas' && req.method==='GET') {
      const id=new URL(req.url,'http://lex').searchParams.get('id');
      const task=await deps.engine.get(id);
      if(!task) json(404,{error:'Tarefa não encontrada'});else json(200,{ok:true,tarefa:task});
    } else if(path==='/api/tarefas/retomar' && req.method==='POST') {
      const b=await deps.body(req);await deps.engine.retry(b.id);json(202,{ok:true});
      deps.engine.run(b.id).catch(e=>deps.log(e.message));
    } else if(path==='/api/tarefas/revisar' && req.method==='POST') {
      const b=await deps.body(req);const task=await deps.engine.review(b.id,b.sha256,profile);json(200,{ok:true,tarefa:task});
    } else if(path==='/api/tarefas/documento' && req.method==='GET') {
      const task=await deps.engine.get(new URL(req.url,'http://lex').searchParams.get('id'));
      if(!task?.resultado) throw new Error('A tarefa ainda não produziu documento.');
      const bytes=deps.docx(task.processo_nome||task.tipo,task.resultado,'Minuta para revisão');
      res.writeHead(200,{...deps.headers,'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition':'attachment; filename="LEX_'+task.tipo+'_'+task.id.slice(0,8)+'.docx"'});res.end(bytes);
    } else json(404,{error:'Operação não encontrada'});
  }catch(e){json(e.status||422,{error:e.message});}
  return true;
}
module.exports={officeRoutes};
