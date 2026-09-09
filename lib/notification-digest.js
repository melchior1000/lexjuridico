'use strict';
const crypto=require('node:crypto');
const flow=require('./workflow');
function digestItems(processes, now=new Date()) {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(now);
  const items=[];
  for(const p of processes) {
    if(flow.CLOSED.has(String(p.status).toUpperCase())) continue;
    const due=flow.date(p.prazoReal||p.prazo);
    const days=due?Math.round((Date.parse(due)-Date.parse(today))/86400000):null;
    const ref=flow.date(String(p.atualizado_em||p.ultima_atualizacao||'').slice(0,10));
    const stale=ref?Math.round((Date.parse(today)-Date.parse(ref))/86400000):null;
    const reasons=[];
    if(days!==null && days<=5) reasons.push(days<0?'prazo vencido há '+(-days)+'d':days===0?'prazo hoje':'prazo em '+days+'d');
    if(String(p.status).toUpperCase()==='URGENTE') reasons.push('urgente');
    if(stale!==null && stale>=10) reasons.push('sem atualização há '+stale+'d');
    if(flow.sector(p)==='autuacao') reasons.push(p.docsFaltantes?'documentos pendentes':'em preparação');
    if(!reasons.length) continue;
    items.push({id:String(p.id),rank:days==null?999:days,text:(p.nome||p.numero||p.id)+' — '+reasons.join('; ')+(p.proxacao?' · '+p.proxacao:'')});
  }
  return items.sort((a,b)=>a.rank-b.rank || a.id.localeCompare(b.id));
}
function formatDigest(items, events=[], max=3600) {
  const lines=['LEX · Resumo do escritório','']; let omitted=0;
  const unique=[...new Set([...items.map(i=>i.text),...events.map(e=>String(e.text||e.msg||''))].filter(Boolean))];
  for(const text of unique) {
    const line='• '+text.replace(/\s+/g,' ').slice(0,450);
    if(lines.join('\n').length+line.length>max-180) { omitted++; continue; }
    lines.push(line);
  }
  if(omitted) lines.push('Mais '+omitted+' itens na Central de trabalho.');
  lines.push('','Pronto para suas ordens. Informe o processo e a tarefa.');
  return lines.join('\n');
}
class NotificationDigest {
  constructor(store, send) {this.store=store;this.send=send;}
  async enqueue(text, recipient, thread=null) {
    if(!recipient) return {enfileirado:false};
    const key=crypto.createHash('sha256').update(String(recipient)+'|'+String(thread)+'|'+text).digest('hex');
    await this.store.change('lex_notifications',state=>{
      state ||= {events:[]};
      if(!state.events.some(e=>e.id===key)) state.events.push({id:key,text:String(text).slice(0,2500),recipient:String(recipient),thread,at:new Date().toISOString()});
      if(state.events.length>1000) throw new Error('Fila de avisos cheia. Confira a central antes de novos avisos.');
      return state;
    });
    return {enfileirado:true};
  }
  async flush(recipient, processes, {force=false, now=new Date()}={}) {
    if(!recipient) return {enviado:false};
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(now);
    const key='lex_digest:'+String(recipient)+':'+day;
    let acquired=false;
    const items=digestItems(processes,now);
    const queue=(await this.store.read('lex_notifications'))?.value||{events:[]};
    const events=queue.events.filter(e=>e.recipient===String(recipient));
    if(!items.length&&!events.length) return {enviado:false,vazio:true};
    await this.store.change(key,prior=>{
      acquired=false;
      if(prior) return undefined; // inclusive resultado incerto: não repetir após reinício
      acquired=true;
      return {status:'enviando',at:now.toISOString(),ids:events.map(e=>e.id)};
    });
    if(!acquired) return {enviado:false,ja_processado:true};
    let confirmed=false;
    try { confirmed=await this.send(formatDigest(items,events),null,recipient)===true; }
    catch { confirmed=false; }
    await this.store.change(key,prior=>({...prior,status:confirmed?'enviado':'envio_incerto',updated:new Date().toISOString()}));
    if(confirmed) {
      const sent=new Set(events.map(e=>e.id));
      await this.store.change('lex_notifications',state=>({...state,events:(state?.events||[]).filter(e=>!sent.has(e.id))}));
    }
    return {enviado:confirmed,incerto:!confirmed};
  }
}
module.exports={digestItems,formatDigest,NotificationDigest};
