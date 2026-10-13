'use strict';
// =====================================================================
// VIGIA DO DIÁRIO (DJEN) — leitura ao longo do dia e alarme de atraso
// ---------------------------------------------------------------------
// Antes o LEX lia o Diário uma vez por dia (rotina das 6h). Os sistemas de mercado leem mais de
// uma vez por dia (a AASP entrega em duas levas). Aqui:
//  - lê de 2 em 2 horas, das 6h às 22h (Brasília), todas as OABs ligadas, e logo depois manda o
//    aviso do que chegou (lib/djen-alerts.js) e prepara a sugestão de prazo das novas;
//  - confere os avisos a cada 30 minutos (aviso que o canal não confirmou sai de novo);
//  - ALARME: se até as 8h o Diário de hoje não foi lido por completo (todas as OABs), avisa uma
//    vez, com o caminho para conferir à mão; quando volta a ler, avisa que normalizou;
//  - uma OAB parada já perde prazo: "lido" é a leitura mais atrasada entre as OABs.
// A leitura é a mesma da rotina (djen-monitor.syncDjen): idempotente, não duplica intimação.
// =====================================================================
const {readSyncState}=require('./djen-monitor');

const KEY='lex_djen_vigia';
const FMT_DIA=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'});
const FMT_HORA=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const FMT_QUANDO=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function horaBR(iso){const ms=Date.parse(iso||'');return Number.isFinite(ms)?FMT_HORA.format(new Date(ms)):'—'}
function quandoBR(iso){const ms=Date.parse(iso||'');return Number.isFinite(ms)?FMT_QUANDO.format(new Date(ms)).replace(',',''):'—'}
function horaEm(date){return Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(date))}

// Leitura completa mais atrasada entre as OABs (null se alguma nunca foi lida).
async function ultimaLeituraCompleta(sbReq,oabs){
  let pior=null;
  for(const o of oabs){
    const st=await readSyncState(sbReq,o.oab,o.uf);
    const ms=Date.parse(st?.last_success_at||'');
    if(!Number.isFinite(ms))return null;
    if(pior==null||ms<pior)pior=ms;
  }
  return pior==null?null:new Date(pior).toISOString();
}

function createDjenVigia({records,sbReq,processStore,oabs,syncDjen,alertsTick=null,sugerir=null,notify=async()=>{},log=()=>{},now=()=>new Date(),
  intervalMs=30*60*1000,cadenciaMs=2*60*60*1000,horaAlarme=8,clientOptions={}}={}){
  if(!records?.read||!records?.change||typeof sbReq!=='function'||typeof syncDjen!=='function'||typeof oabs!=='function')throw new Error('Vigia do Diário sem dependências.');
  let running=false,timer=null,first=null;
  async function tick(){
    const current=now(),hora=horaEm(current);
    if(hora<6||hora>22)return{skipped:'fora_horario'};
    if(running)return{skipped:'em_execucao'};
    let lista=[];try{lista=(oabs()||[]).filter(o=>o&&o.oab&&o.uf)}catch{lista=[]}
    if(!lista.length)return{skipped:'sem_oab'}; // a rotina diária já avisa que falta a OAB
    running=true;
    try{
      const hoje=FMT_DIA.format(current);
      const estado=(await records.read(KEY))?.value||{};
      const avisos=estado.date===hoje&&estado.avisos&&typeof estado.avisos==='object'?{...estado.avisos}:{};
      const antes=await ultimaLeituraCompleta(sbReq,lista);
      let leu=false,erro=null,resultado=null;
      if(!antes||current.getTime()-Date.parse(antes)>=cadenciaMs){
        try{
          resultado=await syncDjen({processStore,sbReq,oabs:lista,now:current,clientOptions});
          leu=true;
          if(resultado?.ok===false)erro=(resultado.falhas||[]).map(f=>f?.error).filter(Boolean).slice(0,2).join('; ')||'falha na leitura';
        }catch(e){erro=e.message}
        // Sugestão de prazo das novas (a IA só escolhe entre trechos do texto; vale com confirmação).
        if(leu&&typeof sugerir==='function'&&Array.isArray(resultado?.cunhar)&&resultado.cunhar.length){
          try{await sugerir(resultado.cunhar)}catch(e){log('[Diário] sugestão de prazo: '+e.message)}
        }
      }
      // Aviso do que chegou: logo depois da leitura (mesmo com falha parcial: o que foi lido já é
      // intimação) e também nas rodadas sem leitura — aviso que o canal não confirmou, ou que
      // chegou por outra leitura (rotina das 6h, OAB recém-ligada), sai em até 30 minutos.
      if(typeof alertsTick==='function'){try{await alertsTick()}catch(e){log('[Diário] aviso: '+e.message)}}
      const depois=leu?await ultimaLeituraCompleta(sbReq,lista):antes;
      const lidoHoje=!!depois&&FMT_DIA.format(new Date(depois))===hoje;
      if(!lidoHoje&&hora>=horaAlarme&&!avisos.atraso){
        await notify('⚠️ PRAZOS: o Diário (DJEN) de hoje ainda NÃO foi lido por completo pelo LEX'
          +(depois?' (última leitura completa: '+quandoBR(depois)+')':' (nenhuma leitura completa registrada)')+(erro?' — '+erro:'')
          +'. Até eu voltar a ler, confira as intimações em comunica.pje.jus.br pelo número da OAB. Tento de novo a cada 30 minutos.');
        avisos.atraso=current.toISOString();
      }
      if(lidoHoje&&avisos.atraso&&!avisos.normalizou){
        await notify('✅ PRAZOS: o Diário de hoje foi lido às '+horaBR(depois)+'. As intimações novas seguem nos avisos.');
        avisos.normalizou=current.toISOString();
      }
      await records.change(KEY,()=>({date:hoje,avisos,ultima_leitura_completa:depois||null,ultima_tentativa:leu?current.toISOString():(estado.ultima_tentativa||null),
        ultimo_erro:erro,novas:Number(resultado?.casadas||0)+Number(resultado?.orfas||0)}));
      return{ok:!erro,leu,lido_hoje:lidoHoje,erro,ultima_leitura_completa:depois||null};
    }catch(e){
      log('[Diário] vigia falhou: '+e.message);
      return{ok:false,error:e.message};
    }finally{running=false}
  }
  function start(){
    if(timer)return;
    first=setTimeout(()=>tick().catch(e=>log('[Diário] '+e.message)),3*60*1000);
    timer=setInterval(()=>tick().catch(e=>log('[Diário] '+e.message)),intervalMs);
  }
  function stop(){if(first){clearTimeout(first);first=null}if(timer){clearInterval(timer);timer=null}}
  return{tick,start,stop};
}

module.exports={KEY,createDjenVigia,ultimaLeituraCompleta};
