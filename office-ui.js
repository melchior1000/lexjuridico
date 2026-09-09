/* Interface de trabalho: usa os controles e temas do LEX existente. */
let lexWorkTimer=null;
const lexTaskStatus={na_fila:'Na fila',executando:'Em execução',aguardando_dados:'Precisa de informação',aguardando_configuracao:'Configuração pendente',aguardando_revisao:'Revisar entrega',concluida:'Concluída',falhou:'Falhou'};
async function lexApi(path,options={}) {
  const response=await fetchComTimeout(SERVIDOR+path,{...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+getAuthToken(),...(options.headers||{})}},30000);
  const data=await response.json();
  if(!response.ok || data.ok===false) throw new Error(data.error||'Não foi possível confirmar a operação.');
  return data;
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
    ${['falhou','aguardando_dados','aguardando_configuracao'].includes(t.status)?`<button class="btn-outline" onclick="lexRetryTask('${t.id}')">Tentar após corrigir</button>`:''}
    </div></article>`;
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
    // Contagem usa os mesmos registros, incluindo preparação legada ainda no aparelho.
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
