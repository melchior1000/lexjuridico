(function(){
  'use strict';

  function prepareLoginTheme(){
    const screen=document.getElementById('login-screen');
    if(screen) screen.dataset.loginThemeReady='true';
  }

  window.lexPrepareLoginTheme=prepareLoginTheme;
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',prepareLoginTheme,{once:true});
  else prepareLoginTheme();
})();
