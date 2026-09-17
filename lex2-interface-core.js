(function(){
'use strict';
// Central de Decisões: preserva a inteligência de exceções sem substituir a Home comercial.
const $=(s,r=document)=>r.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const procs=()=>{try{return typeof getProcs==='function'?(getProcs()||[]):[]}catch{return[]}};
const days=p=>{const raw=p?.prazoReal||p?.prazo||p?.dataPrazo||p?.next_action_due_at;if(!raw)return 9999;let d;if(/^\d{2}\/\d{2}\/\d{4}$/.test(raw)){const[a,b,c]=raw.split('/');d=new Date(+c,+b-1,+a)}else d=new Date(raw);if(Number.isNaN(d.getTime()))return 9999;const n=new Date();return Math.ceil((d-n)/86400000)};
const dock=()=>'<nav class="lex-dock"><button onclick="lexHome()"><b>⌂</b><span>Início</span></button><button onclick="lexProcessos()"><b>▣</b><span>Processos</span></button><button class="lex-main" onclick="lexChat()"><b>◉</b><span>LEX</span></button><button onclick="lexPrazos()"><b>◷</b><span>Prazos</span></button><button onclick="lexMais()"><b>☰</b><span>Mais</span></button></nav>';
const card=(tone,title,meta,detail,action,label)=>'<article class="lex-today-item '+tone+'"><div><small>'+esc(meta)+'</small><h2>'+esc(title)+'</h2><p>'+esc(detail)+'</p></div><button onclick="'+action+'">'+esc(label)+'</button></article>';
async function api(path){const r=await fetch(path);if(!r.ok)throw new Error(path);return r.json()}
async function decisions(){
 const ps=procs(),items=[];
 for(const p of ps){const d=days(p);if(d<=0)items.push({rank:0,html:card('critical',p.nome||p.numero||'Prazo requer conferência',(p.case_type||'judicial')+' · '+(p.numero||'sem número'),d<0?'Existe um prazo cadastrado cuja data já passou. A situação judicial atual não está confirmada por esta tela; confira a fonte antes de agir.':'Existe um prazo cadastrado para hoje. Confira a situação judicial antes de agir.','lexOpenProc(\''+esc(String(p.id))+'\')','Conferir processo')})}
 let tasks=[];try{const d=await api('/api/trabalho');tasks=d.tarefas||[]}catch{}
 for(const t of tasks.filter(x=>['bloqueada','aguardando_documento','aguardando_revisao'].includes(String(x.status))).slice(0,12)){items.push({rank:1,html:card('blocked',t.titulo||t.tipo||'Tarefa precisa de decisão','Tarefa · '+(t.status||''),t.motivo||t.pendencia||'Há uma pendência que impede a continuação.','lexChat()','Abrir no LEX')})}
 try{const d=await api('/api/escritorio/recepcao');for(const r of (d.itens||d.contatos||d.recepcao||[]).filter(x=>x.status!=='arquivado').slice(0,12)){items.push({rank:2,html:card('waiting',r.nome||r.cliente||'Cliente aguardando',r.canal||'Recepção',r.assunto||r.ultima_mensagem||'Aguardando atendimento.','typeof lexConversas===\'function\'?lexConversas():lexChat()','Ver conversa')})}}catch{}
 for(const p of ps){for(const d of [...(p.entrada_processual||[]),...(p.arquivos||[]),...(p.recebimentos||[])]){if(/quar|confer|reject/i.test(String(d.status||d.motivo||'')))items.push({rank:1,html:card('quarantine',d.nome||d.arquivo||'Documento requer conferência','Documento · '+(p.nome||p.numero||''),d.motivo||'Precisa de conferência antes de entrar no fluxo produtivo.','lexOpenProc(\''+esc(String(p.id))+'\')','Conferir documento')})}}
 items.sort((a,b)=>a.rank-b.rank);
 const body='<main class="lex-screen lex-today"><header class="lex-top"><div><strong>LEX</strong><small>CENTRAL DE DECISÕES</small></div><div class="lex-top-actions"><button onclick="lexToggleTheme()" aria-label="Tema">◐</button><button onclick="typeof toggleSidebar===\'function\'&&toggleSidebar()">☰</button></div></header><section class="lex-today-head"><small>PENDÊNCIAS DO LEX</small><h1>'+(items.length?items.length+' '+(items.length===1?'item precisa':'itens precisam')+' de decisão.':'Nenhuma decisão pendente.')+'</h1><p>'+(items.length?'Aqui ficam somente exceções que exigem conferência, autorização ou decisão humana.':'O LEX não encontrou exceções críticas agora.')+'</p></section><section class="lex-today-list">'+(items.length?items.slice(0,50).map(x=>x.html).join(''):'<div class="lex-today-clear"><strong>Tudo sob controle.</strong><span>O LEX continua coordenando o escritório.</span></div>')+'</section>'+dock()+'</main>';
 const host=$('#content');if(host){document.body.classList.add('lex-commercial');document.body.classList.remove('lex2-core');host.innerHTML=body}
}
window.lexDecisions=decisions;
// Compatibilidade: mesmo que uma flag experimental antiga permaneça no navegador,
// este módulo nunca substitui window.lexHome automaticamente.
})();