/* Interface de trabalho: usa os controles e temas do LEX existente. */
let lexWorkTimer=null;
const lexTaskStatus={na_fila:'Na fila',executando:'Em execução',aguardando_dados:'Precisa de informação',aguardando_documento_nitido:'Documento legível necessário',aguardando_configuracao:'Configuração pendente',aguardando_revisao:'Revisar entrega',concluida:'Concluída',falhou:'Falhou'};
async function lexApi(path,options={}) {
  const timeoutMs=Number(options.timeoutMs)||30000;
  const requestOptions={...options};delete requestOptions.timeoutMs;
  try{
    const response=await fetchComTimeout(SERVIDOR+path,{...requestOptions,headers:{'Content-Type':'application/json',Authorization:'Bearer '+getAuthToken(),...(requestOptions.headers||{})}},timeoutMs);
    const data=await response.json();
    if(!response.ok || data.ok===false) throw new Error(data.error||'Não foi possível confirmar a operação.');
    return data;
  }catch(error){
    if(error?.name==='AbortError'||/aborted|abort/i.test(String(error?.message||''))){
      throw new Error('O servidor demorou para confirmar a operação. Não repita o envio até conferir se a mensagem chegou.');
    }
    throw error;
  }
}
function lexRefreshCurrent() {
  atualizarUrgentes();
  if(typeof pag!=='undefined' && pag==='trabalho') renderTrabalho();
  else if(typeof ir==='function' && typeof pag!=='undefined') ir(pag,null);
}
function lexTaskCard(t) {
  const done=['concluida','aguardando_revisao'].includes(t.status);
  return `<article class="work-task"><div class="work-task-head"><strong>${lexEscape(t.processo_nome||t.instrucao||t.tipo)}</strong><span class="work-state ${done?'ready':''}">${lexEscape(lexTaskStatus[t.status]||t.status)}</span></div>
    <p>${lexEscape(t.agente)} · ${lexEscape(t.tipo)} · ${lexEscape(t.id.slice(0,8))}</p>
    ${t.pendencia?`<p>${lexEscape(t.pendencia)}</p>`:''}<div class="work-actions">
    ${t.tem_documento||t.resultado?`<button class="btn-outline" onclick="lexDownloadTask('${t.id}')">Baixar Word</button>`:''}
    ${t.status==='aguardando_revisao'?`<button class="btn-outline" onclick="lexReviewTask('${t.id}')">Conferi a minuta</button>`:''}
    ${['falhou','aguardando_dados','aguardando_documento_nitido','aguardando_configuracao'].includes(t.status)?`<button class="btn-outline" onclick="lexRetryTask('${t.id}')">Tentar após corrigir</button>`:''}
    </div></article>`;
}
// Linha do tempo da tarefa a partir dos carimbos REAIS gravados pelo Task Engine
// (criada_em, iniciada_em, triagem, resultado, correcao_solicitada, revisado_em, pendencia).
// Nada é estimado: sem carimbo, sem evento. Ordem cronológica.
function lexTaskTimeline(t){
  const ev=[];
  const when=v=>{const d=v?new Date(v):null;return d&&!Number.isNaN(d.getTime())?d:null};
  const hm=d=>d?d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'';
  const push=(d,titulo,detalhe,estado)=>ev.push({d,hora:hm(d),titulo,detalhe:detalhe||'',estado:estado||'feito'});
  push(when(t.criada_em),'Recebi a ordem',(t.tipo||'')+(t.instrucao?' · '+String(t.instrucao).slice(0,120):''));
  if(t.processo_nome||t.processo_id)push(when(t.iniciada_em||t.criada_em),'Identifiquei o processo',t.processo_nome||('id '+String(t.processo_id).slice(0,12)));
  if(t.iniciada_em)push(when(t.iniciada_em),'Comecei a executar',(t.agente||'')+(Number(t.tentativas)>1?' · tentativa '+t.tentativas:''));
  if(t.triagem)push(when(t.iniciada_em),'Conferi cabimento e fontes',t.triagem.cabivel===true?'Cabível com as fontes do processo':'Triagem registrada');
  if(t.recuperada_em)push(when(t.recuperada_em),'Recuperei a tarefa após interrupção','Voltou para a fila sem duplicar');
  if(t.correcao_solicitada)push(when(t.atualizada_em),'Devolvida para correção',t.correcao_solicitada);
  if(t.status==='aguardando_revisao')push(when(t.atualizada_em||t.iniciada_em),'Minuta pronta — aguarda sua revisão',t.tem_documento||t.resultado?'Documento disponível para baixar':'','espera');
  if(t.status==='concluida')push(when(t.revisado_em||t.atualizada_em),'Aprovada por você',t.revisado_por?'por '+t.revisado_por:'');
  if(['aguardando_dados','aguardando_documento_nitido','aguardando_configuracao'].includes(t.status))push(when(t.atualizada_em||t.iniciada_em),lexTaskStatus[t.status]||t.status,t.pendencia||'','espera');
  if(t.status==='falhou')push(when(t.atualizada_em),'Falhou',t.pendencia||'','erro');
  if(t.status==='executando')push(null,'Executando agora',t.agente||'','agora');
  if(t.status==='na_fila')push(null,'Na fila','Começo assim que houver vaga','agora');
  return ev;
}
function lexTaskTimelineHtml(t){
  const ev=lexTaskTimeline(t);
  if(!ev.length)return '';
  return '<ol class="lex-task-timeline">'+ev.map(e=>`<li class="${e.estado}"><i></i><div><div class="tt-head"><strong>${lexEscape(e.titulo)}</strong>${e.hora?`<span>${lexEscape(e.hora)}</span>`:''}</div>${e.detalhe?`<small>${lexEscape(e.detalhe)}</small>`:''}</div></li>`).join('')+'</ol>';
}
// "Precisa de você": QUEM + O QUÊ + POR QUÊ + AÇÃO, só quando o Task Engine realmente espera o humano.
function lexTaskNeedsYouHtml(t){
  const need={aguardando_revisao:['Revisar a minuta','O LEX não protocola nem envia nada sem a sua conferência.'],aguardando_dados:['Completar a informação',t.pendencia||'Falta um dado para continuar.'],aguardando_documento_nitido:['Enviar documento legível',t.pendencia||'O documento anexado não está legível.'],aguardando_configuracao:['Configurar o servidor',t.pendencia||'A IA do servidor não está configurada.'],falhou:['Decidir se tento de novo',t.pendencia||'A execução falhou.']}[t.status];
  if(!need)return '';
  const actions=(t.status==='aguardando_revisao'?`<button onclick="lexReviewTask('${t.id}')">Conferi a minuta</button>${t.tem_documento||t.resultado?`<button class="btn-outline" onclick="lexDownloadTask('${t.id}')">Baixar Word</button>`:''}<button class="btn-outline" onclick="lexReturnTask('${t.id}')">Devolver para correção</button>`:`<button onclick="lexRetryTask('${t.id}')">Tentar após corrigir</button>`);
  return `<section class="lex-task-need"><div class="lex-task-need-head"><span>PRECISA DE VOCÊ</span><small>para continuar</small></div><dl><dt>Quem</dt><dd>${lexEscape(t.processo_nome||t.processo_id||'Escritório')}</dd><dt>O quê</dt><dd>${lexEscape(need[0])}</dd><dt>Por quê</dt><dd>${lexEscape(need[1])}</dd></dl><div class="work-actions">${actions}</div></section>`;
}
async function lexReturnTask(id){const motivo=prompt('O que precisa ser corrigido na minuta? (vai para o LEX Redator)');if(!motivo||!motivo.trim())return;try{await lexApi('/api/tarefas/devolver',{method:'POST',body:JSON.stringify({id,motivo:motivo.trim()})});if(typeof window.lexTarefas==='function')window.lexTarefas(id);else renderTrabalho();}catch(e){toast(e.message,'erro');}}
function lexTaskDetailHtml(t){
  const stage=t.status==='concluida'?4:t.status==='aguardando_revisao'?3:t.status==='executando'?2:1;
  return `<article class="work-task lex-task-detail"><div class="work-task-head"><strong>${lexEscape(t.processo_nome||t.instrucao||t.tipo)}</strong><span class="work-state ${['concluida','aguardando_revisao'].includes(t.status)?'ready':''}">${lexEscape(lexTaskStatus[t.status]||t.status)}</span></div>
    <p>${lexEscape(t.agente||'')} · ${lexEscape(t.tipo||'')} · #${lexEscape(String(t.id||'').slice(0,8))}</p>
    <div class="lex-task-grid"><div><small>ETAPA</small><strong>${stage} de 4</strong></div><div><small>TENTATIVAS</small><strong>${Number(t.tentativas||0)}</strong></div><div><small>CRIADA</small><strong>${lexEscape(t.criada_em?new Date(t.criada_em).toLocaleDateString('pt-BR'):'—')}</strong></div></div>
    <h2 class="lex-task-h2">O que o LEX fez</h2>${lexTaskTimelineHtml(t)}${lexTaskNeedsYouHtml(t)}
    ${t.status==='concluida'&&(t.tem_documento||t.resultado)?`<div class="work-actions"><button class="btn-outline" onclick="lexDownloadTask('${t.id}')">Baixar Word</button></div>`:''}
    <p class="lex-task-note">O LEX nunca protocola sozinho. Aviso aqui e no WhatsApp quando a minuta ficar pronta.</p></article>`;
}
function lexApplyServerCounts(data){
  const counts=data?.contagens||{};
  for(const key of ['autuacao','judicial','administrativo','urgentes']){
    const el=document.getElementById('work-count-'+key);
    if(el&&Number.isFinite(Number(counts[key])))el.textContent=String(Number(counts[key]));
  }
}
async function renderTrabalho() {
  clearTimeout(lexWorkTimer);
  const host=document.getElementById('content');
  if(!host) return;
  const counts=LexWorkflow.summary(getProcs(),typeof getPrep==='function'?getPrep():[]);
  host.innerHTML=`<section class="work-home" id="work-home">
    <div class="work-title"><div><div class="work-eyebrow">${lexEscape(getNomeEscritorio())}</div><h1>Seu escritório, em ação.</h1><p>O que precisa de você e o que o LEX está preparando.</p></div><button class="btn-outline" onclick="renderTrabalho()">Atualizar</button></div>
    <div class="work-metrics">${[['autuacao','Preparação','autuacao'],['judicial','Judicial','processos'],['administrativo','Administrativo','processos_admin'],['urgentes','Urgentes','prazos']].map(([key,label,page])=>`<button class="work-metric" onclick="ir('${page}',null)"><span>${label}</span><strong id="work-count-${key}">${counts[key]}</strong></button>`).join('')}</div>
    <div class="work-columns"><section class="work-command"><h2>Peça ao LEX</h2>
      <label for="work-case">Processo</label><select id="work-case"><option value="">Identificar pela ordem</option>${getProcs().map(p=>`<option value="${lexEscape(String(p.id))}">${lexEscape(p.nome)} · ${lexEscape(p.numero||'sem número')}</option>`).join('')}</select>
      <label for="work-kind">Entrega</label><select id="work-kind">${[['analise','Análise do processo'],['peticao','Petição'],['contestacao','Contestação'],['recurso','Recurso'],['pericia','Parecer pericial'],['quesitos','Quesitos'],['revisao','Revisão de peça']].map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select>
      <label for="work-order">Sua ordem</label><textarea id="work-order" rows="4" placeholder="Ex.: prepare a contestação deste processo com base na inicial e na última decisão."></textarea>
      <button class="btn-primary" id="work-submit" onclick="lexSubmitTask()">Executar tarefa</button>
      <p class="work-help">O LEX confere o processo e o material antes de redigir. A entrega fica salva aqui para sua revisão.</p>
      <div id="work-feedback" role="status"></div>
      <div class="work-links"><button class="btn-outline" onclick="abrirModalPrep(null)">Novo cliente / caso</button><button class="btn-outline" onclick="document.getElementById('pdf-upload-input').click()">Adicionar autos</button></div>
    </section><section class="work-deliveries"><div class="work-section-head"><h2>Trabalho e entregas</h2><span id="work-connection">Consultando servidor…</span></div><div id="work-tasks"></div></section></div>
    <div class="work-footer"><span>Um resumo diário. Respostas às ordens quando ficarem prontas.</span><button class="btn-outline" onclick="ir('escritorio',null)">Configurar escritório</button><button class="btn-outline" onclick="ir('agentes',null)">Ver agentes e integrações</button></div>
    <div id="work-conflict"></div></section>`;
  const surface=document.getElementById('work-home');
  try {
    const data=await lexApi('/api/trabalho');if(!surface.isConnected) return;
    lexApplyServerCounts(data);
    document.getElementById('work-connection').textContent='Servidor confirmado · '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    document.getElementById('work-tasks').innerHTML=data.tarefas.length?data.tarefas.map(lexTaskCard).join(''):'<div class="work-empty"><strong>Nenhuma tarefa pendente.</strong><p>Selecione um processo e dê a primeira ordem ao LEX.</p></div>';
    if(!data.ia_configurada) document.getElementById('work-feedback').textContent='Configure a IA no servidor. As ordens ficam salvas enquanto isso.';
    if(data.tarefas.some(t=>['na_fila','executando'].includes(t.status))) lexWorkTimer=setTimeout(lexPollTasks,5000);
  }catch(e){if(surface.isConnected) document.getElementById('work-connection').textContent=e.message;}
  if(localStorage.getItem('lex_sync_conflict')) document.getElementById('work-conflict').innerHTML='<p class="work-notice">Há alterações deste aparelho aguardando conciliação. A cópia foi preservada.</p><button class="btn-outline" onclick="lexExportConflict()">Baixar cópia para conferir</button>';
}
async function lexPollTasks() {
  if(pag!=='trabalho') return;
  try {
    const d=await lexApi('/api/trabalho');
    if(pag!=='trabalho') return;
    lexApplyServerCounts(d);
    document.getElementById('work-tasks').innerHTML=d.tarefas.map(lexTaskCard).join('');
    if(d.tarefas.some(t=>['na_fila','executando'].includes(t.status))) lexWorkTimer=setTimeout(lexPollTasks,5000);
  }catch(e){const h=document.getElementById('work-connection');if(h) h.textContent=e.message;}
}
async function lexSubmitTask() {
  const btn=document.getElementById('work-submit'),out=document.getElementById('work-feedback');
  const instrucao=document.getElementById('work-order').value.trim();
  if(!instrucao){out.textContent='Descreva a tarefa.';return;}
  btn.disabled=true;
  const payload={tipo:document.getElementById('work-kind').value,processo_id:document.getElementById('work-case').value||null,instrucao};
  const signature=JSON.stringify(payload);
  if(btn.dataset.signature!==signature) {btn.dataset.signature=signature;btn.dataset.requestId=crypto.randomUUID();}
  try {
    const d=await lexApi('/api/tarefas',{method:'POST',body:JSON.stringify({...payload,request_id:btn.dataset.requestId})});
    out.textContent='Ordem registrada: '+d.tarefa.id.slice(0,8)+'. Acompanhe a entrega ao lado.';
    lexWorkTimer=setTimeout(lexPollTasks,1000);
  }catch(e){out.textContent=e.message;}finally{btn.disabled=false;}
}
async function lexDownloadTask(id) {
  try{
    const r=await fetchComTimeout(SERVIDOR+'/api/tarefas/documento?id='+encodeURIComponent(id),{headers:{Authorization:'Bearer '+getAuthToken()}},30000);
    if(!r.ok) throw new Error('Documento ainda não disponível.');
    const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download='LEX_minuta_'+id.slice(0,8)+'.docx';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }catch(e){toast(e.message,'erro');}
}
async function lexRetryTask(id){try{await lexApi('/api/tarefas/retomar',{method:'POST',body:JSON.stringify({id})});renderTrabalho();}catch(e){toast(e.message,'erro');}}
async function lexReviewTask(id){try{const d=await lexApi('/api/tarefas?id='+id);if(!confirm('Você conferiu esta versão da minuta? Essa confirmação não protocola o documento.'))return;await lexApi('/api/tarefas/revisar',{method:'POST',body:JSON.stringify({id,sha256:d.tarefa.sha256})});renderTrabalho();}catch(e){toast(e.message,'erro');}}
function lexExportConflict(){const url=URL.createObjectURL(new Blob([localStorage.getItem('lex_sync_conflict')||'{}'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='LEX_alteracoes_para_conferir.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function renderEscritorio() {
  const host=document.getElementById('content');
  host.innerHTML='<div class="work-command" id="office-setup"><h1>Seu escritório</h1><p>Carregando configuração…</p></div>';
  const target=document.getElementById('office-setup');let office=getEscritorio(),notice='';
  try{const d=await lexApi('/api/escritorio');office=d.escritorio;if(d.configurado)setEscritorio(office);}catch(e){notice=e.message;}
  if(!target.isConnected)return;
  target.innerHTML=`<h1>Seu escritório</h1><p>Configure a identificação usada pelo LEX e nas minutas.</p><form onsubmit="event.preventDefault();lexSaveOffice()">
    ${[['nome','Nome do escritório'],['responsavel','Advogado responsável'],['registro','OAB / UF'],['endereco','Endereço profissional'],['telefone','Telefone'],['email','E-mail']].map(([id,label])=>`<label for="office-${id}">${label}</label><input id="office-${id}" value="${lexEscape(office[id]||'')}" ${['nome','responsavel','registro'].includes(id)?'required':''}>`).join('')}
    <button class="btn-primary" type="submit">Salvar configuração</button><p id="office-notice" role="status">${lexEscape(notice)}</p></form>
    <h2>Próximos passos</h2><div class="work-links"><button class="btn-outline" onclick="abrirModalPrep(null)">Cadastrar primeiro cliente</button><button class="btn-outline" onclick="ir('telegram',null)">Conectar canais</button><button class="btn-outline" onclick="ir('pje',null)">Fontes dos processos</button><button class="btn-outline" onclick="abrirCentroDados()">Importar / exportar dados</button></div>`;
}
async function lexSaveOffice(){const data={};for(const id of ['nome','responsavel','registro','endereco','telefone','email'])data[id]=document.getElementById('office-'+id).value;try{const d=await lexApi('/api/escritorio',{method:'POST',body:JSON.stringify(data)});setEscritorio(d.escritorio);document.getElementById('office-notice').textContent='Configuração salva no servidor.';}catch(e){document.getElementById('office-notice').textContent=e.message;}}
async function lexSavePreparation(caso,documentos) {
  const d=await lexApi('/api/escritorio/preparacao',{method:'POST',body:JSON.stringify({caso,documentos})});
  localStorage.setItem(SK,JSON.stringify(d.processos));setVersaoLocal(d.versao);
  const cases=getPrep().filter(c=>String(c.id)!==String(caso.id));cases.push(caso);savePrep(cases);
  return d;
}
function renderFontesProcessos() {
  document.getElementById('content').innerHTML=`<section class="work-home"><div class="work-title"><div><div class="work-eyebrow">Dados para trabalhar</div><h1>Fontes dos processos</h1><p>Veja de onde veio a informação antes de pedir uma análise.</p></div></div><div class="work-columns">
    <section class="work-command"><h2>Computador do advogado</h2><p>Faça login no tribunal com o certificado e a autenticação exigida. O conector importa o andamento que você selecionar e conferir.</p><div class="work-links"><button class="btn-primary" onclick="lexDownloadConnector()">Baixar conector</button><button class="btn-outline" onclick="lexConnectorCode()">Gerar código de acesso</button></div><p class="work-help">Chrome / Edge no computador. Na página de extensões, ative o modo de desenvolvedor e carregue a pasta extraída do ZIP. Configure este servidor:</p><p><code>${lexEscape(SERVIDOR)}</code></p><label for="connector-code">Código temporário · válido por 8 horas</label><input type="password" id="connector-code" readonly><button class="btn-outline" onclick="navigator.clipboard.writeText(document.getElementById('connector-code').value).then(()=>toast('Código copiado.','ok')).catch(()=>toast('Selecione e copie o código.','alert'))">Copiar código</button><p id="connector-notice" role="status"></p><p class="work-help">Captura assistida em validação. Não importa todo o acervo nem protocola documentos. O certificado permanece no seu computador.</p></section>
    <section class="work-command"><h2>Autos enviados pelo escritório</h2><p>Importe o PDF ou Word disponível e informe a data da última atualização. O LEX pode trabalhar com esse material sem o PJe conectado.</p><button class="btn-primary" onclick="document.getElementById('pdf-upload-input').click()">Adicionar PDF dos autos</button><h2 style="margin-top:28px">Consulta pública · Datajud</h2><p>Consulta metadados e movimentações dos processos cadastrados. Não fornece os autos completos nem confirma intimações em tempo real.</p><button class="btn-outline" onclick="lexQueryPublic()">Consultar processos cadastrados</button><p id="datajud-notice" role="status"></p></section></div></section>`;
}
async function lexConnectorCode(){try{const d=await lexApi('/api/conector/parear',{method:'POST',body:'{}'});document.getElementById('connector-code').value=d.token;document.getElementById('connector-notice').textContent='Código gerado. O código anterior foi invalidado.';}catch(e){document.getElementById('connector-notice').textContent=e.message;}}
async function lexDownloadConnector(){try{const r=await fetchComTimeout(SERVIDOR+'/api/conector/download',{headers:{Authorization:'Bearer '+getAuthToken()}},30000);if(!r.ok)throw new Error('Conector não disponível nesta versão do servidor.');const u=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=u;a.download='LEX_conector_navegador.zip';a.click();setTimeout(()=>URL.revokeObjectURL(u),30000);}catch(e){toast(e.message,'erro');}}
async function lexQueryPublic(){const el=document.getElementById('datajud-notice');el.textContent='Consultando…';try{const d=await lexApi('/api/pje/sincronizar',{method:'POST',body:'{}'});el.textContent='Consulta concluída. '+(d.processos||[]).length+' processos consultados. Confira as datas dos movimentos.';}catch(e){el.textContent=e.message;}}

function lexReceptionTime(value){
  if(!value) return 'sem horário';
  const d=new Date(value);if(Number.isNaN(d.getTime())) return 'sem horário';
  return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}
function lexReceptionCard(item,archived=false){
  const origem=String(item.origem||'whatsapp'),id=String(item.id||item.numero||'');
  const safeOrigin=lexEscape(origem),safeId=lexEscape(id);
  const badge=item.urgente?'URGENTE':lexEscape(String(item.classe||'geral').toUpperCase());
  const canal=origem==='telegram'?'Telegram':'WhatsApp';
  return `<article class="lex-reception-card ${item.urgente?'is-urgent':''}">
    <div class="lex-reception-head"><strong>${lexEscape(item.nome||'Contato')}</strong><span>${badge}</span></div>
    <div class="lex-reception-number">${lexEscape(canal)} · ${safeId}</div>
    <p>${lexEscape(item.ultima_mensagem||'Sem texto')}</p>
    <div class="lex-reception-meta"><span>${lexReceptionTime(item.atualizado_em)}</span><span>${Number(item.contador)||1} msg</span></div>
    <div class="work-actions"><button class="btn-outline" onclick="lexOpenReceptionConversation('${safeOrigin}','${safeId}')">Conversar</button>
    ${archived?'':`<button class="btn-outline" onclick="lexArchiveReception('${safeOrigin}','${safeId}')">Arquivar</button>`}</div>
  </article>`;
}
function lexReceptionColumn(title,items,archived=false){
  return `<section class="lex-reception-column"><div class="lex-reception-column-title"><h2>${title}</h2><strong>${items.length}</strong></div>
    <div class="lex-reception-list">${items.length?items.map(x=>lexReceptionCard(x,archived)).join(''):'<div class="lex-reception-empty">Nenhum contato.</div>'}</div></section>`;
}
async function renderRecepcaoLex(){
  const host=document.getElementById('content');if(!host)return;
  host.innerHTML='<section class="work-home"><div class="work-title"><div><div class="work-eyebrow">Ouvidos e voz do LEX</div><h1>Recepção</h1><p>Contatos externos aguardando sua análise. Esta tela não abre processos nem libera dados jurídicos.</p></div><button class="btn-outline" onclick="renderRecepcaoLex()">Atualizar</button></div><div id="lex-reception-status" class="work-notice">Consultando a recepção persistente…</div><div id="lex-reception-grid" class="lex-reception-grid"></div></section>';
  const grid=document.getElementById('lex-reception-grid'),status=document.getElementById('lex-reception-status');
  try{
    const [urgent,waiting,admin,archived]=await Promise.all([
      lexApi('/api/escritorio/recepcao?status=urgente'),
      lexApi('/api/escritorio/recepcao?status=aguardando_advogado'),
      lexApi('/api/escritorio/recepcao?status=administrativo'),
      lexApi('/api/escritorio/recepcao?status=arquivado')
    ]);
    if(!grid.isConnected)return;
    grid.innerHTML=lexReceptionColumn('Urgentes',urgent.contatos||[])+lexReceptionColumn('Aguardando você',waiting.contatos||[])+lexReceptionColumn('Administrativos',admin.contatos||[])+lexReceptionColumn('Arquivados',archived.contatos||[],true);
    status.textContent='WhatsApp + Telegram · mesma Recepção do LEX · atualização '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+'.';
  }catch(e){if(status.isConnected)status.textContent=e.message;}
}
async function lexArchiveReception(origem,id){
  if(!confirm('Arquivar este contato da recepção?')) return;
  try{await lexApi('/api/escritorio/recepcao/arquivar',{method:'POST',body:JSON.stringify({origem,id})});await renderRecepcaoLex();}
  catch(e){toast(e.message,'erro');}
}
async function lexOpenReceptionConversation(origem,id){
  try{
    if(typeof window.lexChannel!=='function'||typeof window.lexSelectChannelContact!=='function')throw new Error('Central de atendimento indisponível nesta versão.');
    await window.lexChannel(origem==='telegram'?'telegram':'whatsapp');
    await window.lexSelectChannelContact(origem,id);
  }catch(e){toast(e.message||'Não foi possível abrir a conversa.','erro');}
}
function lexOpenReception(btn){
  if(typeof pag!=='undefined')pag='recepcao';
  if(typeof procAtivo!=='undefined')procAtivo=null;
  if(typeof fecharSidebar==='function')fecharSidebar();
  if(typeof esconderBackBar==='function')esconderBackBar();
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  const title=document.getElementById('page-title');if(title)title.textContent='Recepção';
  renderRecepcaoLex();
}
window.addEventListener('DOMContentLoaded',()=>{
  if(!document.getElementById('lex-nav-recepcao')){
    const nav=document.querySelector('#sidebar nav');
    if(nav){
      const btn=document.createElement('button');btn.id='lex-nav-recepcao';btn.className='nav-btn';btn.innerHTML='<span class="nav-icon">📥</span> Recepção';btn.onclick=()=>lexOpenReception(btn);
      const central=[...nav.querySelectorAll('.nav-btn')].find(b=>/Central Mensagens/i.test(b.textContent||''));
      if(central)central.after(btn);else nav.appendChild(btn);
    }
  }
  if(!document.getElementById('lex-reception-style')){
    const style=document.createElement('style');style.id='lex-reception-style';style.textContent=`
      .lex-reception-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;align-items:start}
      .lex-reception-column{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:12px;min-width:0}
      .lex-reception-column-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.lex-reception-column-title h2{font-size:13px;margin:0}.lex-reception-column-title strong{background:var(--surface2);border:1px solid var(--border2);border-radius:999px;padding:3px 8px;font-size:11px}
      .lex-reception-list{display:grid;gap:10px}.lex-reception-card{background:var(--surface2);border:1px solid var(--border2);border-radius:12px;padding:12px}.lex-reception-card.is-urgent{border-color:var(--red)}
      .lex-reception-head{display:flex;justify-content:space-between;gap:8px;align-items:start}.lex-reception-head strong{font-size:13px;overflow-wrap:anywhere}.lex-reception-head span{font-size:9px;letter-spacing:.7px;color:var(--text3)}
      .lex-reception-number{font-size:11px;color:var(--accent);margin-top:4px}.lex-reception-card p{font-size:12px;color:var(--text2);line-height:1.45;margin:10px 0;overflow-wrap:anywhere}.lex-reception-meta{display:flex;justify-content:space-between;gap:8px;color:var(--text3);font-size:10px;margin-bottom:10px}.lex-reception-empty{padding:18px 8px;text-align:center;color:var(--text3);font-size:12px}
      @media(max-width:1100px){.lex-reception-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.lex-reception-grid{grid-template-columns:1fr}}
    `;document.head.appendChild(style);
  }
});
