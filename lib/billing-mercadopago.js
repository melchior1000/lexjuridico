'use strict';
// =====================================================================
// ADAPTADOR MERCADO PAGO — assinatura da licença do LEX por escritório
// ---------------------------------------------------------------------
// Cobrança do ESCRITÓRIO pelo software. Nunca se mistura com honorários,
// cliente de processo ou valores de causa. Toda lógica específica do
// Mercado Pago fica aqui; o resto do LEX só fala com lib/license-policy.js.
//
// Fluxo: assinar() cria uma assinatura (preapproval) com external_reference =
// escritorio_id e devolve o link de pagamento → o Mercado Pago chama o webhook
// → validamos a assinatura HMAC do cabeçalho x-signature → buscamos o recurso na
// API (nunca confiamos no corpo do webhook) → o evento vira transição de licença
// do escritório indicado no external_reference, e só dele. Idempotência por id
// do evento persistido; evento antigo não rebaixa estado mais novo.
//
// Referência (confirmar na documentação oficial ao homologar):
//   POST https://api.mercadopago.com/preapproval   (assinaturas sem plano)
//   GET  https://api.mercadopago.com/preapproval/{id}
//   GET  https://api.mercadopago.com/v1/payments/{id}
//   Webhook: cabeçalhos x-signature ("ts=...,v1=...") e x-request-id;
//   manifesto HMAC-SHA256: "id:{data.id};request-id:{x-request-id};ts:{ts};"
// =====================================================================
const crypto=require('node:crypto');
const Policy=require('./license-policy');

const API='https://api.mercadopago.com';
const EVENT_PREFIX='lex_mp_evento_';
const LINK_PREFIX='lex_mp_vinculo_';
const MAX_SKEW_SECONDS=15*60;

function timingEqual(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)}

// Valida o cabeçalho x-signature do webhook (HMAC-SHA256 do manifesto com o segredo).
function verifySignature({signatureHeader,requestId,dataId,secret,now=Date.now()}){
  if(!secret)return{ok:false,reason:'MERCADOPAGO_WEBHOOK_SECRET não configurado'};
  const parts=Object.fromEntries(String(signatureHeader||'').split(',').map(p=>p.trim().split('=')).filter(x=>x.length===2));
  const ts=parts.ts,v1=parts.v1;
  if(!ts||!v1)return{ok:false,reason:'x-signature ausente ou malformado'};
  if(!/^\d+$/.test(ts))return{ok:false,reason:'ts inválido'};
  const skew=Math.abs(Math.floor(now/1000)-Number(ts));
  if(skew>MAX_SKEW_SECONDS)return{ok:false,reason:'assinatura fora da janela de tempo ('+skew+'s)'};
  const id=String(dataId||'');
  const idNorm=/^[a-z0-9]+$/i.test(id)&&/[a-z]/i.test(id)?id.toLowerCase():id;
  const manifest='id:'+idNorm+';request-id:'+String(requestId||'')+';ts:'+ts+';';
  const expected=crypto.createHmac('sha256',secret).update(manifest).digest('hex');
  return timingEqual(expected,v1)?{ok:true}:{ok:false,reason:'assinatura não confere'};
}

// Mapeamento provedor → licença (o "porquê" fica registrado no histórico).
function mapPayment(status){
  switch(String(status||'').toLowerCase()){
    case 'approved':case 'accredited':return{to:'active',motivo:'pagamento aprovado'};
    case 'pending':case 'in_process':case 'authorized':return null; // sem mudança
    case 'rejected':case 'cancelled':return{to:'past_due',motivo:'pagamento recusado/cancelado'};
    case 'refunded':case 'charged_back':return{to:'past_due',motivo:'pagamento estornado'};
    default:return null;
  }
}
function mapPreapproval(status){
  switch(String(status||'').toLowerCase()){
    case 'authorized':return{to:'active',motivo:'assinatura autorizada'};
    case 'paused':return{to:'past_due',motivo:'assinatura pausada pelo provedor'};
    case 'cancelled':return{to:'canceled',motivo:'assinatura cancelada'};
    case 'pending':return null;
    default:return null;
  }
}

function createMercadoPagoBilling({records,policy,env=process.env,fetchImpl=globalThis.fetch,now=()=>new Date(),log=()=>{}}={}){
  if(!records?.read||!records?.change)throw new Error('Cobrança sem repositório.');
  const pol=policy||Policy.createLicensePolicy({records,env,now});
  const token=()=>String(env.MERCADOPAGO_ACCESS_TOKEN||'').trim();
  const secret=()=>String(env.MERCADOPAGO_WEBHOOK_SECRET||'').trim();
  const configured=()=>!!token();

  async function api(path,init={}){
    if(!token())throw Object.assign(new Error('MERCADOPAGO_ACCESS_TOKEN não configurado'),{status:503});
    const r=await fetchImpl(API+path,{...init,headers:{'Authorization':'Bearer '+token(),'Content-Type':'application/json',...(init.headers||{})}});
    const text=await r.text();let body=null;try{body=text?JSON.parse(text):null}catch{body={raw:text.slice(0,300)}}
    if(!r.ok)throw Object.assign(new Error('Mercado Pago respondeu HTTP '+r.status+(body?.message?': '+body.message:'')),{status:502,provider_status:r.status});
    return body;
  }

  // Cria a assinatura do escritório e devolve o link (init_point). external_reference = escritorio_id.
  async function assinar({escritorioId,email,valor,descricao,backUrl,frequency=1,frequencyType='months'}){
    if(!escritorioId)throw Object.assign(new Error('escritorio_id obrigatório'),{status:422});
    const amount=Number(valor);if(!Number.isFinite(amount)||amount<=0)throw Object.assign(new Error('valor da assinatura inválido'),{status:422});
    const payload={reason:descricao||'Licença LEX Jurídico',external_reference:String(escritorioId),payer_email:email||undefined,back_url:backUrl||undefined,
      auto_recurring:{frequency,frequency_type:frequencyType,transaction_amount:amount,currency_id:'BRL'},status:'pending'};
    const out=await api('/preapproval',{method:'POST',body:JSON.stringify(payload)});
    await records.change(LINK_PREFIX+String(escritorioId),old=>({...(old||{}),escritorio_id:String(escritorioId),preapproval_id:out.id||null,init_point:out.init_point||null,criado_em:new Date(now()).toISOString(),status_provedor:out.status||null}));
    return{ok:true,preapproval_id:out.id||null,link:out.init_point||out.sandbox_init_point||null,status:out.status||null};
  }

  // Processa um webhook. Devolve {ok, aplicado, motivo}. Nunca lança por dado do provedor.
  async function webhook({headers={},body={},rawDataId}={}){
    const type=String(body?.type||body?.topic||'').toLowerCase();
    const dataId=String(rawDataId||body?.data?.id||body?.id||'');
    const sig=verifySignature({signatureHeader:headers['x-signature'],requestId:headers['x-request-id'],dataId,secret:secret(),now:now().getTime()});
    if(!sig.ok)return{ok:false,status:401,motivo:sig.reason};
    if(!dataId)return{ok:false,status:400,motivo:'evento sem data.id'};
    const eventId=(type||'evento')+':'+dataId+':'+String(body?.action||'');
    // Idempotência persistida: o mesmo evento nunca é aplicado duas vezes.
    let duplicate=false;
    await records.change(EVENT_PREFIX+crypto.createHash('sha256').update(eventId).digest('hex').slice(0,32),old=>{if(old){duplicate=true;return undefined}return{event_id:eventId,recebido_em:new Date(now()).toISOString(),tipo:type}});
    if(duplicate)return{ok:true,aplicado:false,motivo:'evento repetido (idempotente)'};
    // Nunca confiamos no corpo: buscamos o recurso na API.
    let resource,mapped,provedorRef;
    try{
      if(type==='payment'){resource=await api('/v1/payments/'+encodeURIComponent(dataId));mapped=mapPayment(resource?.status);provedorRef={payment_id:resource?.id,preapproval_id:resource?.metadata?.preapproval_id||null};}
      else if(type==='subscription_preapproval'||type==='preapproval'){resource=await api('/preapproval/'+encodeURIComponent(dataId));mapped=mapPreapproval(resource?.status);provedorRef={preapproval_id:resource?.id};}
      else return{ok:true,aplicado:false,motivo:'tipo de evento ignorado: '+(type||'?')};
    }catch(e){log('[MercadoPago] não consegui ler o recurso '+dataId+': '+e.message);return{ok:false,status:502,motivo:'não consegui confirmar o evento na API do provedor'};}
    const escritorioId=String(resource?.external_reference||'').trim();
    // Evento sem tenant válido nunca cria nem escolhe escritório.
    if(!escritorioId)return{ok:true,aplicado:false,motivo:'evento sem external_reference (escritório): ignorado'};
    const link=(await records.read(LINK_PREFIX+escritorioId))?.value||null;
    if(link?.preapproval_id&&provedorRef?.preapproval_id&&String(link.preapproval_id)!==String(provedorRef.preapproval_id))return{ok:true,aplicado:false,motivo:'assinatura do evento não é a vinculada a este escritório: ignorado'};
    if(!mapped)return{ok:true,aplicado:false,motivo:'estado do provedor sem efeito na licença: '+String(resource?.status||'?')};
    // Fora de ordem: um evento mais antigo que a última atualização não rebaixa o estado.
    const eventAt=Date.parse(resource?.date_last_updated||resource?.last_modified||resource?.date_approved||resource?.date_created||'');
    const lic=await pol.get(escritorioId);
    if(lic?.ultimo_evento_em&&Number.isFinite(eventAt)&&eventAt<Date.parse(lic.ultimo_evento_em)&&mapped.to!=='active'&&lic.status==='active')return{ok:true,aplicado:false,motivo:'evento mais antigo que o último aplicado: ignorado'};
    await pol.apply(escritorioId,mapped.to,mapped.motivo+' (mercadopago '+type+' '+dataId+')',{provedor:'mercadopago',provedor_ref:provedorRef,ultimo_evento:eventId,ultimo_evento_em:Number.isFinite(eventAt)?new Date(eventAt).toISOString():new Date(now()).toISOString()});
    return{ok:true,aplicado:true,escritorio_id:escritorioId,para:mapped.to,motivo:mapped.motivo};
  }

  // Reconciliação: quando o estado local está ambíguo, pergunta ao provedor.
  async function reconciliar(escritorioId){
    const link=(await records.read(LINK_PREFIX+String(escritorioId)))?.value||null;
    if(!link?.preapproval_id)return{ok:false,motivo:'escritório sem assinatura vinculada'};
    const r=await api('/preapproval/'+encodeURIComponent(link.preapproval_id));
    const mapped=mapPreapproval(r?.status);
    if(!mapped)return{ok:true,aplicado:false,status_provedor:r?.status||null};
    await pol.apply(String(escritorioId),mapped.to,'reconciliação: '+mapped.motivo,{provedor:'mercadopago',provedor_ref:{preapproval_id:r.id},ultimo_evento_em:new Date(now()).toISOString()});
    return{ok:true,aplicado:true,para:mapped.to,status_provedor:r.status};
  }

  return{configured,assinar,webhook,reconciliar,policy:pol,verifySignature};
}

module.exports={createMercadoPagoBilling,verifySignature,mapPayment,mapPreapproval,EVENT_PREFIX,LINK_PREFIX};
