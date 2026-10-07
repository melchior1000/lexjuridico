/* Trava das telas antigas.
   As telas antigas (painel, lista de processos, prazos) ainda são chamadas por
   atualizações em segundo plano: comandos vindos do Telegram, sincronização com o
   servidor, aviso do motor. Antes elas escreviam por cima de qualquer tela aberta —
   ao abrir o app, a lista antiga aparecia com o título "Mais" e depois sumia.
   Regra: no modo comercial, com a tela nova disponível, a tela antiga só se redesenha
   se ela mesma for a que está aberta. Sem a tela nova, a antiga segue como reserva. */
(function(root){
  const NOVAS={painel:'lexHome',processos:'lexProcessos',prazos:'lexPrazos'};
  const doc0=()=>(typeof document!=='undefined'?document:null);
  const win0=()=>(typeof window!=='undefined'?window:root);
  function host(doc){try{return doc&&doc.getElementById('content')}catch{return null}}
  function lexLegadoPodePintar(tela,doc=doc0(),win=win0()){
    const nova=NOVAS[tela];
    if(!nova||!doc)return true;
    const comercial=!!(doc.body&&doc.body.classList&&doc.body.classList.contains('lex-commercial'));
    if(!comercial||typeof (win||{})[nova]!=='function')return true;
    const h=host(doc);
    if(!h)return false;
    if(h.querySelector('.lex-screen'))return false;
    return !!(h.dataset&&h.dataset.lexLegado===tela);
  }
  function lexMarcarLegado(tela,doc=doc0()){const h=host(doc);if(h&&h.dataset)h.dataset.lexLegado=tela}
  function lexLimparLegado(doc=doc0()){const h=host(doc);if(h&&h.dataset)delete h.dataset.lexLegado}
  root.lexLegadoPodePintar=lexLegadoPodePintar;
  root.lexMarcarLegado=lexMarcarLegado;
  root.lexLimparLegado=lexLimparLegado;
  if(typeof module==='object'&&module.exports)module.exports={lexLegadoPodePintar,lexMarcarLegado,lexLimparLegado};
})(typeof globalThis!=='undefined'?globalThis:this);
