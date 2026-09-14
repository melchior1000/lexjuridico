(function(){
  'use strict';
  const sectorBlueprint=[
    {name:'Recepção',page:'mensagens',agents:['Atendimento','WhatsApp','Telegram']},
    {name:'Cadastro',page:'autuacao',agents:['Secretaria','Cadastro']},
    {name:'Inicial',page:'autuacao',agents:['Instrução','Inicial']},
    {name:'Processos ativos',page:'processos',agents:['Processual','Estratégia']},
    {name:'Prazos',page:'prazos',agents:['Controladoria','PJe']},
    {name:'Peças / Perícia',page:'trabalho',agents:['Redação','Pesquisa','Perícia']},
    {name:'Revisão',page:'trabalho',agents:['Revisão','Sentenças']},
    {name:'Concluído',page:'concluidos',agents:['Entrega','Arquivo']}
  ];
  function esc(v){return typeof lexEscape==='function'?lexEscape(String(v??'')):String(v??'');}
  function procs(){try{return typeof getProcs==='function'?(getProcs()||[]):[];}catch{return [];}}
  function prep(){try{return typeof getPrep==='function'?(getPrep()||[]):[];}catch{return [];}}
  function workflowCounts(){try{return typeof LexWorkflow!=='undefined'&&LexWorkflow?.summary?LexWorkflow.summary(procs(),prep()):{};}catch{return {};}}
  function prazoScore(p){
    const raw=p?.prazoReal||p?.prazo||p?.dataPrazo||'';
    if(!raw)return 99999;
    if(typeof diasRestantes==='function'){try{const n=diasRestantes(raw);return Number.isFinite(n)?n:99999;}catch{}}
    const m=String(raw).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);const d=m?new Date(+m[3],+m[2]-1,+m[1]):new Date(raw);
    if(Number.isNaN(d.getTime()))return 99999;return Math.ceil((d-Date.now())/86400000);
  }
  function nextActions(items){
    return items.map(p=>({p,score:prazoScore(p)})).filter(x=>x.score<99999).sort((a,b)=>a.score-b.score).slice(0,5);
  }
  function actionHtml(x){
    const p=x.p;const s=x.score;const badge=s<=0?'HOJE':s===1?'AMANHÃ':s<0?'VENCIDO':'PRAZO';
    const when=s<0?`${Math.abs(s)}d vencido`:s===0?'vence hoje':s===1?'vence amanhã':`${s} dias`;
    return `<div class="lex-v2-action"><span class="lex-v2-action-badge">${esc(badge)}</span><div class="lex-v2-action-main"><strong>${esc(p.nome||p.titulo||p.numero||'Processo')}</strong><span>${esc(p.numero||p.assunto||p.status||'')}</span></div><span class="lex-v2-action-time">${esc(when)}</span></div>`;
  }
  function agentBusy(agent,tasks){
    const needle=agent.toLowerCase();
    return tasks.some(t=>['na_fila','executando','aguardando_dados','aguardando_configuracao'].includes(t.status)&&String(t.agente||t.tipo||'').toLowerCase().includes(needle));
  }
  function sectorsHtml(tasks){
    return sectorBlueprint.map(s=>`<button class="lex-v2-sector" onclick="ir('${s.page}',null)" style="text-align:left;color:inherit;font:inherit;cursor:pointer"><h3>${esc(s.name)}</h3><div class="lex-v2-agents">${s.agents.map(a=>{const busy=agentBusy(a,tasks);return `<div class="lex-v2-agent"><span>🤖 ${esc(a)}</span><span class="lex-v2-agent-state ${busy?'busy':''}">${busy?'trabalhando':'pronto'}</span></div>`;}).join('')}</div></button>`).join('');
  }
  function taskPreview(tasks){
    if(!tasks.length)return '<div class="lex-v2-empty">Nenhuma entrega pendente. O LEX está livre para receber uma ordem.</div>';
    return tasks.slice(0,6).map(t=>typeof lexTaskCard==='function'?lexTaskCard(t):`<div class="work-task"><strong>${esc(t.processo_nome||t.instrucao||t.tipo)}</strong><p>${esc(t.agente||'LEX')} · ${esc(t.status||'')}</p></div>`).join('');
  }
  async function renderDashboard(){
    clearTimeout(typeof lexWorkTimer!=='undefined'?lexWorkTimer:null);
    const host=document.getElementById('content');if(!host)return;
    const items=procs(),preparacoes=prep(),counts=workflowCounts(),actions=nextActions(items);
    const nome=typeof getNomeEscritorio==='function'?getNomeEscritorio():'LEX Jurídico';
    const total=items.length;const urgentes=actions.filter(x=>x.score<=2).length;
    host.innerHTML=`<section class="lex-v2" id="lex-v2-home">
      <div class="lex-v2-hero">
        <div class="lex-v2-card lex-v2-intro"><div class="lex-v2-orb">🤖</div><div><div class="lex-v2-kicker">${esc(nome)}</div><h1>LEX coordena. Os agentes executam. Você decide.</h1><p>Uma única mesa para processos, prazos, documentos, clientes e os bots de cada setor — adaptada ao tamanho da tela.</p></div></div>
        <div class="lex-v2-card lex-v2-quick"><button onclick="abrirModalPrep(null)">＋ Novo caso<small>Recepção e cadastro</small></button><button onclick="ir('processos',null)">⌕ Processos<small>Consultar e trabalhar</small></button><button onclick="ir('prazos',null)">⏱ Prazos<small>Hoje e próximos dias</small></button><button onclick="document.getElementById('pdf-upload-input')?.click()">⇧ Documento<small>PDF, Word e autos</small></button></div>
      </div>
      <div class="lex-v2-kpis">
        <button class="lex-v2-card lex-v2-kpi" onclick="ir('processos',null)"><span>Processos</span><strong>${esc(total)}</strong><em>ativos no escritório</em></button>
        <button class="lex-v2-card lex-v2-kpi" onclick="ir('prazos',null)"><span>Prazos críticos</span><strong>${esc(urgentes)}</strong><em>até 2 dias</em></button>
        <button class="lex-v2-card lex-v2-kpi" onclick="ir('autuacao',null)"><span>Preparação</span><strong>${esc(counts.autuacao??preparacoes.length)}</strong><em>antes de distribuir</em></button>
        <button class="lex-v2-card lex-v2-kpi" onclick="ir('processos_admin',null)"><span>Administrativo</span><strong>${esc(counts.administrativo??0)}</strong><em>fora do judicial</em></button>
        <button class="lex-v2-card lex-v2-kpi" onclick="typeof lexOpenReception==='function'?lexOpenReception(document.getElementById('lex-nav-recepcao')):ir('mensagens',null)"><span>Recepção</span><strong id="lex-v2-reception-count">—</strong><em>aguardando o LEX / você</em></button>
      </div>
      <div class="lex-v2-grid">
        <div>
          <section class="lex-v2-card lex-v2-section"><div class="lex-v2-section-head"><div><h2>Agir agora</h2><p>O que pode vencer ou travar o escritório primeiro.</p></div><button class="btn-outline" onclick="ir('prazos',null)">Ver prazos</button></div><div class="lex-v2-action-list">${actions.length?actions.map(actionHtml).join(''):'<div class="lex-v2-empty">Nenhum prazo próximo identificado nos processos carregados.</div>'}</div></section>
          <section class="lex-v2-card lex-v2-office"><div class="lex-v2-section-head"><div><h2>Escritório virtual</h2><p>Os bots ficam dentro dos setores. O LEX fica acima, coordenando a passagem do trabalho.</p></div><button class="btn-outline" onclick="ir('agentes',null)">Detalhes</button></div><div class="lex-v2-coordinator"><span>🧠</span><div><strong>LEX · Coordenador geral</strong><div>Recebe a ordem, envia ao setor, acompanha a entrega e devolve para sua revisão.</div></div></div><div class="lex-v2-sectors" id="lex-v2-sectors">${sectorsHtml([])}</div></section>
        </div>
        <section class="lex-v2-card lex-v2-section"><div class="lex-v2-section-head"><div><h2>LEX agora</h2><p id="work-connection">Consultando servidor…</p></div><button class="btn-outline" onclick="renderTrabalho()">Atualizar</button></div><div class="lex-v2-deliveries" id="work-tasks"><div class="lex-v2-empty">Carregando tarefas…</div></div></section>
      </div>
      <section class="lex-v2-card lex-v2-order"><div class="lex-v2-section-head"><div><h2>Dar uma ordem ao LEX</h2><p>O LEX escolhe o agente do setor e mantém a entrega sob sua revisão.</p></div><span class="lex-v2-status" id="work-feedback"></span></div><div class="lex-v2-order-grid"><div><label for="work-case">Processo</label><select id="work-case"><option value="">Identificar pela ordem</option>${items.map(p=>`<option value="${esc(String(p.id))}">${esc(p.nome||p.numero||'Processo')} · ${esc(p.numero||'sem número')}</option>`).join('')}</select></div><div><label for="work-kind">Setor / entrega</label><select id="work-kind">${[['analise','Análise'],['peticao','Petição'],['contestacao','Contestação'],['recurso','Recurso'],['pericia','Perícia'],['quesitos','Quesitos'],['revisao','Revisão']].map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></div><div><label for="work-order">Ordem</label><textarea id="work-order" rows="1" placeholder="Ex.: analise a última decisão e prepare a manifestação para minha revisão."></textarea></div><button class="btn-primary" id="work-submit" onclick="lexSubmitTask()">Enviar ao LEX</button></div></section>
      <nav class="lex-v2-mobile-dock" aria-label="Atalhos"><button onclick="renderTrabalho()"><b>⌂</b>Início</button><button onclick="ir('processos',null)"><b>▣</b>Processos</button><button class="lex-primary" onclick="document.getElementById('work-order')?.focus()"><b>◉</b>LEX</button><button onclick="ir('prazos',null)"><b>◷</b>Prazos</button><button onclick="typeof toggleSidebar==='function'?toggleSidebar():document.getElementById('sidebar')?.classList.toggle('open')"><b>☰</b>Mais</button></nav>
    </section>`;
    const surface=document.getElementById('lex-v2-home');
    try{
      const data=await lexApi('/api/trabalho');if(!surface?.isConnected)return;
      const tasks=Array.isArray(data.tarefas)?data.tarefas:[];
      document.getElementById('work-connection').textContent='Servidor confirmado · '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
      document.getElementById('work-tasks').innerHTML=taskPreview(tasks);
      document.getElementById('lex-v2-sectors').innerHTML=sectorsHtml(tasks);
      if(!data.ia_configurada)document.getElementById('work-feedback').textContent='IA do servidor precisa de configuração.';
      if(tasks.some(t=>['na_fila','executando'].includes(t.status)))lexWorkTimer=setTimeout(()=>renderDashboard(),8000);
    }catch(e){if(surface?.isConnected)document.getElementById('work-connection').textContent=e.message;}
    try{
      const rec=await lexApi('/api/escritorio/recepcao');
      const rows=rec.itens||rec.contatos||rec.recepcao||[];const el=document.getElementById('lex-v2-reception-count');if(el)el.textContent=Array.isArray(rows)?rows.filter(r=>r.status!=='arquivado').length:'—';
    }catch{}
  }
  window.lexRenderOfficeV2=renderDashboard;
  window.renderTrabalho=renderDashboard;
})();