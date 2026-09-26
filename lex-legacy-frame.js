/* Moldura das telas antigas (Clientes, Agenda, Documentos, Relatórios,
   Configurações...) dentro da interface nova: topo com voltar e título, e a
   mesma barra inferior das outras telas. Não altera o conteúdo da tela. */
(function(){
  'use strict';
  const TITLES=[[/contato|agenda de contatos/i,'Clientes e contatos'],[/setembro|janeiro|fevereiro|março|abril|maio|junho|julho|agosto|outubro|novembro|dezembro|prazo\/evento/i,'Agenda'],[/autuação|autuacao/i,'Documentos e autuação'],[/dashboard por tribunal|taxa de êxito/i,'Relatórios'],[/configura/i,'Configurações'],[/fontes dos processos/i,'Fontes dos processos'],[/pje/i,'PJe']];
  const dock='<nav class="lex-dock lex-legacy-dock"><button onclick="lexHome()"><b>⌂</b><span>Início</span></button><button onclick="lexProcessos()"><b>▣</b><span>Processos</span></button><button class="lex-main" onclick="lexChat()"><b>◉</b><span>LEX</span></button><button onclick="lexPrazos()"><b>◷</b><span>Prazos</span></button><button class="on" onclick="lexMais()"><b>☰</b><span>Mais</span></button></nav>';
  let busy=false;
  function frame(){
    const host=document.getElementById('content');
    if(busy||!host||!document.body.classList.contains('lex-commercial'))return;
    if(host.querySelector('.lex-legacy-top')){host.classList.add('lex-legacy-framed');return}
    if(host.querySelector('.lex-screen,.lex-dock')){host.classList.remove('lex-legacy-framed');return}
    if(!host.textContent.trim())return;
    busy=true;
    try{
      const text=host.innerText.slice(0,600);
      const title=(TITLES.find(([re])=>re.test(text))||[,'Mais'])[1];
      const top=document.createElement('header');
      top.className='lex-top lex-legacy-top';
      top.innerHTML='<div class="lex-brand"><button class="lex-shell-back" onclick="lexMais()" aria-label="Voltar">‹</button><div><strong>'+title+'</strong>'+(typeof lexAvisoHtml==='function'?lexAvisoHtml():'')+'</div></div>';
      host.prepend(top);
      host.insertAdjacentHTML('beforeend',dock);
      host.classList.add('lex-legacy-framed');
    }finally{busy=false}
  }
  function start(){
    const host=document.getElementById('content');
    if(!host)return setTimeout(start,300);
    new MutationObserver(frame).observe(host,{childList:true});
    frame();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
