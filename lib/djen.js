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
function buildUrl({base=process.env.DJEN_BASE||DEFAULT_BASE,numeroOab,ufOab,nomeAdvogado,inicio,fim,pagina=1,itensPorPagina=50}){
  const u=new URL(String(base).replace(/\/$/,'')+'/comunicacao');
  // Por OAB (número + UF) ou, como segunda rede, pelo nome do advogado (nomeAdvogado).
  if(nomeAdvogado)u.searchParams.set('nomeAdvogado',String(nomeAdvogado).trim());
  else{u.searchParams.set('numeroOab',numeroOab);u.searchParams.set('ufOab',String(ufOab||'').toUpperCase());}
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
      // Sem "count" na resposta, o total é desconhecido (null): a leitura segue pelo tamanho da
      // página. Antes virava o tamanho da 1ª página, e a leitura parava nela.
      const informado=body.count==null||String(body.count).trim()===''?NaN:Number(body.count);
      return{count:Number.isFinite(informado)&&informado>=0?informado:null,items,audit:{endpoint:url.toString(),request_id:res.headers?.get?.('x-request-id')||crypto.randomUUID(),requested_at:requestedAt,responded_at:respondedAt,status_code:res.status,raw_receipt:raw}};
    }catch(e){last=e;if(attempt<retries&&(!e.status||RETRYABLE.has(e.status))){await sleep(750*Math.pow(2,attempt));continue}throw e}
    finally{clearTimeout(timer)}
  }
  throw last||new Error('DJEN indisponível.');
}
// Lê todas as páginas de UMA busca (uma variante de OAB, ou um nome). Falha FECHADA sem jogar nada
// fora: se o DJEN informa N comunicações (count) e entrega menos — página vazia, página repetida,
// corte por limite —, o que chegou é devolvido (são intimações reais) e a busca vai para
// `incompletas`: quem lê não dá o dia por lido e tenta de novo. A página continua enquanto o count
// disser que há mais, seja qual for o tamanho de página que o DJEN usar.
async function lerBusca(params,rotulo,ctx){
  const {janela,deps,vistos,items,audits,itemAudits,extra}=ctx;
  const maxItems=Number(deps.maxItems||5000),maxPages=Number(deps.maxPages||100);
  // linhas: linhas entregues pelo DJEN que entram na conta do count (inclusive uma comunicação que
  // apareça duas vezes na lista); página cheia sem nada novo é a mesma página devolvida de novo.
  const vistosBusca=new Set();let declarado=null,linhas=0,cortado=false,paginaAnterior=null;
  for(let page=1;page<=maxPages;page++){
    if(items.length>=maxItems){cortado=true;break}
    if(ctx.pages&&deps.interRequestDelayMs!==0)await sleep(Number(deps.interRequestDelayMs||650));
    const r=await pagina({...params,inicio:janela.inicio,fim:janela.fim,pagina:page,itensPorPagina:50,base:deps.base},deps);
    const audit={...r.audit,...extra,pagina:page};
    ctx.pages++;audits.push(audit);
    if(page===1)declarado=r.count;
    if(!r.items.length)break;
    let novosNaPagina=0,lidasNaPagina=0;
    const chaves=r.items.map(itemKey),assinatura=chaves.join('\n');
    for(const item of r.items){
      if(items.length>=maxItems){cortado=true;break}
      lidasNaPagina++;
      const key=itemKey(item);
      if(!vistosBusca.has(key)){vistosBusca.add(key);novosNaPagina++}
      if(vistos.has(key))continue;
      vistos.add(key);itemAudits[key]=audit;
      items.push({...item,textoSeguro:sanitizeText(item.texto)});
    }
    // A mesma página de novo (idêntica à anterior, ou cheia sem nada novo): o DJEN não avançou.
    // O count decide, abaixo, se ficou faltando.
    if(!novosNaPagina&&(assinatura===paginaAnterior||r.items.length>=50))break;
    paginaAnterior=assinatura;
    linhas+=lidasNaPagina;
    if(cortado)break;
    if(declarado>0?linhas>=declarado:r.items.length<50)break;
    if(page===maxPages)cortado=true;
  }
  const faltou=declarado>0?linhas<declarado:cortado;
  if(faltou)ctx.incompletas.push({busca:rotulo,informadas:declarado,recebidas:vistosBusca.size,
    erro:'DJEN: leitura incompleta para '+rotulo+' ('+(declarado>0?declarado:'?')+' informada(s), '+vistosBusca.size+' recebida(s)). O que chegou foi guardado; o dia não foi dado como lido e a leitura será repetida.'});
}
function novoContexto(janela,deps,extra){return{janela,deps,vistos:new Set(),items:[],audits:[],itemAudits:{},pages:0,incompletas:[],extra}}
function resultado(ctx){return{items:ctx.items,pagesConsulted:ctx.pages,audits:ctx.audits,itemAudits:ctx.itemAudits,janela:ctx.janela,incompletas:ctx.incompletas}}
async function porOab(numeroOab,ufOab,janela=ontemHoje(),deps={}){
  const ctx=novoContexto(janela,deps);
  for(const variant of oabVariants(numeroOab)){
    ctx.extra={numero_oab:variant,uf_oab:String(ufOab).toUpperCase()};
    await lerBusca({numeroOab:variant,ufOab},'a OAB '+variant+'/'+String(ufOab).toUpperCase(),ctx);
  }
  return resultado(ctx);
}
// Segunda rede (como fazem AASP e Projuris): busca pelo nome do advogado, para pegar publicação em
// que a OAB veio faltando ou errada. O que vier só por aqui é marcado para conferência (homônimo).
async function porNome(nome,janela=ontemHoje(),deps={}){
  const n=String(nome||'').replace(/\s+/g,' ').trim();
  if(n.length<8||!/\s/.test(n))throw new Error('Nome do advogado incompleto para a busca no DJEN (use nome e sobrenome).');
  const ctx=novoContexto(janela,deps,{nome_advogado:n});
  await lerBusca({nomeAdvogado:n},'o nome "'+n+'"',ctx);
  return resultado(ctx);
}
// Advogados intimados que o DJEN lista em cada comunicação (destinatarioadvogados).
function advogadosDoItem(item={}){
  const lista=Array.isArray(item.destinatarioadvogados)?item.destinatarioadvogados:Array.isArray(item.destinatarioAdvogados)?item.destinatarioAdvogados:[];
  return lista.map(x=>x?.advogado||x).filter(a=>a&&typeof a==='object').map(a=>({nome:String(a.nome||'').trim(),oab:String(a.numero_oab??a.numeroOab??'').replace(/\D/g,''),uf:String(a.uf_oab??a.ufOab??'').toUpperCase()}));
}
module.exports={DEFAULT_BASE,SUFIXOS,ymdBrasil,addDaysYmd,ontemHoje,normalizeOab,oabVariants,itemKey,sanitizeText,buildUrl,pagina,porOab,porNome,advogadosDoItem};
