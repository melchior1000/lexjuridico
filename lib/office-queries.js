'use strict';
// Consultas do dia a dia do advogado pelos canais (WhatsApp/Telegram/Web):
// prazos, intimações do DJEN, andamento de processo, resumo do dia e ajuda.
// Tudo aqui é determinístico: a resposta sai dos registros do escritório,
// nunca da IA. Prazo sem autorização humana aparece como "não confirmado";
// fonte indisponível é dita como indisponível, nunca como "nada novo".
const flow=require('./workflow');
const DeadlineWatch=require('./deadline-watch');
const {rowsFromResult}=require('./supabase');

const norm=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();

const CNJ=/\b\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}\b/;
const WINDOW_DAYS={hoje:0,amanha:1,semana:7,quinzena:15,mes:30};

function deadlineWindow(t){
  if(/\b(vencid[oa]s?|atrasad[oa]s?|perdid[oa]s?|estourad[oa]s?)\b/.test(t))return'vencidos';
  if(/\bhoje\b/.test(t))return'hoje';
  if(/\bamanha\b/.test(t))return'amanha';
  if(/\b(quinzena|15 dias)\b/.test(t))return'quinzena';
  if(/\b(mes|30 dias)\b/.test(t))return'mes';
  if(/\b(semana|7 dias|proximos dias|essa semana|esta semana)\b/.test(t))return'semana';
  return'semana';
}

// Reconhece somente perguntas sobre a carteira do escritório. Perguntas
// doutrinárias ("qual o prazo para apelar?") seguem para o assessor jurídico.
function parseOfficeQuery(text){
  const raw=String(text||'').trim();
  const t=norm(raw).replace(/[?!.]+$/g,'').trim();
  if(!t||t.length>240)return null;

  if(/^(\/?ajuda|\/?help|\/?menu|\/start|o que (voce|vc) (faz|sabe fazer)|como (te|voce) (uso|funciona)|comandos)$/.test(t))
    return{action:'help',requires_process:false};

  if(/^(bom dia|boa tarde|boa noite)(,? lex)?$|^(\/?resumo|resumo do dia|resumo de hoje|como (esta|estamos|ta) (o dia|hoje|o escritorio)|o que (tem|temos) (pra|para) hoje|agenda (de|do) (hoje|dia)|\/?hoje|panorama|briefing)$/.test(t))
    return{action:'daily_brief',requires_process:false};

  const doctrinal=/\b(prazo|prazos)\s+(para|pra|de)\s+(contestar|recorrer|apelar|embargar|agravar|impugnar|apelacao|contestacao|recurso|embargos|agravo|resposta|manifestacao)\b|\b(qual|quanto)\s+(e\s+)?o\s+prazo\s+(legal|processual|para|pra|de)\b|\bcontagem\s+de\s+prazo\b|\bprazo\s+em\s+dobro\b|\bcpc\b|\bart(igo)?\.?\s*\d/;
  const mentionsDeadline=/\bprazos?\b|\bvencimentos?\b|\bvencend[oa]\b|\bvence(m)?\b/.test(t);
  if(mentionsDeadline&&!doctrinal.test(t)){
    const aboutProcess=CNJ.test(raw)||/\b(do|da|no|na)\s+(processo|caso|cliente|acao)\b/.test(t);
    if(aboutProcess)return{action:'process_status',requires_process:true,foco:'prazo',instrucao:raw};
    const asksList=/^(\/?prazos?)$/.test(t)
      ||/\b(meus|nossos|os|quais|que|tem|temos|ha|existe|lista|listar|mostre|mostra|veja|ver|quero ver|me passa|me manda)\b.*\b(prazos?|vencimentos?)\b/.test(t)
      ||/\bprazos?\b.*\b(hoje|amanha|semana|quinzena|mes|vencid[oa]s?|atrasad[oa]s?|pendentes?|abertos?|proximos?|escritorio|fatais?)\b/.test(t)
      ||/\b(o que|que|quem)\s+vence\b/.test(t)
      ||/\bvencend[oa]\b/.test(t);
    if(asksList)return{action:'deadlines',requires_process:false,janela:deadlineWindow(t)};
  }

  if(/\b(intimac(ao|oes)|publicac(ao|oes)|diario( oficial| da justica)?|djen|dje|comunicac(ao|oes)|citac(ao|oes))\b/.test(t)
    &&!/\b(o que e|o que significa|como funciona|qual a diferenca|nula|nulidade|conta(gem)?)\b/.test(t)){
    const dias=/\bhoje\b/.test(t)?1:/\b(ontem)\b/.test(t)?2:/\b(mes|30 dias)\b/.test(t)?30:7;
    return{action:'publications',requires_process:false,dias};
  }

  if(/\b(andamento|andamentos|movimentac(ao|oes)|situacao|status|como (esta|ta|anda|vai)|novidade|novidades|atualizac(ao|oes)|o que (ha|tem|aconteceu) de novo)\b/.test(t)
    &&(CNJ.test(raw)||/\b(processo|caso|acao|cliente)\b/.test(t)))
    return{action:'process_status',requires_process:true,foco:'geral',instrucao:raw};

  return null;
}

// Pergunta jurídica em tese ("qual o prazo para contestar?") não é ordem de
// produzir peça: vai para o assessor, sem abrir tarefa nem pedir processo.
function isLegalQuestion(text){
  const raw=String(text||'');
  if(CNJ.test(raw))return false;
  const t=norm(raw);
  if(/\b(faca|fazer|elabore|elaborar|prepare|preparar|redija|redigir|minute|gere|gerar|quero|monte|escreva|escrever|providencie)\b/.test(t))return false;
  if(/\b(desse|deste|nesse|neste)\s+(processo|caso)\b|\b(do|da|no|na)\s+(processo|caso|cliente)\s+\S/.test(t))return false;
  const doctrinal=/\b(prazo|prazos)\s+(para|pra|de)\s+(contestar|recorrer|apelar|embargar|agravar|impugnar|apelacao|contestacao|recurso|embargos|agravo|resposta|manifestacao)\b|\bcontagem\s+de\s+prazo\b|\bprazo\s+em\s+dobro\b|\bcpc\b|\bart(igo)?\.?\s*\d/;
  const interrogative=/^(qual|quais|quanto|quantos|como|quando|o que|cabe|pode|e possivel|me explique|explique)\b/.test(t)&&/\?\s*$/.test(t);
  return doctrinal.test(t)||interrogative;
}

// Remove as palavras da pergunta para o resolvedor de processo trabalhar só
// com o nome/número informado ("como está o processo da Maria" -> "Maria").
function processHint(text){
  const raw=String(text||'');
  const cnj=raw.match(CNJ);if(cnj)return cnj[0];
  const stop=new Set('como esta ta anda vai qual quais o a os as do da dos das de no na nos nas em processo processos caso acao cliente andamento andamentos movimentacao movimentacoes situacao status novidade novidades atualizacao prazo prazos vencimento lex me mostre mostra veja ver passa manda sobre que tem ha aconteceu novo nova e pra para por favor'.split(' '));
  return norm(raw).replace(/[?!.,;:]/g,' ').split(' ').filter(w=>w&&!stop.has(w)).join(' ');
}

function brDate(ymd){const m=String(ymd||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?m[3]+'/'+m[2]+'/'+m[1]:String(ymd||'')}
function ymdSP(now){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(now)}
function addDays(ymd,n){const d=new Date(ymd+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}

function whenLabel(days){
  if(days==null)return'sem data';
  if(days<0)return'VENCIDO há '+(-days)+(days===-1?' dia':' dias');
  if(days===0)return'HOJE';
  if(days===1)return'amanhã';
  return'em '+days+' dias';
}
function deadlineLine(item){
  const flag=item.deadline_status==='confirmed'?'✅ confirmado':'⚠️ NÃO confirmado (conferir no tribunal)';
  return'• '+brDate(item.prazo)+' ('+whenLabel(item.days_to_due)+') — '+item.titulo+'\n  '+flag;
}

function selectDeadlines(items,janela){
  const withDate=items.filter(i=>i.prazo&&i.days_to_due!=null);
  if(janela==='vencidos')return withDate.filter(i=>i.days_to_due<0);
  const max=WINDOW_DAYS[janela]??7;
  // Vencidos sempre aparecem junto: esconder atraso é pior do que repetir.
  return withDate.filter(i=>i.days_to_due<=max);
}

const WINDOW_TITLE={hoje:'Prazos de hoje',amanha:'Prazos até amanhã',semana:'Prazos dos próximos 7 dias',quinzena:'Prazos dos próximos 15 dias',mes:'Prazos dos próximos 30 dias',vencidos:'Prazos vencidos'};

async function readProcesses(deps){
  const state=await deps.processStore.read();
  return Array.isArray(state?.processes)?state.processes:[];
}

async function deadlinesQuery(deps,command,now){
  const processes=await readProcesses(deps);
  const items=DeadlineWatch.watchlist(processes,now,[],[],{integrityKey:deps.integrityKey});
  const selected=selectDeadlines(items,command.janela);
  const semData=items.filter(i=>!i.prazo).length;
  const title=WINDOW_TITLE[command.janela]||'Prazos';
  const lines=[];
  if(!selected.length)lines.push(title+': nenhum prazo registrado no LEX nessa janela.');
  else{
    lines.push(title+' ('+selected.length+'):');
    for(const item of selected.slice(0,15))lines.push(deadlineLine(item));
    if(selected.length>15)lines.push('… e mais '+(selected.length-15)+'. Veja a tela Prazos.');
  }
  const naoConfirmados=selected.filter(i=>i.deadline_status!=='confirmed').length;
  if(naoConfirmados)lines.push('\n'+naoConfirmados+' prazo(s) ainda sem confirmação oficial. Confirme em Prazos antes de contar com a data.');
  const semLeitura=selected.filter(i=>i.freshness!=='fresh').length;
  if(semLeitura)lines.push(semLeitura+' desses processo(s) sem leitura oficial recente do tribunal.');
  if(semData)lines.push(semData+' processo(s) ativo(s) sem prazo cadastrado.');
  lines.push('Fonte: registros do LEX. Intimação que ainda não entrou no LEX não aparece aqui — pergunte "tem intimação nova?".');
  return{handled:true,command,result:{janela:command.janela,itens:selected,sem_data:semData},message:lines.join('\n')};
}

async function publicationsQuery(deps,command,now){
  const dbReq=typeof deps.sbReq==='function'?deps.sbReq:deps.records?.request;
  if(typeof dbReq!=='function')
    return{handled:true,command,result:{disponivel:false},message:'Não consigo consultar as intimações do DJEN agora (banco indisponível). Isso NÃO significa que não há intimações: confira o DJEN/PJe diretamente.'};
  const since=addDays(ymdSP(now),-(Math.max(1,command.dias)-1));
  let rows;
  try{
    rows=rowsFromResult(await dbReq('GET','djen_comunicacoes',null,{data_disponibilizacao:'gte.'+since,order:'data_disponibilizacao.desc',limit:'200'}),'Listar comunicações DJEN');
  }catch(e){
    return{handled:true,command,result:{disponivel:false,erro:e.message},message:'Falhei ao consultar as intimações do DJEN ('+e.message+'). Isso NÃO significa que não há intimações: confira o DJEN/PJe diretamente.'};
  }
  // Cursor ilegível conta como "sem leitura registrada": o aviso abaixo cobre.
  // Com várias OABs, vale a leitura mais atrasada: uma OAB parada já perde prazo.
  const cursor=await dbReq('GET','djen_sync_state',null,{order:'last_success_at.asc',limit:'50'})
    .then(result=>rowsFromResult(result,'Ler cursor DJEN')[0]||null).catch(()=>null);
  const ativas=rows.filter(r=>r.status!=='cancelada');
  const orfas=ativas.filter(r=>r.status==='orfa');
  const semPrazo=ativas.filter(r=>r.status==='casada'&&r.prazo_cunhado!==true);
  const periodo=command.dias===1?'hoje':'desde '+brDate(since);
  const lines=[];
  if(!ativas.length)lines.push('Nenhuma intimação/publicação do DJEN registrada '+periodo+'.');
  else{
    lines.push(ativas.length+' comunicação(ões) do DJEN '+periodo+':');
    for(const r of ativas.slice(0,10))lines.push('• '+brDate(r.data_disponibilizacao)+' · '+(r.tribunal||'tribunal?')+' · '+(r.tipo||'comunicação')+' · '+(r.cnj||'sem nº')+(r.status==='orfa'?' — ⚠️ processo NÃO cadastrado no LEX':r.prazo_cunhado===true?' — prazo confirmado':' — prazo a confirmar'));
    if(ativas.length>10)lines.push('… e mais '+(ativas.length-10)+'.');
  }
  if(semPrazo.length)lines.push('\n'+semPrazo.length+' aguardando você confirmar o prazo (tela Prazos).');
  if(orfas.length)lines.push(orfas.length+' sem processo correspondente no LEX: cadastre o processo para o prazo não se perder.');
  if(cursor?.last_success_at){
    const hours=Math.floor((now.getTime()-Date.parse(cursor.last_success_at))/3600000);
    lines.push('Última leitura do DJEN: '+(Number.isFinite(hours)?(hours<1?'há menos de 1h':'há '+hours+'h'):'data inválida')+'.'+(hours>26?' ⚠️ Leitura atrasada: o monitor pode estar parado.':''));
  }else lines.push('⚠️ Não há registro de leitura bem-sucedida do DJEN. Verifique DJEN_OABS e o monitor.');
  return{handled:true,command,result:{disponivel:true,total:ativas.length,orfas:orfas.length,aguardando_prazo:semPrazo.length,ultima_leitura:cursor?.last_success_at||null},message:lines.join('\n')};
}

function sortedMovements(p){
  const list=Array.isArray(p.andamentos)?p.andamentos.map((a,i)=>({a,i,d:flow.date(a?.data)})):[];
  // Sem data válida, preserva a ordem gravada (o LEX insere o mais novo no início).
  return list.sort((x,y)=>x.d&&y.d?(y.d.localeCompare(x.d)||x.i-y.i):x.i-y.i).map(x=>x.a);
}

function processStatusMessage(p,now,foco){
  const item=DeadlineWatch.watchlist([p],now)[0]||DeadlineWatch.freshnessOf(p,now);
  const lines=['📁 '+(p.nome||'Processo')+(p.numero?' — '+p.numero:'')];
  const meta=[p.tribunal,p.vara,p.status].filter(Boolean).join(' · ');
  if(meta)lines.push(meta);
  if(item?.prazo)lines.push('Prazo: '+brDate(item.prazo)+' ('+whenLabel(item.days_to_due)+') — '+(item.deadline_status==='confirmed'?'✅ confirmado':'⚠️ NÃO confirmado'));
  else lines.push('Prazo: nenhum cadastrado no LEX.');
  if(foco!=='prazo'){
    const movs=sortedMovements(p).slice(0,3);
    if(movs.length){
      lines.push('Últimos andamentos:');
      for(const a of movs)lines.push('• '+(a.data?brDate(flow.date(a.data)||a.data)+' — ':'')+String(a.txt||a.texto||a.descricao||'').replace(/\s+/g,' ').slice(0,220));
    }else lines.push('Nenhum andamento registrado.');
    if(p.proxacao)lines.push('Próxima ação: '+String(p.proxacao).slice(0,200));
  }
  if(p.last_court_sync_at)lines.push('Última leitura oficial: '+String(p.last_court_sync_at).slice(0,16).replace('T',' '));
  else lines.push('Sem leitura oficial registrada. Peça "atualize pelo Datajud" para sincronizar.');
  return lines.join('\n');
}

async function processStatusQuery(deps,command,now){
  const processes=await readProcesses(deps);
  const p=processes.find(x=>String(x.id)===String(command.processo_id));
  if(!p)return{handled:true,command,needs_input:true,message:'Não encontrei esse processo no LEX.'};
  return{handled:true,command,result:{processo_id:p.id},message:processStatusMessage(p,now,command.foco)};
}

const HELP=[
  'Sou o LEX. Fale comigo normalmente. Exemplos:',
  '• "prazos de hoje" / "prazos da semana" / "prazos vencidos"',
  '• "tem intimação nova?"',
  '• "como está o processo da Maria Silva" ou pelo número CNJ',
  '• "resumo do dia" ou "bom dia"',
  '• "o que precisa de mim?"',
  '• "faça a contestação do processo 0000000-00.0000.0.00.0000"',
  '• "responda a Maria: recebi os documentos"',
  '• "cadastre o cliente João"',
  'Pode mandar áudio: eu transcrevo, mostro o que entendi e executo.',
  'Quando eu perguntar "qual processo?", responda só 1, 2… ou o CNJ.',
  'Protocolo, envio sensível e prazo oficial sempre passam pela sua confirmação.'
].join('\n');

async function dailyBrief(deps,command,now,extra={}){
  const parts=['Resumo de '+brDate(ymdSP(now))+':'];
  try{
    const d=await deadlinesQuery(deps,{action:'deadlines',janela:'semana'},now);
    const itens=d.result.itens;
    const vencidos=itens.filter(i=>i.days_to_due<0).length,hoje=itens.filter(i=>i.days_to_due===0).length;
    parts.push('\n⏰ Prazos (7 dias): '+itens.length+(vencidos?' · '+vencidos+' VENCIDO(S)':'')+(hoje?' · '+hoje+' HOJE':''));
    for(const item of itens.slice(0,5))parts.push(deadlineLine(item));
  }catch(e){parts.push('\n⏰ Prazos: não consegui ler ('+e.message+').')}
  const pub=await publicationsQuery(deps,{action:'publications',dias:1},now);
  parts.push('\n📰 DJEN: '+pub.message.split('\n')[0]+(pub.result?.orfas?' ('+pub.result.orfas+' sem processo no LEX)':''));
  if(typeof extra.workQueue==='function'){
    try{const w=await extra.workQueue();parts.push('\n📋 '+w.message)}catch(e){parts.push('\n📋 Pendências: não consegui ler ('+e.message+').')}
  }
  parts.push('\nDiga "prazos da semana", "tem intimação nova?" ou "o que precisa de mim" para detalhar.');
  return{handled:true,command,message:parts.join('\n')};
}

async function dailyBriefText(deps,extra={}){
  const now=extra.now instanceof Date?extra.now:new Date();
  return(await dailyBrief(deps,{action:'daily_brief'},now,extra)).message;
}

async function executeOfficeQuery(deps,command,extra={}){
  const now=extra.now instanceof Date?extra.now:new Date();
  if(command.action==='help')return{handled:true,command,message:HELP};
  if(command.action==='deadlines')return deadlinesQuery(deps,command,now);
  if(command.action==='publications')return publicationsQuery(deps,command,now);
  if(command.action==='process_status')return processStatusQuery(deps,command,now);
  if(command.action==='daily_brief')return dailyBrief(deps,command,now,extra);
  return null;
}

// Resposta curta a uma pergunta de "qual processo?": "1", "o segundo", o CNJ
// ou um nome que identifique uma única opção. Qualquer outra coisa devolve
// null e a mensagem segue como ordem nova.
const ORDINALS={primeiro:1,primeira:1,segundo:2,segunda:2,terceiro:3,terceira:3,quarto:4,quarta:4,quinto:5,quinta:5,sexto:6,sexta:6,setimo:7,setima:7,oitavo:8,oitava:8};
function pickChoice(reply,candidates){
  const list=Array.isArray(candidates)?candidates:[];
  if(!list.length)return null;
  const raw=String(reply||'').trim();
  const t=norm(raw).replace(/[.!?)]+$/g,'').replace(/^(o|a|opcao|numero|n)\s+/,'').trim();
  if(!t||t.length>120)return null;
  let index=null;
  if(/^\d{1,2}$/.test(t))index=Number(t);
  else if(ORDINALS[t])index=ORDINALS[t];
  if(index!=null)return list[index-1]||null;
  const cnj=raw.match(CNJ);
  if(cnj){const digits=cnj[0].replace(/\D/g,'');const hit=list.filter(c=>String(c.numero||'').replace(/\D/g,'')===digits);return hit.length===1?hit[0]:null}
  if(t.split(' ').length>6)return null;
  const hits=list.filter(c=>norm(c.nome).includes(t));
  return hits.length===1?hits[0]:null;
}

const QUERY_ACTIONS=Object.freeze(['help','deadlines','publications','process_status','daily_brief']);

module.exports={parseOfficeQuery,executeOfficeQuery,processHint,isLegalQuestion,pickChoice,dailyBriefText,QUERY_ACTIONS,HELP};
