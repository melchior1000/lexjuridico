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
// Só a recusa típica do provedor liga o modo sem IA (não qualquer texto com "billing").
const FRASE_PROVEDOR=/credit balance is too low|exceeded your current quota|\binsufficient_quota\b/i;
const TIPOS=new Set(['insufficient_quota']);

function isCreditError(e){
  if(!e)return false;
  if(TIPOS.has(String(e.type||e.code||'').toLowerCase()))return true;
  return FRASE_PROVEDOR.test(String(e.message||e||''));
}

function mensagemSemIA(env=process.env){
  // Pausa pelo teto de gasto do mês (lib/ai-budget.js) é diferente de falta de crédito.
  const teto=env.LEX_AI_SEM_IA_MOTIVO==='teto';
  return [
    teto
      ?'A IA do LEX está pausada: o escritório atingiu o teto de gasto de IA deste mês. Não consigo conversar livremente nem redigir peças até o próximo mês ou até o teto subir — e não vou fingir que fiz.'
      :'A IA do LEX está sem crédito agora. Não consigo conversar livremente nem redigir peças até a recarga — e não vou fingir que fiz.',
    'Sem IA eu continuo fazendo:',
    '• "prazos da semana" ou "prazos de hoje"',
    '• "tem intimação nova?" (Diário/DJEN)',
    '• "como está o processo <nome ou número>"',
    '• "resumo do dia"',
    '• "veja o que precisa de mim"',
    teto?'Quando a IA puder voltar eu aviso e retomo sozinho.':'Quando o crédito voltar eu aviso e retomo sozinho.'
  ].join('\n');
}

function createCreditGuard({env=process.env,probe=null,notify=()=>{},log=()=>{},intervalMs=INTERVALO,setIntervalImpl=setInterval}={}){
  let automatico=false,desde=null,sondando=false,timer=null,geracao=0;
  const ligado=()=>env.LEX_AI_NO_CREDIT==='1';

  function registrarErro(e){
    if(!isCreditError(e))return false;
    geracao++; // recusa nova durante um teste invalida o resultado do teste
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
    const g=geracao;
    try{
      await probe();
      if(g!==geracao)return{ok:false,reason:'recusa_nova_durante_teste'};
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
