/* Conserto de exibição para textos gravados com codificação errada.
   O caractere U+FFFD ("�") indica bytes perdidos. Recupera só os padrões
   inequívocos do português e remove o resto; não altera texto íntegro. */
(function(root){
  function lexFixText(value){
    let s=String(value??'');
    if(s.indexOf('�')<0)return s;
    s=s.replace(/\s+�+\s+/g,' — ')          // travessão perdido entre palavras
      .replace(/ç�+o/g,'ção').replace(/Ç�+O/g,'ÇÃO')
      .replace(/ç�+es/g,'ções')
      .replace(/(^|[^\p{L}])n�+o(?=$|[^\p{L}])/gu,'$1não')
      .replace(/�+/g,'');
    return s;
  }
  root.lexFixText=lexFixText;
  if(typeof module==='object'&&module.exports)module.exports={lexFixText};
})(typeof globalThis!=='undefined'?globalThis:this);
