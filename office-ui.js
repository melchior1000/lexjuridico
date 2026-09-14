document.write('<script src="office-ui-base.js"><\/script>');
(function(){
  function esc(v){
    const s=String(v??'');
    if(typeof window.lexEscape==='function') return window.lexEscape(s);
    return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function setPageTitle(text){
    const el=document.querySelector('.page-title');
    if(el) el.textContent=text;
  }
  function activate(btn){
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    const sidebar=document.getElementById('sidebar');
    const overlay=document.getElementById('overlay');
    if(window.innerWidth<=900){sidebar?.classList.remove('open');overlay?.classList.remove('show');}
  }
  function openWhatsapp(btn){
    activate(btn||document.getElementById('lex-nav-whatsapp'));
    setPageTitle('WhatsApp do escritório');
    renderWhatsappCanal();
  }
  function renderWhatsappCanal(){
    if(typeof podeConfig==='function'&&!podeConfig()){
      document.getElementById('content').innerHTML='<div class="work-home"><p>Acesso restrito ao administrador.</p></div>';
      return;
    }
    document.getElementById('content').innerHTML=`
      <section class="work-home lex-canal">
        <div class="work-title">
          <div><div class="work-eyebrow">Canal dos clientes</div><h1>WhatsApp do escritório</h1>
          <p>O cliente fala com o LEX Jurídico por este número. O LEX mantém cada conversa separada e chama você quando precisa de decisão.</p></div>
          <button class="btn-outline" onclick="typeof lexOpenReception==='function'?lexOpenReception(document.getElementById('lex-nav-recepcao')):ir('mensagens',null)">Ver fila</button>
        </div>
        <div class="lex-canal-hero">
          <div class="lex-canal-phone"><span>Entrada dos clientes</span><strong>(61) 99933-3672</strong><p>WhatsApp do escritório. O cliente fala com o LEX aqui.</p></div>
          <div class="lex-canal-phone"><span>Sua mesa privada</span><strong>(61) 99917-1717</strong><p>O LEX reporta nome, número e assunto. Você autoriza o que for sensível.</p></div>
        </div>
        <section class="work-command">
          <h2>Fluxo do atendimento</h2>
          <ol class="lex-canal-steps">
            <li>O cliente manda mensagem no <strong>(61) 99933-3672</strong>.</li>
            <li>O LEX recebe, organiza e responde o que é apenas recepção.</li>
            <li>Quando precisa de você, o 7171 recebe nome, número e assunto daquele contato.</li>
            <li>No 7171, <code>Oi</code> ou <code>mesa</code> mostra quem está aguardando.</li>
            <li>Para responder uma pessoa: <code>/responder NUMERO TEXTO EXATO</code>.</li>
          </ol>
          <div class="lex-canal-rule"><strong>Regra do escritório</strong><p>Processo, estratégia, acordo, honorário, promessa ou posição jurídica não saem sem sua autorização.</p></div>
          <div class="work-links">
            <button class="btn-primary" onclick="typeof lexOpenReception==='function'?lexOpenReception(document.getElementById('lex-nav-recepcao')):ir('mensagens',null)">Abrir recepção</button>
            <button class="btn-outline" onclick="ir('telegram',null)">Ir ao Telegram</button>
          </div>
        </section>
      </section>`;
  }
  function renderTelegramCommercial(){
    if(typeof podeConfig==='function'&&!podeConfig()){
      document.getElementById('content').innerHTML='<div class="work-home"><p>Acesso restrito ao administrador.</p></div>';
      return;
    }
    const cfg=typeof getTgConfig==='function'?getTgConfig():{};
    const token=esc(cfg.token||''); const chatId=esc(cfg.chatId||'');
    document.getElementById('content').innerHTML=`
      <section class="work-home lex-canal">
        <div class="work-title">
          <div><div class="work-eyebrow">Canal complementar</div><h1>Telegram do escritório</h1>
          <p>Outra porta de atendimento do LEX. O funcionamento do escritório continua o mesmo: cada pessoa em seu fio e o responsável decide o que é sensível.</p></div>
          <button class="btn-outline" onclick="window.lexOpenWhatsapp()">Ver WhatsApp</button>
        </div>
        <section class="work-command">
          <h2>Como usar</h2>
          <ol class="lex-canal-steps">
            <li>O contato fala com o bot do escritório em conversa privada.</li>
            <li><code>/resumo</code> abre a mesa do Telegram.</li>
            <li><code>/respondertg ID TEXTO EXATO</code> envia só para aquele contato.</li>
          </ol>
          <p class="lex-canal-note">Grupo e terceiro não abrem a mesa do escritório. O Telegram não substitui o WhatsApp; é um segundo canal de entrada.</p>
          <div class="work-links"><button class="btn-primary" onclick="window.lexOpenWhatsapp()">Ver WhatsApp</button><button class="btn-outline" onclick="enviarResumoGeral()">Resumo geral</button></div>
        </section>
        <details class="lex-canal-advanced work-command">
          <summary>Ajustes avançados do Telegram</summary>
          <p class="work-help">Use só quando precisar alterar alertas deste aparelho. Isto não é o interruptor do atendimento.</p>
          <label class="fl" for="tg-token">Token do bot já existente</label>
          <input class="fi" id="tg-token" value="${token}" placeholder="Somente se o administrador pediu este ajuste">
          <label class="fl" for="tg-chatid">Seu Chat ID</label>
          <input class="fi" id="tg-chatid" value="${chatId}" placeholder="ID do seu Telegram">
          <label class="fl" for="tg-modo">Modo</label>
          <select class="fs" id="tg-modo"><option value="alertas" ${cfg.modo==='alertas'?'selected':''}>Alertas de prazo</option><option value="completo" ${cfg.modo==='completo'?'selected':''}>Chat do assessor</option></select>
          <div class="work-links"><button class="btn-primary" onclick="salvarTgConfig()">Salvar ajuste</button><button class="btn-outline" onclick="testarTelegram()">Testar alerta</button><button class="btn-outline" onclick="enviarAlertasPrazos()">Enviar prazos agora</button></div>
          <div id="tg-status"></div><div id="tg-alerta-status"></div>
          <p class="lex-canal-note">${cfg.token&&cfg.chatId?'Alertas deste aparelho configurados.':'Alertas deste aparelho ainda não configurados. O atendimento do LEX não depende desta caixa.'}</p>
        </details>
      </section>`;
  }
  function patchChannels(){
    window.renderWhatsappCanal=renderWhatsappCanal;
    window.lexOpenWhatsapp=()=>openWhatsapp(document.getElementById('lex-nav-whatsapp'));
    window.renderTelegram=renderTelegramCommercial;
    const nav=document.querySelector('#sidebar nav');
    if(nav){
      const tg=[...nav.querySelectorAll('.nav-btn')].find(b=>/Telegram/i.test(b.textContent||''));
      if(tg){
        tg.innerHTML='<span class="nav-icon">✈️</span> Telegram';
        tg.onclick=()=>{activate(tg);setPageTitle('Telegram');renderTelegramCommercial();};
        if(!document.getElementById('lex-nav-whatsapp')){
          const section=document.createElement('div');section.className='nav-section lex-canais-label';section.textContent='Canais';
          const btn=document.createElement('button');btn.id='lex-nav-whatsapp';btn.className='nav-btn';btn.innerHTML='<span class="nav-icon">📱</span> WhatsApp';btn.onclick=()=>openWhatsapp(btn);
          tg.before(section);section.after(btn);
        }
      }
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',patchChannels); else patchChannels();
})();
document.write('<link rel="stylesheet" href="office-ui-v2.css">');
document.write('<link rel="stylesheet" href="office-ui-device.css">');
document.write('<link rel="stylesheet" href="login-theme.css">');
document.write('<link rel="stylesheet" href="office-flow-ui.css">');
document.write('<script src="office-ui-device.js"><\/script>');
document.write('<script src="office-ui-v2.js"><\/script>');
document.write('<script src="login-theme.js"><\/script>');
document.write('<script src="office-flow-ui.js"><\/script>');
document.write('<script src="lib/office-command.js"><\/script>');
document.write('<script src="office-command-ui.js"><\/script>');
