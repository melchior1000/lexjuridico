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
    req.setTimeout?.(timeoutMs,()=>req.destroy(new Error('timeout')));
    req.on('error',reject);req.end(body);
  });
}
async function sendTelegram(id,text,{env=process.env,transport=https}={}){
  const token=String(env.TELEGRAM_TOKEN||'').trim(),chatId=String(id||'').trim();
  if(!token||!/^\d{1,20}$/.test(chatId)) return false;
  try{
    const url=new URL('https://api.telegram.org/bot'+token+'/sendMessage');
    const r=await postJson(url,{chat_id:chatId,text:String(text||'').slice(0,4000)},{},transport);
    return r.status>=200&&r.status<300&&r.body?.ok===true&&Number.isSafeInteger(r.body?.result?.message_id);
  }catch{return false;}
}
async function sendWhatsApp(id,text,{env=process.env,transport=https,sleepFn}={}){
  const numero=String(id||'').replace(/\D/g,'');
  if(!/^55\d{10,11}$/.test(numero)) return false;
  const cfg=evolutionConfig(env);if(!cfg.url||!cfg.key||!cfg.instance)return false;
  try{
    const getJson=(url,options={})=>requestJson(url,{...options,transport});
    const ready=await waitForEvolutionOpen({url:cfg.url,key:cfg.key,instance:cfg.instance,request:getJson,sleepFn});
    if(!ready.ok)return false;
    const expected=String(env.LEX_WHATSAPP_NUMBER||'').trim();
    if(expected){
      const status=await whatsappStatus({url:cfg.url,key:cfg.key,instance:cfg.instance,number:expected,enabled:true},getJson);
      if(status.conectado!==true)return false;
    }
    const url=safeEvolutionEndpoint(cfg.url,'message/sendText/'+encodeURIComponent(cfg.instance));
    // Nao repetir POST apos timeout ambiguo: pode ter sido aceito pelo provedor.
    const r=await postJson(url,{number:numero,text:String(text||'').slice(0,4000)},{apikey:cfg.key},transport,30000);
    return r.status>=200&&r.status<300&&!!(r.body?.key?.id&&!r.body?.error);
  }catch{return false;}
}
async function sendChannel({origem,id,texto},{env=process.env,transport=https}={}){
  const channel=String(origem||'').toLowerCase();
  if(channel==='telegram') return sendTelegram(id,texto,{env,transport});
  if(channel==='whatsapp') return sendWhatsApp(id,texto,{env,transport});
  return false;
}
module.exports={sendChannel,sendTelegram,sendWhatsApp,safeEvolutionEndpoint,postJson};
