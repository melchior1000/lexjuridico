(function(){
'use strict';
const $=(s,r=document)=>r.querySelector(s);
const esc=v=>(globalThis.lexFixText||String)(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const procs=()=>{try{return typeof getProcs==='function'?(getProcs()||[]):[]}catch{return[]}};
const prep=()=>{try{return typeof getPrep==='function'?(getPrep()||[]):[]}catch{return[]}};
const first=()=>{try{return String(typeof getResponsavel==='function'?getResponsavel():'').replace(/^dr\.?\s*/i,'').trim().split(/\s+/)[0]||'titular'}catch{return'titular'}};
const go=p=>{if(typeof ir==='function')ir(p,null)};
const openProc=id=>{if(typeof abrirProc==='function')abrirProc(id)};
const days=p=>{const raw=p?.prazoReal||p?.prazo||p?.dataPrazo;if(!raw)return 9999;let d;if(/^\d{2}\/\d{2}\/\d{4}$/.test(raw)){const[a,b,c]=raw.split('/');d=new Date(+c,+b-1,+a)}else if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){const[y,m,day]=raw.split('-');d=new Date(+y,+m-1,+day)}else d=new Date(raw);if(Number.isNaN(d.getTime()))return 9999;const n=new Date();n.setHours(0,0,0,0);d.setHours(0,0,0,0);return Math.round((d-n)/86400000)};
const active=p=>!/CONCLU|ARQUIV|ENTREGUE|GANHO|PERDIDO/i.test(String(p.status||''));
const CHAT_HISTORY_LIMIT=20;
let procTab='ativos',procQuery='',procSort='recentes',procPage=1,procView='clientes',procOpen=new Set(),procGroupShow={},prazoTab='todos',prazoPage=1,deadlineServerState=[];
const PROC_PAGE_SIZE=40,DEADLINE_PAGE_SIZE=40;
const PROC_GROUP_PAGE=25,PROC_GROUP_ROWS=30;
let navCurrent=null,navTrail=[],navRestoring=false;
function navMark(view){
  if(navRestoring){navCurrent=view;navRestoring=false;return}
  if(navCurrent===view)return;
  if(navCurrent)navTrail.push(navCurrent);
  if(navTrail.length>20)navTrail=navTrail.slice(-20);
  navCurrent=view;
}
function navGo(view){
  const map={home:()=>window.lexHome(),processos:()=>window.lexProcessos(),prazos:()=>window.lexPrazos(),lex:()=>window.lexChat(),mais:()=>window.lexMais(),tarefas:()=>window.lexTarefas(),escritorio:()=>window.lexEscritorio()};
  (map[view]||map.home)();
}
window.lexBack=function(){const target=navTrail.pop()||'home';navRestoring=true;navGo(target)};
function pageSlice(list,page,size){
  const total=list.length,pages=Math.max(1,Math.ceil(total/size)),safe=Math.min(Math.max(1,page),pages),start=(safe-1)*size;
  return{items:list.slice(start,start+size),page:safe,pages,total,start,end:Math.min(start+size,total)};
}
function pagerHtml(meta,kind){
  if(meta.total<=meta.items.length&&meta.pages<=1)return '<div class="lex-list-meta"><span>'+meta.total+' resultado'+(meta.total===1?'':'s')+'</span></div>';
  const prev=meta.page>1,next=meta.page<meta.pages;
  return '<div class="lex-pager"><span>'+ (meta.total?meta.start+1:0)+'–'+meta.end+' de '+meta.total+'</span><div><button '+(prev?'':'disabled')+' onclick="'+kind+'('+(meta.page-1)+')">‹</button><b>Página '+meta.page+' de '+meta.pages+'</b><button '+(next?'':'disabled')+' onclick="'+kind+'('+(meta.page+1)+')">›</button></div></div>';
}

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
function shell(title,body,on){const host=$('#content');if(!host)return;document.body.classList.add('lex-commercial');const back=navCurrent&&navCurrent!=='home'?'<button class="lex-shell-back" onclick="lexBack()" aria-label="Voltar">‹</button>':'';host.innerHTML='<main class="lex-screen"><header class="lex-top"><div class="lex-brand">'+back+'<div><strong>LEX</strong><small>ESCRITÓRIO VIRTUAL INTELIGENTE</small></div></div><div class="lex-top-actions"><button onclick="lexToggleTheme()" aria-label="Tema">◐</button><button onclick="typeof toggleSidebar===\'function\'&&toggleSidebar()">☰</button></div></header>'+body+dock(on)+'</main>';const t=$('#page-title');if(t)t.textContent=title}
function badge(d){if(d===9999)return '';if(d<0)return '<em class="late">Vencido</em>';if(d===0)return '<em class="urgent">Prazo hoje</em>';if(d<=2)return '<em class="urgent">'+d+' dias</em>';if(d<=7)return '<em class="soon">'+d+' dias</em>';return '<em class="ok">Em curso</em>'}
function procRows(list,opts){return list.map(p=>procLine(p,opts)).join('')||'<div class="lex-empty">Nenhum processo encontrado.</div>'}
// Carteira: cliente é o campo cliente ou o que vem antes de " — " / " x " no nome.
const PROC_SEP=/\s+[—–-]\s+|\s+(?:x|×|vs\.?|versus)\s+/i;
function procClient(p){const c=String((globalThis.lexFixText||String)(p?.cliente||(p?.grupo&&!/^outros$/i.test(p.grupo)?p.grupo:''))).trim();if(c)return c;const n=String((globalThis.lexFixText||String)(p?.nome||'')).trim(),m=n.split(PROC_SEP);return m.length>1&&m[0].trim().length>=2?m[0].trim():''}
function procKey(name){return String(name||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim()}
function processOfficial(p){return !!(p?.last_court_sync_at||p?.partes_verificadas_em||p?.cadastro_conferido==='tribunal'||p?.numero_verificado_fonte==='pje')}
function trustedDeadline(p){return p?.deadline_truth===true||p?.prazo_confirmado===true||deadlineConfirmed(p)}
function procTitle(p,client){if(judicial(p)&&active(p)&&!processOfficial(p)){const num=procShortNum(p);return num?'Processo '+num+' — dados a conferir':'Processo — dados a conferir'}const n=String((globalThis.lexFixText||String)(p.nome_oficial||p.nome||p.partes||'Processo')).trim();if(!client)return n;const rest=n.slice(0,client.length).toLowerCase()===client.toLowerCase()?n.slice(client.length).replace(/^\s*(?:[—–-]|x|×|vs\.?|versus)\s+/i,'').trim():n;return rest||n}
function procShortNum(p){const m=String(p.numero||'').match(/^\s*(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/);return m?m[1]:''}
function procLine(p,opts){const d=trustedDeadline(p)?days(p):9999,num=procShortNum(p),where=p.tribunal||p.vara||p.area||'',unverified=judicial(p)&&active(p)&&!processOfficial(p),tone=unverified?'soon':d<0?'late':d<=2?'urgent':d<=7?'soon':active(p)?'ok':'done';
  // Linha enxuta: bolinha de estado, título, número e UM botão "falar com o LEX sobre este".
  return '<div class="lex-proc-line"><button class="open" onclick="lexOpenProc(\''+esc(String(p.id))+'\')"><i class="dot '+tone+'"></i><span class="txt"><strong>'+esc(procTitle(p,opts?.client))+'</strong><small>'+(num?(cnjOk(num)||!judicial(p)?'<code>'+esc(num)+'</code>':'<span class="nocnj">nº CNJ inválido</span>'):'<span class="nocnj">'+(judicial(p)?'sem nº CNJ':'administrativo')+'</span>')+(where?' · '+esc(where):'')+(unverified?' · <span class="nocnj">dados não conferidos no tribunal</span>':'')+'</small></span>'+(d<9999?'<span class="chips">'+badge(d)+'</span>':'')+'</button><button class="lex" onclick="lexChat(\''+esc(String(p.id))+'\')" aria-label="Falar com o LEX sobre este processo" title="Falar com o LEX sobre este processo">◉</button></div>'}
function procUrgency(list){const r={vencidos:0,hoje:0,semana:0};for(const p of list){if(!active(p)||!trustedDeadline(p))continue;const d=days(p);if(d<0)r.vencidos++;else if(d===0)r.hoje++;else if(d<=7)r.semana++}return r}
function procGroups(list){const map=new Map();for(const p of list){const name=procClient(p),key=procKey(name)||'~';if(!map.has(key))map.set(key,{key,name:name||'Sem cliente identificado',items:[]});map.get(key).items.push(p)}
  const groups=[],single=[];for(const g of map.values()){if(g.key!=='~'&&g.items.length>1)groups.push(g);else single.push(...g.items)}
  const byUrgency=(a,b)=>(active(a)&&trustedDeadline(a)?days(a):99999)-(active(b)&&trustedDeadline(b)?days(b):99999);
  for(const g of groups){g.u=procUrgency(g.items);g.items.sort(byUrgency)}
  groups.sort((a,b)=>b.u.vencidos-a.u.vencidos||b.u.hoje-a.u.hoje||b.u.semana-a.u.semana||b.items.length-a.items.length||a.name.localeCompare(b.name,'pt-BR'));
  if(single.length)single.sort(byUrgency),groups.push({key:'~outros',name:groups.length?'Demais clientes':'Processos',items:single,u:procUrgency(single),rest:true});
  return groups}
function initials(n){return String(n||'?').replace(/[^\p{L}\p{N}\s]/gu,'').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?'}
function procGroupHtml(g){const open=procOpen.has(g.key),u=g.u,chips=(u.vencidos?'<em class="late">'+u.vencidos+' vencido'+(u.vencidos>1?'s':'')+'</em>':'')+(u.hoje?'<em class="urgent">'+u.hoje+' hoje</em>':'')+(u.semana?'<em class="soon">'+u.semana+' na semana</em>':'');
  const show=procGroupShow[g.key]||PROC_GROUP_ROWS,rows=open?g.items.slice(0,show):[];
  return '<section class="lex-proc-group'+(open?' open':'')+(u.vencidos||u.hoje?' hot':'')+'"><button class="head" aria-expanded="'+open+'" onclick="lexToggleProcGroup(\''+esc(g.key)+'\')"><span class="ava">'+(g.rest?'＋':esc(initials(g.name)))+'</span><span class="who"><strong>'+esc(g.name)+'</strong><small>'+g.items.length+' processo'+(g.items.length>1?'s':'')+'</small></span><span class="chips">'+chips+'</span><b>'+(open?'⌃':'⌄')+'</b></button>'
    +(open?'<div class="rows">'+procRows(rows,{client:g.rest?'':g.name})+(g.items.length>show?'<button class="more" onclick="lexMoreProcGroup(\''+esc(g.key)+'\')">Mostrar mais '+Math.min(PROC_GROUP_ROWS,g.items.length-show)+' de '+(g.items.length-show)+' restantes</button>':'')+'</div>':'')+'</section>'}
function procListHtml(list){
  if(procView==='clientes'&&!procQuery&&!['vencidos','hoje','semana','semcnj'].includes(procTab)){
    const groups=procGroups(list),meta=pageSlice(groups,procPage,PROC_GROUP_PAGE);procPage=meta.page;
    if(groups.length===1&&!procOpen.has(groups[0].key))procOpen.add(groups[0].key);
    return meta.items.map(procGroupHtml).join('')||'<div class="lex-empty">Nenhum processo encontrado.</div>';
  }
  const meta=pageSlice(list,procPage,PROC_PAGE_SIZE);procPage=meta.page;
  return '<div class="lex-proc-flat">'+procRows(meta.items)+'</div>'+pagerHtml(meta,'lexSetProcPage')}
function procGroupPager(list){if(procView!=='clientes'||procQuery||['vencidos','hoje','semana','semcnj'].includes(procTab))return'';const meta=pageSlice(procGroups(list),procPage,PROC_GROUP_PAGE);return meta.pages>1?pagerHtml({...meta,total:meta.total},'lexSetProcPage').replace(' de '+meta.total+'</span>',' de '+meta.total+' clientes</span>'):''}
function processUpdatedAt(p){const raw=p?.atualizado_em||p?.ultima_atualizacao||p?.updated_at||p?.criado_em||'';const ms=Date.parse(raw);return Number.isFinite(ms)?ms:0}
function filteredProcesses(){
  let list=procs();
  if(procTab==='ativos')list=list.filter(active);
  else if(procTab==='prazos')list=list.filter(p=>trustedDeadline(p)&&days(p)<9999);
  else if(procTab==='arquivados')list=list.filter(p=>!active(p));
  else if(procTab==='vencidos')list=list.filter(p=>active(p)&&trustedDeadline(p)&&days(p)<0);
  else if(procTab==='hoje')list=list.filter(p=>active(p)&&trustedDeadline(p)&&days(p)===0);
  else if(procTab==='semana')list=list.filter(p=>active(p)&&trustedDeadline(p)&&days(p)>0&&days(p)<=7);
  else if(procTab==='semcnj')list=list.filter(cnjProblem);
  if(procQuery)list=list.filter(p=>[p.nome,p.numero,p.partes,p.assunto,p.area,p.tribunal,p.status,p.responsavel,p.cliente].join(' ').toLowerCase().includes(procQuery));
  if(procSort==='nome')list=[...list].sort((a,b)=>String(a.nome||a.partes||'').localeCompare(String(b.nome||b.partes||''),'pt-BR'));
  else if(procSort==='numero')list=[...list].sort((a,b)=>String(a.numero||'').localeCompare(String(b.numero||''),'pt-BR'));
  else list=[...list].sort((a,b)=>processUpdatedAt(b)-processUpdatedAt(a)||String(a.nome||a.partes||'').localeCompare(String(b.nome||b.partes||''),'pt-BR'));
  // Filtros de prazo: o mais atrasado primeiro.
  if(['prazos','vencidos','hoje','semana'].includes(procTab))list.sort((a,b)=>days(a)-days(b));
  return list
}
function renderProcessList(){
  const h=$('#lex-proc-list');if(!h)return;
  const list=filteredProcesses();
  h.innerHTML=procListHtml(list)+procGroupPager(list);
  const summary=$('#lex-proc-summary');if(summary)summary.innerHTML=procSummary(list,['vencidos','hoje','semana','semcnj'].includes(procTab));
}
function setDeadlineServerState(work){deadlineServerState=Array.isArray(work?.prazos?.todos)?work.prazos.todos.filter(x=>x?.deadline_legal_truth===true&&x?.case_id!=null):[]}
function deadlineTruthMap(){return new Map(deadlineServerState.map(x=>[String(x.case_id),x]))}
// Mantida pelo contrato de prazos (test/commercial-ui-corrections); usada por trustedDeadline().
function deadlineConfirmed(p){return deadlineTruthMap().has(String(p?.id))}
function deadlineItems(){const trusted=deadlineTruthMap();return procs().map(p=>{const t=trusted.get(String(p.id));if(t){const d=Number(t.days_to_due);return{p,d:Number.isFinite(d)?d:9999,confirmed:true,due:t.prazo||null}}return{p,d:days(p),confirmed:false,due:null}}).filter(x=>x.d<9999).sort((a,b)=>a.d-b.d)}
function deadlineBuckets(all=deadlineItems()){return{revisar:all.filter(x=>!x.confirmed),vencidos:all.filter(x=>x.confirmed&&x.d<0),hoje:all.filter(x=>x.confirmed&&x.d===0),dias7:all.filter(x=>x.confirmed&&x.d>0&&x.d<=7),todos:all}}
function deadlineVisible(all=deadlineItems()){const b=deadlineBuckets(all);return prazoTab==='revisar'?b.revisar:prazoTab==='vencidos'?b.vencidos:prazoTab==='hoje'?b.hoje:prazoTab==='7dias'?b.dias7:b.todos}
function deadlineEmptyMessage(){return prazoTab==='revisar'?'Nenhum prazo legado aguardando conferência.':prazoTab==='vencidos'?'Nenhum prazo confirmado está vencido.':prazoTab==='hoje'?'Nenhum prazo confirmado vence hoje.':prazoTab==='7dias'?'Nenhum prazo confirmado vence nos próximos 7 dias.':'Nenhum prazo cadastrado.'}
function deadlineRows(list,emptyMessage=deadlineEmptyMessage()){return list.map(x=>{const legacy=!x.confirmed,label=legacy?'REVISAR':x.d<0?'vencido '+Math.abs(x.d)+'d':x.d===0?'hoje':x.d+'d',meta=legacy?'Anotado no LEX, ainda não conferido no tribunal · '+(x.p.prazoReal||x.p.prazo||'data não informada'):[x.p.numero,x.due?'vence '+x.due:null].filter(Boolean).join(' · ')||(x.p.tribunal||'');return'<button onclick="lexOpenProc(\''+esc(String(x.p.id))+'\')"><i class="'+(legacy?'amber':x.d<=0?'red':x.d<=2?'amber':'blue')+'"></i><span><strong>'+esc(x.p.nome||x.p.numero||'Processo')+'</strong><small>'+esc(meta)+'</small></span><em>'+esc(label)+'</em></button>'}).join('')||'<div class="lex-empty">'+esc(emptyMessage)+'</div>'}
function deadlineOrganizeCommand(){
  const critical=deadlineItems().filter(x=>!x.confirmed||x.d<=7).slice(0,30);
  if(!critical.length)return'Confira a controladoria de prazos e diga se existe alguma pendência que exige ação. Não invente prazo nem vencimento.';
  const rows=critical.map(x=>{const id=(x.p.numero||'sem número')+' · '+(x.p.nome||x.p.partes||'Processo');if(!x.confirmed)return'- '+id+' · PRAZO A CONFERIR NO TRIBUNAL · data cadastrada '+(x.p.prazoReal||x.p.prazo||'não informada');return'- '+id+' · '+(x.d<0?'VENCIDO HÁ '+Math.abs(x.d)+' DIAS':x.d===0?'VENCE HOJE':'VENCE EM '+x.d+' DIAS')}).join('\n');
  return'Organize estas pendências da controladoria por urgência e diga qual ação exige minha atenção agora. Prazo legado é apenas dado para conferência: não o trate como verdade jurídica nem como vencido confirmado. Não altere datas.\n\n'+rows;
}
window.lexOrganizeDeadlines=function(){
  const command=deadlineOrganizeCommand();
  try{window.lexSelectChatProcess?.('')}catch{}
  if(typeof window.lexChat!=='function')return;
  window.lexChat('');
  setTimeout(()=>{
    const input=document.getElementById('lex-chat-input');
    if(!input){if(typeof window.toast==='function')window.toast('Não consegui abrir o LEX com os prazos.','erro');return}
    input.value=command;
    const form=input.closest('form');
    if(form&&typeof form.requestSubmit==='function')form.requestSubmit();
    else if(typeof window.lexSendChat==='function')window.lexSendChat({preventDefault(){}});
  },100);
}
// Número CNJ: dígito verificador (Res. CNJ 65/2008, mod 97). Mesmo cálculo do servidor (lib/carteira-audit.js).
function cnjOk(d){d=String(d||'').replace(/\D/g,'');if(d.length!==20||typeof BigInt!=='function')return d.length===20;const r=Number(BigInt(d.slice(0,7)+d.slice(9)+'00')%97n);return String(98-r).padStart(2,'0')===d.slice(7,9)}
function judicial(p){return !/administr|extrajud|consult/i.test(String(p?.tipo||'')+' '+String(p?.setor||''))}
function cnjProblem(p){if(!active(p)||!judicial(p))return false;const n=procShortNum(p);return !n||!cnjOk(n)}
window.lexAskLex=function(text){try{window.lexSelectChatProcess?.('')}catch{}if(typeof window.lexChat!=='function')return;window.lexChat('');setTimeout(()=>{const input=document.getElementById('lex-chat-input');if(!input)return;input.value=String(text||'');const form=input.closest('form');if(form&&typeof form.requestSubmit==='function')form.requestSubmit();else if(typeof window.lexSendChat==='function')window.lexSendChat({preventDefault(){}})},100)};
// Ligar ao tribunal: o advogado digita a OAB e o LEX já busca o Diário (DJEN).
window.lexOab=async function(){
  navMark('mais');let atuais=[],pje={configurado:false,tribunais:[],faltando:[]},erro='';
  try{const d=await lexApi('/api/escritorio/oab');atuais=Array.isArray(d.oabs)?d.oabs:[];pje=d.pje||pje}catch(e){erro=e?.message||'servidor indisponível'}
  const lista=atuais.map(o=>o.oab+'/'+o.uf).join(', ');
  const st=(ok,t)=>'<span class="lex-conn '+(ok?'on':'off')+'">'+(ok?'●':'○')+' '+esc(t)+'</span>';
  const body='<div class="lex-page-head"><div><small>Conexões</small><h1>Diário e PJe</h1></div></div>'
    +(erro?'<div class="lex-warning">Não consegui ler as conexões: '+esc(erro)+'</div>':'')
    +'<section class="lex-oab"><h2>Diário de Justiça (DJEN)</h2>'+st(!!lista,lista?'OAB ligada ao DJEN: '+lista:'Nenhuma OAB ligada')
    +'<p>Publicações do Diário pela OAB. O LEX lê todos os dias e relaciona com os seus processos. Não dá acesso ao PJe.</p>'
    +'<label for="lex-oab-in">OAB</label><input id="lex-oab-in" inputmode="text" autocomplete="off" placeholder="123456/MG — mais de uma: separe por vírgula" value="'+esc(lista)+'">'
    +'<button class="lex-oab-go" onclick="lexOabSave()">'+(lista?'Atualizar OAB e buscar publicações':'Ligar OAB e buscar publicações')+'</button>'
    +'<div id="lex-oab-out" class="lex-oab-out" role="status"></div></section>'
    +'<section class="lex-oab"><h2>PJe e eproc (acesso autenticado)</h2>'+st(pje.configurado,pje.configurado?'Tribunais ligados: '+(pje.tribunais||[]).join(', '):'PJe/eproc não configurado')
    +'<p>Expedientes, intimações e citações pendentes, partes e andamentos. Precisa do CPF e da senha (ou certificado) do advogado no servidor. A consulta não dá ciência.</p>'
    +(pje.configurado?'':'<p class="lex-conn-miss">Falta no servidor: '+esc((pje.faltando||[]).join(', '))+'</p>')
    +((pje.eproc||[]).length?'<p class="lex-conn-miss">'+esc(pje.eproc.join(', '))+': sistema eproc, ainda não ligado. Falta PJE_MNI_EPROC no servidor (webservice do eproc). Publicações chegam pelo Diário.</p>':'')
    +'<button class="lex-oab-sec" onclick="lexAskLex(\'teste o PJe\')">Testar conexão com o PJe</button></section>';
  shell('Diário e PJe',body,'mais');
};
window.lexOabSave=async function(){
  const input=$('#lex-oab-in'),out=$('#lex-oab-out'),btn=$('.lex-oab-go');const v=String(input?.value||'').trim();
  if(!v){if(out)out.textContent='Digite a OAB, por exemplo 123456/MG.';return}
  if(btn){btn.disabled=true;btn.textContent='Ligando e lendo o Diário…'}
  try{const d=await lexApi('/api/escritorio/oab',{method:'POST',body:JSON.stringify({oab:v}),timeoutMs:120000});if(out){out.textContent=d.mensagem||'OAB ligada.';out.className='lex-oab-out ok'}}
  catch(e){if(out){out.textContent='Não liguei: '+(e?.message||'erro');out.className='lex-oab-out erro'}}
  finally{if(btn){btn.disabled=false;btn.textContent='Atualizar OAB e buscar publicações'}}
};
// Equipe: cada pessoa com login próprio. Desativar corta o acesso na hora.
window.lexEquipe=async function(msg){
  navMark('mais');let contas=[],erro='',pode=false,desligado=false;
  try{const d=await lexApi('/api/equipe');contas=Array.isArray(d.contas)?d.contas:[];pode=d.pode_gerenciar===true;desligado=d.login_compartilhado_desligado===true}catch(e){erro=e?.message||'sem acesso'}
  const papel=p=>p==='admin'?'Administrador / advogado':'Secretária';
  const linhas=contas.length?contas.map(c=>'<div class="lex-eq-row'+(c.ativo?'':' off')+'"><div><strong>'+esc(c.nome)+'</strong><small>'+esc(c.email)+' · '+papel(c.papel)+(c.senior?' · sênior':'')+(c.oab?' · OAB '+esc(c.oab):'')+(c.ativo?'':' · desativada')+'</small></div>'+(pode&&c.ativo?'<button onclick="lexEquipeDesativar(\''+esc(c.id)+'\',\''+esc(c.nome).replace(/'/g,'')+'\')">Desativar</button>':'')+'</div>').join(''):'<p class="lex-eq-vazio">Nenhuma conta individual ainda.</p>';
  const body='<div class="lex-page-head"><div><small>Acesso</small><h1>Equipe</h1></div></div>'
    +(erro?'<div class="lex-warning">'+esc(erro)+'</div>':'')
    +(msg?'<div class="lex-eq-msg" role="status">'+esc(msg)+'</div>':'')
    +(erro?'':'<section class="lex-oab"><h2>Contas</h2>'+linhas+(pode?'':'<p>Só o advogado sênior cria ou desativa contas.</p>')+'</section>')
    +(pode?'<section class="lex-oab"><h2>Login compartilhado</h2>'
      +'<p>'+(desligado?'Desligado: só entra quem tem conta individual.':'Ligado: quem souber a senha única do perfil ainda entra. Depois que todos tiverem conta, desligue — assim quem sair do escritório perde o acesso de vez.')+'</p>'
      +'<button class="'+(desligado?'lex-oab-sec':'lex-oab-go')+'" onclick="lexEquipeLoginCompartilhado('+(!desligado)+')">'+(desligado?'Religar login compartilhado':'Desligar login compartilhado')+'</button></section>'
      +'<section class="lex-oab"><h2>Nova conta</h2>'
      +'<label for="eq-nome">Nome</label><input id="eq-nome" autocomplete="off">'
      +'<label for="eq-email">E-mail</label><input id="eq-email" type="email" autocomplete="off">'
      +'<label for="eq-papel">Papel</label><select id="eq-papel"><option value="admin">Administrador / advogado</option><option value="secretaria">Secretária</option></select>'
      +'<label class="lex-eq-check"><input id="eq-senior" type="checkbox"> Advogado sênior (pode criar e desativar contas)</label>'
      +'<label for="eq-oab">OAB (opcional)</label><input id="eq-oab" placeholder="123456/MG" autocomplete="off">'
      +'<label for="eq-senha">Senha inicial (8+ caracteres, letras e números)</label><input id="eq-senha" type="password" autocomplete="new-password">'
      +'<button class="lex-oab-go" onclick="lexEquipeCriar()">Criar conta</button>'
      +'<p>A pessoa entra com este e-mail e senha. Quando sair do escritório, toque em Desativar: o acesso dela cai na hora.</p></section>':'')
    +'<section class="lex-oab"><h2>Minha senha</h2><p>Para quem entra com conta individual.</p>'
    +'<label for="eq-atual">Senha atual</label><input id="eq-atual" type="password" autocomplete="current-password">'
    +'<label for="eq-nova">Nova senha</label><input id="eq-nova" type="password" autocomplete="new-password">'
    +'<button class="lex-oab-sec" onclick="lexEquipeMinhaSenha()">Trocar minha senha</button></section>';
  shell('Equipe',body,'mais');
};
window.lexEquipeLoginCompartilhado=async function(desligar){
  if(desligar&&!window.confirm('Desligar o login compartilhado? Só quem tem conta individual vai entrar, e as sessões abertas pelo perfil caem agora.'))return;
  try{await lexApi('/api/equipe/login-compartilhado',{method:'POST',body:JSON.stringify({desligar})});window.lexEquipe(desligar?'Login compartilhado desligado.':'Login compartilhado religado.')}
  catch(e){window.lexEquipe('Não alterei: '+(e?.message||'erro'))}
};
window.lexEquipeMinhaSenha=async function(){
  const v=id=>String(($('#'+id)||{}).value||'');
  try{await lexApi('/api/equipe/minha-senha',{method:'POST',body:JSON.stringify({senhaAtual:v('eq-atual'),senhaNova:v('eq-nova')})});window.lexEquipe('Senha trocada.')}
  catch(e){window.lexEquipe('Não troquei: '+(e?.message||'erro'))}
};
window.lexEquipeCriar=async function(){
  const v=id=>String(($('#'+id)||{}).value||'').trim();
  try{await lexApi('/api/equipe',{method:'POST',body:JSON.stringify({nome:v('eq-nome'),email:v('eq-email'),papel:v('eq-papel'),oab:v('eq-oab')||null,senior:!!($('#eq-senior')||{}).checked,senha:v('eq-senha')})});window.lexEquipe('Conta criada para '+v('eq-email')+'.')}
  catch(e){window.lexEquipe('Não criei: '+(e?.message||'erro'))}
};
window.lexEquipeDesativar=async function(id,nome){
  if(!window.confirm('Desativar a conta de '+nome+'? O acesso cai na hora.'))return;
  try{await lexApi('/api/equipe/desativar',{method:'POST',body:JSON.stringify({id})});window.lexEquipe('Conta de '+nome+' desativada. Se a OAB dela estava ligada ao Diário, troque em Diário e PJe.')}
  catch(e){window.lexEquipe('Não desativei: '+(e?.message||'erro'))}
};
window.lexOpenProc=id=>openProc(id);

async function home(){
  const p=procs(),act=p.filter(active);let tasks=[],reception=0,quadro=null;
  try{const d=await lexApi('/api/trabalho');tasks=Array.isArray(d.tarefas)?d.tarefas:[];quadro=officeCounts(d);setDeadlineServerState(d)}catch{deadlineServerState=[]}
  try{const d=await lexApi('/api/escritorio/recepcao');const r=d.itens||d.contatos||d.recepcao||[];reception=Array.isArray(r)?r.filter(x=>x.status!=='arquivado').length:0}catch{}
  const buckets=deadlineBuckets();
  // O LEX fala primeiro: no máximo 3 assuntos, cada um com UMA ação.
  const cnjBad=act.filter(cnjProblem),review=tasks.filter(t=>t.status==='aguardando_revisao');
  const talk=[];
  if(buckets.vencidos.length)talk.push({tone:'late',t:buckets.vencidos.length+' prazo'+(buckets.vencidos.length>1?'s vencidos':' vencido'),s:esc(buckets.vencidos[0].p.nome||buckets.vencidos[0].p.numero||'Processo')+(buckets.vencidos.length>1?' e mais '+(buckets.vencidos.length-1):''),b:'Resolver agora',a:"lexPrazosVencidos()"});
  if(buckets.hoje.length)talk.push({tone:'urgent',t:buckets.hoje.length+' prazo'+(buckets.hoje.length>1?'s vencem':' vence')+' hoje',s:esc(buckets.hoje[0].p.nome||buckets.hoje[0].p.numero||'Processo'),b:'Ver com o LEX',a:"lexAskLex('prazos de hoje')"});
  if(buckets.revisar.length)talk.push({tone:'soon',t:buckets.revisar.length+' prazo'+(buckets.revisar.length>1?'s':'')+' para conferir',s:'Anotados no LEX, ainda sem confirmação do tribunal.',b:'Conferir',a:"lexSetPrazoTab('revisar')"});
  if(cnjBad.length)talk.push({tone:'soon',t:cnjBad.length+' processo'+(cnjBad.length>1?'s':'')+' com número CNJ errado ou faltando',s:'Eu acho o número certo nas publicações da sua OAB e corrijo com um toque.',b:'Corrigir agora',a:"lexFixCnj()"});
  if(review.length)talk.push({tone:'ok',t:review.length+' minuta'+(review.length>1?'s prontas':' pronta')+' para sua revisão',s:esc(review[0].processo_nome||review[0].tipo||''),b:'Revisar',a:'lexTarefas()'});
  if(reception)talk.push({tone:'ok',t:reception+' conversa'+(reception>1?'s':'')+' de clientes em andamento',s:'Recepção no WhatsApp.',b:'Abrir',a:"lexChannel('all')"});
  const shown=talk.slice(0,3),more=talk.length-shown.length;
  const status=talk.length?'Tenho '+talk.length+' assunto'+(talk.length>1?'s':'')+' para resolver com você.':'Tudo em dia. Estou acompanhando '+act.length+' processo'+(act.length===1?'':'s')+'.';
  const cards=shown.length?shown.map(x=>'<div class="lex-says '+x.tone+'"><div><strong>'+x.t+'</strong><small>'+x.s+'</small></div><button onclick="'+x.a+'">'+x.b+'</button></div>').join('')+(more?'<button class="lex-says-more" onclick="lexEscritorio()">Ver os outros '+more+' ›</button>':'')
    :'<div class="lex-says calm"><div><strong>Nada exige você agora.</strong><small>Aviso aqui e no WhatsApp quando chegar intimação, prazo ou mensagem de cliente.</small></div></div>';
  const body='<section class="lex-home-hero lex-home-v3"><div class="lex-hello">'+bot()+'<div><h1>Olá, '+esc(first())+'!</h1><p>'+status+'</p></div></div>'
    +'<button class="lex-talk" onclick="lexChat()"><span>⌕</span><b>Fale com o LEX...</b><i>🎙</i><i>↑</i></button>'
    +'<div class="lex-quick"><button onclick="goLex(\'peticao\')">📄 Nova peça</button><button onclick="document.getElementById(\'pdf-upload-input\')?.click()">⇧ Enviar documento</button></div></section>'
    +'<section class="lex-says-list"><h2>O LEX informa</h2>'+cards+'</section>';
  // Painel completo (setores, contagens) fica em Escritório: officeGrid(tasks,procs(),quadro)
  void quadro;
  shell('Início',body,'home');
}
function officeCounts(data){return data?.contagens?.setores||null}
function officeGrid(tasks,p,counts){
  const busy=rx=>tasks.some(t=>!['concluida','falhou'].includes(t.status)&&rx.test(String(t.agente||t.tipo||t.instrucao||'')));
  const local={recepcao:0,cadastro:prep().length,iniciais:p.filter(x=>/inicial/i.test(String(x.setor||''))).length,processos:p.filter(active).length,prazos:deadlineBuckets().dias7.length,pecas:tasks.filter(x=>/petic|recurso|contest/i.test(String(x.tipo||x.instrucao||''))).length,pericia:tasks.filter(x=>/peric|quesit/i.test(String(x.tipo||x.instrucao||''))).length,revisao:tasks.filter(x=>x.status==='aguardando_revisao').length,concluidos:p.filter(x=>!active(x)).length};
  const count=k=>counts?Number(counts[k]||0):Number(local[k]||0);
  const rows=[['Recepção','LEX Recepção',count('recepcao'),'cyan',/atend|recep/i],['Cadastro','LEX Cadastro',count('cadastro'),'purple',/cadast|secret/i],['Iniciais','LEX Peticionamento',count('iniciais'),'violet',/inicial|redac/i],['Processos','LEX Jurídico',count('processos'),'green',/jurid|anal/i],['Prazos','LEX Controladoria',count('prazos'),'amber',/prazo|control/i],['Peças / Perícia','LEX Produção',count('pecas')+count('pericia'),'rose',/peric|redac|pesq/i],['Revisão','LEX Revisão',count('revisao'),'blue',/revis/i],['Concluídos','LEX Finalização',count('concluidos'),'slate',/final|entreg/i]];
  return '<div class="lex-office-grid">'+rows.map(r=>'<button class="tone-'+r[3]+'" onclick="lexEscritorio()"><span><strong>'+r[0]+'</strong><b>'+r[2]+'</b></span><small>'+r[1]+' <i class="'+(busy(r[4])?'busy':'')+'"></i></small></button>').join('')+'</div>';
}
function officeBoardHtml(counts){
  if(!counts)return '';
  const items=[['Cadastro',counts.cadastro],['Iniciais',counts.iniciais],['Peças',counts.pecas],['Perícia',counts.pericia],['Revisão',counts.revisao],['Processos',counts.processos],['Prazos',counts.prazos],['Concluídos',counts.concluidos]];
  return '<div class="lex-panel lex-office-board"><h2>Quadro do escritório</h2><div class="lex-office-board-grid">'+items.map(x=>'<span><strong>'+esc(x[0])+'</strong><b>'+Number(x[1]||0)+'</b></span>').join('')+'</div></div>';
}
window.lexHome=function(){navMark('home');return home()};
window.lexProcessos=function(){
  navMark('processos');
  const all=procs(),filtered=filteredProcesses(),urgentTab=['vencidos','hoje','semana','semcnj'].includes(procTab);
  const closed=all.filter(x=>!active(x)).length;
  // Tela enxuta: busca, grupos por cliente e a barra de ordem ao LEX. Urgências e conferências
  // são avisos na Conversa (Início); aqui só se consulta e se fala com o LEX sobre um processo.
  const body='<div class="lex-page-head"><div><small>Carteira jurídica</small><h1>Processos</h1></div><button onclick="goLex(\'autuacao\')" aria-label="Cadastrar processo">＋</button></div>'
    +'<div class="lex-search"><span>⌕</span><input id="lex-q" value="'+esc(procQuery)+'" placeholder="Cliente, número, parte ou assunto" oninput="lexFilterProc(this.value)"></div>'
    +'<div class="lex-list-summary" id="lex-proc-summary">'+procSummary(filtered,urgentTab)+'</div>'
    +'<div id="lex-proc-list">'+procListHtml(filtered)+procGroupPager(filtered)+'</div>'
    +(procTab!=='arquivados'&&closed?'<section class="lex-proc-group lex-proc-closed"><button class="head" aria-expanded="false" onclick="lexSetProcFilter(\'arquivados\')"><span class="ava">▣</span><span class="who"><strong>Encerrados</strong><small>'+closed+' processo'+(closed>1?'s':'')+' · toque para ver</small></span><b>⌄</b></button></section>':'')
    +'<form class="lex-proc-order" onsubmit="event.preventDefault();var q=this.querySelector(\'input\');if(q.value.trim())lexAskLex(q.value.trim())"><input type="text" placeholder="Diga ao LEX o que fazer… ex.: cadastre o processo do PDF" aria-label="Ordem ao LEX"><button type="submit" aria-label="Enviar ordem">↑</button></form>';
  shell('Processos',body,'processos')
};
function procSummary(list,urgentTab){const label={vencidos:'com prazo vencido',hoje:'com prazo hoje',semana:'com prazo nos próximos 7 dias',semcnj:'com número CNJ faltando ou errado — o LEX acha o número certo: toque em Resolver'}[procTab];
  if(label)return list.length+' processo'+(list.length===1?'':'s')+' '+label+' · <button class="link" onclick="lexSetProcFilter(\'todos\')">ver todos</button>';
  if(procView==='clientes'&&!procQuery&&!urgentTab){const g=procGroups(list);const n=g.filter(x=>!x.rest).length;return list.length+' processo'+(list.length===1?'':'s')+(n?' · '+n+' cliente'+(n===1?'':'s')+' · toque para abrir':'')}
  if(procTab==='arquivados')return list.length+' processo'+(list.length===1?' encerrado':'s encerrados')+' · <button class="link" onclick="lexSetProcFilter(\'ativos\')">voltar aos ativos</button>';
  return list.length+' processo'+(list.length===1?'':'s')+(procQuery?' encontrados':' neste filtro')}
window.lexSetProcFilter=tab=>{procTab=['todos','ativos','prazos','arquivados','vencidos','hoje','semana','semcnj'].includes(tab)?tab:'todos';procPage=1;window.lexProcessos()};
window.lexSetProcView=view=>{procView=view==='lista'?'lista':'clientes';procPage=1;window.lexProcessos()};
window.lexToggleProcGroup=key=>{const k=String(key);if(procOpen.has(k))procOpen.delete(k);else procOpen.add(k);renderProcessList()};
window.lexMoreProcGroup=key=>{const k=String(key);procGroupShow[k]=(procGroupShow[k]||PROC_GROUP_ROWS)+PROC_GROUP_ROWS;renderProcessList()};
window.lexSetProcSort=value=>{procSort=['recentes','nome','numero'].includes(value)?value:'recentes';procPage=1;renderProcessList()};
window.lexSetProcPage=page=>{procPage=Math.max(1,Number(page)||1);renderProcessList();window.scrollTo?.({top:0,behavior:'smooth'})};
window.lexFilterProc=q=>{procQuery=String(q||'').toLowerCase();procPage=1;renderProcessList()};
window.lexPrazos=async function(){navMark('prazos');let serverError=null;try{const d=await lexApi('/api/trabalho');setDeadlineServerState(d)}catch(err){deadlineServerState=[];serverError=err?.message||'Falha ao consultar o servidor'}const all=deadlineItems(),b=deadlineBuckets(all),visible=deadlineVisible(all),page=pageSlice(visible,prazoPage,DEADLINE_PAGE_SIZE);prazoPage=page.page;const recommendation=b.revisar.length?'Há '+b.revisar.length+' prazo(s) anotado(s) no LEX ainda não conferido(s) no tribunal. Confira antes de contar com a data.':b.vencidos.length?'Há '+b.vencidos.length+' prazo(s) confirmado(s) vencido(s). Confira primeiro a situação jurídica e a ação pendente.':b.hoje.length?'Há '+b.hoje.length+' prazo(s) confirmado(s) vencendo hoje. Priorize a conferência agora.':b.dias7.length?'Há '+b.dias7.length+' prazo(s) confirmado(s) nos próximos 7 dias. Organize a ordem de trabalho.':'Nenhum prazo confirmado crítico nos próximos 7 dias.';const body='<div class="lex-page-head"><div><small>Controladoria</small><h1>Prazos</h1></div><button onclick="goLex(\'calendario\')" aria-label="Abrir calendário">▣</button></div>'+(serverError?'<div class="lex-warning">Não consegui confirmar os prazos auditáveis no servidor: '+esc(serverError)+'. Dados locais aparecem apenas para conferência.</div>':'')+'<div class="lex-tabs"><button class="'+(prazoTab==='revisar'?'on':'')+'" onclick="lexSetPrazoTab(\'revisar\')">Revisar <b>'+b.revisar.length+'</b></button><button class="'+(prazoTab==='vencidos'?'on':'')+'" onclick="lexSetPrazoTab(\'vencidos\')">Vencidos <b>'+b.vencidos.length+'</b></button><button class="'+(prazoTab==='hoje'?'on':'')+'" onclick="lexSetPrazoTab(\'hoje\')">Hoje <b>'+b.hoje.length+'</b></button><button class="'+(prazoTab==='7dias'?'on':'')+'" onclick="lexSetPrazoTab(\'7dias\')">7 dias <b>'+b.dias7.length+'</b></button><button class="'+(prazoTab==='todos'?'on':'')+'" onclick="lexSetPrazoTab(\'todos\')">Todos <b>'+b.todos.length+'</b></button></div><div class="lex-timeline">'+deadlineRows(page.items)+'</div>'+pagerHtml(page,'lexSetPrazoPage')+'<div class="lex-recommend"><b>💡 LEX recomenda</b><p>'+esc(recommendation)+'</p><button onclick="lexOrganizeDeadlines()">Organizar com o LEX</button></div>';shell('Prazos',body,'prazos')};
window.lexSetPrazoTab=tab=>{prazoTab=['revisar','vencidos','hoje','7dias','todos'].includes(tab)?tab:'todos';prazoPage=1;window.lexPrazos()};
window.lexSetPrazoPage=page=>{prazoPage=Math.max(1,Number(page)||1);window.lexPrazos();window.scrollTo?.({top:0,behavior:'smooth'})};
let taskWatch=null;
function stopTaskWatch(){if(taskWatch){clearInterval(taskWatch);taskWatch=null}}
// Uma tarefa aberta é re-lida a cada 15 s enquanto ainda estiver em execução/fila
// (não há evento SSE de tarefa no servidor); ao sair da tela, o relógio para.
async function loadTasks(selectedId){
  const detail=$('#lex-task-detail');if(!detail||!detail.isConnected){stopTaskWatch();return}
  try{
    const d=await lexApi('/api/trabalho');if(!detail.isConnected){stopTaskWatch();return}
    if(!Array.isArray(d.tarefas))throw new Error('Resposta de tarefas inválida.');
    const tasks=selectedId?d.tarefas.filter(t=>String(t.id)===String(selectedId)):d.tarefas;
    if(selectedId){
      const t=tasks[0];
      detail.innerHTML='<button class="btn-outline" onclick="lexTarefas()">Ver todas as tarefas</button>'+(t?(typeof lexTaskDetailHtml==='function'?lexTaskDetailHtml(t):lexTaskCard(t)):'<div class="lex-empty">Esta tarefa não está mais disponível.</div>');
      if(!t||!['na_fila','executando'].includes(t.status))stopTaskWatch();
    }else{
      stopTaskWatch();
      const order=['aguardando_revisao','aguardando_dados','aguardando_documento_nitido','aguardando_configuracao','falhou','executando','na_fila','concluida'];
      const sorted=tasks.slice().sort((a,b)=>order.indexOf(a.status)-order.indexOf(b.status));
      detail.innerHTML=sorted.length?sorted.map(t=>'<div class="lex-task-row" onclick="lexTarefas(\''+esc(String(t.id))+'\')">'+lexTaskCard(t)+'</div>').join(''):'<div class="lex-empty">Nenhuma tarefa registrada.</div>';
    }
  }catch(err){if(detail.isConnected)detail.textContent='Não consegui carregar as tarefas: '+(err.message||'falha no servidor')}
}
window.lexTarefas=async function(selectedId){navMark('tarefas');stopTaskWatch();
  shell(selectedId?'Tarefa':'Tarefas','<div class="lex-page-head"><div><small>'+(selectedId?'Em andamento':'Entregas do escritório')+'</small><h1>'+(selectedId?'Tarefa #'+esc(String(selectedId).slice(0,8)):'Tarefas')+'</h1></div><button onclick="lexHome()" aria-label="Voltar ao início">⌂</button></div><div id="lex-task-detail" class="lex-panel" role="status">Consultando tarefas…</div>','home');
  await loadTasks(selectedId);
  if(selectedId&&!taskWatch)taskWatch=setInterval(()=>loadTasks(selectedId),15000);
};
// Recibos do dia: tudo que o LEX fez hoje, com hora, alvo, quem autorizou e origem.
const RECEIPT_LABEL={mensagem_enviada:'MENSAGEM ENVIADA',ordem_confirmada:'ORDEM CONFIRMADA',atendimento_recepcao:'CLIENTE ATENDIDO',andamento_registrado:'ANDAMENTO REGISTRADO',prazo_confirmado:'PRAZO CONFIRMADO',prazo_cumprido:'PRAZO CUMPRIDO',tarefa_concluida:'TAREFA CONCLUÍDA',minuta_pronta:'MINUTA PRONTA',rotina_noturna:'ROTINA NOTURNA'};
const RECEIPT_SOURCE={whatsapp:'WhatsApp',telegram:'Telegram',datajud:'Datajud',djen:'DJEN',pje:'PJe',conector:'conector do navegador',task_engine:'Task Engine',lex:'LEX',manual:'cadastro manual'};
function receiptHtml(r){
  const fix="Corrija o recibo de "+(r.hora?r.hora+' ':'')+'('+(RECEIPT_LABEL[r.tipo]||r.tipo)+'): '+r.oque;
  const open=r.tipo==='tarefa_concluida'||r.tipo==='minuta_pronta'?(r.ref?'<button onclick="lexTarefas(\''+esc(String(r.ref))+'\')">Ver tarefa</button>':''):r.tipo==='andamento_registrado'||r.tipo==='prazo_confirmado'||r.tipo==='prazo_cumprido'?(r.ref?'<button onclick="lexOpenProc(\''+esc(String(r.ref))+'\')">Abrir processo</button>':''):r.tipo==='atendimento_recepcao'||r.tipo==='mensagem_enviada'||r.tipo==='ordem_confirmada'?'<button onclick="lexChannel(\'all\')">Ver conversa</button>':'';
  return '<article class="lex-receipt"><div class="lex-receipt-head"><span class="ok">✓ '+esc(RECEIPT_LABEL[r.tipo]||r.tipo)+'</span><span>'+esc(r.hora||'—')+'</span></div><dl>'
    +'<dt>O quê</dt><dd>'+esc(r.oque||'')+'</dd>'
    +(r.para?'<dt>Para quem</dt><dd>'+esc(r.para)+'</dd>':'')
    +(r.autorizado_por?'<dt>Autorizado</dt><dd>por '+esc(r.autorizado_por)+'</dd>':'')
    +(r.origem?'<dt>Origem</dt><dd>'+esc(RECEIPT_SOURCE[r.origem]||r.origem)+'</dd>':'')
    +'</dl><div class="lex-receipt-actions">'+open+'<button class="ghost" onclick="lexChat();setTimeout(()=>lexPrefill('+JSON.stringify(fix).replace(/</g,'\\u003c')+'),120)">Enviar correção</button></div></article>';
}
window.lexRecibos=async function(){navMark('recibos');
  shell('Recibos','<div class="lex-page-head"><div><small>Recibos · hoje</small><h1>O que o LEX fez hoje</h1></div><button onclick="lexHome()" aria-label="Voltar ao início">⌂</button></div><div id="lex-receipts" class="lex-panel" role="status">Lendo os registros de hoje…</div>','mais');
  const box=$('#lex-receipts');if(!box)return;
  try{
    const d=await lexApi('/api/escritorio/recibos');if(!box.isConnected)return;
    const c=d.contagens||{},rows=Array.isArray(d.recibos)?d.recibos:[];
    const counters='<div class="lex-receipt-grid"><div><strong class="g">'+Number(c.concluidas||0)+'</strong><span>concluídas</span></div><div><strong class="b">'+Number(c.em_andamento||0)+'</strong><span>em andamento</span></div><div class="'+(Number(c.aguardam_voce||0)?'hot':'')+'"><strong class="a">'+Number(c.aguardam_voce||0)+'</strong><span>aguarda'+(Number(c.aguardam_voce||0)===1?'':'m')+' você</span></div></div>';
    const fail=Array.isArray(d.falhas)&&d.falhas.length?'<div class="lex-warning">Não consegui ler '+esc(d.falhas.join(', '))+'. A lista abaixo pode estar incompleta; não vou interpretar ausência de registro como ausência de ação.</div>':'';
    box.innerHTML=counters+fail+(rows.length?rows.map(receiptHtml).join(''):'<div class="lex-empty">Nenhuma ação minha registrada hoje'+(fail?'':' — '+esc(String(d.mensagem||''))) +'</div>');
  }catch(err){if(box.isConnected)box.innerHTML='<div class="lex-warning">Não consegui ler os recibos: '+esc(err.message||'falha no servidor')+'</div>'}
};
window.lexEscritorio=async function(){navMark('escritorio');
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
window.lexChat=function(selectedId){navMark('lex');const items=procs();let saved='';try{saved=String(selectedId||sessionStorage.getItem('lex_chat_process_id')||'')}catch{saved=String(selectedId||'')}if(saved&&!items.some(p=>String(p.id)===saved))saved='';window.lexSelectChatProcess(saved);const history=chatHistoryHtml(saved);const body='<div class="lex-chat-head">'+bot()+'<div><h1>Olá, '+esc(first())+'!</h1><p>Como posso ajudar hoje?</p></div></div><div class="lex-search lex-chat-context"><span>⚖</span><select id="lex-chat-process" onchange="lexSwitchChatProcess(this.value)" style="width:100%;min-height:44px;background:transparent;border:0;color:inherit;outline:0"><option value="">Conversa geral — sem processo</option>'+items.slice(0,150).map(p=>'<option value="'+esc(String(p.id))+'" '+(String(p.id)===saved?'selected':'')+'>'+esc((p.numero||'sem número')+' · '+(p.nome||p.partes||'Processo'))+'</option>').join('')+'</select></div><div class="lex-chat-shortcuts"><button onclick="lexPrefill(\'Analise o processo selecionado e a última decisão.\')">⚖ Analisar processo</button><button onclick="lexPrefill(\'Prepare uma minuta de peça para minha revisão.\')">📄 Minuta de peça</button><button onclick="lexPrazos()">◷ Ver prazos</button><button onclick="lexPrefill(\'Analise os riscos e próximos passos deste caso.\')">♟ Analisar risco</button><button onclick="lexPrefill(\'Pesquise jurisprudência atual e relevante para este caso.\')">⌕ Jurisprudência</button><button onclick="lexEscritorio()">▦ Setores</button></div><div class="lex-conversation" id="lex-conversation"><div class="lex-msg bot">Sou o LEX. Posso analisar casos, organizar prazos e acionar os agentes certos. As entregas relevantes continuam sob sua revisão.</div>'+history+'</div><form class="lex-chatbar" onsubmit="lexSendChat(event)"><textarea id="lex-chat-input" rows="1" placeholder="Digite sua mensagem..."></textarea><button id="lex-mic-btn" type="button" title="Falar" onclick="lexStartVoice()">🎙</button><button type="submit">↑</button></form><div class="lex-suggestion"><b>💡 Sugestão do LEX</b><span>Quer que eu organize primeiro os casos com prazo crítico?</span><button onclick="lexPrazos()">Ver prazos</button></div>';shell('LEX',body,'lex');setTimeout(()=>{const c=$('#lex-conversation');if(c)c.scrollTop=c.scrollHeight;$('#lex-chat-input')?.focus()},60)};
window.lexPrefill=t=>{const i=$('#lex-chat-input');if(i){i.value=t;i.focus()}};
window.lexSendChat=async function(e){e?.preventDefault();const input=$('#lex-chat-input'),box=$('#lex-conversation');const text=input?.value.trim();if(!text||!box)return;const selected=String($('#lex-chat-process')?.value||'');const process=procs().find(p=>String(p.id)===selected)||null;if(selected&&!process){box.insertAdjacentHTML('beforeend','<div class="lex-msg bot error">O processo selecionado não está mais disponível. Atualize a carteira e selecione novamente.</div>');return}window.lexSelectChatProcess(selected);const historico=loadChatHistory(selected);box.insertAdjacentHTML('beforeend','<div class="lex-msg me">'+esc(text)+'</div>');input.value='';box.insertAdjacentHTML('beforeend','<div class="lex-msg bot pending" id="lex-pending">LEX está analisando…</div>');box.scrollTop=box.scrollHeight;try{const payload={mensagem:text,historico};if(process){payload.processo_id=process.id;payload.numero_processo=process.numero||null;payload.processo_nome=process.nome||process.partes||null;payload.setor=process.setor||null}const d=await lexApi('/api/vivo/conversar',{method:'POST',body:JSON.stringify(payload)});const ans=d?.resposta||d?.reply||d?.mensagem||d?.texto||d?.resultado||d?.content||'Recebi a ordem. Vou organizar isso dentro do fluxo do escritório.';const answer=typeof ans==='string'?ans:JSON.stringify(ans);$('#lex-pending')?.remove();box.insertAdjacentHTML('beforeend','<div class="lex-msg bot">'+esc(answer)+'</div>');saveChatHistory(selected,[...historico,{role:'user',content:text},{role:'assistant',content:answer}])}catch(err){$('#lex-pending')?.remove();box.insertAdjacentHTML('beforeend','<div class="lex-msg bot error">Não consegui concluir a conversa agora: '+esc(err.message||'falha no servidor')+'.</div>')}box.scrollTop=box.scrollHeight};

const channelDesk={channel:'all',rows:[],selected:null,query:'',historyGeneration:0};
function channelName(channel){return channel==='telegram'?'Telegram':channel==='whatsapp'?'WhatsApp':'Mensagens'}
function channelIcon(channel){return channel==='telegram'?'🔵':'🟢'}
function channelKey(row){return String(row.origem||'whatsapp')+':'+String(row.id||row.numero||'')}
function channelWhen(value){if(!value)return'';const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
async function loadChannelRows(channel){
  const statuses=['urgente','aguardando_advogado','administrativo','arquivado'];
  const batches=await Promise.all(statuses.map(status=>lexApi('/api/escritorio/recepcao?status='+status)));
  const map=new Map();
  for(const batch of batches)for(const row of (batch.contatos||[])){
    if(channel!=='all'&&row.origem!==channel)continue;
    map.set(channelKey(row),row);
  }
  return [...map.values()].sort((a,b)=>String(b.atualizado_em||'').localeCompare(String(a.atualizado_em||'')));
}
function channelListHtml(){
  const q=channelDesk.query.toLowerCase();
  const rows=channelDesk.rows.filter(row=>!q||[row.nome,row.id,row.numero,row.ultima_mensagem,row.classe].join(' ').toLowerCase().includes(q));
  return rows.map(row=>{
    const key=channelKey(row),active=channelDesk.selected===key?' active':'',archived=row.status==='arquivado';
    return '<button class="lex-channel-contact'+active+'" onclick="lexSelectChannelContact(\''+esc(String(row.origem||'whatsapp'))+'\',\''+esc(String(row.id||row.numero||''))+'\')"><span class="lex-channel-avatar">'+channelIcon(row.origem)+'</span><span class="lex-channel-contact-copy"><strong>'+esc(row.nome||'Contato')+'</strong><small>'+esc(row.ultima_mensagem||'Sem mensagem')+'</small><em>'+esc(channelWhen(row.atualizado_em))+'</em></span><span class="lex-channel-contact-meta">'+(row.urgente?'<b>!</b>':'')+(archived?'<i>arquivado</i>':'')+'</span></button>';
  }).join('')||'<div class="lex-empty">Nenhuma conversa neste canal.</div>';
}
function renderChannelList(){
  const list=$('#lex-channel-list');if(list)list.innerHTML=channelListHtml();
  const count=$('#lex-channel-count');if(count)count.textContent=String(channelDesk.rows.filter(x=>x.status!=='arquivado').length);
}
window.lexChannelSearch=function(value){channelDesk.query=String(value||'');renderChannelList()};
window.lexChannel=async function(channel='all'){navMark('mais');
  channelDesk.channel=['whatsapp','telegram','all'].includes(channel)?channel:'all';channelDesk.selected=null;channelDesk.query='';channelDesk.historyGeneration++;
  const title=channelName(channelDesk.channel);
  const body='<div class="lex-page-head lex-channel-page-head"><div><small>Comunicação do escritório</small><h1>'+esc(title)+'</h1></div><button onclick="lexMais()">‹</button></div>'
    +'<section class="lex-channel-console" id="lex-channel-console"><aside class="lex-channel-sidebar"><div class="lex-channel-sidebar-head"><div><strong>'+esc(title)+'</strong><span><b id="lex-channel-count">0</b> aguardando</span></div><button onclick="lexChannel(\''+esc(channelDesk.channel)+'\')" title="Atualizar">↻</button></div><label class="lex-channel-search">⌕<input placeholder="Buscar conversa..." oninput="lexChannelSearch(this.value)"></label><div id="lex-channel-list" class="lex-channel-list"><div class="lex-empty">Carregando conversas…</div></div></aside>'
    +'<section class="lex-channel-chat" id="lex-channel-chat"><div class="lex-channel-placeholder">'+bot('sm')+'<h2>Central de atendimento</h2><p>Escolha uma conversa. A resposta sai pelo mesmo canal em que a mensagem chegou.</p></div></section></section>';
  shell(title,body,'mais');
  try{channelDesk.rows=await loadChannelRows(channelDesk.channel);renderChannelList()}catch(err){const list=$('#lex-channel-list');if(list)list.innerHTML='<div class="lex-empty">Não consegui carregar as conversas: '+esc(err.message||'falha no servidor')+'</div>'}
};
window.lexSelectChannelContact=async function(origem,id){
  const key=String(origem)+':'+String(id);channelDesk.selected=key;const generation=++channelDesk.historyGeneration;renderChannelList();
  if(channelDesk.commandTimer){clearTimeout(channelDesk.commandTimer);channelDesk.commandTimer=null}
  const consoleEl=$('#lex-channel-console'),chat=$('#lex-channel-chat');if(consoleEl)consoleEl.classList.add('has-open-chat');if(!chat)return;
  const row=channelDesk.rows.find(x=>channelKey(x)===key)||{origem,id,nome:'Contato'};
  chat.innerHTML='<div class="lex-channel-chat-loading">Carregando histórico…</div>';
  try{
    const [d,pending]=await Promise.all([
      lexApi('/api/escritorio/recepcao/historico?origem='+encodeURIComponent(origem)+'&id='+encodeURIComponent(id)),
      lexApi('/api/escritorio/recepcao/comandos?origem='+encodeURIComponent(origem)+'&id='+encodeURIComponent(id))
    ]);
    if(generation!==channelDesk.historyGeneration||channelDesk.selected!==key||!chat.isConnected)return;
    const history=Array.isArray(d.historico)?d.historico:[];
    const msgs=history.map(m=>{
      const outgoing=m.direcao!=='entrada',who=m.direcao==='saida_operador'?'Você':m.direcao==='saida_lex'?'LEX':'Contato';
      return '<div class="lex-channel-bubble '+(outgoing?'out':'in')+'"><small>'+esc(who)+'</small><p>'+esc(m.texto||'')+'</p><time>'+esc(channelWhen(m.criado_em))+'</time></div>';
    }).join('')||'<div class="lex-empty">Sem histórico registrado.</div>';
    chat.innerHTML='<header class="lex-channel-chat-head"><button class="lex-channel-back" onclick="lexCloseChannelContact()">‹</button><span class="lex-channel-avatar">'+channelIcon(origem)+'</span><div><strong>'+esc(row.nome||'Contato')+'</strong><small>'+esc(channelName(origem))+' · '+esc(String(id))+'</small></div><button class="lex-channel-archive" onclick="lexArchiveChannelContact(\''+esc(origem)+'\',\''+esc(String(id))+'\')" '+(row.status==='arquivado'?'disabled':'')+'>'+(row.status==='arquivado'?'Arquivado':'Arquivar')+'</button></header><div class="lex-channel-messages" id="lex-channel-messages">'+msgs+'</div><div class="lex-channel-command-status" id="lex-channel-command-status"></div><form class="lex-channel-compose" onsubmit="lexSendChannelCommand(event)"><textarea id="lex-channel-compose-text" rows="1" maxlength="3500" placeholder="Dê uma ordem ao LEX…"></textarea><button type="submit">Executar</button></form>';
    const messages=$('#lex-channel-messages');if(messages)messages.scrollTop=messages.scrollHeight;$('#lex-channel-compose-text')?.focus();
    const jobs=Array.isArray(pending?.jobs)?pending.jobs:[],latest=jobs.length?jobs[jobs.length-1]:null;
    if(latest){lexRenderChannelCommand(latest);if(!['aguardando_confirmacao','falhou','cancelado','enviado'].includes(latest.status))lexWatchChannelCommand(latest.id,key)}
  }catch(err){if(generation!==channelDesk.historyGeneration||channelDesk.selected!==key||!chat.isConnected)return;chat.innerHTML='<div class="lex-channel-placeholder"><h2>Não consegui abrir a conversa</h2><p>'+esc(err.message||'falha no servidor')+'</p><button onclick="lexCloseChannelContact()">Voltar</button></div>'}
};
window.lexCloseChannelContact=function(){
  channelDesk.historyGeneration++;channelDesk.selected=null;
  if(channelDesk.commandTimer){clearTimeout(channelDesk.commandTimer);channelDesk.commandTimer=null}
  $('#lex-channel-console')?.classList.remove('has-open-chat');renderChannelList();
  const chat=$('#lex-channel-chat');if(chat)chat.innerHTML='<div class="lex-channel-placeholder">'+bot('sm')+'<h2>Central de atendimento</h2><p>Escolha uma conversa para responder pelo canal de origem.</p></div>'
};
window.lexRenderChannelCommand=function(job){
  const box=$('#lex-channel-command-status');if(!box||!job)return;
  const status=String(job.status||'');
  if(status==='pendente'||status==='interpretando'){
    box.innerHTML='<div class="lex-command-card working"><strong>LEX está analisando sua ordem…</strong><small>'+esc(job.comando||'')+'</small></div>';return;
  }
  if(status==='aguardando_confirmacao'){
    box.innerHTML='<div class="lex-command-card preview"><strong>Mensagem preparada pelo LEX</strong><small>Confira antes do envio para '+esc(job.contato_nome||'o contato')+'.</small><textarea id="lex-command-preview-text" maxlength="3500">'+esc(job.texto_final||'')+'</textarea><div class="lex-command-actions"><button type="button" class="btn-primary" onclick="lexConfirmChannelCommand(\''+esc(job.id)+'\')">Confirmar envio</button><button type="button" class="btn-outline" onclick="lexCancelChannelCommand(\''+esc(job.id)+'\')">Cancelar</button></div></div>';return;
  }
  if(status==='confirmado'||status==='enviando'){
    box.innerHTML='<div class="lex-command-card working"><strong>Enviando pelo '+esc(channelName(job.origem))+'…</strong><small>O resultado será confirmado pelo provedor.</small></div>';return;
  }
  if(status==='enviado'){
    box.innerHTML='<div class="lex-command-card success"><strong>Enviado ✓</strong><small>Mensagem confirmada pelo '+esc(channelName(job.origem))+'.</small></div>';return;
  }
  if(status==='falhou'){
    box.innerHTML='<div class="lex-command-card error"><strong>Envio não concluído</strong><small>'+esc(job.last_error||'Falha sem detalhe confirmado.')+'</small></div>';return;
  }
  if(status==='cancelado'){
    box.innerHTML='<div class="lex-command-card"><strong>Envio cancelado.</strong></div>';return;
  }
  box.innerHTML='';
};
window.lexWatchChannelCommand=async function(jobId,selected){
  if(!jobId||channelDesk.selected!==selected)return;
  try{
    const d=await lexApi('/api/escritorio/recepcao/comando/'+encodeURIComponent(jobId),{timeoutMs:60000});
    if(channelDesk.selected!==selected)return;
    const job=d.job;lexRenderChannelCommand(job);
    if(['pendente','interpretando','confirmado','enviando'].includes(job?.status)){
      channelDesk.commandTimer=setTimeout(()=>lexWatchChannelCommand(jobId,selected),1800);
    }else if(job?.status==='enviado'){
      const [origem,id]=selected.split(':');
      channelDesk.commandTimer=setTimeout(()=>{if(channelDesk.selected===selected)lexSelectChannelContact(origem,id)},700);
    }
  }catch(err){
    const box=$('#lex-channel-command-status');if(box&&channelDesk.selected===selected)box.innerHTML='<div class="lex-command-card error"><strong>Não consegui consultar o envio</strong><small>'+esc(err.message||'falha de rede')+'</small></div>'
  }
};
window.lexSendChannelCommand=async function(e){
  e?.preventDefault();const input=$('#lex-channel-compose-text');const comando=String(input?.value||'').trim();if(!comando||!channelDesk.selected)return;
  const selected=channelDesk.selected,[origem,id]=selected.split(':'),button=e?.submitter||e?.target?.querySelector('button[type=submit]');if(button)button.disabled=true;
  const box=$('#lex-channel-command-status');if(box)box.innerHTML='<div class="lex-command-card working"><strong>Registrando sua ordem no LEX…</strong></div>';
  try{
    const d=await lexApi('/api/escritorio/recepcao/comando',{method:'POST',body:JSON.stringify({origem,id,comando}),timeoutMs:90000});
    if(input)input.value='';lexRenderChannelCommand(d.job);lexWatchChannelCommand(d.job.id,selected);
  }catch(err){
    if(box)box.innerHTML='<div class="lex-command-card error"><strong>O LEX não recebeu a ordem</strong><small>'+esc(err.message||'falha no servidor')+'</small></div>';
    if(typeof window.toast==='function')window.toast(err.message||'Ordem não registrada','erro')
  }finally{if(button)button.disabled=false}
};
window.lexConfirmChannelCommand=async function(jobId){
  const selected=channelDesk.selected,input=$('#lex-command-preview-text'),texto=String(input?.value||'').trim();if(!selected||!texto)return;
  try{
    const d=await lexApi('/api/escritorio/recepcao/comando/'+encodeURIComponent(jobId)+'/confirmar',{method:'POST',body:JSON.stringify({texto}),timeoutMs:60000});
    lexRenderChannelCommand(d.job);lexWatchChannelCommand(jobId,selected);
  }catch(err){if(typeof window.toast==='function')window.toast(err.message||'Confirmação não registrada','erro')}
};
window.lexCancelChannelCommand=async function(jobId){
  try{
    const d=await lexApi('/api/escritorio/recepcao/comando/'+encodeURIComponent(jobId)+'/cancelar',{method:'POST',body:'{}',timeoutMs:60000});
    lexRenderChannelCommand(d.job);
  }catch(err){if(typeof window.toast==='function')window.toast(err.message||'Não foi possível cancelar','erro')}
};
window.lexArchiveChannelContact=async function(origem,id){
  if(!confirm('Arquivar esta conversa?'))return;
  try{await lexApi('/api/escritorio/recepcao/arquivar',{method:'POST',body:JSON.stringify({origem,id})});channelDesk.rows=await loadChannelRows(channelDesk.channel);window.lexCloseChannelContact()}
  catch(err){if(typeof window.toast==='function')window.toast(err.message||'Não foi possível arquivar','erro')}
};

window.lexMais=function(){navMark('mais');const body='<div class="lex-page-head"><div><small>Funções complementares</small><h1>Mais</h1></div><button onclick="lexToggleTheme()">◐</button></div><div class="lex-menu"><button onclick="lexEquipe()">👥<span>Equipe (contas de acesso)</span><b>›</b></button><button onclick="lexOab()">⚖<span>Diário e PJe (conexões)</span><b>›</b></button><button onclick="goLex(\'agenda\')">👥<span>Clientes / Contatos</span><b>›</b></button><button onclick="goLex(\'calendario\')">📅<span>Agenda</span><b>›</b></button><button onclick="goLex(\'autuacao\')">📄<span>Documentos / Autuação</span><b>›</b></button><button disabled title="Módulo financeiro ainda não possui rota comercial própria">＄<span>Financeiro · em breve</span><b>·</b></button><button onclick="goLex(\'estatisticas\')">▥<span>Relatórios / Estatísticas</span><b>›</b></button><button onclick="lexEscritorio()">▦<span>Escritório / Setores</span><b>›</b></button><button onclick="goLex(\'escritorio\')">⚙<span>Configurações do escritório</span><b>›</b></button></div><h2 class="lex-channel-title">Canais de comunicação</h2><div class="lex-channels"><button onclick="lexChannel(\'whatsapp\')">🟢<span>WhatsApp</span></button><button onclick="lexChannel(\'telegram\')">🔵<span>Telegram</span></button><button onclick="lexChannel(\'all\')">✉️<span>Mensagens</span></button><button onclick="goLex(\'pje\')">Pe<span>PJe</span></button></div>';shell('Mais',body,'mais')};
window.goLex=p=>go(p);
window.renderPainel=home;window.renderTrabalho=window.lexTarefas;window.renderProcessos=window.lexProcessos;window.renderPrazos=window.lexPrazos;window.lexFocusV2=window.lexChat;
function hook(){themeInit();disableLegacySweep();syncLegacyThemeButton();if(typeof window.ir==='function'&&!window.ir.__commercial){const old=window.ir;window.ir=function(page){if(page==='painel'){home();return}if(page==='trabalho'){window.lexTarefas();return}if(page==='processos'){window.lexProcessos();return}if(page==='prazos'){window.lexPrazos();return}return old.apply(this,arguments)};window.ir.__commercial=true}setTimeout(()=>{disableLegacySweep();syncLegacyThemeButton();const c=$('#content');if(c&&c.offsetParent!==null&&!$('.lex-screen',c))window.lexHome()},120)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook,{once:true});else hook();
})();