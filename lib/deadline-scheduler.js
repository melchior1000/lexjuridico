'use strict';

function brasiliaParts(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const get=t=>parts.find(p=>p.type===t)?.value||'';
  return{date:get('year')+'-'+get('month')+'-'+get('day'),hour:Number(get('hour'))};
}
function createDeadlineScheduler({run,records,notify=async()=>{},log=()=>{},now=()=>new Date(),intervalMs=30*60*1000}={}){
  if(typeof run!=='function'||!records?.read||!records?.change)throw new Error('Scheduler de prazos sem dependências.');
  let running=false,timer=null,first=null;
  // Novas tentativas no mesmo dia (Diário falhou, sem OAB, gravação de alertas falhou) repetem
  // só o que falta: a carteira já lida no Datajud hoje não é lida de novo (pularDatajud), e cada
  // aviso ao titular sai uma vez por dia — o resumo de comunicações só volta se a fila crescer.
  async function tick(){
    const current=now(),br=brasiliaParts(current);
    if(br.hour<6||br.hour>22)return{skipped:'fora_horario'};
    const previous=(await records.read('lex_deadline_daily_job'))?.value;
    const mesmoDia=previous?.date===br.date;
    if(mesmoDia&&previous?.status==='ok')return{skipped:'ja_executado'};
    if(running)return{skipped:'em_execucao'};
    running=true;
    const iniciouEm=new Date().toISOString();
    const datajudHoje=mesmoDia&&previous?.datajud_date===br.date;
    const avisos=mesmoDia&&previous?.avisos&&typeof previous.avisos==='object'?{...previous.avisos}:{};
    async function avisarUmaVez(chave,texto){if(avisos[chave])return;await notify(texto);avisos[chave]=true}
    // Marca a leitura do Datajud assim que ela acontece: se um aviso falhar depois, a próxima
    // tentativa não relê a carteira nem soma de novo nos Recibos.
    let datajudLidoHoje=datajudHoje;
    try{
      const result=await run(current,{pularDatajud:datajudHoje});
      const dj=result?.datajud||{};
      const leuDatajudAgora=dj.enabled===true&&dj.skipped!==true;
      if(leuDatajudAgora)datajudLidoHoje=true;
      // Registro da rotina do dia (lido pelos Recibos): o que foi consultado, o que veio de novo, o que falhou.
      // Sem DATAJUD_API_KEY o registro diz que a carteira NÃO foi atualizada — não se marca "atualizado".
      try{
        await records.change('lex_rotina_noturna_'+br.date,prev=>{
          const old=prev&&prev.date===br.date?prev:{};
          return{
            date:br.date,iniciou_em:old.iniciou_em||iniciouEm,terminou_em:new Date().toISOString(),
            datajud_ativo:old.datajud_ativo===true||dj.enabled===true,motivo:dj.reason==='DATAJUD_JA_LIDO_HOJE'?(old.motivo||null):(dj.reason||old.motivo||null),
            consultados:Number(old.consultados||0)+(leuDatajudAgora?Number(dj.total)||0:0),
            novos:Number(old.novos||0)+(leuDatajudAgora?Number(dj.novos)||0:0),
            erros:Number(old.erros||0)+(Number(dj.falhas)||0),
            nao_encontrados:Number(old.nao_encontrados||0)+(Number(dj.nao_encontrados)||0),
            djen_consultadas:Number(old.djen_consultadas||0)+(Number(result?.djen?.consultadas)||0),
            djen_cunhar:Number(old.djen_cunhar||0)+(Number(result?.djen?.cunhar_total)||0)
          };
        });
      }catch(error){log('[Prazos] não gravei o registro da rotina: '+error.message)}
      const djenStatus=!result?.djen?.enabled?'not_configured':result.djen.ok===false?'failed':'ok';
      const status=djenStatus==='failed'?'retry':djenStatus==='not_configured'?'blocked':result?.ok===false?'partial':'ok';
      const cunhar=Number(result?.djen?.cunhar_total)||0;
      // O que falta tratar do Diário (lib/djen-tratamento.js): inclui intimação de processo não cadastrado
      // e deixa de fora o que o titular já deu por tratado. Sem essa leitura, vale a fila de prazos.
      const pend=result?.djen?.pendentes&&Number.isFinite(Number(result.djen.pendentes.total))?result.djen.pendentes:null;
      const aTratar=pend?Number(pend.total):cunhar;
      if(aTratar>(Number(avisos.cunhar)||0)){
        await notify(pend
          ?'PRAZOS: '+aTratar+' intimação(ões) do Diário a tratar'+(pend.orfas?' ('+pend.orfas+' de processo não cadastrado)':'')+(pend.urgentes?', '+pend.urgentes+' urgente(s)':'')+'. Diga "intimações a tratar" ou abra Prazos › Diário. Prazo só vale depois da sua confirmação.'
          :'PRAZOS: '+cunhar+' comunicação(ões) do DJEN aguardam leitura e confirmação humana.');
        avisos.cunhar=aTratar;
      }
      // Lembrete de vencimento com processo, data e quanto falta (lib/deadline-alerts.js).
      const lembrete=require('./deadline-alerts').textoLembretes(result?.lembretes);
      if(lembrete)await notify(lembrete);
      else if(result?.alerts?.novos>0)await notify('PRAZOS: '+result.alerts.novos+' prazo(s) entraram na fila de vencimento. Veja em Prazos.');
      if(djenStatus==='failed')await avisarUmaVez('djen_falhou','PRAZOS: leitura do DJEN falhou. O LEX não considera o diário atualizado até a próxima tentativa.');
      if(djenStatus==='not_configured')await avisarUmaVez('sem_oab','PRAZOS: a vigia do DJEN ainda não tem OAB configurada. Até isso ser resolvido, o LEX não considera o diário monitorado.');
      await records.change('lex_deadline_daily_job',()=>({
        date:br.date,status,djen_status:djenStatus,executado_em:new Date().toISOString(),
        datajud_date:leuDatajudAgora||datajudHoje?br.date:null,avisos,
        cunhar,alertas_novos:Number(result?.alerts?.novos)||0,
        erros:Array.isArray(result?.exceptions)?result.exceptions.slice(0,20):[]
      }));
      return result;
    }catch(error){
      log('[Prazos] rotina diária falhou: '+error.message);
      try{await avisarUmaVez('rotina_falhou','PRAZOS: rotina de vigilância falhou e será tentada novamente. Confira a Central.')}catch(e){log('[Prazos] aviso: '+e.message)}
      await records.change('lex_deadline_daily_job',()=>({date:br.date,status:'retry',djen_status:'unknown',executado_em:new Date().toISOString(),erro:error.message,
        datajud_date:datajudLidoHoje?br.date:null,avisos}));
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
