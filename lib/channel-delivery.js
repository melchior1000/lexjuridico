'use strict';
const https=require('node:https');
const {evolutionConfig}=require('./evolution-config');
const {whatsappStatus,requestJson,waitForEvolutionOpen}=require('./integration-status');

function safeEvolutionEndpoint(base,suffix){
  const url=new URL(base);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash) throw new Error('EVOLUTION_URL inválida.');
  url.pathname=url.pathname.replace(/\/+$/,'')+'/'+suffix;
  return url;
}
function postJson(url,data,headers={},transport=https,timeoutMs=15000){
  return new Promise((resolve,reject)=>{
    const body=Buffer.from(JSON.stringify(data));
    const req=transport.request(url,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':body.length,...headers}},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{
        let parsed={};try{parsed=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{}
        resolve({status:res.statusCode||0,body:parsed});
      });
    });
    req.setTimeout?.(timeoutMs,()=>req.destroy(new Error('Tempo de resposta da Evolution excedido.')));
    req.on('error',reject);req.end(body);
  });
}
function errorText(error){
  return String(error?.message||error||'Falha de rede').replace(/[\r\n]+/g,' ').slice(0,400);
}
async function sendTelegramDetailed(id,text,{env=process.env,transport=https,logger=()=>{}}={}){
  const token=String(env.TELEGRAM_TOKEN||'').trim(),chatId=String(id||'').trim();
  if(!token)return{ok:false,state:'nao_configurado',error:'Telegram não configurado no servidor.'};
  if(!/^\d{1,20}$/.test(chatId))return{ok:false,state:'destinatario_invalido',error:'ID do Telegram inválido.'};
  const started=Date.now();
  try{
    logger('telegram_post_inicio',{chat_id:chatId});
    const url=new URL('https://api.telegram.org/bot'+token+'/sendMessage');
    const r=await postJson(url,{chat_id:chatId,text:String(text||'').slice(0,4000)},{},transport,30000);
    const providerId=r.body?.result?.message_id;
    const ok=r.status>=200&&r.status<300&&r.body?.ok===true&&Number.isSafeInteger(providerId);
    logger(ok?'telegram_post_ok':'telegram_post_falhou',{ms:Date.now()-started,http_status:r.status});
    return ok?{ok:true,state:'confirmado',provider_id:String(providerId),ms:Date.now()-started}
      :{ok:false,state:'provedor_recusou',error:'Telegram respondeu HTTP '+r.status+'.',ms:Date.now()-started};
  }catch(error){
    logger('telegram_post_falhou',{ms:Date.now()-started,error:errorText(error)});
    return{ok:false,state:'falha_rede',error:errorText(error),ms:Date.now()-started};
  }
}
async function sendWhatsAppDetailed(id,text,{env=process.env,transport=https,sleepFn,logger=()=>{}}={}){
  const numero=String(id||'').replace(/\D/g,'');
  if(!/^55\d{10,11}$/.test(numero))return{ok:false,state:'destinatario_invalido',error:'Número de WhatsApp inválido.'};
  const cfg=evolutionConfig(env);
  if(!cfg.url||!cfg.key||!cfg.instance)return{ok:false,state:'nao_configurado',error:'Evolution API não configurada no servidor.'};
  const totalStart=Date.now();
  const getJson=async(address,options={})=>{
    const t=Date.now(),path=new URL(address).pathname;
    logger('evolution_http_inicio',{path});
    try{
      const out=await requestJson(address,{...options,transport});
      logger('evolution_http_ok',{path,ms:Date.now()-t});
      return out;
    }catch(error){
      logger('evolution_http_falhou',{path,ms:Date.now()-t,error:errorText(error),status:error?.status||null});
      throw error;
    }
  };
  try{
    const wakeStart=Date.now();
    logger('evolution_preflight_inicio',{instance:cfg.instance});
    const ready=await waitForEvolutionOpen({url:cfg.url,key:cfg.key,instance:cfg.instance,request:getJson,sleepFn});
    const wakeMs=Date.now()-wakeStart;
    logger('evolution_preflight_fim',{instance:cfg.instance,estado:ready.estado,tentativas:ready.tentativas,ms:wakeMs});
    if(!ready.ok)return{ok:false,state:ready.estado||'indisponivel',error:'Evolution indisponível: '+String(ready.estado||'estado não confirmado')+'.',wake_ms:wakeMs,ms:Date.now()-totalStart};

    const expected=String(env.LEX_WHATSAPP_NUMBER||'').trim();
    let identityMs=0;
    if(expected){
      const identityStart=Date.now();
      logger('evolution_identidade_inicio',{instance:cfg.instance});
      const status=await whatsappStatus({url:cfg.url,key:cfg.key,instance:cfg.instance,number:expected,enabled:true},getJson);
      identityMs=Date.now()-identityStart;
      logger('evolution_identidade_fim',{estado:status.estado,conectado:status.conectado===true,ms:identityMs});
      if(status.conectado!==true)return{ok:false,state:status.estado||'identidade_nao_confirmada',error:'Linha do WhatsApp não confirmada: '+String(status.estado||'estado desconhecido')+'.',wake_ms:wakeMs,identity_ms:identityMs,ms:Date.now()-totalStart};
    }

    const sendStart=Date.now();
    logger('evolution_send_inicio',{instance:cfg.instance,numero});
    const url=safeEvolutionEndpoint(cfg.url,'message/sendText/'+encodeURIComponent(cfg.instance));
    // POST deliberadamente único. Se a conexão cair depois do aceite, não repetimos
    // automaticamente: o resultado pode ser ambíguo e duplicar mensagem.
    const r=await postJson(url,{number:numero,text:String(text||'').slice(0,4000)},{apikey:cfg.key},transport,30000);
    const sendMs=Date.now()-sendStart,providerId=r.body?.key?.id;
    const ok=r.status>=200&&r.status<300&&!!(providerId&&!r.body?.error);
    logger(ok?'evolution_send_ok':'evolution_send_falhou',{http_status:r.status,provider_id:providerId||null,ms:sendMs});
    return ok
      ?{ok:true,state:'confirmado',provider_id:String(providerId),wake_ms:wakeMs,identity_ms:identityMs,send_ms:sendMs,ms:Date.now()-totalStart}
      :{ok:false,state:'provedor_recusou',error:'Evolution respondeu HTTP '+r.status+' sem confirmar a mensagem.',wake_ms:wakeMs,identity_ms:identityMs,send_ms:sendMs,ms:Date.now()-totalStart};
  }catch(error){
    logger('evolution_send_falhou',{ms:Date.now()-totalStart,error:errorText(error)});
    return{ok:false,state:'falha_rede',error:errorText(error),ms:Date.now()-totalStart};
  }
}
async function sendTelegram(id,text,options={}){return (await sendTelegramDetailed(id,text,options)).ok===true}
async function sendWhatsApp(id,text,options={}){return (await sendWhatsAppDetailed(id,text,options)).ok===true}
async function sendChannelDetailed({origem,id,texto},options={}){
  const channel=String(origem||'').toLowerCase();
  if(channel==='telegram')return sendTelegramDetailed(id,texto,options);
  if(channel==='whatsapp')return sendWhatsAppDetailed(id,texto,options);
  return{ok:false,state:'canal_invalido',error:'Canal de envio inválido.'};
}
async function sendChannel(input,options={}){return (await sendChannelDetailed(input,options)).ok===true}

module.exports={
  sendChannel,sendChannelDetailed,sendTelegram,sendTelegramDetailed,sendWhatsApp,sendWhatsAppDetailed,
  safeEvolutionEndpoint,postJson
};
