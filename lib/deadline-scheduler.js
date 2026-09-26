'use strict';

function brasiliaParts(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const get=t=>parts.find(p=>p.type===t)?.value||'';
  return{date:get('year')+'-'+get('month')+'-'+get('day'),hour:Number(get('hour'))};
}
function createDeadlineScheduler({run,records,notify=async()=>{},log=()=>{},now=()=>new Date(),intervalMs=30*60*1000}={}){
  if(typeof run!=='function'||!records?.read||!records?.change)throw new Error('Scheduler de prazos sem dependências.');
  let running=false,timer=null,first=null;
  async function tick(){
    const current=now(),br=brasiliaParts(current);
    if(br.hour<6||br.hour>22)return{skipped:'fora_horario'};
    const previous=(await records.read('lex_deadline_daily_job'))?.value;
    if(previous?.date===br.date&&previous?.status==='ok')return{skipped:'ja_executado'};
    if(running)return{skipped:'em_execucao'};
    running=true;
    const iniciouEm=new Date().toISOString();
    try{
      const result=await run(current);
      // Registro da rotina do dia (lido pelos Recibos): o que foi consultado, o que veio de novo, o que falhou.
      // Sem DATAJUD_API_KEY o registro diz que a carteira NÃO foi atualizada — não se marca "atualizado".
      try{
        const dj=result?.datajud||{};
        await records.change('lex_rotina_noturna_'+br.date,()=>({
          date:br.date,iniciou_em:iniciouEm,terminou_em:new Date().toISOString(),
          datajud_ativo:dj.enabled===true,motivo:dj.reason||null,
          consultados:dj.enabled?Number(dj.total)||0:0,novos:dj.enabled?Number(dj.novos)||0:0,erros:Number(dj.falhas)||0,
          djen_consultadas:Number(result?.djen?.consultadas)||0,djen_cunhar:Number(result?.djen?.cunhar_total)||0
        }));
      }catch(error){log('[Prazos] não gravei o registro da rotina: '+error.message)}
      const djenStatus=!result?.djen?.enabled?'not_configured':result.djen.ok===false?'failed':'ok';
      const status=djenStatus==='failed'?'retry':djenStatus==='not_configured'?'blocked':result?.ok===false?'partial':'ok';
      await records.change('lex_deadline_daily_job',()=>({
        date:br.date,status,djen_status:djenStatus,executado_em:new Date().toISOString(),
        cunhar:Number(result?.djen?.cunhar_total)||0,alertas_novos:Number(result?.alerts?.novos)||0,
        erros:Array.isArray(result?.exceptions)?result.exceptions.slice(0,20):[]
      }));
      if(result?.djen?.cunhar_total>0)await notify('PRAZOS: '+result.djen.cunhar_total+' comunicação(ões) do DJEN aguardam leitura e confirmação humana.');
      if(result?.alerts?.novos>0)await notify('PRAZOS: '+result.alerts.novos+' novo(s) marco(s) de vencimento entraram na fila de alerta.');
      if(djenStatus==='failed')await notify('PRAZOS: leitura do DJEN falhou. O LEX não considera o diário atualizado até a próxima tentativa.');
      if(djenStatus==='not_configured')await notify('PRAZOS: a vigia do DJEN ainda não tem OAB configurada. Até isso ser resolvido, o LEX não considera o diário monitorado.');
      return result;
    }catch(error){
      log('[Prazos] rotina diária falhou: '+error.message);
      await records.change('lex_deadline_daily_job',()=>({date:br.date,status:'retry',djen_status:'unknown',executado_em:new Date().toISOString(),erro:error.message}));
      await notify('PRAZOS: rotina de vigilância falhou e será tentada novamente. Confira a Central.');
      return{ok:false,error:error.message};
    }finally{running=false}
  }
  function start(){
    if(timer)return;
    first=setTimeout(()=>tick().catch(error=>log('[Prazos] '+error.message)),45*1000);
    timer=setInterval(()=>tick().catch(error=>log('[Prazos] '+error.message)),intervalMs);
  }
  function stop(){if(first){clearTimeout(first);first=null}if(timer){clearInterval(timer);timer=null}}
  return{start,stop,tick,brasiliaParts};
}
module.exports={createDeadlineScheduler,brasiliaParts};
