'use strict';
// Mantém o LEX acordado no plano gratuito do Render.
//
// O Render gratuito desliga o serviço após ~15 min sem visita externa. A rotina do GitHub
// (.github/workflows/manter-servidor-acordado.yml) deveria visitar a cada 5 min, mas o
// agendador do GitHub atrasa: em 27/09/2026 rodou a cada 2–5 h, e o LEX dormia entre as
// visitas (mensagem de WhatsApp chegando com o servidor dormindo pode se perder).
//
// Aqui o próprio LEX visita o seu endereço PÚBLICO (passa pela porta do Render e conta
// como visita) a cada 10 min enquanto está acordado — assim ele não chega a dormir.
// Um serviço já dormindo não se acorda sozinho: para isso seguem valendo a rotina do
// GitHub e, em produção comercial, o plano pago do Render (que não dorme).
const INTERVALO_PADRAO=10*60*1000;

function createKeepAwake({url,desligado=false,intervalMs=INTERVALO_PADRAO,fetchImpl=globalThis.fetch,log=()=>{},
  setIntervalImpl=setInterval,clearIntervalImpl=clearInterval}={}){
  const base=String(url||'').trim().replace(/\/+$/,'');
  const ativo=!!base&&!desligado&&typeof fetchImpl==='function';
  let timer=null;
  async function tick(){
    if(!ativo)return false;
    try{
      const r=await fetchImpl(base+'/health',{method:'GET',signal:AbortSignal.timeout(20000)});
      if(r&&r.ok)return true;
      log('[Manter acordado] /health respondeu HTTP '+(r&&r.status));
      return false;
    }catch(e){
      log('[Manter acordado] visita falhou: '+(e&&e.message||e));
      return false;
    }
  }
  function start(){
    if(!ativo||timer)return;
    timer=setIntervalImpl(()=>{tick().catch(()=>{})},intervalMs);
    if(timer&&typeof timer.unref==='function')timer.unref();
  }
  function stop(){if(timer){clearIntervalImpl(timer);timer=null}}
  return{ativo,tick,start,stop};
}
module.exports={createKeepAwake,INTERVALO_PADRAO};
