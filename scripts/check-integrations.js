'use strict';

// Consulta de preparacao: nao inicia bot, timers, IA, pareamento ou envios.
const {brazilMobile,whatsappStatus,telegramStatus} = require('../lib/integration-status');
const env = process.env;
const evo = require('../lib/evolution-config').evolutionConfig(env);
async function main() {
  let number = null;
  try { number = brazilMobile(env.LEX_WHATSAPP_NUMBER); }
  catch { console.error('LEX_WHATSAPP_NUMBER invalido'); process.exitCode=1; return; }
  const config = {
    whatsapp:{numero_configurado:!!number,api_configurada:!!evo.url,
      chave_configurada:!!evo.key,instancia_configurada:!!evo.instance},
    telegram:{token_configurado:!!env.TELEGRAM_TOKEN,admin_configurado:!!(env.TELEGRAM_ADMIN||env.TELEGRAM_ADMIN_CHAT_ID)},
    agentes:{anthropic_configurada:!!env.ANTHROPIC_KEY,banco_configurado:!!(env.SUPABASE_URL&&env.SUPABASE_KEY),
      homologacao:'pendente',pje_executor_local:'nao_verificado'}
  };
  if(process.argv.includes('--live')) {
    const [whatsapp,telegram]=await Promise.all([
      whatsappStatus({url:evo.url,key:evo.key,instance:evo.instance,number}),
      telegramStatus({token:env.TELEGRAM_TOKEN,admin:env.TELEGRAM_ADMIN||env.TELEGRAM_ADMIN_CHAT_ID})
    ]);
    config.verificacao={whatsapp,telegram};
    if(!whatsapp.conectado||!telegram.conectado) process.exitCode=1;
  }
  console.log(JSON.stringify(config,null,2));
}
main().catch(()=>{console.error('Nao foi possivel verificar as integracoes');process.exitCode=1;});
