'use strict';

function messageText(data){
  const m=data?.message||{};
  return String(m.conversation||m.extendedTextMessage?.text||'').trim();
}
function isTextOnly(data){
  const m=data?.message||{};
  return !!messageText(data) && !m.audioMessage && !m.imageMessage && !m.videoMessage && !m.documentMessage;
}
function combineBodies(bodies){
  if(!Array.isArray(bodies)||!bodies.length) return null;
  if(bodies.length===1) return bodies[0];
  const base=structuredClone(bodies[bodies.length-1]);
  const rows=bodies.map(b=>messageText(b?.data||b)).filter(Boolean);
  const data=base.data||base;
  data.message={conversation:rows.join(' | ')};
  if(data.key) data.key={...data.key,id:String(data.key.id||'turno')+'-turno-'+bodies.length};
  return base;
}
function createReceptionTurnBuffer({dispatch,delayMs=1200,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  if(typeof dispatch!=='function') throw new Error('dispatch obrigatório');
  const pending=new Map();
  const running=new Map();
  const serial=(key,body,instance)=>{
    const task=(running.get(key)||Promise.resolve()).catch(()=>{}).then(()=>dispatch(body,instance));
    running.set(key,task);
    task.finally(()=>{if(running.get(key)===task) running.delete(key);}).catch(()=>{});
    return task;
  };
  const flush=async key=>{
    const item=pending.get(key); if(!item) return false;
    pending.delete(key); clearTimer(item.timer);
    return serial(key,combineBodies(item.bodies),item.instance);
  };
  const enqueue=(body,instance)=>{
    const data=body?.data||body||{};
    const jid=String(data.key?.remoteJid||'');
    const key=String(instance||'')+'|'+jid;
    if(!jid) return Promise.resolve(false);
    if(!isTextOnly(data)) {
      // A mídia não pode ultrapassar o texto pendente do mesmo contato.
      const before=pending.has(key)?flush(key):Promise.resolve();
      return before.then(()=>serial(key,body,instance));
    }
    const prior=pending.get(key);
    if(prior) clearTimer(prior.timer);
    const bodies=prior?[...prior.bodies,body]:[body];
    const timer=setTimer(()=>{flush(key).catch(()=>{});},delayMs);
    pending.set(key,{bodies,instance,timer});
    return Promise.resolve(true);
  };
  return {enqueue,flush,pendingCount:()=>pending.size,combineBodies};
}
module.exports={createReceptionTurnBuffer,combineBodies,isTextOnly};
