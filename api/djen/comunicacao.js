'use strict';

const UPSTREAM='https://comunicaapi.pje.jus.br/api/v1';
const RETRYABLE=new Set([429,500,502,503,504]);
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function safeInt(value,fallback,min,max){const n=Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback}
function authOk(req){
  const expected=String(process.env.DJEN_GATEWAY_KEY||'');
  const supplied=String(req.headers['x-api-key']||req.headers['authorization']||'').replace(/^Bearer\s+/i,'');
  if(!expected||!supplied||expected.length!==supplied.length)return false;
  return require('node:crypto').timingSafeEqual(Buffer.from(expected),Buffer.from(supplied));
}
module.exports=async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'})}
  if(!process.env.DJEN_GATEWAY_KEY)return res.status(503).json({ok:false,error:'DJEN_GATEWAY_NOT_CONFIGURED'});
  if(!authOk(req))return res.status(401).json({ok:false,error:'UNAUTHORIZED'});
  const q=req.query||{},numeroOab=String(q.numeroOab||'').trim(),ufOab=String(q.ufOab||'').trim().toUpperCase();
  const inicio=String(q.dataDisponibilizacaoInicio||'').trim(),fim=String(q.dataDisponibilizacaoFim||'').trim();
  if(!/^\d+[A-Z-]*$/.test(numeroOab)||!/^[A-Z]{2}$/.test(ufOab)||!/^\d{4}-\d{2}-\d{2}$/.test(inicio)||!/^\d{4}-\d{2}-\d{2}$/.test(fim)){
    return res.status(400).json({ok:false,error:'BAD_REQUEST'});
  }
  const pagina=safeInt(q.pagina,1,1,1000),itensPorPagina=safeInt(q.itensPorPagina,50,1,50);
  const url=new URL(UPSTREAM+'/comunicacao');
  for(const [k,v] of Object.entries({numeroOab,ufOab,dataDisponibilizacaoInicio:inicio,dataDisponibilizacaoFim:fim,pagina,itensPorPagina}))url.searchParams.set(k,String(v));
  let last;
  for(let attempt=0;attempt<3;attempt++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const upstream=await fetch(url,{headers:{Accept:'application/json, text/plain, */*','User-Agent':'LEX-DJEN-Gateway/1.0'},signal:controller.signal});
      const text=await upstream.text();
      if(RETRYABLE.has(upstream.status)&&attempt<2){await sleep(750*Math.pow(2,attempt));continue}
      if(!upstream.ok)return res.status(502).json({ok:false,error:'DJEN_UPSTREAM_ERROR',upstreamStatus:upstream.status});
      let body;try{body=JSON.parse(text)}catch{return res.status(502).json({ok:false,error:'DJEN_NON_JSON'})}
      res.setHeader('Cache-Control','no-store');
      res.setHeader('X-LEX-DJEN-Region','gru1');
      return res.status(200).json(body);
    }catch(error){last=error;if(attempt<2){await sleep(750*Math.pow(2,attempt));continue}}
    finally{clearTimeout(timer)}
  }
  return res.status(502).json({ok:false,error:'DJEN_GATEWAY_UNAVAILABLE',message:last?.name==='AbortError'?'timeout':'upstream unavailable'});
};
