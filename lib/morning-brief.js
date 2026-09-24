'use strict';
// "Bom dia" do LEX: uma vez por dia, a partir da hora configurada (Brasília),
// envia ao titular o resumo determinístico do escritório. Só marca o dia como
// enviado depois que o canal confirmar a entrega; falha tenta de novo no
// próximo ciclo, sem duplicar o que já foi aceito.
const {brasiliaParts}=require('./deadline-scheduler');

const KEY='lex_bom_dia';

function createMorningBrief({records,compose,deliver,log=()=>{},now=()=>new Date(),hour=7,lastHour=12,intervalMs=10*60*1000}={}){
  if(!records?.read||!records?.change||typeof compose!=='function'||typeof deliver!=='function')throw new Error('Bom dia do LEX sem dependências.');
  let running=false,timer=null;
  async function tick(){
    const current=now(),br=brasiliaParts(current);
    if(br.hour<hour||br.hour>=lastHour)return{skipped:'fora_horario'};
    if(running)return{skipped:'em_execucao'};
    running=true;
    try{
      const previous=(await records.read(KEY))?.value;
      if(previous?.date===br.date&&previous?.status==='enviado')return{skipped:'ja_enviado'};
      const text=await compose(current);
      if(!String(text||'').trim())return{skipped:'sem_conteudo'};
      const delivered=await deliver(text);
      if(delivered!==true){
        log('[Bom dia] canal não confirmou a entrega; nova tentativa no próximo ciclo.');
        return{ok:false,reason:'entrega_nao_confirmada'};
      }
      await records.change(KEY,()=>({date:br.date,status:'enviado',enviado_em:new Date().toISOString()}));
      return{ok:true};
    }catch(error){
      log('[Bom dia] falhou: '+error.message);
      return{ok:false,error:error.message};
    }finally{running=false}
  }
  function start(){if(!timer)timer=setInterval(()=>tick().catch(e=>log('[Bom dia] '+e.message)),intervalMs)}
  function stop(){if(timer){clearInterval(timer);timer=null}}
  return{tick,start,stop};
}
module.exports={createMorningBrief,KEY};
