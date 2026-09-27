'use strict';
// Guarda do crédito da IA.
//
// Quando o provedor recusa por falta de crédito, o LEX entra sozinho no modo "sem IA"
// (a mesma chave LEX_AI_NO_CREDIT que as rotas e o executor já respeitam), avisa o
// titular UMA vez e passa a operar pelo executor de ordens. A cada 30 min faz um teste
// mínimo; sem crédito o provedor recusa (sem custo). Quando o crédito volta, o LEX
// desliga o modo sem IA e avisa. Se o modo foi ligado à mão no servidor, a guarda não
// o desliga.
const INTERVALO=30*60*1000;
const PADRAO=/credit balance|insufficient[_ ]?(?:quota|funds|credit)|exceeded your current quota|payment required|billing[_ ]?(?:error|hard[_ ]limit)|purchase credits/i;

function isCreditError(e){return PADRAO.test(String(e&&e.message||e||''))}

function mensagemSemIA(){
  return [
    'A IA do LEX está sem crédito agora. Não consigo conversar livremente nem redigir peças até a recarga — e não vou fingir que fiz.',
    'Sem IA eu continuo fazendo:',
    '• "prazos da semana" ou "prazos de hoje"',
    '• "tem intimação nova?" (Diário/DJEN)',
    '• "como está o processo <nome ou número>"',
    '• "resumo do dia"',
    '• "veja o que precisa de mim"',
    'Quando o crédito voltar eu aviso e retomo sozinho.'
  ].join('\n');
}

function createCreditGuard({env=process.env,probe=null,notify=()=>{},log=()=>{},intervalMs=INTERVALO,setIntervalImpl=setInterval}={}){
  let automatico=false,desde=null,sondando=false,timer=null;
  const ligado=()=>env.LEX_AI_NO_CREDIT==='1';

  function registrarErro(e){
    if(!isCreditError(e))return false;
    if(!ligado()){
      env.LEX_AI_NO_CREDIT='1';
      automatico=true;desde=new Date().toISOString();
      log('[IA] provedor recusou por falta de crédito; LEX em modo sem IA até a recarga.');
      try{Promise.resolve(notify('⚠️ A IA do LEX ficou sem crédito. Continuo operando prazos, intimações, andamentos e a sua fila pelo executor; conversa livre e redação de peças ficam pausadas. Testo a cada 30 min e aviso quando voltar.')).catch(()=>{})}catch{}
    }
    return true;
  }

  function registrarSucesso(){/* sucesso com IA ativa não muda nada; a volta é pela sonda */}

  async function sondar(){
    if(!automatico||!ligado()||sondando||typeof probe!=='function')return{skipped:true};
    sondando=true;
    try{
      await probe();
      delete env.LEX_AI_NO_CREDIT;
      automatico=false;desde=null;
      log('[IA] crédito disponível de novo; modo sem IA desligado.');
      try{Promise.resolve(notify('✅ A IA do LEX voltou: há crédito de novo. Voltei a conversar e a redigir.')).catch(()=>{})}catch{}
      return{ok:true};
    }catch(e){
      if(!isCreditError(e))log('[IA] teste de crédito falhou: '+String(e&&e.message||e).slice(0,160));
      return{ok:false};
    }finally{sondando=false}
  }

  function start(){
    if(timer)return;
    timer=setIntervalImpl(()=>{sondar().catch(()=>{})},intervalMs);
    if(timer&&typeof timer.unref==='function')timer.unref();
  }

  return{registrarErro,registrarSucesso,sondar,start,estado:()=>({sem_credito:ligado(),automatico,desde})};
}

module.exports={createCreditGuard,isCreditError,mensagemSemIA,INTERVALO};
