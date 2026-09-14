(function(){
  'use strict';

  const sectors=[
    ['Recepção','mensagens','cyan',['Atendimento','WhatsApp','Telegram']],
    ['Cadastro','autuacao','violet',['Secretaria','Cadastro']],
    ['Iniciais','autuacao','purple',['Instrução','Inicial']],
    ['Processos','processos','green',['Processual','Estratégia']],
    ['Prazos','prazos','amber',['Controladoria','PJe']],
    ['Peças / Perícia','trabalho','rose',['Redação','Pesquisa','Perícia']],
    ['Revisão','trabalho','blue',['Revisão','Sentenças']],
    ['Concluídos','estatisticas','slate',['Entrega','Arquivo']]
  ];
  const quotes=['Organização hoje. Resultados amanhã.','Disciplina hoje. Liberdade amanhã.','Seu escritório em ação, com inteligência e estratégia.'];
  let procFilter='todos',prazoTab='hoje';

  function esc(v){
    const value=String(v??'');
    return typeof lexEscape==='function'?lexEscape(value):value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function getProcesses(){try{return typeof getProcs==='function'?(getProcs()||[]):[];}catch{return [];}}
  function getPreparations(){try{return typeof getPrep==='function'?(getPrep()||[]):[];}catch{return [];}}
  function workflowSummary(){try{return typeof LexWorkflow!=='undefined'&&LexWorkflow?.summary?LexWorkflow.summary(getProcesses(),getPreparations()):{};}catch{return {};}}
  function encodedId(id){return esc(encodeURIComponent(String(id??'')));}
  function firstName(){
    const raw=typeof getResponsavel==='function'?getResponsavel():'';
    return String(raw||'').trim().replace(/^dr\.?\s+/i,'').split(/\s+/)[0]||'Doutor';
  }
  function greeting(){
    const hour=new Date().getHours();
    return (hour<12?'Bom dia':hour<18?'Boa tarde':'Boa noite')+', Dr. '+firstName()+'!';
  }
  function dateFrom(raw){
    if(!raw)return null;
    if(typeof parsePrazo==='function'){try{const d=parsePrazo(raw);if(d&&!Number.isNaN(d.getTime()))return d;}catch{}}
    const m=String(raw).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const d=m?new Date(+m[3],+m[2]-1,+m[1]):new Date(raw);
    return Number.isNaN(d.getTime())?null:d;
  }
  function daysToDeadline(p){
    const d=dateFrom(p?.prazoReal||p?.prazo||p?.dataPrazo||'');
    if(!d)return 99999;
    const today=new Date();today.setHours(0,0,0,0);d.setHours(0,0,0,0);
    return Math.round((d-today)/86400000);
  }
  function whenLabel(days){
    if(days<0)return Math.abs(days)+'d vencido';
    if(days===0)return 'Hoje';
    if(days===1)return 'Amanhã';
    return days+' dias';
  }
  function toneFor(days){
    if(days<0)return ['VENCIDO','is-late'];
    if(days===0)return ['HOJE','is-urgent'];
    if(days<=2)return ['URGENTE','is-urgent'];
    if(days<=7)return ['PRAZO','is-soon'];
    return ['AGENDA','is-ok'];
  }
  function nextActions(items){
    return items.map(p=>({p,days:daysToDeadline(p)})).filter(x=>x.days<99999).sort((a,b)=>a.days-b.days).slice(0,5);
  }
  function actionCard(item){
    const p=item.p,[badge,tone]=toneFor(item.days);
    return '<button class="lex-v2-action '+tone+'" data-proc-id="'+encodedId(p.id)+'" onclick="window.lexOpenProcV2(this.dataset.procId)">'+
      '<span class="lex-v2-action-badge">'+badge+'</span><span class="lex-v2-action-main"><strong>'+esc(p.nome||p.titulo||p.numero||'Processo')+
      '</strong><span>'+esc(p.numero||p.assunto||p.partes||p.status||'')+'</span></span><span class="lex-v2-action-time">'+esc(whenLabel(item.days))+'</span></button>';
  }
  function taskBusy(agent,tasks){
    const needle=agent.toLowerCase();
    return tasks.some(t=>['na_fila','executando','aguardando_dados','aguardando_configuracao'].includes(t.status)&&String(t.agente||t.tipo||'').toLowerCase().includes(needle));
  }
  function sectorCards(tasks,counts){
    const values={'Recepção':counts.recepcao??0,'Cadastro':counts.autuacao??0,'Iniciais':counts.iniciais??0,'Processos':counts.judicial??counts.total??0,'Prazos':counts.prazos7??0,'Peças / Perícia':counts.pecas??0,'Revisão':counts.revisao??0,'Concluídos':counts.concluidos??0};
    return sectors.map(([name,page,tone,agents])=>'<button class="lex-v2-sector tone-'+tone+'" onclick="ir(\''+page+'\',null)"><span class="lex-v2-sector-top"><span class="lex-v2-sector-title">'+esc(name)+'</span><strong>'+esc(values[name]??0)+'</strong></span><span class="lex-v2-agents">'+
      agents.map(agent=>{const busy=taskBusy(agent,tasks);return '<span class="lex-v2-agent"><span>LEX '+esc(agent)+'</span><span class="lex-v2-agent-state '+(busy?'busy':'')+'">'+(busy?'trabalhando':'pronto')+'</span></span>';}).join('')+
      '</span></button>').join('');
  }
  function pipeline(counts){
    const rows=[['Recepção',counts.recepcao??0,'mensagens'],['Cadastro',counts.autuacao??0,'autuacao'],['Iniciais',counts.iniciais??0,'autuacao'],['Processos',counts.judicial??0,'processos'],['Prazos',counts.prazos7??0,'prazos'],['Peças / Perícia',counts.pecas??0,'trabalho'],['Revisão',counts.revisao??0,'trabalho'],['Concluídos',counts.concluidos??0,'estatisticas']];
    return rows.map(([label,value,page],i)=>'<button class="lex-v2-pipe" onclick="ir(\''+page+'\',null)"><em>'+(i+1)+'</em><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></button>').join('');
  }
  function taskCards(tasks){
    if(!tasks.length)return '<div class="lex-v2-empty">Nenhuma entrega pendente. O LEX está livre para receber uma ordem.</div>';
    return tasks.slice(0,7).map(t=>{
      const status=typeof lexTaskStatus==='object'?(lexTaskStatus[t.status]||t.status):t.status;
      return '<div class="lex-v2-agent-row"><span class="lex-v2-dot '+(['executando','na_fila'].includes(t.status)?'busy':'')+'"></span><span><strong>'+esc(t.agente||'LEX')+'</strong><span>'+esc(t.processo_nome||t.instrucao||t.tipo||'Tarefa')+'</span></span><em>'+esc(status||'')+'</em></div>';
    }).join('');
  }
  function featuredCases(items){
    if(!items.length)return '<div class="lex-v2-empty">Nenhum processo em destaque ainda.</div>';
    return items.slice(0,4).map(p=>'<button class="lex-v2-case" data-proc-id="'+encodedId(p.id)+'" onclick="window.lexOpenProcV2(this.dataset.procId)"><code>'+esc(p.numero||'sem número')+'</code><strong>'+esc(p.nome||p.titulo||'Processo')+'</strong><span>'+esc(p.assunto||p.area||p.partes||'')+'</span><i>'+esc(p.status||'Ativo')+'</i></button>').join('');
  }
  function calendarKey(){
    const d=new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  function dayEvents(items){
    const events=[];
    try{(JSON.parse(localStorage.getItem('lex_cal_ev_v1')||'{}')[calendarKey()]||[]).forEach(e=>events.push({time:e.hora||e.time||'—',title:e.titulo||e.nome||'Evento',place:e.tipo||e.obs||'Agenda'}));}catch{}
    items.filter(p=>daysToDeadline(p)===0).forEach(p=>events.push({time:'Prazo',title:p.nome||p.numero||'Processo',place:p.numero||'Hoje'}));
    return events;
  }
  function agenda(items){
    const events=dayEvents(items);
    return events.length?events.slice(0,5).map(e=>'<div class="lex-v2-agenda-row"><strong>'+esc(e.time)+'</strong><span><b>'+esc(e.title)+'</b><span>'+esc(e.place)+'</span></span></div>').join(''):'<div class="lex-v2-empty">Nada marcado para hoje.</div>';
  }
  function channels(rows){
    return rows.map(c=>'<button class="lex-v2-channel" onclick="ir(\''+c.page+'\',null)"><span class="lex-v2-channel-icon">'+c.icon+'</span><span><strong>'+esc(c.name)+'</strong><em>'+esc(c.meta)+'</em></span><b>'+esc(c.count)+'</b></button>').join('');
  }
  function robot(){
    return '<svg class="lex-v2-bot" viewBox="0 0 80 80" aria-hidden="true"><defs><linearGradient id="lexBot" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6ee7ff"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs><rect x="14" y="18" width="52" height="46" rx="16" fill="#0b1224" stroke="url(#lexBot)" stroke-width="2"/><circle cx="32" cy="40" r="6" fill="#7af0ff"/><circle cx="48" cy="40" r="6" fill="#7af0ff"/><rect x="30" y="52" width="20" height="4" rx="2" fill="#6d7cff"/><rect x="36" y="8" width="8" height="12" rx="4" fill="#38bdf8"/><circle cx="40" cy="8" r="4" fill="#7af0ff"/></svg>';
  }
  function countsFor(items,preparations,tasks,reception){
    const base=workflowSummary(),deadline7=items.filter(p=>{const d=daysToDeadline(p);return d<99999&&d<=7;}).length;
    const urgent=items.filter(p=>{const d=daysToDeadline(p);return d<99999&&d<=2;}).length;
    const docs=items.reduce((n,p)=>n+(Array.isArray(p.arquivos)?p.arquivos.length:0)+(Array.isArray(p.docs)?p.docs.length:0),0);
    const work=tasks.filter(t=>/petic|pe[cç]a|per[ií]c|contest|recurso|quesito/i.test(String(t.tipo||t.instrucao||''))).length;
    const review=tasks.filter(t=>t.status==='aguardando_revisao'||/revis/i.test(String(t.tipo||''))).length;
    const initials=preparations.filter(p=>/pronto|aprov|inicial/i.test(String(p.status||''))).length||Math.min(preparations.length,5);
    return {total:base.total??items.length,autuacao:base.autuacao??preparations.length,judicial:base.judicial??items.length,administrativo:base.administrativo??0,concluidos:base.concluidos??0,urgentes:urgent||base.urgentes||0,prazos7:deadline7,pecas:work,revisao:review,iniciais:initials,docs,tasks:tasks.filter(t=>!['concluida','falhou'].includes(t.status)).length,recepcao:reception};
  }
  function patchShell(counts){
    document.body.classList.add('lex-shell-v2');
    const home=[...document.querySelectorAll('.nav-btn')].find(b=>/Painel Geral|Início/i.test(b.textContent||''));
    if(home){home.innerHTML='<span class="nav-icon">⌂</span> Início';}
    const map=[[/Início|Painel Geral/i,counts.total],[/Recepção/i,counts.recepcao],[/Autuação|Cadastro/i,counts.autuacao],[/Processos(?! Administrativo)/i,counts.judicial],[/Prazos/i,counts.prazos7]];
    document.querySelectorAll('#sidebar .nav-btn').forEach(btn=>{
      const hit=map.find(([re])=>re.test(btn.textContent||''));if(!hit)return;
      let badge=btn.querySelector('.lex-nav-badge');if(!badge){badge=document.createElement('span');badge.className='lex-nav-badge';btn.appendChild(badge);}
      badge.textContent=String(hit[1]??0);
    });
  }
  function dock(active){
    return '<nav class="lex-v2-mobile-dock" aria-label="Atalhos principais"><button class="'+(active==='home'?'lex-primary':'')+'" onclick="ir(\'painel\',null)"><b>⌂</b>Início</button><button class="'+(active==='processos'?'lex-primary':'')+'" onclick="ir(\'processos\',null)"><b>▣</b>Processos</button><button onclick="window.lexFocusV2()"><b>◉</b>LEX</button><button class="'+(active==='prazos'?'lex-primary':'')+'" onclick="ir(\'prazos\',null)"><b>◷</b>Prazos</button><button onclick="typeof toggleSidebar===\'function\'?toggleSidebar():null"><b>☰</b>Mais</button></nav>';
  }

  async function renderDashboard(){
    clearTimeout(typeof lexWorkTimer!=='undefined'?lexWorkTimer:null);
    const host=document.getElementById('content');if(!host)return;
    document.body.classList.add('lex-v2-screen');
    const items=getProcesses(),preparations=getPreparations();
    const office=typeof getNomeEscritorio==='function'?getNomeEscritorio():'LEX Jurídico';
    const options=items.map(p=>'<option value="'+esc(String(p.id))+'">'+esc(p.nome||p.numero||'Processo')+' · '+esc(p.numero||'sem número')+'</option>').join('');
    const kinds=[['analise','Análise'],['peticao','Petição'],['contestacao','Contestação'],['recurso','Recurso'],['pericia','Perícia'],['quesitos','Quesitos'],['revisao','Revisão']].map(([id,label])=>'<option value="'+id+'">'+label+'</option>').join('');
    const title=document.getElementById('page-title');if(title)title.textContent='Início';
    host.innerHTML='<section class="lex-v2" id="lex-v2-home"><div class="lex-v2-hero"><div class="lex-v2-card lex-v2-intro"><div class="lex-v2-orb">'+robot()+'</div><div><div class="lex-v2-kicker">'+esc(office)+'</div><h1>'+esc(greeting())+'</h1><p>Seu escritório em ação, com inteligência e estratégia.</p><blockquote>“'+esc(quotes[new Date().getDate()%quotes.length])+'”</blockquote></div></div>'+
      '<div class="lex-v2-card lex-v2-quick"><button onclick="ir(\'peticao\',null)"><b>＋</b>Nova peça<small>Peça ao LEX</small></button><button onclick="ir(\'processos\',null)"><b>⌕</b>Consultar<small>processo</small></button><button onclick="ir(\'prazos\',null)"><b>◷</b>Prazos<small>agenda crítica</small></button><button onclick="document.getElementById(\'pdf-upload-input\')?.click()"><b>⇧</b>Enviar<small>documento</small></button></div></div>'+
      '<div class="lex-v2-kpis"><button class="lex-v2-card lex-v2-kpi tone-blue" onclick="ir(\'processos\',null)"><span>Processos ativos</span><strong id="lex-v2-kpi-total">—</strong><em id="lex-v2-kpi-week">carregando</em></button><button class="lex-v2-card lex-v2-kpi tone-rose" onclick="ir(\'prazos\',null)"><span>Prazos (7 dias)</span><strong id="lex-v2-kpi-prazos">—</strong><em id="lex-v2-kpi-urgent">até 2 dias</em></button><button class="lex-v2-card lex-v2-kpi tone-green" onclick="ir(\'trabalho\',null)"><span>Tarefas pendentes</span><strong id="lex-v2-kpi-tasks">—</strong><em>com o LEX</em></button><button class="lex-v2-card lex-v2-kpi tone-violet" onclick="ir(\'processos\',null)"><span>Documentos p/ revisão</span><strong id="lex-v2-kpi-docs">—</strong><em>aguardando análise</em></button><button class="lex-v2-card lex-v2-kpi tone-cyan" onclick="typeof lexOpenReception===\'function\'?lexOpenReception(document.getElementById(\'lex-nav-recepcao\')):ir(\'mensagens\',null)"><span>Mensagens não lidas</span><strong id="lex-v2-reception-count">—</strong><em>WhatsApp e Telegram</em></button></div>'+
      '<section class="lex-v2-card lex-v2-flow"><div class="lex-v2-section-head"><div><h2>Fluxo de Trabalho do Escritório</h2><p>Do primeiro contato à conclusão, com os bots dentro de cada setor.</p></div><button class="btn-outline" onclick="ir(\'estatisticas\',null)">Visão completa</button></div><div class="lex-v2-pipeline" id="lex-v2-pipeline"></div></section>'+
      '<div class="lex-v2-grid"><div><section class="lex-v2-card lex-v2-section"><div class="lex-v2-section-head"><div><h2>Minhas próximas ações</h2><p>O que pode vencer ou travar o escritório primeiro.</p></div><button class="btn-outline" onclick="ir(\'prazos\',null)">Ver todas</button></div><div class="lex-v2-action-list" id="lex-v2-actions"></div></section><section class="lex-v2-card lex-v2-section"><div class="lex-v2-section-head"><div><h2>Processos em destaque</h2><p>Casos que pedem atenção agora.</p></div><button class="btn-outline" onclick="ir(\'processos\',null)">Ver todos</button></div><div class="lex-v2-cases" id="lex-v2-cases"></div></section></div>'+
      '<div><section class="lex-v2-card lex-v2-section"><div class="lex-v2-section-head"><div><h2>Atividade dos Agentes</h2><p id="work-connection">Consultando servidor…</p></div><button class="btn-outline" onclick="renderTrabalho()">Atualizar</button></div><div class="lex-v2-deliveries" id="work-tasks"><div class="lex-v2-empty">Carregando tarefas…</div></div></section><section class="lex-v2-card lex-v2-section"><div class="lex-v2-section-head"><h2>Agenda de hoje</h2><button class="btn-outline" onclick="ir(\'calendario\',null)">Ver agenda</button></div><div id="lex-v2-agenda"></div></section><section class="lex-v2-card lex-v2-section"><div class="lex-v2-section-head"><h2>Canais de comunicação</h2><button class="btn-outline" onclick="ir(\'mensagens\',null)">Ver todos</button></div><div class="lex-v2-channels" id="lex-v2-channels"></div></section></div></div>'+
      '<section class="lex-v2-card lex-v2-office"><div class="lex-v2-section-head"><div><h2>Setores do Escritório</h2><p>O LEX coordena; os bots trabalham dentro de cada setor.</p></div><button class="btn-outline" onclick="ir(\'agentes\',null)">Detalhes</button></div><div class="lex-v2-coordinator"><span class="lex-v2-orb lex-v2-orb-small">'+robot()+'</span><span><strong>LEX · Coordenador geral</strong><span>Recebe sua ordem, encaminha, acompanha e devolve para sua revisão.</span></span></div><div class="lex-v2-sectors" id="lex-v2-sectors"></div></section>'+
      '<section class="lex-v2-card lex-v2-order" id="lex-v2-order"><div class="lex-v2-section-head"><div><h2>Dar uma ordem ao LEX</h2><p>O LEX escolhe o agente e mantém a entrega sob sua revisão.</p></div><span class="lex-v2-status" id="work-feedback"></span></div><div class="lex-v2-order-grid"><div><label for="work-case">Processo</label><select id="work-case"><option value="">Identificar pela ordem</option>'+options+'</select></div><div><label for="work-kind">Setor / entrega</label><select id="work-kind">'+kinds+'</select></div><div><label for="work-order">Ordem</label><textarea id="work-order" rows="1" placeholder="Ex.: analise a última decisão e prepare a manifestação para minha revisão."></textarea></div><button class="btn-primary" id="work-submit" onclick="lexSubmitTask()">Enviar ao LEX</button></div></section>'+dock('home')+'</section>';

    const surface=document.getElementById('lex-v2-home');let tasks=[];
    try{
      const data=await lexApi('/api/trabalho');if(!surface?.isConnected)return;
      tasks=Array.isArray(data.tarefas)?data.tarefas:[];
      document.getElementById('work-connection').textContent='Servidor confirmado · '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
      document.getElementById('work-tasks').innerHTML=taskCards(tasks);
      if(!data.ia_configurada)document.getElementById('work-feedback').textContent='IA do servidor precisa de configuração.';
      if(tasks.some(t=>['na_fila','executando'].includes(t.status)))lexWorkTimer=setTimeout(()=>{if(document.getElementById('lex-v2-home'))renderDashboard();},8000);
    }catch(e){if(surface?.isConnected)document.getElementById('work-connection').textContent=e.message;}
    let reception=0;
    try{const data=await lexApi('/api/escritorio/recepcao');const rows=data.itens||data.contatos||data.recepcao||[];reception=Array.isArray(rows)?rows.filter(r=>r.status!=='arquivado').length:0;}catch{}
    if(!surface?.isConnected)return;
    const counts=countsFor(items,preparations,tasks,reception),actions=nextActions(items);
    document.getElementById('lex-v2-kpi-total').textContent=String(counts.judicial||counts.total||0);
    document.getElementById('lex-v2-kpi-week').textContent=preparations.length+' em preparação';
    document.getElementById('lex-v2-kpi-prazos').textContent=String(counts.prazos7);
    document.getElementById('lex-v2-kpi-urgent').textContent=counts.urgentes+' urgentes';
    document.getElementById('lex-v2-kpi-tasks').textContent=String(counts.tasks);
    document.getElementById('lex-v2-kpi-docs').textContent=String(counts.revisao||counts.docs||0);
    document.getElementById('lex-v2-reception-count').textContent=String(reception);
    document.getElementById('lex-v2-pipeline').innerHTML=pipeline(counts);
    document.getElementById('lex-v2-actions').innerHTML=actions.length?actions.map(actionCard).join(''):'<div class="lex-v2-empty">Nenhum prazo próximo identificado.</div>';
    document.getElementById('lex-v2-cases').innerHTML=featuredCases(items);
    document.getElementById('lex-v2-agenda').innerHTML=agenda(items);
    document.getElementById('lex-v2-sectors').innerHTML=sectorCards(tasks,counts);
    document.getElementById('lex-v2-channels').innerHTML=channels([{icon:'📱',name:'WhatsApp',meta:'Canal dos clientes',count:reception,page:'whatsapp'},{icon:'✈️',name:'Telegram',meta:'Canal complementar',count:0,page:'telegram'},{icon:'✉️',name:'E-mail',meta:'Mensagens do escritório',count:0,page:'mensagens'},{icon:'⚖',name:'PJe',meta:'Fonte dos processos',count:counts.judicial||0,page:'pje'}]);
    patchShell(counts);
  }

  function isClosed(p){return ['CONCLUIDO','CONCLUÍDO','ENTREGUE','ARQUIVADO','GANHO','PERDIDO'].includes(String(p.status||'').toUpperCase());}
  function statusChip(p){
    const days=daysToDeadline(p),status=String(p.status||'').toUpperCase();
    if(days===0)return ['chip-hoje','Prazo hoje'];
    if(days<0&&days<99999)return ['chip-hoje','Vencido'];
    if(/FAVOR|GANHO|PROCEDENTE/.test(status+' '+(p.resultado||'')+' '+(p.decisao||'')))return ['chip-ok',status.includes('SENT')?'Sentença favorável':'Decisão favorável'];
    if(status==='URGENTE')return ['chip-hoje','Urgente'];
    if(days<=7)return ['chip-andamento','Em andamento'];
    return ['chip-curso',status&&status!=='ATIVO'?status.replaceAll('_',' '):'Em curso'];
  }
  function processCard(p){
    const [chip,label]=statusChip(p),days=daysToDeadline(p);
    return '<button class="lex-app-case" data-proc-id="'+encodedId(p.id)+'" onclick="window.lexOpenProcV2(this.dataset.procId)"><span class="lex-app-case-bar tone-'+chip+'"></span><span class="lex-app-case-body"><code>'+esc(p.numero||'sem número')+'</code><strong>'+esc(p.nome||p.partes||'Processo')+'</strong><span class="lex-app-case-meta"><i class="'+chip+'">'+esc(label)+'</i>'+(days<99999?'<em>◷ '+esc(whenLabel(days))+'</em>':'')+'</span></span><span class="lex-app-chev">›</span></button>';
  }
  function renderProcesses(queryValue){
    const host=document.getElementById('content');if(!host)return;
    document.body.classList.add('lex-v2-screen');
    const value=String(queryValue??document.getElementById('lex-proc-q')?.value??''),query=value.trim().toLowerCase(),all=getProcesses();
    const active=all.filter(p=>!isClosed(p)).length,critical=all.filter(p=>{const d=daysToDeadline(p);return d<99999&&d<=7;}).length;
    let rows=procFilter==='ativos'?all.filter(p=>!isClosed(p)):procFilter==='prazos'?all.filter(p=>{const d=daysToDeadline(p);return d<99999&&d<=7;}):all;
    if(query)rows=rows.filter(p=>[p.nome,p.numero,p.partes,p.assunto,p.area,p.tribunal,p.status].join(' ').toLowerCase().includes(query));
    const title=document.getElementById('page-title');if(title)title.textContent='Processos';
    host.innerHTML='<section class="lex-v2 lex-app" id="lex-app-processos"><div class="lex-app-heading"><div><span class="lex-v2-kicker">Carteira jurídica</span><h1>Processos</h1></div><button class="btn-primary" onclick="typeof abrirModalPrep===\'function\'&&abrirModalPrep(null)">＋ Novo caso</button></div><div class="lex-app-search"><span>⌕</span><input id="lex-proc-q" value="'+esc(value)+'" placeholder="Buscar processo, cliente, assunto..." oninput="window.lexFilterProcessos(this.value)"></div><div class="lex-app-tabs"><button class="'+(procFilter==='todos'?'on':'')+'" onclick="window.lexSetProcFilter(\'todos\')">Todos <b>'+all.length+'</b></button><button class="'+(procFilter==='ativos'?'on':'')+'" onclick="window.lexSetProcFilter(\'ativos\')">Ativos <b>'+active+'</b></button><button class="'+(procFilter==='prazos'?'on':'')+'" onclick="window.lexSetProcFilter(\'prazos\')">Prazos <b>'+critical+'</b></button></div><div class="lex-app-list">'+(rows.length?rows.map(processCard).join(''):'<div class="lex-v2-empty">Nenhum processo neste filtro.</div>')+'</div>'+dock('processos')+'</section>';
    const input=document.getElementById('lex-proc-q');if(input&&queryValue!==undefined){input.focus();input.setSelectionRange(input.value.length,input.value.length);}
  }
  function renderDeadlines(){
    const host=document.getElementById('content');if(!host)return;
    document.body.classList.add('lex-v2-screen');
    const items=getProcesses(),scored=items.map(p=>({p,days:daysToDeadline(p)})).filter(x=>x.days<99999).sort((a,b)=>a.days-b.days);
    const today=scored.filter(x=>x.days<=0),week=scored.filter(x=>x.days>0&&x.days<=7),shown=prazoTab==='hoje'?today:prazoTab==='7'?week:scored,events=dayEvents(items);
    const title=document.getElementById('page-title');if(title)title.textContent='Prazos';
    const cards=shown.map(x=>{const [chip,label]=statusChip(x.p);return '<button class="lex-app-case" data-proc-id="'+encodedId(x.p.id)+'" onclick="window.lexOpenProcV2(this.dataset.procId)"><span class="lex-app-case-bar tone-'+chip+'"></span><span class="lex-app-case-body"><strong>'+esc(x.p.nome||x.p.numero||'Processo')+'</strong><span>'+esc(x.p.numero||x.p.partes||'')+'</span><span class="lex-app-case-meta"><i class="'+chip+'">'+esc(label)+'</i><em>'+esc(whenLabel(x.days))+'</em></span></span><span class="lex-app-chev">›</span></button>';}).join('');
    const dayLabel=new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    host.innerHTML='<section class="lex-v2 lex-app" id="lex-app-prazos"><div class="lex-app-heading"><div><span class="lex-v2-kicker">Controladoria</span><h1>Prazos</h1></div><button class="btn-outline" onclick="ir(\'calendario\',null)">Abrir calendário</button></div><div class="lex-app-tabs"><button class="'+(prazoTab==='hoje'?'on':'')+'" onclick="window.lexSetPrazoTab(\'hoje\')">Hoje <b>'+today.length+'</b></button><button class="'+(prazoTab==='7'?'on':'')+'" onclick="window.lexSetPrazoTab(\'7\')">7 dias <b>'+week.length+'</b></button><button class="'+(prazoTab==='todos'?'on':'')+'" onclick="window.lexSetPrazoTab(\'todos\')">Todos <b>'+scored.length+'</b></button></div><section class="lex-v2-card lex-app-agenda"><div class="lex-app-day">'+esc(dayLabel)+'</div>'+(events.length?events.map(e=>'<div class="lex-v2-agenda-row"><strong>'+esc(e.time)+'</strong><span><b>'+esc(e.title)+'</b><span>'+esc(e.place)+'</span></span></div>').join(''):'<div class="lex-v2-empty">Nada na agenda de hoje.</div>')+'<button class="lex-app-wide" onclick="window.lexSetPrazoTab(\'todos\')">Ver todos os prazos</button></section><div class="lex-app-list">'+(cards||'<div class="lex-v2-empty">Nenhum prazo neste recorte.</div>')+'</div><section class="lex-v2-card lex-app-hint"><strong>LEX recomenda</strong><p>'+(week.length?week.length+' prazos podem ser antecipados. Deseja que o LEX organize?':'Nenhum prazo crítico nos próximos 7 dias.')+'</p><div class="lex-app-hint-actions"><button class="btn-primary" onclick="window.lexFocusV2()">Sim, organizar</button><button class="btn-outline" onclick="window.lexSetPrazoTab(\'7\')">Ver detalhes</button></div></section>'+dock('prazos')+'</section>';
  }

  window.lexOpenProcV2=function(value){
    if(typeof abrirProc!=='function')return;
    const id=decodeURIComponent(String(value||'')),match=getProcesses().find(p=>String(p.id)===id);
    abrirProc(match?match.id:id);
  };
  window.lexFocusV2=function(){
    if(!document.getElementById('work-order')){if(typeof ir==='function')ir('trabalho',null);else renderDashboard();requestAnimationFrame(()=>document.getElementById('work-order')?.focus());return;}
    document.getElementById('lex-v2-order')?.scrollIntoView({behavior:'smooth',block:'center'});document.getElementById('work-order')?.focus();
  };
  window.lexSetProcFilter=v=>{procFilter=v;renderProcesses();};
  window.lexFilterProcessos=v=>renderProcesses(v);
  window.lexSetPrazoTab=v=>{prazoTab=v;renderDeadlines();};
  window.lexRenderOfficeV2=renderDashboard;
  window.renderTrabalho=renderDashboard;
  window.renderPainel=renderDashboard;
  window.renderProcessos=renderProcesses;
  window.renderPrazos=renderDeadlines;

  function hookNavigation(){
    patchShell({total:0,recepcao:0,autuacao:0,judicial:0,prazos7:0});
    if(typeof window.ir==='function'&&!window.ir.__lexV2){
      const previous=window.ir;
      window.ir=function(page,button){
        const result=previous.apply(this,arguments);
        if(!['painel','trabalho','processos','prazos'].includes(page))document.body.classList.remove('lex-v2-screen');
        if(page==='processos'&&!document.getElementById('lex-app-processos'))renderProcesses();
        if(page==='prazos'&&!document.getElementById('lex-app-prazos'))renderDeadlines();
        if((page==='painel'||page==='trabalho')&&!document.getElementById('lex-v2-home'))renderDashboard();
        return result;
      };
      window.ir.__lexV2=true;
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hookNavigation,{once:true});else hookNavigation();
})();
