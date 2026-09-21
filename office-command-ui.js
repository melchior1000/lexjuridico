(function(){
'use strict';

function openCommercialProduction(kind){
  if(typeof window.lexChat!=='function')return false;
  window.lexChat();
  const prompt=kind==='pericia'?'Prepare uma perícia para o processo selecionado.':'Prepare uma minuta de petição para o processo selecionado.';
  setTimeout(()=>{if(typeof window.lexPrefill==='function')window.lexPrefill(prompt)},40);
  return true;
}

function hardenNavigation(){
  if(typeof window.goLex==='function'&&!window.goLex.__commercialProduction){
    const oldGo=window.goLex;
    const go=function(page){
      if(page==='peticao')return openCommercialProduction('peticao');
      if(page==='pericia')return openCommercialProduction('pericia');
      if(page==='agentes'){window.lexEscritorio?.();return true}
      return oldGo.apply(this,arguments);
    };
    go.__commercialProduction=true;window.goLex=go;
  }
  if(typeof window.ir==='function'&&!window.ir.__commercialProduction){
    const oldIr=window.ir;
    const ir=function(page){
      if(page==='peticao')return openCommercialProduction('peticao');
      if(page==='pericia')return openCommercialProduction('pericia');
      if(page==='agentes'){window.lexEscritorio?.();return true}
      return oldIr.apply(this,arguments);
    };
    ir.__commercialProduction=true;window.ir=ir;
  }
}

function boot(){
  hardenNavigation();
  setTimeout(hardenNavigation,250);
  setTimeout(hardenNavigation,1000);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();