(function(){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const procs=()=>{try{return typeof getProcs==='function'?(getProcs()||[]):[]}catch{return[]}};
function consumeContext(selectedId){
  const requested=String((selectedId===undefined?window.__lexDossierContext?.case_id:selectedId)||'');
  window.__lexDossierContext=null;
  return requested&&procs().some(p=>String(p.id)===requested)?requested:'';
}
function dock(){return '<nav class="lex-dock"><button onclick="lexHome()"><b>⌂</b><span>Início</span></button><button onclick="lexProcessos()"><b>▣</b><span>Processos</span></button><button class="lex-main on" onclick="lexChat()"><b>◉</b><span>LEX</span></button><button onclick="lexPrazos()"><b>◷</b><span>Prazos</span></button><button onclick="lexMais()"><b>☰</b><span>Mais</span></button></nav>'}
function chips(id){
  if(!id)return '<nav class="lex2-context-chips" aria-label="Ações do escritório"><button type="button" onclick="lexHome()">Precisa de mim</button><button type="button" onclick="lexChannel(\'all\')">Mensagens</button><button type="button" onclick="lexPrazos()">Prazos</button><button type="button" onclick="lexProcessos()">Processos</button><button type="button" onclick="goLex(\'autuacao\')">Cadastros</button></nav>';
  const c=[
    ['Analisar','Analise o processo selecionado e diga o que exige atenção agora.'],
    ['Peça','Prepare uma minuta de peça para minha revisão.'],
    ['Risco','Analise os riscos e próximos passos deste caso.'],
    ['Jurisprudência','Pesquise jurisprudência atual e relevante para este caso.'],
    ['Levar para perícia','Levar para perícia este processo e dizer o que falta.']
  ];
  return '<div class="lex2-context-chips">'+c.map(([label,prompt])=>'<button type="button" onclick="lex2Prefill(\''+esc(prompt)+'\')">'+esc(label)+'</button>').join('')+'</div>'
}
function history(id){
  try{
    const saved=JSON.parse(sessionStorage.getItem('lex_chat_history_'+(id?'process_'+id:'general'))||'[]');
    const rows=(Array.isArray(saved)?saved:[]).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').slice(-20);
    if(!rows.length)return '<div class="lex-msg bot lex2-welcome">Estou aqui. Dê a ordem em linguagem normal; se houver processo, selecione-o abaixo. Se eu precisar de uma decisão sua, vou dizer exatamente quem, o quê e qual ação está pendente.</div>';
    return rows.map(m=>'<div class="lex-msg '+(m.role==='user'?'me':'bot')+'">'+esc(m.content)+'</div>').join('')
  }catch{return '<div class="lex-msg bot lex2-welcome">Estou aqui. Dê a ordem em linguagem normal.</div>'}
}
function render(selectedId){
  const id=consumeContext(selectedId),p=procs().find(x=>String(x.id)===id);
  const host=document.getElementById('content');if(!host)return;
  window.lexSelectChatProcess?.(id);
  document.body.classList.add('lex-commercial','lex2-core','lex2-coordinator');
  host.innerHTML='<main class="lex-screen lex2-lex">'
    +'<header class="lex-top"><div><strong>LEX</strong><small>COORDENADOR DO ESCRITÓRIO</small></div><div class="lex-top-actions"><button onclick="lexToggleTheme()" aria-label="Tema">◐</button><button onclick="lexMais()" aria-label="Mais opções">☰</button></div></header>'
    +'<section class="lex2-lex-head"><small>'+(p?'PROCESSO EM CONTEXTO':'ESCRITÓRIO')+'</small><h1>'+(p?'Vamos trabalhar neste processo.':'O que precisamos resolver?')+'</h1><p>'+(p?esc((p.nome||p.partes||'Processo')+(p.numero?' · '+p.numero:'')):'Dê a ordem. O LEX identifica o assunto, coordena o setor e devolve o resultado aqui.')+'</p></section>'
    +chips(id)
    +'<section id="lex-conversation" class="lex-conversation" role="log" aria-label="Conversa com o LEX" aria-live="polite">'+history(id)+'</section>'
    +'<form class="lex2-command" onsubmit="return lexSendChat(event)">'
    +'<label for="lex-chat-process">Processo da conversa</label><select id="lex-chat-process" aria-label="Processo" onchange="lexSwitchChatProcess(this.value)"><option value="">Escritório geral — nenhum processo</option>'+procs().map(x=>'<option value="'+esc(String(x.id))+'" '+(String(x.id)===id?'selected':'')+'>'+esc((x.numero||'sem número')+' · '+(x.nome||x.partes||'Processo'))+'</option>').join('')+'</select>'
    +'<div class="lex2-command-row"><button class="lex2-attach" data-lex-attachment type="button" aria-label="Anexar documento ao processo">＋</button><textarea id="lex-chat-input" aria-label="Sua ordem ao LEX" rows="2" placeholder="Dê uma ordem ao LEX…"></textarea><button class="lex2-send" type="submit" aria-label="Enviar">↑</button></div>'
    +'<small class="lex2-command-note">Fale normalmente. O LEX coordena os especialistas; atos críticos continuam sujeitos à autorização humana.</small></form>'
    +dock()+'</main>';
  setTimeout(()=>{const c=document.getElementById('lex-conversation');if(c)c.scrollTop=c.scrollHeight},40)
}
window.lex2Prefill=function(text){const i=document.getElementById('lex-chat-input');if(!i)return;i.value=text;i.focus()};
function patch(){window.lexChat=render}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(patch,0),{once:true});else setTimeout(patch,0);
})();
