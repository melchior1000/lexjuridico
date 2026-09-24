'use strict';
// Plano gratuito do Render dorme após ~15 min sem visita. O próprio servidor
// visita o seu endereço público (RENDER_EXTERNAL_URL, definido pelo Render)
// a cada 10 min, 24 h por dia. Não substitui plano pago em produção.
function createKeepAlive({url,fetchImpl=globalThis.fetch,intervalMs=10*60*1000,log=()=>{},setTimer=setInterval,clearTimer=clearInterval}={}){
  const base=String(url||'').trim().replace(/\/+$/,'');
  let timer=null,falhasSeguidas=0;
  async function ping(){
    if(!base||typeof fetchImpl!=='function')return{ok:false,motivo:'sem_endereco'};
    try{
      const r=await fetchImpl(base+'/health',{method:'GET',signal:AbortSignal.timeout?.(20000)});
      if(!r?.ok)throw new Error('HTTP '+(r?.status||'?'));
      if(falhasSeguidas)log('[keep-alive] voltou a responder.');
      falhasSeguidas=0;return{ok:true};
    }catch(e){
      falhasSeguidas++;
      if(falhasSeguidas===3)log('[keep-alive] 3 visitas seguidas falharam ('+e.message+'). Confira o endereço em RENDER_EXTERNAL_URL.');
      return{ok:false,erro:e.message};
    }
  }
  return{
    ativo:()=>!!timer,
    start(){if(!base||timer)return false;timer=setTimer(()=>{ping().catch(()=>{})},intervalMs);timer?.unref?.();return true},
    stop(){if(timer){clearTimer(timer);timer=null}},
    ping
  };
}
module.exports={createKeepAlive};
