'use strict';

const https = require('node:https');
const {timingSafeEqual} = require('node:crypto');
const {createReceptionStore} = require('./whatsapp-reception-store');
const {transcribeAudio,audioPayloadFromEvolution} = require('./audio-transcription');
const {createReceptionTurnBuffer} = require('./reception-turn-buffer');
const {normalizeOwnerDeskCommand,normalizeOwnerNamedReply} = require('./owner-desk');

const {intakeDecision} = require('./intake-door');
const receptionStore = createReceptionStore();
const operatorReplyTargets = new Map();
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
  setTimeout(() => receptionStore.healthcheck().then(result => {
    console.log('[WhatsApp Recepcao] persistencia Supabase:', result.ok ? 'ok' : 'indisponivel');
  }).catch(() => console.warn('[WhatsApp Recepcao] persistencia Supabase: indisponivel')), 500);
}

function brazilMobile(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!/^[+\d\s().-]+$/.test(raw)) throw new Error('Numero do WhatsApp invalido');
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11) digits = '55' + digits;
  if (!/^55[1-9]\d9\d{8}$/.test(digits)) throw new Error('Informe celular brasileiro com DDD');
  return digits;
}

function sameBrazilWhatsappNumber(ownerDigits, expected) {
  if (typeof ownerDigits !== 'string' || typeof expected !== 'string') return false;
  if (ownerDigits === expected) return true;
  if (!/^55[1-9]\d9\d{8}$/.test(expected)) return false;
  const expectedWithoutNinth = expected.slice(0, 4) + expected.slice(5);
  return ownerDigits === expectedWithoutNinth;
}

function whatsappDigitsFromJid(jid) {
  const m = String(jid || '').match(/^(\d+)(?::\d+)?@s\.whatsapp\.net$/);
  return m ? m[1] : null;
}

function whatsappLid(jid) {
  const value=String(jid||'');
  return /^\d+@lid$/.test(value)?value:null;
}

function whatsappIdentity(data) {
  const key=data?.key||data||{};
  const remoteJid=String(key.remoteJid||'');
  const remoteJidAlt=String(key.remoteJidAlt||'');
  const digits=whatsappDigitsFromJid(remoteJid)||whatsappDigitsFromJid(remoteJidAlt);
  const lid=whatsappLid(remoteJid)||whatsappLid(remoteJidAlt);
  return {digits,lid,replyTarget:lid||digits,remoteJid,remoteJidAlt};
}

function whatsappAccessMode(remoteJid, operatorValue, remoteJidAlt = '') {
  if (!operatorValue) return 'public';
  let expected;
  try { expected = brazilMobile(operatorValue); }
  catch { return 'public'; }
  const sender = whatsappDigitsFromJid(remoteJid) || whatsappDigitsFromJid(remoteJidAlt);
  if (!sender) return 'public';
  return sameBrazilWhatsappNumber(sender, expected) ? 'operator' : 'public';
}

function _rememberOperatorReplyTarget(operator,address){
  if(operator&&address?.lid) operatorReplyTargets.set(operator,address.lid);
}
function _operatorReplyTarget(operator){return operatorReplyTargets.get(operator)||operator;}

function whatsappMessageText(data) {
  const m = data?.message || {};
  return String(m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || '').trim();
}

function publicWhatsappDecision(text, data = {}, history = []) {
  return intakeDecision(text, data, history);
}

function publicWhatsappReply(text, data) { return publicWhatsappDecision(text, data).reply; }

function requestJson(address, {headers = {}, method = 'GET', data, rawBody, timeoutMs = 15000, transport = https} = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(address);
    if (url.protocol !== 'https:' || url.username || url.password) return reject(new Error('A integracao exige URL HTTPS sem credenciais embutidas'));
    if (rawBody !== undefined && (!Buffer.isBuffer(rawBody) || data !== undefined)) return reject(new Error('Corpo binario invalido ou ambiguo'));
    const body = rawBody !== undefined ? rawBody : data === undefined ? null : JSON.stringify(data);
    const req = transport.request(url, {method, headers:{...headers,...(data===undefined?{}:{'Content-Type':'application/json'}),...(body===null?{}:{'Content-Length':Buffer.byteLength(body)})}}, res => {
      const chunks=[]; let size=0;
      res.on('error',()=>reject(new Error('Resposta interrompida pelo provedor')));
      res.on('aborted',()=>reject(new Error('Resposta interrompida pelo provedor')));
      res.on('data',chunk=>{size+=Buffer.byteLength(chunk);if(size>1024*1024){req.destroy();reject(new Error('Resposta do provedor excedeu o limite'));return;}chunks.push(Buffer.from(chunk));});
      res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300){const error=new Error('Provedor respondeu HTTP '+res.statusCode);error.status=res.statusCode;reject(error);return;}try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new Error('Resposta JSON invalida do provedor'));}});
    });
    req.on('error',()=>reject(new Error('Falha de rede da integracao')));
    req.setTimeout(timeoutMs,()=>{reject(new Error('Tempo de resposta da integracao excedido'));req.destroy();});
    if(body!==null) req.write(body); req.end();
  });
}

function evolutionEndpoint(base, suffix) {
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('EVOLUTION_URL deve ser HTTPS sem credenciais ou parametros');
  url.pathname = url.pathname.replace(/\/+$/, '') + '/' + suffix;
  return url.toString();
}

const EVOLUTION_WAKE_DELAYS_MS=[0,3000,7000,12000,18000];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function waitForEvolutionOpen({url,key,instance,request=requestJson,delaysMs=EVOLUTION_WAKE_DELAYS_MS,sleepFn=sleep,timeoutMs=15000}={}){
  if(!url||!key||!instance)return {ok:false,estado:'nao_configurado',tentativas:0};
  let lastState='indisponivel',lastStatus=null;
  for(let i=0;i<delaysMs.length;i++){
    if(delaysMs[i]>0)await sleepFn(delaysMs[i]);
    try{
      const response=await request(evolutionEndpoint(url,'instance/connectionState/'+encodeURIComponent(instance)),{headers:{apikey:key},timeoutMs});
      if(response?.instance?.instanceName!==instance)return {ok:false,estado:'instancia_nao_confirmada',tentativas:i+1};
      lastState=String(response?.instance?.state||'desconhecido');
      if(lastState==='open')return {ok:true,estado:'open',tentativas:i+1};
      if(!['connecting','close','closed','desconhecido'].includes(lastState))return {ok:false,estado:lastState,tentativas:i+1};
    }catch(error){
      lastStatus=Number.isInteger(error?.status)?error.status:null;
      if([401,403].includes(lastStatus))return {ok:false,estado:'falha_autenticacao',status:lastStatus,tentativas:i+1};
      if(lastStatus===404)return {ok:false,estado:'instancia_ausente',status:lastStatus,tentativas:i+1};
      if(lastStatus&&lastStatus<500&&![408,425,429].includes(lastStatus))return {ok:false,estado:'falha_na_verificacao',status:lastStatus,tentativas:i+1};
      lastState='acordando';
    }
  }
  return {ok:false,estado:lastState,status:lastStatus,tentativas:delaysMs.length};
}

async function _sendEvolutionText(number, text, instance, {url, key, request = requestJson, sleepFn, preflight} = {}) {
  if (!number || !text || !instance || !url || !key) return false;
  // Requests injetados sao usados por testes/adaptadores isolados e podem representar
  // diretamente o provedor; no caminho real (requestJson) o preflight e obrigatorio.
  const shouldPreflight=preflight===undefined?request===requestJson:preflight===true;
  if(shouldPreflight){
    const ready=await waitForEvolutionOpen({url,key,instance,request,sleepFn});
    if(!ready.ok){
      console.warn(`[WhatsApp Evolution] indisponivel antes do envio estado=${ready.estado} tentativas=${ready.tentativas}`);
      return false;
    }
  }
  try {
    // POST e deliberadamente unico: repetir apos timeout ambiguo pode duplicar mensagem.
    const result=await request(evolutionEndpoint(url,'message/sendText/'+encodeURIComponent(instance)),{method:'POST',headers:{apikey:key},timeoutMs:30000,data:{number:String(number),text:String(text).substring(0,4000)}});
    return !!(result?.key?.id && !result.error);
  } catch (error) {
    const status=Number.isInteger(error?.status)?error.status:'rede';
    const destino=String(number).endsWith('@lid')?'lid':'telefone';
    console.warn(`[WhatsApp Evolution] sendText falhou status=${status} destino=${destino}; POST nao sera repetido automaticamente`);
    return false;
  }
}

function _listReceptionText(rows) {
  if (!rows.length) return 'Recepção: ninguém aguardando retorno.';
  return 'Recepção — aguardando você:\n'+rows.map((x,i)=>`${i+1}. ${x.urgente?'🔴 ':''}${x.nome} (${x.numero}) — ${x.classe} — ${String(x.ultima_mensagem||'').substring(0,120)}`).join('\n')+'\n\nUse /historico NUMERO para ver a conversa, /responder NUMERO mensagem ou /arquivar NUMERO.';
}

function _historyText(rows,target) {
  if(!rows.length) return `Histórico ${target}: nenhum evento registrado.`;
  return `Histórico ${target} — mais recentes primeiro:\n`+rows.map(x=>{const when=x.criado_em?new Date(x.criado_em).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'--';const who=x.direcao==='entrada'?'Contato':x.direcao==='saida_operador'?'Você':'LEX';return `${when} · ${who}: ${String(x.texto||'').replace(/[\r\n]+/g,' ').substring(0,240)}`;}).join('\n');
}

async function handleWhatsappOperatorCommand(body, instance, options = {}) {
  const data=body?.data||body||{};
  const rawText=whatsappMessageText(data);
  const naturalCommand=normalizeOwnerDeskCommand(rawText);
  const text=/^\//.test(rawText)?rawText:(naturalCommand||rawText);
  const operatorValue=options.operator||process.env.LEX_OPERATOR_WHATSAPP||''; let operator;
  try{operator=brazilMobile(operatorValue);}catch{operator=null;}
  const address=whatsappIdentity(data);
  if(!operator||whatsappAccessMode(data.key?.remoteJid,operator,data.key?.remoteJidAlt)!=='operator'||data.key?.fromMe!==false||!text) return false;
  _rememberOperatorReplyTarget(operator,address);
  const operatorTarget=address.lid||_operatorReplyTarget(operator);
  const cfg=options.url&&options.key?{url:options.url,key:options.key}:require('./evolution-config').evolutionConfig();
  const request=options.request||requestJson; const store=options.store||receptionStore;
  const namedReply=normalizeOwnerNamedReply(rawText);
  if(namedReply){
    const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
    const wanted=norm(namedReply.nome);
    const matches=[];
    const pageSize=100;
    let cursor='0';
    let scanComplete=true;
    for(;;){
      const rows=await store.list({status:'aguardando_advogado',limit:pageSize,afterNumero:cursor});
      for(const row of rows){
        const name=norm(row.nome);
        if(name===wanted||name.startsWith(wanted+' ')) matches.push(row);
        if(matches.length>1) break;
      }
      if(matches.length>1||rows.length<pageSize) break;
      const nextCursor=String(rows[rows.length-1]?.numero||'').replace(/\D/g,'');
      if(!nextCursor||nextCursor===cursor){scanComplete=false;break;}
      cursor=nextCursor;
    }
    if(!scanComplete){
      await _sendEvolutionText(operatorTarget,'Não consegui confirmar com segurança se esse nome é único na fila. Use o número para eu não mandar para a pessoa errada.',instance,{url:cfg.url,key:cfg.key,request});
      return true;
    }
    if(matches.length!==1){
      const detail=matches.length===0?'Não encontrei esse contato na fila.':'Encontrei mais de um contato com esse nome.';
      await _sendEvolutionText(operatorTarget,detail+' Use o número para eu não mandar para a pessoa errada.',instance,{url:cfg.url,key:cfg.key,request});
      return true;
    }
    const target=matches[0].numero;
    let replyText=namedReply.instrucao
      .replace(/\bhj\b/gi,'hoje')
      .replace(/\bfalo com ela\b/gi,'falo com você')
      .replace(/\bfalo com ele\b/gi,'falo com você')
      .trim();
    if(replyText.length>4000){
      await _sendEvolutionText(operatorTarget,'Texto acima de 4000 caracteres. Nada foi enviado.',instance,{url:cfg.url,key:cfg.key,request});
      return true;
    }
    const ok=await _sendEvolutionText(target,replyText,instance,{url:cfg.url,key:cfg.key,request});
    if(ok&&typeof store.appendEvent==='function') await store.appendEvent({numero:target,nome:matches[0].nome||'Contato',direcao:'saida_operador',texto:replyText,classe:matches[0].classe||'geral',nivel:'atencao'});
    await _sendEvolutionText(operatorTarget,ok?`Resposta enviada para ${matches[0].nome} (${target}): ${replyText}`:`Não consegui confirmar o envio para ${matches[0].nome} (${target}).`,instance,{url:cfg.url,key:cfg.key,request});
    return true;
  }
  if(/^\/ajuda\s*$/i.test(text)){await _sendEvolutionText(operatorTarget,'Comandos privados do LEX:\n/recepcao — contatos aguardando\n/historico NUMERO — últimas mensagens do contato\n/responder NUMERO mensagem — responder pelo WhatsApp do escritório\n/arquivar NUMERO — retirar da fila\n\nVocê também pode escrever: oi, mesa, resumo, responder NUMERO mensagem ou resolver NUMERO.',instance,{url:cfg.url,key:cfg.key,request});return true;}
  if(/^\/recepcao\s*$/i.test(text)){const rows=await store.list({status:'aguardando_advogado',limit:10});await _sendEvolutionText(operatorTarget,_listReceptionText(rows),instance,{url:cfg.url,key:cfg.key,request});return true;}
  const historyMatch=text.match(/^\/historico\s+(\+?[\d\s().-]+)\s*$/i);
  if(historyMatch){let target;try{target=brazilMobile(historyMatch[1]);}catch{target=null;}if(!target){await _sendEvolutionText(operatorTarget,'Número inválido. Use: /historico 5561999999999',instance,{url:cfg.url,key:cfg.key,request});return true;}const rows=typeof store.history==='function'?await store.history(target,{limit:15}):[];await _sendEvolutionText(operatorTarget,_historyText(rows,target),instance,{url:cfg.url,key:cfg.key,request});return true;}
  const replyMatch=text.match(/^\/responder\s+(\+?[\d\s().-]+)\s+([\s\S]+)$/i);
  if(replyMatch){let target;try{target=brazilMobile(replyMatch[1]);}catch{target=null;}if(!target){await _sendEvolutionText(operatorTarget,'Número inválido. Use: /responder 5561999999999 sua mensagem',instance,{url:cfg.url,key:cfg.key,request});return true;}const replyText=replyMatch[2].trim();if(replyText.length>4000){await _sendEvolutionText(operatorTarget,'Texto acima de 4000 caracteres. Divida a resposta; nada foi enviado.',instance,{url:cfg.url,key:cfg.key,request});return true;}const ok=await _sendEvolutionText(target,replyText,instance,{url:cfg.url,key:cfg.key,request});if(ok&&typeof store.appendEvent==='function') await store.appendEvent({numero:target,nome:'Contato',direcao:'saida_operador',texto:replyText,classe:'geral',nivel:'atencao'});await _sendEvolutionText(operatorTarget,ok?`Resposta enviada para ${target}.`:`Não consegui confirmar o envio para ${target}.`,instance,{url:cfg.url,key:cfg.key,request});return true;}
  const archiveMatch=text.match(/^\/arquivar\s+(\+?[\d\s().-]+)\s*$/i);
  if(archiveMatch){let target;try{target=brazilMobile(archiveMatch[1]);}catch{target=null;}const archived=target?await store.archive(target):false;await _sendEvolutionText(operatorTarget,archived?`Contato ${target} arquivado.`:'Contato não encontrado na fila.',instance,{url:cfg.url,key:cfg.key,request});return true;}
  return false;
}

async function publicWhatsappReception(body, instance, options = {}) {
  const data=body?.data||body||{};
  const address=whatsappIdentity(data);
  const sender=address.digits;
  const replyTarget=address.replyTarget||sender;
  const operatorValue=options.operator||process.env.LEX_OPERATOR_WHATSAPP||''; let operator;
  try{operator=brazilMobile(operatorValue);}catch{operator=null;}
  if(data.key?.fromMe!==false||!sender||!operator||sameBrazilWhatsappNumber(sender,operator)) return false;
  const cfg=options.url&&options.key?{url:options.url,key:options.key}:require('./evolution-config').evolutionConfig();
  const request=options.request||requestJson; const store=options.store||receptionStore;
  const name=String(data.pushName||'Contato').replace(/[\r\n]+/g,' ').substring(0,80);
  let text=whatsappMessageText(data); let original=text; let decisionData=data; let audioFailure=null;
  const audio=audioPayloadFromEvolution(data);
  if(!text && audio){
    if(!audio.buffer){audioFailure='conteudo_indisponivel';}
    else {
      const transcriber=options.transcribe||transcribeAudio;
      const tr=await transcriber(audio.buffer,{mimeType:audio.mimeType,filename:audio.filename,apiKey:options.openaiKey||process.env.OPENAI_API_KEY});
      if(tr?.ok&&String(tr.texto||'').trim()){
        text=String(tr.texto).trim(); original='[Áudio transcrito] '+text;
        decisionData={...data,message:{...data.message,audioMessage:undefined}};
      } else audioFailure=tr?.erro||'falha_transcricao';
    }
  }
  let decision;
  if(audioFailure){
    original='[Áudio não transcrito: '+audioFailure+']';
    decision={kind:'audio_unread',escalate:true,archive:false,reply:'Recebi seu áudio, mas não consegui ouvi-lo com segurança. Pode reenviar o áudio ou escrever a mensagem em texto?'};
  } else {
    if(!original) original='[mídia ou arquivo sem texto]';
    let history=[];
    if(typeof store.history==='function'){try{history=await store.history(sender,{limit:40});}catch{history=[];}}
    decision=publicWhatsappDecision(text,decisionData,history);
  }
  console.log('[Recepcao] canal=whatsapp entrada='+String(data.key?.id||'').slice(0,100)+' destino='+(decision.destino||'recepcao')+' tipo='+decision.kind+' autorizacao='+!!decision.requiresApproval);
  const contactName=decision.name||name;
  const item=await store.upsert(sender,contactName,original);
  const safeOriginal=original.replace(/[\r\n]+/g,' ').substring(0,500);
  const level=audioFailure?'atencao':item.urgente||decision.kind==='urgent'?'urgente':decision.escalate?'atencao':'ciencia';
  if(typeof store.appendEvent==='function') await store.appendEvent({numero:sender,nome:name,direcao:'entrada',texto:original,classe:item.classe||'geral',nivel:level});
  const marker=level==='urgente'?'[URGENTE]':level==='atencao'?'[ATENÇÃO]':'[CIÊNCIA]';
  const reason=decision.kind==='existing_case'?'possível processo existente':decision.kind==='lawyer'?'pediu advogado':decision.kind==='sensitive'?'tema sensível':decision.kind==='administrative'?'administrativo':decision.kind==='new_case'?'caso novo':decision.kind==='media'?'arquivo recebido':decision.kind==='audio_unread'?'áudio não compreendido':decision.kind;
  const summary=`${marker} ${contactName} (${sender}) — ${reason} — setor sugerido: ${decision.destino||'recepcao'}: ${safeOriginal}${decision.requiresApproval?'\n[AGUARDA SUA DECISÃO] Para autorizar uma resposta, use /responder '+sender+' TEXTO EXATO.':''}`;
  const operatorTarget=_operatorReplyTarget(operator);
  if(level==='urgente') await _sendEvolutionText(operatorTarget,summary,instance,{url:cfg.url,key:cfg.key,request});
  const replied=await _sendEvolutionText(replyTarget,decision.reply,instance,{url:cfg.url,key:cfg.key,request});
  if(replied && typeof store.appendEvent==='function') await store.appendEvent({numero:sender,nome:contactName,direcao:'saida_lex',texto:decision.reply,classe:item.classe||'geral',nivel:level});
  const outcome=replied?'[LEX] respondeu: '+decision.reply:'[FALHA DE ENVIO] A resposta de recepção não foi confirmada.';
  const reported=await _sendEvolutionText(operatorTarget,(level==='urgente'?'Contato '+contactName+' ('+sender+')':summary)+'\n'+outcome,instance,{url:cfg.url,key:cfg.key,request});
  if(!reported) console.warn('[Recepcao] resumo ao dono nao confirmado; atendimento permanece na fila');
  return replied;
}

const publicReceptionTurnBuffer=createReceptionTurnBuffer({dispatch:(body,instance)=>publicWhatsappReception(body,instance),delayMs:2500});

function webhookAuthStatus(secret,supplied){if(typeof secret!=='string'||!secret)return 503;if(typeof supplied!=='string'||!supplied)return 401;const expected=Buffer.from(secret),actual=Buffer.from(supplied);return expected.length===actual.length&&timingSafeEqual(expected,actual)?200:401;}

function incomingWhatsappMessage(body,instance){
  if(!body||typeof body!=='object'||Array.isArray(body)) return false;
  if(body.instance&&body.instance!==instance) return false;
  if(body.event&&String(body.event).toLowerCase().replace(/_/g,'.')!=='messages.upsert') return false;
  const data=body.data||body;
  if(!data||Array.isArray(data)||data.key?.fromMe!==false) return false;
  const address=whatsappIdentity(data);
  const valid=typeof data.key?.id==='string'&&!!data.key.id&&!!address.digits&&!!data.message&&typeof data.message==='object';
  if(!valid) return false;
  const mode=whatsappAccessMode(data.key.remoteJid,process.env.LEX_OPERATOR_WHATSAPP||'',data.key.remoteJidAlt);
  if(mode==='public'){queueMicrotask(()=>publicReceptionTurnBuffer.enqueue(body,instance).catch(()=>console.warn('[Recepcao] falha ao organizar turno')));return false;}
  if(mode==='operator'){
    let operator=null;try{operator=brazilMobile(process.env.LEX_OPERATOR_WHATSAPP||'');}catch{}
    if(operator) _rememberOperatorReplyTarget(operator,address);
    return true;
  }
  return true;
}

async function whatsappStatus({url,key,instance,number,enabled=true},getJson=requestJson){
  const pending={conectado:false,estado:'nao_configurado'}; if(!enabled)return {...pending,estado:'desativado'}; if(!url||!key||!instance||!number)return pending;
  try{const expected=brazilMobile(number),options={headers:{apikey:key}};const response=await getJson(evolutionEndpoint(url,'instance/connectionState/'+encodeURIComponent(instance)),options);if(response?.instance?.instanceName!==instance)return {...pending,estado:'instancia_nao_confirmada'};if(response.instance.state!=='open')return {...pending,estado:'aguardando_pareamento'};const rows=await getJson(evolutionEndpoint(url,'instance/fetchInstances')+'?instanceName='+encodeURIComponent(instance),options);if(!Array.isArray(rows))return {...pending,estado:'resposta_invalida'};const selected=rows.filter(row=>row.name===instance);if(selected.length!==1)return {...pending,estado:'instancia_nao_confirmada'};const owner=String(selected[0].ownerJid||'').match(/^(\d+)(?::\d+)?@s\.whatsapp\.net$/);if(!owner)return {...pending,estado:'numero_nao_confirmado'};if(!sameBrazilWhatsappNumber(owner[1],expected))return {...pending,estado:'numero_divergente'};return {conectado:true,estado:'conectado',verificado_em:new Date().toISOString()};}catch(error){const estado=[401,403].includes(error.status)?'falha_autenticacao':error.status===404?'instancia_ausente':'falha_na_verificacao';return {...pending,estado};}
}

async function telegramStatus({token,admin},getJson=requestJson){if(!token||!admin)return {conectado:false,estado:'nao_configurado'};try{const base='https://api.telegram.org/bot'+token+'/';const me=await getJson(base+'getMe');if(!me?.ok||me.result?.is_bot!==true)return {conectado:false,estado:'token_nao_confirmado'};const webhook=await getJson(base+'getWebhookInfo');if(!webhook?.ok||typeof webhook.result?.url!=='string')return {conectado:false,estado:'resposta_invalida'};if(webhook.result.url)return {conectado:false,estado:'webhook_conflita_com_polling'};return {conectado:true,estado:'api_disponivel',bot:me.result.username||null,envio_confirmado:false,observacao:'Recebimento e envio ainda exigem teste real.'};}catch{return {conectado:false,estado:'falha_na_verificacao'};}}

module.exports={brazilMobile,sameBrazilWhatsappNumber,whatsappAccessMode,whatsappIdentity,publicWhatsappReply,publicWhatsappDecision,publicWhatsappReception,handleWhatsappOperatorCommand,requestJson,evolutionEndpoint,waitForEvolutionOpen,whatsappStatus,telegramStatus,webhookAuthStatus,incomingWhatsappMessage};
