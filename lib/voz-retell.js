'use strict';
// =====================================================================
// PLATAFORMA DE VOZ — RETELL (adaptador)
// ---------------------------------------------------------------------
// A plataforma ouve e fala; o LEX é quem sabe o cliente, o processo e o objetivo
// (lib/voz-ligacoes.js). Este arquivo só traduz o pedido do LEX para a plataforma
// e o aviso dela de volta. Trocar de plataforma = escrever outro adaptador com as
// mesmas quatro funções: configurado, criarLigacao, verificarAssinatura, interpretarEvento.
//
// Contrato conferido na documentação oficial da Retell em 21/11/2026:
// - POST https://api.retellai.com/v2/create-phone-call com Authorization: Bearer <chave>;
//   from_number/to_number em E.164; override_agent_id; metadata; retell_llm_dynamic_variables;
//   idempotency_key (a mesma chave por até 1 h não cria outra ligação);
// - aviso (webhook) com X-Retell-Signature "v=<ms>,d=<hex>": HMAC-SHA256 do corpo cru
//   seguido do <ms>, com a chave da conta que tem o selo de webhook; recusar fora de 5 min;
// - eventos call_started, call_ended e call_analyzed; call_ended traz transcrição e motivo do
//   fim; call_analyzed traz call_analysis. Repetição até 3 vezes: o LEX deduplica.
// Números comprados na própria Retell só ligam para os EUA: para o Brasil, o número é
// importado (tronco SIP de operadora) — ver docs/LIGACOES_POR_VOZ.md.
//
// Variáveis: RETELL_API_KEY, RETELL_AGENT_ID, LEX_VOZ_NUMERO (+55...), RETELL_WEBHOOK_KEY (opcional).
// =====================================================================
const crypto=require('node:crypto');

const API='https://api.retellai.com';
const JANELA_ASSINATURA_MS=5*60*1000;
const E164_BR=/^\+55\d{10,11}$/;

const texto=v=>String(v==null?'':v).trim();

function erroLegivel(status,corpo){
  const msg=texto(corpo?.error_message||corpo?.message||corpo?.error||'').slice(0,200);
  if(status===401||status===403)return'a plataforma de voz recusou a chave (confira RETELL_API_KEY)';
  if(status===402)return'a conta da plataforma de voz está sem saldo/crédito';
  if(status===404)return'agente ou número não encontrado na plataforma de voz (confira RETELL_AGENT_ID e LEX_VOZ_NUMERO)';
  if(status===422||status===400)return'a plataforma de voz recusou o pedido'+(msg?': '+msg:'');
  if(status===429)return'a plataforma de voz pediu para esperar (muitas ligações seguidas)';
  return'a plataforma de voz respondeu com erro '+status+(msg?': '+msg:'');
}

function createRetellProvider({env=process.env,fetchImpl=globalThis.fetch,now=()=>Date.now(),timeoutMs=15000}={}){
  const chave=()=>texto(env.RETELL_API_KEY);
  const agente=()=>texto(env.RETELL_AGENT_ID);
  const origem=()=>texto(env.LEX_VOZ_NUMERO);
  const chaveAviso=()=>texto(env.RETELL_WEBHOOK_KEY)||chave();

  function configurado(){return !!(chave()&&agente()&&E164_BR.test(origem()))}

  async function criarLigacao({para,metadata={},variaveis={},chave:idem}={}){
    if(!configurado())return{ok:false,erro:'as ligações por voz não estão configuradas neste servidor'};
    if(!E164_BR.test(texto(para)))return{ok:false,erro:'número de destino fora do formato +55 com DDD'};
    const corpo={from_number:origem(),to_number:texto(para),override_agent_id:agente(),metadata,
      retell_llm_dynamic_variables:Object.fromEntries(Object.entries(variaveis).map(([k,v])=>[k,String(v==null?'':v)])),
      ...(idem?{idempotency_key:String(idem).replace(/[^A-Za-z0-9_-]/g,'').slice(0,255)}:{})};
    let r;
    try{
      r=await fetchImpl(API+'/v2/create-phone-call',{method:'POST',
        headers:{Authorization:'Bearer '+chave(),'Content-Type':'application/json'},body:JSON.stringify(corpo),
        ...(typeof AbortSignal!=='undefined'&&AbortSignal.timeout?{signal:AbortSignal.timeout(timeoutMs)}:{})});
    }catch(e){
      // Sem resposta, não dá para saber se a ligação saiu: quem chamou não repete às cegas.
      return{ok:false,incerto:true,erro:'sem resposta da plataforma de voz ('+texto(e?.name==='TimeoutError'?'tempo esgotado':e?.message||e).slice(0,120)+')'};
    }
    let j={};try{const t=await r.text();j=t?JSON.parse(t):{}}catch{j={}}
    if(r.status>=200&&r.status<300&&texto(j.call_id))return{ok:true,call_id:texto(j.call_id),status:texto(j.call_status)||'registered'};
    return{ok:false,http:r.status,erro:erroLegivel(r.status,j)};
  }

  function verificarAssinatura(corpoCru,cabecalho){
    const k=chaveAviso();if(!k)return false;
    const m=String(cabecalho||'').match(/^v=(\d+),d=([0-9a-f]+)$/i);if(!m)return false;
    const ms=Number(m[1]);
    if(!Number.isSafeInteger(ms)||Math.abs(now()-ms)>JANELA_ASSINATURA_MS)return false;
    const esperado=crypto.createHmac('sha256',k).update(String(corpoCru)+m[1]).digest('hex');
    const a=Buffer.from(esperado,'hex'),b=Buffer.from(m[2].toLowerCase(),'hex');
    return a.length===b.length&&crypto.timingSafeEqual(a,b);
  }

  function interpretarEvento(ev){
    if(!ev||typeof ev!=='object'||!ev.call||typeof ev.call!=='object')return null;
    const c=ev.call;
    const evento={call_started:'iniciada',call_ended:'encerrada',call_analyzed:'analisada'}[ev.event]||'outro';
    const ini=Number(c.start_timestamp),fim=Number(c.end_timestamp);
    const motivo=texto(c.disconnection_reason)||null;
    const caixaPostal=motivo==='voicemail_reached'||c.call_analysis?.in_voicemail===true;
    const naoConectou=c.call_status==='not_connected'||c.call_status==='error'||/^dial_|^invalid_destination|^telephony_/.test(motivo||'');
    return{evento,call_id:texto(c.call_id),ligacao_id:texto(c.metadata?.ligacao_id)||null,status:texto(c.call_status)||null,
      duracao_s:Number.isFinite(ini)&&Number.isFinite(fim)&&fim>ini?Math.round((fim-ini)/1000):0,motivo,
      atendeu:!naoConectou&&!caixaPostal,caixa_postal:caixaPostal,
      transcricao:typeof c.transcript==='string'?c.transcript:null,gravacao_url:texto(c.recording_url)||null,
      resumo_provedor:texto(c.call_analysis?.call_summary)||null};
  }

  // Reconciliação: aviso perdido (servidor reiniciando, plataforma desistiu depois de 3 tentativas)
  // não deixa a ligação sem resultado — o LEX pergunta à plataforma (GET /v2/get-call/{id}).
  async function consultarLigacao(callId){
    if(!chave()||!/^[A-Za-z0-9_-]{1,120}$/.test(texto(callId)))return null;
    let r;
    try{r=await fetchImpl(API+'/v2/get-call/'+encodeURIComponent(texto(callId)),{method:'GET',headers:{Authorization:'Bearer '+chave()},
      ...(typeof AbortSignal!=='undefined'&&AbortSignal.timeout?{signal:AbortSignal.timeout(timeoutMs)}:{})})}catch{return null}
    if(r.status<200||r.status>=300)return null;
    let c=null;try{c=JSON.parse(await r.text())}catch{return null}
    if(!c||typeof c!=='object')return null;
    const terminou=['ended','not_connected','error'].includes(c.call_status);
    const ev=interpretarEvento({event:terminou?'call_ended':'call_started',call:c});
    return ev?{...ev,evento:terminou?'encerrada':'em_curso'}:null;
  }

  return{nome:'retell',configurado,criarLigacao,verificarAssinatura,interpretarEvento,consultarLigacao};
}

module.exports={createRetellProvider,E164_BR};
