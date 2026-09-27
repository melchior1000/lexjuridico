/* LEX — abertura de painel digital ao ENTRAR no LEX (depois que a senha é aceita).
 *
 * index.html → ativarApp() chama window.lexAbertura(). Dura ~5 s: grade de painel, anel
 * de radar, marca LEX com o AVISO LEGAL embaixo (AGENTS.md §1A: toda tela com a marca
 * mostra o aviso) e a sequência de inicialização, enquanto o LEX monta a central por trás.
 * Toque/tecla pula. Com "reduzir movimento" do sistema, vira uma versão curta e parada.
 * Nunca prende o app: sai sozinha em no máximo 10 s.
 */
(function () {
  'use strict';
  var AVISO = 'Assistente jurídico · não substitui as funções do advogado';
  var PASSO = 850, SEGURA = 1100, TRAVA = 10000;
  var root = document.documentElement;
  var css = ''
    + 'html.lex-abrindo body{overflow:hidden!important}'
    + '#lex-abertura{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;flex-direction:column;'
    + 'background:radial-gradient(ellipse at 50% 42%,rgba(23,120,255,.20),rgba(4,10,20,0) 58%),#040a14;color:#e8f2ff;'
    + 'font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;overflow:hidden;opacity:1;transition:opacity .6s ease}'
    + '#lex-abertura.sai{opacity:0}'
    + '#lex-abertura .grade{position:absolute;inset:-2px;background-image:linear-gradient(rgba(62,150,255,.07) 1px,transparent 1px),'
    + 'linear-gradient(90deg,rgba(62,150,255,.07) 1px,transparent 1px);background-size:34px 34px;'
    + 'mask-image:radial-gradient(ellipse at center,#000 30%,transparent 72%);-webkit-mask-image:radial-gradient(ellipse at center,#000 30%,transparent 72%)}'
    + '#lex-abertura .varre{position:absolute;left:0;right:0;height:120px;top:-120px;'
    + 'background:linear-gradient(180deg,transparent,rgba(64,170,255,.10),transparent);animation:lexVarre 2.2s linear infinite}'
    + '#lex-abertura .hud{position:relative;width:min(62vw,240px);height:min(62vw,240px);display:grid;place-items:center}'
    + '#lex-abertura svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}'
    + '#lex-abertura .gira{transform-origin:50% 50%;animation:lexGira 6s linear infinite}'
    + '#lex-abertura .gira2{transform-origin:50% 50%;animation:lexGira 9s linear infinite reverse}'
    + '#lex-abertura .marca{position:relative;text-align:center}'
    + '#lex-abertura .marca b{display:block;font-size:clamp(46px,14vw,64px);font-weight:900;letter-spacing:.24em;padding-left:.24em;line-height:1;'
    + 'background:linear-gradient(180deg,#ffffff,#8fd0ff);-webkit-background-clip:text;background-clip:text;color:transparent;'
    + 'text-shadow:0 0 28px rgba(64,170,255,.35);animation:lexSurge .9s cubic-bezier(.2,.8,.2,1) both}'
    + '#lex-abertura .marca small{display:block;margin-top:10px;font-size:9px;letter-spacing:.24em;padding-left:.24em;color:#75c8ff;font-weight:800;white-space:nowrap;animation:lexSurge .9s .15s both}'
    + '#lex-abertura .aviso{margin-top:22px;font-size:11px;color:#8ea2bc;letter-spacing:.02em;text-align:center;padding:0 24px;animation:lexSurge .9s .3s both}'
    + '#lex-abertura ol{list-style:none;margin:22px 0 0;padding:0;width:min(84vw,320px);font-size:12px;font-variant-numeric:tabular-nums}'
    + '#lex-abertura li{display:flex;gap:10px;align-items:center;padding:4px 0;color:#5f7590;opacity:0;transform:translateY(4px);transition:all .3s ease}'
    + '#lex-abertura li.on{opacity:1;transform:none;color:#cfe3fb}'
    + '#lex-abertura li i{width:14px;text-align:center;font-style:normal;color:#40aaff}'
    + '#lex-abertura li.ok i{color:#22d3a5}'
    + '#lex-abertura .barra{margin-top:18px;width:min(84vw,320px);height:3px;border-radius:3px;background:rgba(120,160,210,.18);overflow:hidden}'
    + '#lex-abertura .barra span{display:block;height:100%;width:0;border-radius:3px;background:linear-gradient(90deg,#1788ff,#22d3a5);transition:width .5s ease}'
    + '#lex-abertura .pular{position:absolute;bottom:calc(22px + env(safe-area-inset-bottom));font-size:11px;color:#56708f;letter-spacing:.06em}'
    + '@keyframes lexGira{to{transform:rotate(360deg)}}'
    + '@keyframes lexVarre{to{top:100%}}'
    + '@keyframes lexSurge{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}'
    + '@media (prefers-reduced-motion:reduce){#lex-abertura,#lex-abertura *{animation:none!important;transition:none!important}#lex-abertura li{opacity:1;transform:none}}';
  function css_() {
    if (document.getElementById('lex-abertura-css')) return;
    var st = document.createElement('style');
    st.id = 'lex-abertura-css';
    st.textContent = css;
    (document.head || root).appendChild(st);
  }

  var fim = true, trava = null, geracao = 0;
  function tecla() { sair(); }
  function sair() {
    if (fim) return;
    fim = true;
    clearTimeout(trava);
    document.removeEventListener('keydown', tecla);
    var el = document.getElementById('lex-abertura');
    root.classList.remove('lex-abrindo');
    if (!el) return;
    el.classList.add('sai');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 650);
  }

  function quantosProcessos() {
    try { var p = JSON.parse(localStorage.getItem('lex_proc_v1') || '[]'); return Array.isArray(p) ? p.length : 0; } catch (e) { return 0; }
  }

  // Chamada por ativarApp() no index.html, logo que a senha é aceita.
  function abrir() {
    if (!document.body || document.getElementById('lex-abertura')) return;
    var reduz = false;
    try { reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    css_();
    fim = false;
    var g = ++geracao; // temporizadores de uma abertura antiga não fecham a nova
    function sairDesta() { if (g === geracao) sair(); }
    root.classList.add('lex-abrindo');
    // Trava de segurança: a abertura nunca prende o LEX.
    trava = setTimeout(sairDesta, TRAVA);
    var n = quantosProcessos();
    var etapas = [
      'Iniciando o assessor jurídico',
      'Conectando ao escritório',
      n ? 'Organizando ' + n + (n === 1 ? ' processo' : ' processos') : 'Abrindo o banco de processos',
      'Preparando prazos, intimações e tarefas',
      'Pronto'
    ];
    var aviso = typeof window.lexAvisoHtml === 'function' ? window.lexAvisoHtml() : AVISO;
    var el = document.createElement('div');
    el.id = 'lex-abertura';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Abrindo o LEX. Toque para pular.');
    el.innerHTML = '<div class="grade"></div><div class="varre"></div>'
      + '<div class="hud"><svg viewBox="0 0 200 200" aria-hidden="true">'
      + '<circle cx="100" cy="100" r="96" fill="none" stroke="rgba(64,170,255,.18)" stroke-width="1"/>'
      + '<g class="gira"><circle cx="100" cy="100" r="88" fill="none" stroke="#40aaff" stroke-width="2" stroke-dasharray="46 22 8 22" stroke-linecap="round" opacity=".85"/></g>'
      + '<g class="gira2"><circle cx="100" cy="100" r="76" fill="none" stroke="#22d3a5" stroke-width="1.4" stroke-dasharray="3 9" opacity=".7"/></g>'
      + '<circle cx="100" cy="100" r="62" fill="rgba(8,24,48,.55)" stroke="rgba(117,200,255,.25)" stroke-width="1"/>'
      + '</svg><div class="marca"><b>LEX</b><small>ASSESSOR DO ESCRITÓRIO</small></div></div>'
      + '<div class="aviso">' + aviso + '</div>'
      + '<ol>' + etapas.map(function (t) { return '<li><i>›</i><span>' + t + '</span></li>'; }).join('') + '</ol>'
      + '<div class="barra"><span></span></div>'
      + '<div class="pular">toque para pular</div>';
    el.addEventListener('click', sair);
    document.addEventListener('keydown', tecla);
    document.body.appendChild(el);

    var itens = el.querySelectorAll('li');
    var barra = el.querySelector('.barra span');
    var passo = reduz ? 0 : PASSO;
    Array.prototype.forEach.call(itens, function (li, i) {
      setTimeout(function () {
        if (fim || g !== geracao) return;
        li.classList.add('on');
        if (i > 0) { itens[i - 1].classList.add('ok'); itens[i - 1].querySelector('i').textContent = '✓'; }
        if (i === itens.length - 1) { li.classList.add('ok'); li.querySelector('i').textContent = '✓'; }
        barra.style.width = Math.round((i + 1) / itens.length * 100) + '%';
      }, 300 + i * passo);
    });
    setTimeout(sairDesta, reduz ? 1200 : 300 + (itens.length - 1) * passo + SEGURA);
  }
  window.lexAbertura = abrir;
})();
