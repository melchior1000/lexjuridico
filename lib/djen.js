'use strict';
const crypto=require('node:crypto');

const DEFAULT_BASE='https://comunicaapi.pje.jus.br/api/v1';
const SUFIXOS=Object.freeze(['','-O','-A','-N','-B','-S','-E']);
const RETRYABLE=new Set([429,500,502,503,504]);

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function ymdBrasil(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(date)}
function addDaysYmd(ymd,delta){const [y,m,d]=ymd.split('-').map(Number),x=new Date(Date.UTC(y,m-1,d+delta,12));return x.toISOString().slice(0,10)}
function ontemHoje(now=new Date()){const fim=ymdBrasil(now);return{inicio:addDaysYmd(fim,-1),fim}}
function normalizeOab(value){const m=String(value||'').trim().toUpperCase().match(/^(\d+)\s*-?([A-Z])?$/);if(!m)throw new Error('OAB inválida.');return{digits:m[1],suffix:m[2]||''}}
function oabVariants(value){const {digits}=normalizeOab(value);return SUFIXOS.map(s=>digits+s)}
function itemKey(item={}){const id=item.id??item.hash;if(id!=null&&String(id).trim())return String(id);return crypto.createHash('sha256').update([item.numeroProcesso||item.numero_processo||'',item.dataDisponibilizacao||item.data_disponibilizacao||'',item.texto||''].join('|')).digest('hex')}
function sanitizeText(input){return String(input||'').replace(/<\s*(script|style|iframe|object|embed|svg|math|form|base)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function buildUrl({base=process.env.DJEN_BASE||DEFAULT_BASE,numeroOab,ufOab,inicio,fim,pagina=1,itensPorPagina=50}){
  const u=new URL(String(base).replace(/\/$/,'')+'/comunicacao');
  u.searchParams.set('numeroOab',numeroOab);u.searchParams.set('ufOab',String(ufOab||'').toUpperCase());
  u.searchParams.set('dataDisponibilizacaoInicio',inicio);u.searchParams.set('dataDisponibilizacaoFim',fim);
  u.searchParams.set('pagina',String(Math.max(1,pagina)));u.searchParams.set('itensPorPagina',String(Math.min(50,Math.max(1,itensPorPagina))));
  return u;
}
async function pagina(args={},deps={}){
  const fetchImpl=deps.fetchImpl||globalThis.fetch;if(typeof fetchImpl!=='function')throw new Error('Cliente HTTP DJEN indisponível.');
  const timeoutMs=Number.isFinite(deps.timeoutMs)?deps.timeoutMs:20000,retries=Number.isInteger(deps.retries)?deps.retries:2;
  const url=buildUrl(args),headers={Accept:'application/json, text/plain, */*','User-Agent':'LEX-DJEN/1.0'};
  if(deps.gatewayKey||process.env.DJEN_GATEWAY_KEY)headers['x-api-key']=deps.gatewayKey||process.env.DJEN_GATEWAY_KEY;
  let last;
  for(let attempt=0;attempt<=retries;attempt++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),requestedAt=new Date().toISOString();
    try{
      const res=await fetchImpl(url,{headers,signal:controller.signal}),raw=await res.text(),respondedAt=new Date().toISOString();
      if(RETRYABLE.has(res.status)&&attempt<retries){clearTimeout(timer);await sleep(750*Math.pow(2,attempt));continue}
      if(res.status===403)throw Object.assign(new Error('DJEN 403: use gateway em região brasileira (gru1).'),{status:403});
      if(!res.ok)throw Object.assign(new Error('DJEN HTTP '+res.status),{status:res.status});
      let body;try{body=JSON.parse(raw)}catch{throw new Error('DJEN retornou resposta não JSON.')}
      const items=Array.isArray(body.items)?body.items.filter(x=>x&&typeof x==='object'):[];
      return{count:Number(body.count)||items.length,items,audit:{endpoint:url.toString(),request_id:res.headers?.get?.('x-request-id')||crypto.randomUUID(),requested_at:requestedAt,responded_at:respondedAt,status_code:res.status,raw_receipt:raw}};
    }catch(e){last=e;if(attempt<retries&&(!e.status||RETRYABLE.has(e.status))){await sleep(750*Math.pow(2,attempt));continue}throw e}
    finally{clearTimeout(timer)}
  }
  throw last||new Error('DJEN indisponível.');
}
async function porOab(numeroOab,ufOab,janela=ontemHoje(),deps={}){
  const vistos=new Set(),items=[],audits=[],itemAudits={};let pages=0;
  const maxItems=Number(deps.maxItems||5000),maxPages=Number(deps.maxPages||100);
  for(const variant of oabVariants(numeroOab)){
    const vistosVariante=new Set();let variantUnique=0;
    for(let page=1;page<=maxPages&&items.length<maxItems;page++){
      if(pages&&deps.interRequestDelayMs!==0)await sleep(Number(deps.interRequestDelayMs||650));
      const r=await pagina({numeroOab:variant,ufOab,inicio:janela.inicio,fim:janela.fim,pagina:page,itensPorPagina:50,base:deps.base},deps);
      const audit={...r.audit,numero_oab:variant,uf_oab:String(ufOab).toUpperCase(),pagina:page};
      pages++;audits.push(audit);
      if(!r.items.length)break;
      for(const item of r.items){
        const key=itemKey(item);
        if(!vistosVariante.has(key)){vistosVariante.add(key);variantUnique++}
        if(vistos.has(key))continue;
        vistos.add(key);itemAudits[key]=audit;
        items.push({...item,textoSeguro:sanitizeText(item.texto)});
        if(items.length>=maxItems)break;
      }
      if(r.items.length<50||(r.count>0&&variantUnique>=r.count))break;
    }
  }
  return{items,pagesConsulted:pages,audits,itemAudits,janela};
}
module.exports={DEFAULT_BASE,SUFIXOS,ymdBrasil,ontemHoje,normalizeOab,oabVariants,itemKey,sanitizeText,buildUrl,pagina,porOab};
