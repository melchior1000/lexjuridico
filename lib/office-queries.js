'use strict';
// Consultas do dia a dia do advogado pelos canais (WhatsApp/Telegram/Web):
// prazos, intimações do DJEN, andamento de processo, resumo do dia e ajuda.
// Tudo aqui é determinístico: a resposta sai dos registros do escritório,
// nunca da IA. Prazo sem autorização humana aparece como "não confirmado";
// fonte indisponível é dita como indisponível, nunca como "nada novo".
const flow=require('./workflow');
const DeadlineWatch=require('./deadline-watch');
const {rowsFromResult}=require('./supabase');
const PjeMonitor=require('./pje-monitor');
const PjeProcessSync=require('./pje-process-sync');
const {hasCnj}=require('./pje-sync');
const {teorConfirmationPhrase}=require('./pje-mni');

const norm=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();

const CNJ=/\b\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}\b/;
const WINDOW_DAYS={hoje:0,amanha:1,semana:7,quinzena:15,mes:30};

function processOfficial(p){return !!(p?.last_court_sync_at||p?.partes_verificadas_em||p?.cadastro_conferido==='tribunal'||p?.numero_verificado_fonte==='pje')}
function safeProcessLabel(p){
  if(processOfficial(p))return p?.nome_oficial||p?.nome||p?.partes||p?.numero||'Processo';
  const cnj=String(p?.numero||'').match(CNJ);
  return cnj?'Processo '+cnj[0]+' — dados não conferidos no tribunal':'Processo — dados não conferidos no tribunal';
}

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

  // Cadastrar processo pelo número: o LEX busca no tribunal e no Diário antes de gravar.
  if(/^(?:por favor\s+)?(?:lex\s*,?\s*)?(?:cadastr\w*|inclu\w*|adicion\w*|registr\w*|abr\w*|cri\w*)\s+(?:o\s+|um\s+)?(?:novo\s+)?processo\b/.test(t)&&CNJ.test(raw))
    return{action:'process_register',requires_process:false,cnj:raw.match(CNJ)[0],forcar:/\bmesmo assim\b|\bsem conferir\b/.test(t)};
  // Ligar a OAB do advogado: grava e busca as publicações do DJEN na hora.
  if(/\boab\b/.test(t)&&/\b(minha|nossa|meu|cadastr\w*|lig\w*|configur\w*|registr\w*|salv\w*|adicion\w*|inclu\w*|use|usar|troc\w*)\b/.test(t)&&/\d{3,}/.test(t)){
    const oabs=require('./djen-monitor').parseOabInput(raw);
    if(oabs.length)return{action:'oab_set',requires_process:false,oabs};
  }
  // Conferência dos números CNJ da carteira e correção confirmada pelo advogado.
  let fix=raw.match(/^\s*(?:lex\s*,?\s*)?corrig\w*\s+(?:o\s+)?n[uú]mero\s+(?:d[oae]s?\s+)?(?:processo\s+|caso\s+)?(.+?)\s+para\s+(\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4})\s*[.!]?\s*$/i);
  if(fix)return{action:'cnj_fix',requires_process:true,hint:fix[1].replace(/^["'“]|["'”]$/g,'').trim(),numero:fix[2]};
  if(/\b(confir\w*|confer\w*|revis\w*|verifi\w*|audit\w*|corrij\w*|corrig\w*|arrum\w*|checa\w*|cheque)\b/.test(t)&&/\b(numeros?|cnj|carteira|meus processos|os processos|todos os processos|cadastro dos processos)\b/.test(t)&&!/\bprazos?\b/.test(t))
    return{action:'carteira_audit',requires_process:false};

  // Atualizar a carteira (ou um processo) pelo tribunal: andamentos e partes.
  if(/^(por favor\s+)?(lex\s*,?\s*)?(atualiz\w*|sincroniz\w*|puxe|traga)\b/.test(t)&&/\b(processos?|partes|carteira|tudo|tribunal|pje|andamentos)\b/.test(t)){
    const one=CNJ.test(raw)||/\b(do|da|no|na)\s+(processo|caso|cliente)\s+\S/.test(t)||/\b(processo|caso)\s+(do|da|de)\s+\S/.test(t)||/\b(esse|este|desse|deste)\s+processo\b/.test(t);
    return{action:'court_update',requires_process:one,instrucao:raw};
  }

  if(/\b(test\w*|verifi\w*|confer\w*|cheque|checa\w*)\b.*\bpje\b|\bpje\b.*\b(conectad\w*|funcionando|ligad\w*|conex\w*)\b/.test(t))
    return{action:'pje_teste',requires_process:false};
  // PJe: confirmação explícita de abertura (dá ciência), pedido de abertura e lista de expedientes.
  let m=t.match(/^confirmo ciencia\s+(?:([a-z]{2,5}\d{0,2})\s+)?#?\s*([a-z0-9]{1,20})$/);
  if(m)return{action:'pje_confirm',requires_process:false,sigla:m[1]?m[1].toUpperCase():null,id_aviso:(raw.match(/([A-Za-z0-9]{1,20})[\s.!]*$/)||[])[1]||m[2]};
  m=t.match(/\babr(?:ir|a|e)\s+(?:a\s+|o\s+)?(?:intimacao|citacao|expediente|aviso|notificacao|comunicacao)\s+(?:(?:do|no|da)\s+)?(?:([a-z]{2,5}\d{0,2})\s+)?#?\s*(\d{1,20})\b/);
  if(m)return{action:'pje_open',requires_process:false,sigla:m[1]?m[1].toUpperCase():null,id_aviso:m[2]};
  if(/\bpje\b|\bexpedientes?\b|\bpainel do (advogado|pje)\b/.test(t)&&!/\b(o que e|como funciona|como (faco|faz) (login|cadastro))\b/.test(t))
    return{action:'pje_avisos',requires_process:false};

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
  // Fila jurídica: somente prazo com legal truth. Data manual fica para revisão,
  // sem ser classificada como vencida/hoje/próxima.
  const confirmed=items.filter(i=>i.deadline_status==='confirmed'&&i.deadline_legal_truth===true&&i.prazo&&i.days_to_due!=null);
  if(janela==='vencidos')return confirmed.filter(i=>i.days_to_due<0);
  const max=WINDOW_DAYS[janela]??7;
  return confirmed.filter(i=>i.days_to_due<=max);
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
  const manual=items.filter(i=>i.deadline_status!=='confirmed'&&i.prazo&&i.days_to_due!=null);
  const semData=items.filter(i=>!i.prazo).length;
  const title=WINDOW_TITLE[command.janela]||'Prazos';
  const lines=[];
  if(!selected.length)lines.push(title+': nenhum prazo oficial confirmado nessa janela.');
  else{
    lines.push(title+' ('+selected.length+'):');
    for(const item of selected.slice(0,15))lines.push(deadlineLine(item));
    if(selected.length>15)lines.push('… e mais '+(selected.length-15)+'. Veja a tela Prazos.');
  }
  if(manual.length)lines.push('\n'+manual.length+' data(s) anotada(s) no LEX aguardam conferência oficial. Não foram classificadas como vencidas, de hoje ou próximas.');
  const semLeitura=selected.filter(i=>i.freshness!=='fresh').length;
  if(semLeitura)lines.push(semLeitura+' desses processo(s) sem leitura oficial recente do tribunal.');
  if(semData)lines.push(semData+' processo(s) ativo(s) sem prazo cadastrado.');
  lines.push('Fonte: registros do LEX. Intimação que ainda não entrou no LEX não aparece aqui — pergunte "tem intimação nova?".');
  return{handled:true,command,result:{janela:command.janela,itens:selected,manuais:manual.length,sem_data:semData},message:lines.join('\n')};
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
  const pje=await pjeSection(deps).catch(e=>({message:'⚠️ PJe: não consegui ler os expedientes ('+e.message+').'}));
  if(pje)lines.push('\n— PJe —\n'+pje.message);
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
  const official=processOfficial(p);
  const lines=['📁 '+safeProcessLabel(p)+(p.numero?' — '+p.numero:'')];
  if(!official)lines.push('⚠️ Identidade, partes e situação ainda não foram conferidas em fonte oficial. Não vou tratá-las como verdade.');
  const meta=official?[p.tribunal,p.vara,p.status].filter(Boolean).join(' · '):[p.tribunal,'a conferir'].filter(Boolean).join(' · ');
  if(meta)lines.push(meta);
  if(item?.prazo&&item.deadline_status==='confirmed')lines.push('Prazo oficial: '+brDate(item.prazo)+' ('+whenLabel(item.days_to_due)+') — ✅ confirmado');
  else if(item?.prazo)lines.push('Data anotada no LEX: '+brDate(item.prazo)+' — ⚠️ NÃO é prazo oficial confirmado; não classificada como vencida.');
  else lines.push('Prazo oficial: nenhum confirmado no LEX.');
  if(foco!=='prazo'){
    const movs=sortedMovements(p).slice(0,3);
    if(movs.length){
      lines.push('Últimos andamentos:');
      for(const a of movs)lines.push('• '+(a.data?brDate(flow.date(a.data)||a.data)+' — ':'')+String(a.txt||a.texto||a.descricao||'').replace(/\s+/g,' ').slice(0,220));
    }else lines.push('Nenhum andamento registrado.');
    if(p.proxacao)lines.push('Próxima ação: '+String(p.proxacao).slice(0,200));
  }
  if(p.last_court_sync_at)lines.push('Última leitura oficial: '+String(p.last_court_sync_at).slice(0,16).replace('T',' '));
  else lines.push('Sem leitura oficial registrada. Peça "atualize este processo" para consultar o tribunal.');
  return lines.join('\n');
}

async function pjeSection(deps){
  const pje=deps.pje;
  if(!pje)return null;
  if(!pje.config?.configurado)return{message:PjeMonitor.pjeAvisosMessage({avisos:[],estado:[]},{config:pje.config||{configurado:false,faltando:['PJE_MNI_*']}}),pendentes:0,proxima:null};
  const listed=await pje.list();
  const pend=listed.avisos.filter(a=>a.status==='pendente');
  return{message:PjeMonitor.pjeAvisosMessage(listed,{config:pje.config}),pendentes:pend.length,proxima:pend.find(a=>a.dias_para_ciencia_tacita!=null)||null,listed};
}

async function pjeAvisosQuery(deps,command){
  const section=await pjeSection(deps);
  if(!section)return{handled:true,command,result:{configurado:false},message:'O PJe ainda não está conectado a este LEX. Confira os expedientes direto no painel do PJe.'};
  return{handled:true,command,result:{pendentes:section.pendentes},message:section.message};
}

async function findAviso(deps,command){
  const listed=await deps.pje.list();
  const hits=listed.avisos.filter(a=>String(a.id_aviso)===String(command.id_aviso)&&(!command.sigla||a.sigla===command.sigla));
  return hits;
}

async function pjeOpenQuery(deps,command){
  if(!deps.pje?.config?.configurado)return{handled:true,command,message:'O PJe ainda não está conectado a este LEX.'};
  const hits=await findAviso(deps,command);
  if(hits.length!==1)return{handled:true,command,needs_input:true,message:hits.length?'Esse número de aviso existe em mais de um tribunal. Diga "abrir intimação SIGLA #número".':'Não encontrei o aviso #'+command.id_aviso+' na última leitura do PJe. Peça "intimações do PJe" para ver a lista.'};
  const a=hits[0];
  if(a.status!=='pendente')return{handled:true,command,message:'O aviso '+a.sigla+' #'+a.id_aviso+' não está mais pendente ('+(a.status==='ciencia_dada'?'ciência já dada em '+String(a.ciencia_em||'').slice(0,10):'saiu da lista do tribunal')+'). Confira o prazo no processo.'};
  return{handled:true,command,needs_input:true,message:[
    '⚠️ Abrir o teor do aviso '+a.sigla+' #'+a.id_aviso+' ('+a.tipo_descricao+(a.processo_nome?' — '+a.processo_nome:'')+') REGISTRA A CIÊNCIA no PJe agora e o prazo começa a correr (Lei 11.419/2006, art. 5º, §1º; CPC, art. 231, V).',
    a.ciencia_tacita_data?'Se não abrir, a ciência tácita ocorre em '+a.ciencia_tacita_data.split('-').reverse().join('/')+' às 23:59.':'',
    'Para confirmar, responda exatamente: '+teorConfirmationPhrase(a.id_aviso,a.sigla)
  ].filter(Boolean).join('\n')};
}

async function pjeConfirmQuery(deps,command,now,extra){
  if(!['admin','advogado'].includes(extra.profile))return{handled:true,command,message:'Somente o advogado pode dar ciência de intimação.'};
  if(!deps.pje?.config?.configurado)return{handled:true,command,message:'O PJe ainda não está conectado a este LEX.'};
  const hits=await findAviso(deps,command);
  if(hits.length!==1)return{handled:true,command,needs_input:true,message:hits.length?'O aviso #'+command.id_aviso+' existe em mais de um tribunal. Responda "CONFIRMO CIENCIA SIGLA '+command.id_aviso+'". Nada foi aberto.':'Não encontrei o aviso #'+command.id_aviso+' pendente. Peça "intimações do PJe". Nada foi aberto.'};
  const a=hits[0];
  if(a.status!=='pendente')return{handled:true,command,message:'O aviso '+a.sigla+' #'+a.id_aviso+' não está mais pendente. Nada foi aberto.'};
  try{
    const out=await deps.pje.open({sigla:a.sigla,idAviso:a.id_aviso,authorization:{confirmado:true,sigla:a.sigla,id_aviso:a.id_aviso,perfil:extra.profile,em:now.toISOString()}});
    const lines=['✅ Ciência registrada no PJe ('+a.sigla+' #'+a.id_aviso+'). O prazo está correndo a partir do dia útil seguinte (CPC, art. 231, V).'];
    if(out.teor)lines.push('\nTeor:\n'+out.teor.slice(0,2500)+(out.teor.length>2500?'\n…(continua na Central)':''));
    if(out.documentos?.length)lines.push('\nDocumentos vinculados: '+out.documentos.length+'.');
    if(out.andamento?.erro)lines.push('\n⚠️ Não registrei o andamento no processo: '+out.andamento.erro);
    else if(out.andamento)lines.push('\nAndamento registrado no processo.');
    lines.push('\nCadastre o prazo em Prazos após conferir o tipo de ato e a contagem.');
    return{handled:true,command,result:{aviso:out.aviso},message:lines.join('\n')};
  }catch(error){
    return{handled:true,command,result:{erro:error.code||'erro'},message:'Não abri o teor: '+error.message+' Nenhuma ciência foi registrada pelo LEX; confira no painel do PJe se o tribunal registrou.'};
  }
}

async function courtUpdateQuery(deps,command,now){
  const pje=deps.pje;
  if(!pje?.config?.configurado||!pje.client)
    return{handled:true,command,result:{configurado:false},message:PjeProcessSync.syncReportMessage(null,{configurado:false,faltando:pje?.config?.faltando?.length?pje.config.faltando:['PJE_MNI_TRIBUNAIS','PJE_MNI_CPF','PJE_MNI_SENHA']})};
  const report=await PjeProcessSync.syncProcessesFromPje({client:pje.client,processStore:deps.processStore,now,processId:command.processo_id??null,oabs:(()=>{try{return require('./djen-monitor').parseOabs()}catch{return[]}})()});
  return{handled:true,command,result:report,message:PjeProcessSync.syncReportMessage(report)};
}

async function processStatusQuery(deps,command,now){
  const processes=await readProcesses(deps);
  const p=processes.find(x=>String(x.id)===String(command.processo_id));
  if(!p)return{handled:true,command,needs_input:true,message:'Não encontrei esse processo no LEX.'};
  return{handled:true,command,result:{processo_id:p.id},message:processStatusMessage(p,now,command.foco)};
}

const HELP=[
  'Sou o LEX, coordenador do escritório. Você não precisa escolher agente nem setor: diga o que quer, para qual cliente/processo e como quer que eu execute. Eu localizo o caso no banco, encaminho ao setor correto, acompanho e volto com o resultado.',
  '',
  'O banco processual é permanente e fica no centro do escritório. Nele ficam número, cliente, partes, vara, tribunal, andamentos, prazos, documentos, histórico, tarefas, fontes oficiais e eventos. Os setores trabalham sobre esse mesmo registro; mudar de setor não apaga o processo.',
  '',
  'Os 9 setores oficiais do escritório são:',
  '• Recepção — recebe pessoas e mensagens, identifica a demanda e encaminha para Cadastro.',
  '• Cadastro — confere cliente, processo, documentos e dados faltantes. Se faltar algo, a produção fica bloqueada.',
  '• Iniciais — prepara o caso para distribuição/protocolo depois do Cadastro conferido.',
  '• Processos — acompanha a carteira já distribuída; número, partes, vara, tribunal, andamentos e situação processual vivem no banco e são atualizados aqui por fonte identificada.',
  '• Prazos — controladoria: DJEN, expedientes, prazos confirmados, ciência e pendências. Prazo sem fonte oficial não vira verdade.',
  '• Peças — petições, contestações, recursos e outras minutas para revisão.',
  '• Perícia — cálculos, quesitos, pareceres e material técnico.',
  '• Revisão — recebe a entrega dos setores, confere e devolve para correção ou libera para a próxima etapa.',
  '• Concluídos — arquiva o fluxo encerrado sem apagar o histórico ou o banco do processo.',
  '',
  'Dê a ordem assim: "LEX, quero X, no processo Y, faça desse jeito Z". Se faltar processo, documento, autorização ou dado, eu pergunto só o que estiver faltando e continuo dali.',
  '',
  'Mesmo sem IA paga eu continuo executando rotinas determinísticas do escritório: consultar a carteira, conferir números, atualizar fontes já conectadas, mostrar prazos e publicações, mover processo entre setores, cadastrar contato/processo e organizar a fila.',
  'Análise jurídica livre, redação de peça, jurisprudência e texto pericial precisam do provedor de IA com crédito. Se o crédito acabar, eu aviso somente nessa etapa; o banco e os demais setores continuam funcionando.',
  'Atos críticos — protocolo, ciência, envio sensível e outras ações com efeito externo — continuam sujeitos à autorização humana.'
].join('\n');

async function dailyBrief(deps,command,now,extra={}){
  const parts=['Resumo de '+brDate(ymdSP(now))+':'];
  try{
    const d=await deadlinesQuery(deps,{action:'deadlines',janela:'semana'},now);
    const itens=d.result.itens;
    const vencidos=itens.filter(i=>i.deadline_status==='confirmed'&&i.days_to_due<0).length,hoje=itens.filter(i=>i.deadline_status==='confirmed'&&i.days_to_due===0).length;
    parts.push('\n⏰ Prazos oficiais (7 dias): '+itens.length+(vencidos?' · '+vencidos+' VENCIDO(S)':'')+(hoje?' · '+hoje+' HOJE':'')+(d.result.manuais?' · '+d.result.manuais+' data(s) manual(is) aguardando conferência':''));
    for(const item of itens.slice(0,5))parts.push(deadlineLine(item));
  }catch(e){parts.push('\n⏰ Prazos: não consegui ler ('+e.message+').')}
  const pub=await publicationsQuery({...deps,pje:null},{action:'publications',dias:1},now);
  parts.push('\n📰 DJEN: '+pub.message.split('\n')[0]+(pub.result?.orfas?' ('+pub.result.orfas+' sem processo no LEX)':''));
  const pje=await pjeSection(deps).catch(()=>null);
  if(pje?.listed){
    const p=pje.proxima;
    parts.push('\n⚖️ PJe: '+pje.pendentes+' expediente(s) pendente(s)'+(p?' · próxima ciência tácita: '+(p.dias_para_ciencia_tacita<=0?'HOJE':'em '+p.dias_para_ciencia_tacita+'d')+' ('+(p.processo_nome||p.cnj||p.sigla)+')':''));
  }
  try{const r=require('./carteira-audit').auditCarteira({processes:await readProcesses(deps)});if(r.problemas.length)parts.push('\n🔢 '+r.problemas.length+' processo(s) com número CNJ faltando ou errado — diga "confira os números" que eu acho o número certo.')}catch(e){deps.log?.('[LEX] conferência CNJ no resumo: '+e.message)}
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

function oabMessage(r){
  const lista=(r.oabs||[]).map(o=>o.oab+'/'+o.uf).join(', ');
  const d=r.djen;
  if(!d)return'✅ OAB '+lista+' ligada ao DJEN (Diário). Vou buscar as publicações do DJEN na próxima rodada.';
  if(d.ok===false&&d.erro)return'✅ OAB '+lista+' gravada, mas não consegui ler o DJEN agora ('+d.erro+'). Tento de novo sozinho na próxima rodada.';
  const lines=['✅ OAB '+lista+' ligada ao DJEN (Diário). Li agora: '+(d.consultadas||0)+' publicação(ões).'];
  if(d.casadas)lines.push('• '+d.casadas+' entraram nos seus processos.');
  if(d.orfas)lines.push('• '+d.orfas+' são de processos que não estão no LEX — diga "tem intimação nova?" para ver e cadastrar.');
  if(d.falhas?.length)lines.push('• '+d.falhas.length+' falharam; tento de novo na próxima rodada.');
  lines.push('Prazo sugerido a partir do DJEN só vale depois da sua confirmação.');
  lines.push('Isto liga só o Diário. Intimações no painel do PJe exigem o acesso do advogado ao PJe — diga "teste o PJe".');
  return lines.join('\n');
}

async function carteiraAuditQuery(deps,command){
  const Audit=require('./carteira-audit');
  const processes=await readProcesses(deps);
  const dbReq=typeof deps.sbReq==='function'?deps.sbReq:deps.records?.request;
  let orphans=[],aviso='';
  try{orphans=await Audit.readOrphans(dbReq)}catch(e){aviso='\n(Não consegui ler as publicações do DJEN para sugerir números: '+e.message+'.)'}
  const report=Audit.auditCarteira({processes,orphans});
  return{handled:true,command,result:report,message:Audit.auditMessage(report)+aviso};
}
async function cnjFixQuery(deps,command,now,extra){
  const Audit=require('./carteira-audit');
  try{
    const dbReq=typeof deps.sbReq==='function'?deps.sbReq:deps.records?.request;
    const out=await Audit.correctAndRefresh({processStore:deps.processStore,processId:command.processo_id,numero:command.numero,now,actor:extra.profile||'advogado',dbReq,pje:deps.pje});
    return{handled:true,command,result:{processo_id:out.processo.id,numero:out.processo.numero,anterior:out.anterior,publicacoes:out.publicacoes,tribunal:out.tribunal},message:Audit.correctionMessage(out)};
  }catch(e){return{handled:true,command,message:e.message}}
}

async function executeOfficeQuery(deps,command,extra={}){
  const now=extra.now instanceof Date?extra.now:new Date();
  if(command.action==='help')return{handled:true,command,message:HELP};
  if(command.action==='deadlines')return deadlinesQuery(deps,command,now);
  if(command.action==='publications')return publicationsQuery(deps,command,now);
  if(command.action==='process_status')return processStatusQuery(deps,command,now);
  if(command.action==='daily_brief')return dailyBrief(deps,command,now,extra);
  if(command.action==='pje_avisos')return pjeAvisosQuery(deps,command);
  if(command.action==='court_update')return courtUpdateQuery(deps,command,now);
  if(command.action==='pje_open')return pjeOpenQuery(deps,command);
  if(command.action==='pje_confirm')return pjeConfirmQuery(deps,command,now,extra);
  if(command.action==='pje_teste'){const M=require('./pje-mni');const d=await M.diagnoseMni(deps.pje?.client,deps.pje?.config||{configurado:false,faltando:['PJE_MNI_TRIBUNAIS','PJE_MNI_CPF','PJE_MNI_SENHA']});return{handled:true,command,result:d,message:M.diagnoseMessage(d)}}
  if(command.action==='process_register'){
    const R=require('./process-register');
    const dbReq=typeof deps.sbReq==='function'?deps.sbReq:deps.records?.request;
    try{
      const r=await R.registerProcess({cnj:command.cnj,processStore:deps.processStore,pje:deps.pje,dbReq,now,forcar:command.forcar,markCommunication:require('./djen-monitor').markCommunication});
      return{handled:true,command,result:r,message:R.registerMessage(r,command.cnj)};
    }catch(e){return{handled:true,command,message:'Não cadastrei: '+e.message}}
  }
  if(command.action==='oab_set'){
    if(typeof deps.oab?.set!=='function')return{handled:true,command,message:'Não consegui ligar a OAB por aqui. Use a tela Mais → Diário e PJe.'};
    try{const r=await deps.oab.set(command.oabs,{profile:extra.profile});return{handled:true,command,result:r,message:oabMessage(r)}}
    catch(e){return{handled:true,command,message:'Não liguei a OAB: '+e.message}}
  }
  if(command.action==='carteira_audit')return carteiraAuditQuery(deps,command);
  if(command.action==='cnj_fix')return cnjFixQuery(deps,command,now,extra);
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
  if(cnj){const digits=cnj[0].replace(/\D/g,'');const hit=list.filter(c=>hasCnj(c,digits));return hit.length===1?hit[0]:null}
  if(t.split(' ').length>6)return null;
  const hits=list.filter(c=>norm(c.nome).includes(t));
  return hits.length===1?hits[0]:null;
}

const QUERY_ACTIONS=Object.freeze(['help','deadlines','publications','process_status','daily_brief','pje_avisos','pje_open','pje_confirm','court_update','carteira_audit','cnj_fix','pje_teste','oab_set','process_register']);

module.exports={oabMessage,parseOfficeQuery,executeOfficeQuery,processHint,isLegalQuestion,pickChoice,dailyBriefText,QUERY_ACTIONS,HELP};
