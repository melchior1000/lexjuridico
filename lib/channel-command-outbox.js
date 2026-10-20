'use strict';

const crypto=require('node:crypto');
const {sendChannelDetailed}=require('./channel-delivery');
const {createReceptionStore}=require('./whatsapp-reception-store');

const PREFIX='lex_channel_command_';
const ACTIVE=new Set(['pendente','interpretando','aguardando_confirmacao','confirmado','enviando']);
// Status que a varredura de recuperação retoma (ver recover()).
const RECOVERABLE=['pendente','confirmado','interpretando','enviando'];
const running=new Set();
const now=()=>new Date().toISOString();

function safeError(error){
  return String(error?.message||error||'Falha desconhecida').replace(/[\r\n]+/g,' ').slice(0,500);
}
function normalizeOrigin(value){
  const v=String(value||'').toLowerCase();
  return ['whatsapp','telegram'].includes(v)?v:'';
}
function normalizeId(origem,value){
  const id=String(value||'').replace(/\D/g,'');
  // WhatsApp: telefone brasileiro ou código LID de contato (14 a 20 dígitos); o destino
  // final do LID é conferido em lib/channel-delivery.js antes do envio.
  if(origem==='whatsapp'&&!/^(55\d{10,11}|\d{14,20})$/.test(id))return'';
  if(origem==='telegram'&&!/^\d{1,20}$/.test(id))return'';
  return id;
}

function createChannelCommandOutbox({
  records,
  compose,
  deliverDetailed=sendChannelDetailed,
  receptionStore=createReceptionStore(),
  log=console.warn,
  // A varredura é só recuperação (enqueue/confirm/kick já disparam na hora). Era de 5 s e,
  // trazendo 100 ordens inteiras por vez, estourou a cota de tráfego do banco (18/10/2026).
  intervalMs=60*1000,
  maxBackoffMs=15*60*1000,
  staleMs=5*60*1000,
  setTimer=setTimeout,
  clearTimer=clearTimeout
}={}){
  if(!records?.change||!records?.read||!records?.list)throw new Error('Outbox requer RecordStore persistente.');
  if(typeof compose!=='function')throw new Error('Outbox requer compositor do LEX.');

  async function read(id){
    return (await records.read(PREFIX+String(id||'')))?.value||null;
  }
  async function save(id,patch){
    return records.change(PREFIX+id,old=>({...old,...patch,id,atualizado_em:now()}));
  }
  async function enqueue(input={}){
    const origem=normalizeOrigin(input.origem),id=normalizeId(origem,input.id||input.numero);
    const comando=String(input.comando||input.texto||'').trim();
    if(!origem||!id)throw Object.assign(new Error('Informe canal e contato válidos.'),{status:422});
    if(!comando||comando.length>3500)throw Object.assign(new Error('Dê uma ordem ao LEX de até 3500 caracteres.'),{status:422});
    const jobId=String(input.request_id||crypto.randomUUID());
    const existing=await read(jobId);
    if(existing)return existing;
    const active=(await records.list(PREFIX)).filter(x=>x?.origem===origem&&String(x?.contato_id)===id&&ACTIVE.has(x?.status));
    if(active.length)throw Object.assign(new Error('Já existe uma ordem do LEX em andamento nesta conversa. Confirme ou cancele antes de criar outra.'),{status:409,job:active[active.length-1]});
    const row={
      id:jobId,origem,contato_id:id,contato_nome:String(input.nome||'Contato').slice(0,100),
      comando,status:'pendente',texto_final:null,last_error:null,provider_id:null,provider_state:null,
      criado_em:now(),atualizado_em:now(),enviado_em:null,confirmado_em:null,cancelado_em:null,
      historico:Array.isArray(input.historico)?input.historico.slice(-20):[],
      perfil:String(input.profile||input.perfil||'')
    };
    await records.change(PREFIX+jobId,old=>old||row);
    kick(jobId);
    return row;
  }
  // Mensagem cujo texto final o titular JÁ viu e aprovou (ex.: aviso de andamento ao
  // cliente, lib/andamento-conversa.js): entra direto como "confirmado" e sai pelo mesmo
  // caminho das demais — conferência do provedor, histórico da recepção e recibo do dia.
  // Não passa pelo compositor: o texto aprovado é o texto enviado. Mantém a regra de uma
  // ordem ativa por contato. Quem chama dispara o envio (kick) quando quiser.
  async function enqueueApproved(input={}){
    const origem=normalizeOrigin(input.origem),id=normalizeId(origem,input.id||input.numero);
    const texto=String(input.texto||'').trim();
    if(!origem||!id)throw Object.assign(new Error('Informe canal e contato válidos.'),{status:422});
    if(!texto||texto.length>3500)throw Object.assign(new Error('A mensagem aprovada precisa ter entre 1 e 3500 caracteres.'),{status:422});
    const confirmadoPor=String(input.confirmado_por||'').trim();
    if(!confirmadoPor)throw Object.assign(new Error('Mensagem sem aprovação registrada não é enviada.'),{status:422});
    const jobId=String(input.request_id||crypto.randomUUID());
    const existing=await read(jobId);
    if(existing)return existing;
    const active=(await records.list(PREFIX)).filter(x=>x?.origem===origem&&String(x?.contato_id)===id&&ACTIVE.has(x?.status));
    if(active.length)throw Object.assign(new Error('Já existe outra mensagem em andamento para este contato. Aguarde ela terminar e tente de novo.'),{status:409,job:active[active.length-1]});
    const stamp=now();
    const row={
      id:jobId,origem,contato_id:id,contato_nome:String(input.nome||'Contato').slice(0,100),
      comando:String(input.comando||'Mensagem aprovada pelo titular').slice(0,500),tipo:String(input.tipo||'mensagem_aprovada').slice(0,60),
      status:'confirmado',texto_final:texto,last_error:null,provider_id:null,provider_state:null,
      criado_em:stamp,atualizado_em:stamp,enviado_em:null,confirmado_em:stamp,confirmado_por:confirmadoPor.slice(0,100),cancelado_em:null,
      historico:[],perfil:String(input.profile||input.perfil||confirmadoPor).slice(0,40)
    };
    await records.change(PREFIX+jobId,old=>old||row);
    return read(jobId);
  }
  async function interpret(id){
    if(running.has(id))return read(id);
    running.add(id);
    try{
      let job=await read(id);if(!job)return null;
      if(!['pendente','interpretando'].includes(job.status))return job;
      const started=Date.now();
      job=await save(id,{status:'interpretando',last_error:null,interpretacao_iniciada_em:now()});
      log('[LEX OUTBOX] '+id+' etapa=interpretando origem='+job.origem+' contato='+job.contato_id);
      try{
        const textoFinal=String(await compose(job)||'').trim();
        if(!textoFinal)throw new Error('O LEX não produziu uma resposta para enviar.');
        const current=await read(id);
        if(current?.status==='cancelado')return current;
        if(current?.status!=='interpretando'&&current?.status!=='pendente')return current;
        const ready=await save(id,{status:'aguardando_confirmacao',texto_final:textoFinal,interpretacao_concluida_em:now()});
        log('[LEX OUTBOX] '+id+' etapa=aguardando_confirmacao ms='+(Date.now()-started));
        return ready;
      }catch(error){
        const current=await read(id);if(current?.status==='cancelado')return current;
        const msg=safeError(error);
        log('[LEX OUTBOX] '+id+' etapa=interpretacao_falhou ms='+(Date.now()-started)+' erro='+msg);
        return save(id,{status:'falhou',last_error:msg,finalizado_em:now()});
      }
    }finally{running.delete(id);}
  }
  async function confirm(id,{texto}={}){
    const job=await read(id);
    if(!job)throw Object.assign(new Error('Ordem não encontrada.'),{status:404});
    if(job.status!=='aguardando_confirmacao')throw Object.assign(new Error('Esta ordem não está aguardando confirmação.'),{status:409});
    const final=String(texto??job.texto_final??'').trim();
    if(!final||final.length>3500)throw Object.assign(new Error('Confira a mensagem final antes de enviar.'),{status:422});
    const saved=await save(id,{status:'confirmado',texto_final:final,confirmado_em:now(),last_error:null});
    kick(id);return saved;
  }
  async function cancel(id){
    const job=await read(id);
    if(!job)throw Object.assign(new Error('Ordem não encontrada.'),{status:404});
    if(['enviado','falhou','cancelado'].includes(job.status))return job;
    if(job.status==='enviando')throw Object.assign(new Error('O envio já foi iniciado; aguarde o resultado.'),{status:409});
    return save(id,{status:'cancelado',cancelado_em:now(),finalizado_em:now()});
  }
  async function send(id){
    if(running.has(id))return read(id);
    running.add(id);
    try{
      let job=await read(id);if(!job)return null;
      if(job.status!=='confirmado')return job;
      const started=Date.now();
      job=await save(id,{status:'enviando',envio_iniciado_em:now(),last_error:null});
      log('[LEX OUTBOX] '+id+' etapa=enviando origem='+job.origem+' contato='+job.contato_id);
      const result=await deliverDetailed(
        {origem:job.origem,id:job.contato_id,texto:job.texto_final},
        {logger:(stage,data)=>log('[LEX OUTBOX] '+id+' etapa='+stage+' '+JSON.stringify(data||{}))}
      );
      if(!result?.ok){
        const msg=safeError(result?.error||'Envio não confirmado pelo provedor.');
        log('[LEX OUTBOX] '+id+' etapa=envio_falhou ms='+(Date.now()-started)+' erro='+msg);
        return save(id,{status:'falhou',last_error:msg,provider_state:result?.state||null,finalizado_em:now()});
      }
      if(job.origem==='whatsapp'){
        await receptionStore.appendEvent({numero:job.contato_id,nome:job.contato_nome,direcao:'saida_operador',texto:job.texto_final,classe:'geral',nivel:'ciencia'});
      }else if(job.origem==='telegram'){
        await records.change('lex_recepcao_telegram_'+job.contato_id,row=>{
          if(!row)return row;
          return {...row,requiresApproval:false,history:[...(row.history||[]),{direcao:'saida_operador',texto:job.texto_final,criado_em:now()}].slice(-50),atualizado_em:now()};
        });
      }
      const done=await save(id,{status:'enviado',provider_id:result.provider_id||null,provider_state:result.state||'confirmado',enviado_em:now(),finalizado_em:now(),last_error:null});
      log('[LEX OUTBOX] '+id+' etapa=enviado ms='+(Date.now()-started)+' provider_id='+(result.provider_id||''));
      return done;
    }catch(error){
      const msg=safeError(error);log('[LEX OUTBOX] '+id+' etapa=envio_falhou erro='+msg);
      return save(id,{status:'falhou',last_error:msg,finalizado_em:now()});
    }finally{running.delete(id);}
  }
  function kick(id){
    setImmediate(async()=>{
      try{
        const job=await read(id);
        if(['pendente','interpretando'].includes(job?.status))await interpret(id);
        else if(job?.status==='confirmado')await send(id);
      }catch(error){log('[LEX OUTBOX] '+id+' erro='+safeError(error));}
    });
  }
  async function listForContact(origem,id){
    const channel=normalizeOrigin(origem),target=normalizeId(channel,id);
    if(!channel||!target)return[];
    const rows=await records.list(PREFIX);
    return (rows||[]).filter(x=>x?.origem===channel&&String(x?.contato_id)===target)
      .sort((a,b)=>String(a.criado_em||'').localeCompare(String(b.criado_em||''))).slice(-10);
  }
  // Lista enxuta: só id/status/data das ordens ainda ativas. Antes de confiar no filtro, uma
  // prova barata (1 linha, sem filtro) confere que o banco lê o campo de dentro do JSON: em
  // coluna texto o PostgREST NÃO recusa — devolve o campo vazio e o filtro voltaria vazio sem
  // erro, e a recuperação pararia calada. Sem leitura de JSON (campo vazio, 400/404, ou modo
  // PostgreSQL direto → null), volta de vez à lista completa e avisa uma vez. Banco recusado
  // ou fora (402, 5xx, sem resposta) NÃO cai aqui: a falha sobe e a varredura espera mais.
  let slimScan=typeof records.listFields==='function',slimChecked=false;
  function useFullList(reason){
    slimScan=false;
    log('[LEX OUTBOX] '+reason+'; varredura usa a lista completa.');
  }
  async function recoverable(){
    if(slimScan){
      try{
        if(!slimChecked){
          const probe=await records.listFields(PREFIX,['id','status'],{limit:1});
          if(probe===null)useFullList('banco sem filtro por campo JSON');
          else if(!probe.length)return[];
          else if(probe[0].id==null||probe[0].status==null)useFullList('banco não lê id/status de dentro do registro (coluna sem JSON?)');
          else slimChecked=true;
        }
        if(slimScan){
          const rows=await records.listFields(PREFIX,['id','status','atualizado_em'],{status:RECOVERABLE});
          return rows.map(r=>({...r,id:r.id||String(r.chave||'').slice(PREFIX.length)}));
        }
      }catch(error){
        const status=Number(error?.databaseStatus)||0;
        if(status!==400&&status!==404)throw error;
        useFullList('banco recusou a lista enxuta ('+status+')');
      }
    }
    return records.list(PREFIX);
  }
  async function recover(){
    const rows=await recoverable(),cutoff=Date.now()-staleMs;
    for(const job of rows||[]){
      if(job?.status==='pendente'||job?.status==='confirmado'){kick(job.id);continue;}
      const stamp=Date.parse(job?.atualizado_em||'');
      if(job?.status==='interpretando'&&(!Number.isFinite(stamp)||stamp<cutoff)){
        await save(job.id,{status:'pendente',last_error:'Retomado após reinício do servidor.'});kick(job.id);
      }
      if(job?.status==='enviando'&&(!Number.isFinite(stamp)||stamp<cutoff)){
        await save(job.id,{status:'falhou',last_error:'O servidor reiniciou durante o envio. Confira a conversa antes de mandar novamente; o resultado pode ser indeterminado.',finalizado_em:now()});
      }
    }
  }
  // Uma varredura por vez (sem sobreposição). Com o banco recusando, a espera dobra até
  // maxBackoffMs e há um aviso por tentativa — não um erro a cada 5 s. Voltou, volta o ritmo.
  function start(){
    const base=Math.max(1000,intervalMs),ceiling=Math.max(base,maxBackoffMs);
    let failures=0,timer=null,stopped=false;
    const schedule=ms=>{
      if(stopped)return;
      timer=setTimer(()=>{timer=null;run();},ms);
      timer?.unref?.();
    };
    async function run(){
      if(stopped)return;
      try{
        await recover();
        if(failures)log('[LEX OUTBOX] banco respondeu de novo; varredura volta a cada '+Math.round(base/1000)+' s');
        failures=0;schedule(base);
      }catch(error){
        failures++;
        const wait=Math.min(ceiling,base*2**Math.min(failures,20));
        log('[LEX OUTBOX] scan erro='+safeError(error)+' próxima tentativa em '+Math.round(wait/1000)+' s');
        schedule(wait);
      }
    }
    run();
    return{stop(){stopped=true;if(timer){clearTimer(timer);timer=null;}}};
  }
  return{enqueue,enqueueApproved,read,confirm,cancel,interpret,send,kick,listForContact,recover,start};
}
module.exports={createChannelCommandOutbox,PREFIX};
