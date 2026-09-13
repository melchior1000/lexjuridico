'use strict';
const {requestJson,evolutionEndpoint}=require('./integration-status');

async function pairing({url,key,instance,webhookSecret,publicUrl},request=requestJson){
  if(!url||!key||!instance)throw new Error('Evolution não configurada no servidor.');
  if(!webhookSecret)throw new Error('Configure WHATSAPP_WEBHOOK_SECRET no servidor antes de vincular.');
  const callback=new URL('/api/webhook-whatsapp',publicUrl);
  if(callback.protocol!=='https:'||callback.username||callback.password)throw new Error('URL pública do LEX inválida.');
  const headers={apikey:key};
  await request(evolutionEndpoint(url,'webhook/set/'+encodeURIComponent(instance)),{
    method:'POST',headers,data:{webhook:{enabled:true,url:callback.toString(),headers:{'x-webhook-secret':webhookSecret},
      byEvents:false,base64:true,events:['MESSAGES_UPSERT']}}
  });
  const result=await request(evolutionEndpoint(url,'instance/connect/'+encodeURIComponent(instance)),{headers,timeoutMs:25000});
  const qr=result?.base64||result?.qrcode?.base64;
  // Retorna apenas a imagem necessária ao pareamento; nunca credenciais do provedor.
  if(typeof qr==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(qr)&&qr.length<500000){
    return {ok:true,estado:'aguardando_pareamento',qr,expira_em:new Date(Date.now()+120000).toISOString()};
  }
  return {ok:true,estado:'qr_ainda_indisponivel',qr:null};
}
module.exports={pairing};
