(function(){
  'use strict';

  function dropThemeProps(el, props){
    if(!el || !el.style) return;
    props.forEach(function(prop){ el.style.removeProperty(prop); });
  }

  function removeLegacyLoginBridge(){
    for(const sheet of Array.from(document.styleSheets||[])){
      let rules;
      try{ rules=sheet.cssRules; }catch(_){ continue; }
      if(!rules) continue;
      for(let i=rules.length-1;i>=0;i--){
        const rule=rules[i];
        const selector=rule && rule.selectorText || '';
        if(selector && selector.includes('body.dia #login-screen')){
          try{ sheet.deleteRule(i); }catch(_){ }
        }
      }
    }
  }

  function prepareLoginTheme(){
    const screen=document.getElementById('login-screen');
    if(!screen) return;

    removeLegacyLoginBridge();

    const wrap=screen.firstElementChild;
    const brand=wrap && wrap.children[0];
    const card=wrap && wrap.children[1];
    const footer=wrap && wrap.children[2];

    screen.classList.add('login-shell');
    if(wrap) wrap.classList.add('login-wrap');
    if(brand){
      brand.classList.add('login-brand');
      if(brand.children[0]) brand.children[0].classList.add('login-kicker');
      if(brand.children[1]) brand.children[1].classList.add('login-title');
      if(brand.children[2]) brand.children[2].classList.add('login-subtitle');
    }
    if(card){
      card.classList.add('login-card');
      if(card.children[0]) card.children[0].classList.add('login-kicker');
      card.querySelectorAll('label').forEach(function(el){ el.classList.add('login-label'); });
      card.querySelectorAll('input,select').forEach(function(el){ el.classList.add('login-input'); });
    }
    if(footer) footer.classList.add('login-footer');

    const submit=document.getElementById('btn-login');
    const eye=document.getElementById('olho-btn');
    const reset=card && card.querySelector('button[onclick*="resetSenhasPadrao"]');
    if(submit) submit.classList.add('login-submit');
    if(eye) eye.classList.add('login-eye');
    if(reset) reset.classList.add('login-reset');

    dropThemeProps(screen,['background','color']);
    dropThemeProps(card,['background','border-color','box-shadow']);
    if(brand) Array.from(brand.children).forEach(function(el){ dropThemeProps(el,['color']); });
    if(card){
      if(card.children[0]) dropThemeProps(card.children[0],['color']);
      card.querySelectorAll('label').forEach(function(el){ dropThemeProps(el,['color']); });
      card.querySelectorAll('input,select').forEach(function(el){ dropThemeProps(el,['background','border-color','color','box-shadow']); });
    }
    dropThemeProps(submit,['background','color','box-shadow']);
    dropThemeProps(eye,['color']);
    dropThemeProps(reset,['background','border-color','color']);
    dropThemeProps(footer,['color']);
    dropThemeProps(document.getElementById('login-erro'),['color']);

    screen.dataset.loginThemeReady='true';
  }

  window.lexPrepareLoginTheme=prepareLoginTheme;
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',prepareLoginTheme,{once:true});
  else prepareLoginTheme();
})();
