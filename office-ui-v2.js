(function(){
'use strict';
const $=(s,r=document)=>r.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const procs=()=>{try{return typeof getProcs==='function'?(getProcs()||[]):[]}catch{return[]}};
const prep=()=>{try{return typeof getPrep==='function'?(getPrep()||[]):[]}catch{return[]}};
const first=()=>{try{return String(typeof getResponsavel==='function'?getResponsavel():'Kleuber').replace(/^dr\.?\s*/i,'').trim().split(/\s+/)[0]||'Kleuber'}catch{return'Kleuber'}};
const go=p=>{if(typeof ir==='function')ir(p,null)};
const openProc=id=>{if(typeof abrirProc==='function')abrirProc(id)};
const days=p=>{const raw=p?.prazoReal||p?.prazo||p?.dataPrazo;if(!raw)return 9999;let d;if(/^\d{2}\/\d{2}\/\d{4}$/.test(raw)){const[a,b,c]=raw.split('/');d=new Date(+c,+b-1,+a)}else d=new Date(raw);if(Number.isNaN(d.getTime()))return 9999;const n=new Date();n.setHours(0,0,0,0);d.setHours(0,0,0,0);return Math.round((d-n)/86400000)};
const active=p=>!/CONCLU|ARQUIV|ENTREGUE|GANHO|PERDIDO/i.test(String(p.status||''));
const CHAT_HISTORY_LIMIT=20;
let procTab='todos',procQuery='',prazoTab='hoje',inboxFilter='todos',inboxActive=null,inboxTimer=null,inboxContacts=[];

function chatHistoryKey(id){return 'lex_chat_history_'+(id?'process_'+String(id):'general')}
function loadChatHistory(id){try{const raw=sessionStorage.getItem(chatHistoryKey(id));const items=raw?JSON.parse(raw):[];if(!Array.isArray(items))return[];return items.filter(m=>m&&(m.role==='user'||m.role==='assistant')&&typeof m.content==='string'&&m.content.trim()).slice(-CHAT_HISTORY_LIMIT)}catch{return[]}}
function saveChatHistory(id,items){try{const clean=(Array.isArray(items)?items:[]).filter(m=>m&&(m.role==='user'||m.role==='assistant')&&typeof m.content==='string'&&m.content.trim()).slice(-CHAT_HISTORY_LIMIT);sessionStorage.setItem(chatHistoryKey(id),JSON.stringify(clean))}catch{}}
function chatHistoryHtml(id){return loadChatHistory(id).map(m=>'<div class="lex-msg '+(m.role==='user'?'me':'bot')+'">'+esc(m.content)+'</div>').join('')}

function bot(size='lg'){return '<div class="lex-bot '+size+'"><span class="ant"></span><div class="head"><i></i><i></i><b>LEX</b></div></div>'}
function applyTheme(day){
  document.body.classList.toggle('lex-day',!!day);
  document.body.classList.toggle('dia',!!day);
  document.body.classList.toggle('noite',!day);
  localStorage.setItem('lex_commercial_theme',day?'day':'night');
  localStorage.setItem('lex_tema',day?'dia':'noite');
  const btn=document.getElementById('tema-btn');if(btn)btn.textContent=day?'🌙 Noite':'☀️ Dia';
}
function themeInit(){const modern=localStorage.getItem('lex_commercial_theme'),legacy=localStorage.getItem('lex_tema');const day=modern?modern==='day':legacy?legacy==='dia':document.body.classList.contains('dia');applyTheme(day)}
window.lexToggleTheme=function(){applyTheme(!document.body.classList.contains('lex-day'))};

function disableLegacySweep(){
  try{window.varreduraInicial=function(){return false}}catch{}
  const removeSweep=()=>document.getElementById('varredura-overlay')?.remove();
  removeSweep();let tries=0;const timer=setInterval(()=>{removeSweep();if(++tries>=12)clearInterval(timer)},250);
}
function syncLegacyThemeButton(){
  if(typeof window.alternarTema==='function'&&!window.alternarTema.__commercialSync){
    const old=window.alternarTema;
    window.alternarTema=function(){old.apply(this,arguments);applyTheme(document.body.classList.contains('dia'))};
    window.alternarTema.__commercialSync=true;
  }
}
function dock(on){return '<nav class="lex-dock"><button '+(on==='home'?'class="on"':'')+' onclick="lexHome()"><b>⌂</b><span>Início</span></button><button '+(on==='processos'?'class="on"':'')+' onclick="lexProcessos()"><b>▣</b><span>Processos</span></button><button class="lex-main '+(on==='lex'?'on':'')+'" onclick="lexChat()"><b>◉</b><span>LEX</span></button><button '+(on==='prazos'?'class="on"':'')+' onclick="lexPrazos()"><b>◷</b><span>Prazos</span></button><button '+(on==='mais'?'class="on"':'')+' onclick="lexMais()"><b>☰</b><span>Mais</span></button></nav>'}
function shell(title,body,on){if(inboxTimer){clearInterval(inboxTimer);inboxTimer=null}const host=$('#content');if(!host)return;document.body.classList.add('lex-commercial');host.innerHTML='<main class="lex-screen"><header class="lex-top"><div><strong>LEX</strong><small>ESCRITÓRIO VIRTUAL INTELIGENTE</small></div><div class="lex-top-actions"><button onclick="lexToggleTheme()" aria-label="Tema">◐</button><button onclick="typeof toggleSidebar===\'function\'&&toggleSidebar()">☰</button></div></header>'+body+dock(on)+'</main>';const t=$('#page-title');if(t)t.textContent=title}
function badge(d){if(d===9999)return '';if(d<0)return '<em class="late">Vencido</em>';if(d===0)return '<em class="urgent">Prazo hoje</em>';if(d<=2)return '<em class="urgent">'+d+' dias</em>';if(d<=7)return '<em class="soon">'+d+' dias</em>';return '<em class="ok">Em curso</em>'}
function procRows(list){return list.slice(0,30).map(p=>'<button class="lex-proc-row" onclick="lexOpenProc(\''+esc(String(p.id))+'\')"><span class="bar"></span><span><code>'+esc(p.numero||'sem número')+'</code><strong>'+esc(p.nome||p.partes||'Processo')+'</strong><small>'+esc(p.tribunal||p.area||p.assunto||'')+'</small><span class="chips">'+badge(days(p))+'</span></span><b>›</b></button>').join('')||'<div class="lex-empty">Nenhum processo encontrado.</div>'}
function filteredProcesses(){let list=procs();if(procTab==='ativos')list=list.filter(active);else if(procTab==='prazos')list=list.filter(p=>days(p)<=7);if(procQuery)list=list.filter(p=>[p.nome,p.numero,p.partes,p.assunto,p.area,p.tribunal,p.status].join(' ').toLowerCase().includes(procQuery));return list}
function deadlineItems(){return procs().map(p=>({p,d:days(p)})).filter(x=>x.d<9999).sort((a,b)=>a.d-b.d)}
function deadlineRows(list){return list.slice(0,30).map(x=>'<button onclick="lexOpenProc(\''+esc(String(x.p.id))+'\')"><i class="'+(x.d<=0?'red':x.d<=2?'amber':'blue')+'"></i><span><strong>'+esc(x.p.nome||x.p.numero||'Processo')+'</strong><small>'+esc(x.p.numero||x.p.tribunal||'')+'</small></span><em>'+(x.d<0?'vencido '+Math.abs(x.d)+'d':x.d===0?'hoje':x.d+'d')+'</em></button>').join('')||'<div class="lex-empty">Nenhum prazo cadastrado.</div>'}
window.lexOpenProc=id=>openProc(id);

async function home(){
  const p=procs(),act=p.filter(active),soon=p.filter(x=>days(x)<=7).length;let tasks=[],reception=0,quadro=null;
  try{const d=await lexApi('/api/trabalho');tasks=Array.isArray(d.tarefas)?d.tarefas:[];quadro=officeCounts(d)}catch{}
  try{const d=await lexApi('/api/escritorio/recepcao');const r=d.itens||d.contatos||d.recepcao||[];reception=Array.isArray(r)?r.filter(x=>x.status!=='arquivado').length:0}catch{}
  const urgent=p.map(x=>({p:x,d:days(x)})).filter(x=>x.d<=2).sort((a,b)=>a.d-b.d).slice(0,4);
  const body='<section class="lex-home-hero"><div class="lex-hello">'+bot()+'<div><h1>Olá, '+esc(first())+'!</h1><p>Seu escritório em ação. Resultados hoje.</p></div></div><button class="lex-talk" onclick="lexChat()"><span>⌕</span><b>Fale com o LEX...</b><i>🎙</i><i>↑</i></button><div class="lex-actions"><button onclick="goLex(\'peticao\')">📄<span>Nova peça</span></button><button onclick="lexProcessos()">⌕<span>Consultar</span></button><button onclick="lexPrazos()">📅<span>Prazos</span></button><button onclick="document.getElementById(\'pdf-upload-input\')?.click()">⇧<span>Enviar</span></button></div></section><section><div class="lex-section-title"><h2>Hoje no seu escritório</h2><button onclick="lexMais()">Ver tudo ›</button></div><div class="lex-kpis"><button onclick="lexProcessos()"><b>'+act.length+'</b><span>Processos</span></button><button onclick="lexPrazos()"><b>'+soon+'</b><span>Prazos</span></button><button onclick="lexTarefas()"><b>'+tasks.filter(t=>!['concluida','falhou'].includes(t.status)).length+'</b><span>Tarefas</span></button><button onclick="goLex(\'mensagens\')"><b>'+reception+'</b><span>Mensagens</span></button></div></section><section><div class="lex-section-title"><h2>Agir agora</h2><button onclick="lexPrazos()">Ver todos ›</button></div><div class="lex-now">'+(urgent.length?urgent.map(x=>'<button onclick="lexOpenProc(\''+esc(String(x.p.id))+'\')"><span>⚠</span><span><strong>'+esc(x.p.nome||x.p.numero||'Processo')+'</strong><small>'+esc(x.p.numero||x.p.assunto||'')+'</small></span><em>'+(x.d<=0?'Hoje':x.d+'d')+'</em></button>').join(''):'<div class="lex-empty">Nenhuma ação crítica para hoje.</div>')+'</div></section><section><div class="lex-section-title"><h2>Setores do Escritório</h2><button onclick="lexEscritorio()">Ver todos ›</button></div>'+officeGrid(tasks,p,quadro)+'</section>';
  shell('Início',body,'home');
}
function officeCounts(data){return data?.contagens?.setores||null}
function officeGrid(tasks,p,counts){
  const busy=rx=>tasks.some(t=>!['concluida','falhou'].includes(t.status)&&rx.test(String(t.agente||t.tipo||t.instrucao||'')));
  const local={recepcao:0,cadastro:prep().length,iniciais:p.filter(x=>/inicial/i.test(String(x.setor||''))).length,processos:p.filter(active).length,prazos:p.filter(x=>days(x)<=7).length,pecas:tasks.filter(x=>/petic|recurso|contest/i.test(String(x.tipo||x.instrucao||''))).length,pericia:tasks.filter(x=>/peric|quesit/i.test(String(x.tipo||x.instrucao||''))).length,revisao:tasks.filter(x=>x.status==='aguardando_revisao').length,concluidos:p.filter(x=>!active(x)).length};
  const count=k=>counts?Number(counts[k]||0):Number(local[k]||0);
  const rows=[['Recepção','LEX Recepção',count('recepcao'),'cyan',/atend|recep/i],['Cadastro','LEX Cadastro',count('cadastro'),'purple',/cadast|secret/i],['Iniciais','LEX Peticionamento',count('iniciais'),'violet',/inicial|redac/i],['Processos','LEX Jurídico',count('processos'),'green',/jurid|anal/i],['Prazos','LEX Controladoria',count('prazos'),'amber',/prazo|control/i],['Peças / Perícia','LEX Produção',count('pecas')+count('pericia'),'rose',/peric|redac|pesq/i],['Revisão','LEX Revisão',count('revisao'),'blue',/revis/i],['Concluídos','LEX Finalização',count('concluidos'),'slate',/final|entreg/i]];
  return '<div class="lex-office-grid">'+rows.map(r=>'<button class="tone-'+r[3]+'" onclick="lexEscritorio()"><span><strong>'+r[0]+'</strong><b>'+r[2]+'</b></span><small>'+r[1]+' <i class="'+(busy(r[4])?'busy':'')+'"></i></small></button>').join('')+'</div>';
}
function officeBoardHtml(counts){
  if(!counts)return '';
  const items=[['Cadastro',counts.cadastro],['Iniciais',counts.iniciais],['Peças',counts.pecas],['Perícia',counts.pericia],['Revisão',counts.revisao],['Processos',counts.processos],['Prazos',counts.prazos],['Concluídos',counts.concluidos]];
  return '<div class="lex-panel lex-office-board"><h2>Quadro do escritório</h2><div class="lex-office-board-grid">'+items.map(x=>'<span><strong>'+esc(x[0])+'</strong><b>'+Number(x[1]||0)+'</b></span>').join('')+'</div></div>';
}
window.lexHome=home;
window.lexProcessos=function(){const all=procs();const body='<div class="lex-page-head"><div><small>Carteira jurídica</small><h1>Processos</h1></div><button onclick="goLex(\'autuacao\')">＋</button></div><div class="lex-search"><span>⌕</span><input id="lex-q" value="'+esc(procQuery)+'" placeholder="Buscar processo, cliente, assunto..." oninput="lexFilterProc(this.value)"></div><div class="lex-tabs"><button class="'+(procTab==='todos'?'on':'')+'" onclick="lexSetProcFilter(\'todos\')">Todos <b>'+all.length+'</b></button><button class="'+(procTab==='ativos'?'on':'')+'" onclick="lexSetProcFilter(\'ativos\')">Ativos <b>'+all.filter(active).length+'</b></button><button class="'+(procTab==='prazos'?'on':'')+'" onclick="lexSetProcFilter(\'prazos\')">Prazos <b>'+all.filter(x=>days(x)<=7).length+'</b></button></div><div id="lex-proc-list">'+procRows(filteredProcesses())+'</div>';shell('Processos',body,'processos')};
window.lexSetProcFilter=tab=>{procTab=['todos','ativos','prazos'].includes(tab)?tab:'todos';window.lexProcessos()};
window.lexFilterProc=q=>{procQuery=String(q||'').toLowerCase();const h=$('#lex-proc-list');if(h)h.innerHTML=procRows(filteredProcesses())};
window.lexPrazos=function(){const all=deadlineItems();const visible=prazoTab==='hoje'?all.filter(x=>x.d===0):prazoTab==='7dias'?all.filter(x=>x.d>=0&&x.d<=7):all;const body='<div class="lex-page-head"><div><small>Controladoria</small><h1>Prazos</h1></div><button onclick="goLex(\'calendario\')">▣</button></div><div class="lex-tabs"><button class="'+(prazoTab==='hoje'?'on':'')+'" onclick="lexSetPrazoTab(\'hoje\')">Hoje <b>'+all.filter(x=>x.d===0).length+'</b></button><button class="'+(prazoTab==='7dias'?'on':'')+'" onclick="lexSetPrazoTab(\'7dias\')">7 dias <b>'+all.filter(x=>x.d>=0&&x.d<=7).length+'</b></button><button class="'+(prazoTab==='todos'?'on':'')+'" onclick="lexSetPrazoTab(\'todos\')">Todos</button></div><div class="lex-timeline">'+deadlineRows(visible)+'</div><div class="lex-recommend"><b>💡 LEX recomenda</b><p>Priorize prazos de hoje e dos próximos 2 dias.</p><button onclick="lexChat()">Organizar com o LEX</button></div>';shell('Prazos',body,'prazos')};
window.lexSetPrazoTab=tab=>{prazoTab=['hoje','7dias','todos'].includes(tab)?tab:'hoje';window.lexPrazos()};
window.lexTarefas=async function(){let tasks=[];try{const d=await lexApi('/api/trabalho');tasks=Array.isArray(d.tarefas)?d.tarefas:[]}catch{}const body='<div class="lex-page-head"><div><small>Entregas do escritório</small><h1>Tarefas</h1></div><button onclick="lexHome()">⌂</button></div><div class="lex-panel"><h2>Fila do LEX</h2>'+(tasks.length?tasks.slice(0,60).map(t=>'<div class="lex-agent-row"><i class="'+(['na_fila','executando'].includes(t.status)?'busy':'')+'"></i><span><strong>'+esc(t.agente||t.tipo||'LEX')+'</strong><small>'+esc(t.processo_nome||t.instrucao||'Tarefa do escritório')+'</small></span><em>'+esc(t.status||'')+'</em></div>').join(''):'<div class="lex-empty">Nenhuma tarefa registrada.</div>')+'</div>';shell('Tarefas',body,'home')};
window.lexEscritorio=async function(){
  let tasks=[],quadro=null;
  try{const d=await lexApi('/api/trabalho');tasks=Array.isArray(d.tarefas)?d.tarefas:[];quadro=officeCounts(d)}catch{}
  const atividade=tasks.slice(0,12).map(t=>'<div class="lex-agent-row"><i class="'+(['na_fila','executando'].includes(t.status)?'busy':'')+'"></i><span><strong>'+esc(t.agente||'LEX')+'</strong><small>'+esc(t.processo_nome||t.instrucao||t.tipo||'Tarefa')+'</small></span><em>'+esc(t.status||'')+'</em></div>').join('')||'<div class="lex-empty">Nenhuma tarefa em andamento.</div>';
  const body='<div class="lex-page-head"><div><small>Fluxo completo</small><h1>Escritório</h1></div><button onclick="lexHome()">⌂</button></div>'
    +'<div class="lex-coord">'+bot('sm')+'<div><strong>LEX · Coordenador geral</strong><small>Recebe a ordem, distribui aos setores e devolve para sua revisão.</small></div></div>'
    +officeGrid(tasks,procs(),quadro)
    +officeBoardHtml(quadro)
    +'<div class="lex-panel"><h2>Atividade dos agentes</h2>'+atividade+'</div>';
  shell('Escritório',body,'mais');
};
window.lexSelectChatProcess=function(id){try{sessionStorage.setItem('lex_chat_process_id',String(id||''))}catch{}};
window.lexSwitchChatProcess=function(id){window.lexSelectChatProcess(id);window.lexChat(id)};
window.lexStartVoice=function(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;const input=$('#lex-chat-input');if(!input)return;if(!SR){input.placeholder='Ditado por voz não disponível neste navegador.';input.focus();return}const rec=new SR();rec.lang='pt-BR';rec.interimResults=false;rec.maxAlternatives=1;const btn=$('#lex-mic-btn');if(btn)btn.classList.add('listening');rec.onresult=e=>{const txt=e.results?.[0]?.[0]?.transcript||'';input.value=(input.value?input.value+' ':'')+txt;input.focus()};rec.onerror=()=>{input.placeholder='Não consegui ouvir. Digite sua mensagem.'};rec.onend=()=>btn?.classList.remove('listening');rec.start()};
window.lexChat=function(selectedId){const items=procs();let saved='';try{saved=String(selectedId||sessionStorage.getItem('lex_chat_process_id')||'')}catch{saved=String(selectedId||'')}if(saved&&!items.some(p=>String(p.id)===saved))saved='';window.lexSelectChatProcess(saved);const history=chatHistoryHtml(saved);const body='<div class="lex-chat-head">'+bot()+'<div><h1>Olá, '+esc(first())+'!</h1><p>Como posso ajudar hoje?</p></div></div><div class="lex-search lex-chat-context"><span>⚖</span><select id="lex-chat-process" onchange="lexSwitchChatProcess(this.value)" style="width:100%;min-height:44px;background:transparent;border:0;color:inherit;outline:0"><option value="">Conversa geral — sem processo</option>'+items.slice(0,150).map(p=>'<option value="'+esc(String(p.id))+'" '+(String(p.id)===saved?'selected':'')+'>'+esc((p.numero||'sem número')+' · '+(p.nome||p.partes||'Processo'))+'</option>').join('')+'</select></div><div class="lex-chat-shortcuts"><button onclick="lexPrefill(\'Analise o processo selecionado e a última decisão.\')">⚖ Analisar processo</button><button onclick="lexPrefill(\'Prepare uma minuta de peça para minha revisão.\')">📄 Minuta de peça</button><button onclick="lexPrazos()">◷ Ver prazos</button><button onclick="lexPrefill(\'Analise os riscos e próximos passos deste caso.\')">♟ Analisar risco</button><button onclick="lexPrefill(\'Pesquise jurisprudência atual e relevante para este caso.\')">⌕ Jurisprudência</button><button onclick="lexEscritorio()">▦ Setores</button></div><div class="lex-conversation" id="lex-conversation"><div class="lex-msg bot">Sou o LEX. Posso analisar casos, organizar prazos e acionar os agentes certos. As entregas relevantes continuam sob sua revisão.</div>'+history+'</div><form class="lex-chatbar" onsubmit="lexSendChat(event)"><textarea id="lex-chat-input" rows="1" placeholder="Digite sua mensagem..."></textarea><button id="lex-mic-btn" type="button" title="Falar" onclick="lexStartVoice()">🎙</button><button type="submit">↑</button></form><div class="lex-suggestion"><b>💡 Sugestão do LEX</b><span>Quer que eu organize primeiro os casos com prazo crítico?</span><button onclick="lexPrazos()">Ver prazos</button></div>';shell('LEX',body,'lex');setTimeout(()=>{const c=$('#lex-conversation');if(c)c.scrollTop=c.scrollHeight;$('#lex-chat-input')?.focus()},60)};
window.lexPrefill=t=>{const i=$('#lex-chat-input');if(i){i.value=t;i.focus()}};
window.lexSendChat=async function(e){e?.preventDefault();const input=$('#lex-chat-input'),box=$('#lex-conversation');const text=input?.value.trim();if(!text||!box)return;const selected=String($('#lex-chat-process')?.value||'');const process=procs().find(p=>String(p.id)===selected)||null;if(selected&&!process){box.insertAdjacentHTML('beforeend','<div class="lex-msg bot error">O processo selecionado não está mais disponível. Atualize a carteira e selecione novamente.</div>');return}window.lexSelectChatProcess(selected);const historico=loadChatHistory(selected);box.insertAdjacentHTML('beforeend','<div class="lex-msg me">'+esc(text)+'</div>');input.value='';box.insertAdjacentHTML('beforeend','<div class="lex-msg bot pending" id="lex-pending">LEX está analisando…</div>');box.scrollTop=box.scrollHeight;try{const payload={mensagem:text,historico};if(process){payload.processo_id=process.id;payload.numero_processo=process.numero||null;payload.processo_nome=process.nome||process.partes||null;payload.setor=process.setor||null}const d=await lexApi('/api/vivo/conversar',{method:'POST',body:JSON.stringify(payload)});const ans=d?.resposta||d?.reply||d?.mensagem||d?.texto||d?.resultado||d?.content||'Recebi a ordem. Vou organizar isso dentro do fluxo do escritório.';const answer=typeof ans==='string'?ans:JSON.stringify(ans);$('#lex-pending')?.remove();box.insertAdjacentHTML('beforeend','<div class="lex-msg bot">'+esc(answer)+'</div>');saveChatHistory(selected,[...historico,{role:'user',content:text},{role:'assistant',content:answer}])}catch(err){$('#lex-pending')?.remove();box.insertAdjacentHTML('beforeend','<div class="lex-msg bot error">Não consegui concluir a conversa agora: '+esc(err.message||'falha no servidor')+'.</div>')}box.scrollTop=box.scrollHeight};

function inboxKey(x){return String(x?.origem||'whatsapp')+':'+String(x?.id||x?.numero||'')}
function inboxTime(v){if(!v)return'';const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
function inboxIcon(o){return o==='telegram'?'✈':'◉'}
function inboxLabel(o){return o==='telegram'?'Telegram':'WhatsApp'}
function inboxFiltered(){return inboxContacts.filter(x=>inboxFilter==='todos'||x.origem===inboxFilter)}
function inboxListHtml(){
  const list=inboxFiltered();
  return list.length?list.map(x=>{
    const key=inboxKey(x),active=inboxActive===key?' on':'',urgent=x.urgente?' urgent':'';
    return '<button class="lex-inbox-contact'+active+urgent+'" onclick="lexInboxOpen(\''+esc(x.origem)+'\',\''+esc(x.id||x.numero||'')+'\')"><span class="lex-channel-dot '+esc(x.origem)+'">'+inboxIcon(x.origem)+'</span><span><strong>'+esc(x.nome||'Contato')+'</strong><small>'+esc(x.ultima_mensagem||'Sem mensagem')+'</small></span><em>'+esc(inboxTime(x.atualizado_em))+'</em></button>';
  }).join(''):'<div class="lex-empty">Nenhuma conversa neste canal.</div>';
}
function inboxEmptyChat(){return '<div class="lex-inbox-empty-chat"><b>Mensagens do escritório</b><span>Escolha uma conversa. WhatsApp e Telegram ficam na mesma mesa, sem misturar os canais.</span></div>'}
function inboxChatHeader(item){return '<header class="lex-inbox-chat-head"><button class="lex-inbox-back" onclick="lexInboxBack()">‹</button><span class="lex-channel-dot '+esc(item.origem)+'">'+inboxIcon(item.origem)+'</span><div><strong>'+esc(item.nome||'Contato')+'</strong><small>'+inboxLabel(item.origem)+' · '+esc(item.id||item.numero||'')+'</small></div><button title="Atualizar conversa" onclick="lexInboxOpen(\''+esc(item.origem)+'\',\''+esc(item.id||item.numero||'')+'\')">↻</button></header>'}
function inboxMessagesHtml(rows){
  return (rows||[]).map(m=>{
    const mine=m.direcao!=='entrada',who=m.direcao==='saida_lex'?'LEX':m.direcao==='saida_operador'?'Equipe':'Contato';
    return '<div class="lex-inbox-msg '+(mine?'mine':'theirs')+'"><small>'+who+'</small><span>'+esc(m.texto||'')+'</span><time>'+esc(inboxTime(m.criado_em))+'</time></div>';
  }).join('')||'<div class="lex-empty">Ainda não há histórico persistido desta conversa.</div>';
}
async function loadInboxContacts(){
  const statuses=['urgente','aguardando_advogado','administrativo','arquivado'];
  const data=await Promise.all(statuses.map(s=>lexApi('/api/escritorio/recepcao?status='+s)));
  const map=new Map();
  data.flatMap(d=>d.contatos||[]).forEach(x=>{const k=inboxKey(x),old=map.get(k);if(!old||String(x.atualizado_em||'')>String(old.atualizado_em||''))map.set(k,x)});
  inboxContacts=[...map.values()].sort((a,b)=>Number(b.urgente)-Number(a.urgente)||String(b.atualizado_em||'').localeCompare(String(a.atualizado_em||'')));
  return inboxContacts;
}
function inboxRenderList(){const h=$('#lex-inbox-list');if(h)h.innerHTML=inboxListHtml();const count=$('#lex-inbox-count');if(count)count.textContent=String(inboxFiltered().length)}
window.lexInbox=async function(filter='todos'){
  inboxFilter=['todos','whatsapp','telegram'].includes(filter)?filter:'todos';
  const body='<div class="lex-page-head lex-inbox-title"><div><small>Central de comunicação</small><h1>Mensagens</h1></div><span id="lex-inbox-count">0</span></div><div class="lex-tabs lex-inbox-tabs"><button class="'+(inboxFilter==='todos'?'on':'')+'" onclick="lexInbox(\'todos\')">Todas</button><button class="'+(inboxFilter==='whatsapp'?'on':'')+'" onclick="lexInbox(\'whatsapp\')">◉ WhatsApp</button><button class="'+(inboxFilter==='telegram'?'on':'')+'" onclick="lexInbox(\'telegram\')">✈ Telegram</button></div><section class="lex-inbox-shell" id="lex-inbox-shell"><aside class="lex-inbox-list" id="lex-inbox-list"><div class="lex-empty">Carregando conversas…</div></aside><main class="lex-inbox-chat" id="lex-inbox-chat">'+inboxEmptyChat()+'</main></section>';
  shell('Mensagens',body,'mais');
  try{
    await loadInboxContacts();inboxRenderList();
    const visible=inboxFiltered();
    const selected=visible.find(x=>inboxKey(x)===inboxActive);
    if(selected&&matchMedia('(min-width: 701px)').matches)await window.lexInboxOpen(selected.origem,selected.id||selected.numero);
    else if(!inboxActive&&visible[0]&&matchMedia('(min-width: 701px)').matches)await window.lexInboxOpen(visible[0].origem,visible[0].id||visible[0].numero);
    inboxTimer=setInterval(async()=>{try{await loadInboxContacts();inboxRenderList()}catch{}},5000);
  }catch(e){const h=$('#lex-inbox-list');if(h)h.innerHTML='<div class="lex-empty">'+esc(e.message||'Não foi possível carregar as conversas.')+'</div>'}
};
window.lexInboxOpen=async function(origem,id){
  const key=origem+':'+id;inboxActive=key;inboxRenderList();
  const shellEl=$('#lex-inbox-shell'),chat=$('#lex-inbox-chat');if(!chat)return;
  const item=inboxContacts.find(x=>inboxKey(x)===key)||{origem,id,nome:'Contato'};
  shellEl?.classList.add('has-active');chat.innerHTML=inboxChatHeader(item)+'<div class="lex-inbox-thread"><div class="lex-empty">Carregando histórico…</div></div>';
  try{
    const d=await lexApi('/api/escritorio/recepcao/historico?origem='+encodeURIComponent(origem)+'&id='+encodeURIComponent(id));
    const thread=$('.lex-inbox-thread',chat);if(thread){thread.innerHTML=inboxMessagesHtml(d.historico||[]);thread.scrollTop=thread.scrollHeight}
    chat.insertAdjacentHTML('beforeend','<form class="lex-inbox-compose" onsubmit="lexInboxSend(event,\''+esc(origem)+'\',\''+esc(id)+'\')"><textarea id="lex-inbox-text" rows="1" maxlength="3500" placeholder="Mensagem pelo '+inboxLabel(origem)+'…"></textarea><button type="submit" aria-label="Enviar">↑</button></form>');
    $('#lex-inbox-text')?.focus();
  }catch(e){const thread=$('.lex-inbox-thread',chat);if(thread)thread.innerHTML='<div class="lex-empty">'+esc(e.message||'Falha ao carregar histórico.')+'</div>'}
};
window.lexInboxSend=async function(e,origem,id){
  e?.preventDefault();const input=$('#lex-inbox-text'),btn=e?.submitter,text=String(input?.value||'').trim();if(!text)return;
  if(btn)btn.disabled=true;if(input)input.disabled=true;
  try{
    await lexApi('/api/escritorio/recepcao/responder',{method:'POST',body:JSON.stringify({origem,id,texto:text})});
    await loadInboxContacts();await window.lexInboxOpen(origem,id);inboxRenderList();
  }catch(err){if(input){input.disabled=false;input.focus()}if(btn)btn.disabled=false;typeof toast==='function'?toast(err.message||'Envio não confirmado.','erro'):alert(err.message||'Envio não confirmado.')}
};
window.lexInboxBack=function(){inboxActive=null;$('#lex-inbox-shell')?.classList.remove('has-active');const chat=$('#lex-inbox-chat');if(chat)chat.innerHTML=inboxEmptyChat();inboxRenderList()};

window.lexMais=function(){const body='<div class="lex-page-head"><div><small>Funções complementares</small><h1>Mais</h1></div><button onclick="lexToggleTheme()">◐</button></div><div class="lex-menu"><button onclick="goLex(\'agenda\')">👥<span>Clientes / Contatos</span><b>›</b></button><button onclick="goLex(\'calendario\')">📅<span>Agenda</span><b>›</b></button><button onclick="goLex(\'autuacao\')">📄<span>Documentos / Autuação</span><b>›</b></button><button disabled title="Módulo financeiro ainda não possui rota comercial própria">＄<span>Financeiro · em breve</span><b>·</b></button><button onclick="goLex(\'estatisticas\')">▥<span>Relatórios / Estatísticas</span><b>›</b></button><button onclick="lexEscritorio()">▦<span>Escritório / Setores</span><b>›</b></button><button onclick="goLex(\'escritorio\')">⚙<span>Configurações do escritório</span><b>›</b></button></div><h2 class="lex-channel-title">Canais de comunicação</h2><div class="lex-channels"><button onclick="goLex(\'whatsapp\')">🟢<span>WhatsApp</span></button><button onclick="goLex(\'telegram\')">🔵<span>Telegram</span></button><button onclick="goLex(\'mensagens\')">✉️<span>Mensagens</span></button><button onclick="goLex(\'pje\')">Pe<span>PJe</span></button></div>';shell('Mais',body,'mais')};
window.goLex=p=>go(p);
window.renderPainel=home;window.renderTrabalho=window.lexTarefas;window.renderProcessos=window.lexProcessos;window.renderPrazos=window.lexPrazos;window.lexFocusV2=window.lexChat;
function hook(){themeInit();disableLegacySweep();syncLegacyThemeButton();if(typeof window.ir==='function'&&!window.ir.__commercial){const old=window.ir;window.ir=function(page,button){if(page==='painel'){home();return}if(page==='trabalho'){window.lexTarefas();return}if(page==='processos'){window.lexProcessos();return}if(page==='prazos'){window.lexPrazos();return}return old.apply(this,arguments)};window.ir.__commercial=true}setTimeout(()=>{disableLegacySweep();syncLegacyThemeButton();const c=$('#content');if(c&&c.offsetParent!==null&&!$('.lex-screen',c))home()},120)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook,{once:true});else hook();
})();