'use strict';
const {requestJson,evolutionEndpoint}=require('./integration-status');

const QR_PNG=/^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
function qrValido(result){
  const qr=result?.base64||result?.qrcode?.base64;
  return typeof qr==='string'&&QR_PNG.test(qr)&&qr.length<500000?qr:null;
}
function esperar(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

async function configureWebhook({url,key,instance,webhookSecret,publicUrl},request=requestJson){
  if(!url||!key||!instance)throw new Error('Evolution não configurada no servidor.');
  if(!webhookSecret)throw new Error('Configure WHATSAPP_WEBHOOK_SECRET no servidor antes de vincular.');
  const callback=new URL('/api/webhook-whatsapp',publicUrl);
  if(callback.protocol!=='https:'||callback.username||callback.password)throw new Error('URL pública do LEX inválida.');
  await request(evolutionEndpoint(url,'webhook/set/'+encodeURIComponent(instance)),{
    method:'POST',headers:{apikey:key},data:{webhook:{enabled:true,url:callback.toString(),headers:{'x-webhook-secret':webhookSecret},
      byEvents:false,base64:true,events:['MESSAGES_UPSERT']}}
  });
  return true;
}

async function pairing(config,request=requestJson){
  const {url,key,instance}=config;
  await configureWebhook(config,request);
  const headers={apikey:key};
  const connectUrl=evolutionEndpoint(url,'instance/connect/'+encodeURIComponent(instance));
  let result=await request(connectUrl,{headers,timeoutMs:25000});
  let qr=qrValido(result);
  for(let tentativa=0;!qr&&tentativa<2;tentativa++){
    await esperar(1500);
    result=await request(connectUrl,{headers,timeoutMs:10000});
    qr=qrValido(result);
  }
  // Retorna apenas a imagem necessária ao pareamento; nunca credenciais do provedor.
  if(qr){
    return {ok:true,estado:'aguardando_pareamento',qr,expira_em:new Date(Date.now()+120000).toISOString()};
  }
  return {ok:true,estado:'qr_ainda_indisponivel',qr:null};
}
module.exports={pairing,configureWebhook};
