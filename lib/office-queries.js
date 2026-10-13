'use strict';
// Consultas do dia a dia do advogado pelos canais (WhatsApp/Telegram/Web):
// prazos, intimações do DJEN, andamento de processo, resumo do dia e ajuda.
// Tudo aqui é determinístico: a resposta sai dos registros do escritório,
// nunca da IA. Prazo sem autorização humana aparece como "não confirmado";
// fonte indisponível é dita como indisponível, nunca como "nada novo".
const DeadlineWatch=require('./deadline-watch');
const {rowsFromResult}=require('./supabase');
const PjeMonitor=require('./pje-monitor');
const PjeProcessSync=require('./pje-process-sync');
const {hasCnj}=require('./pje-sync');
const {teorConfirmationPhrase}=require('./pje-mni');
const Andamentos=require('./andamentos');
const Datajud=require('./datajud');

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

  if(/^(\/?recibos?( do dia| de hoje)?|o que (voce|vc|o lex) fez hoje|o que (voce|vc) (ja )?fez( hoje)?|relatorio (do dia|de hoje)|o que (foi|ja foi) feito hoje)$/.test(t))
    return{action:'daily_receipts',requires_process:false};

  // Intimações do Diário (DJEN) a tratar (lib/djen-tratamento.js). Confirmar prazo, "sem prazo",
  // "não é nosso" e "já tratei" são atos do titular: só valem com a frase exata digitada por ele.
  const djen=parseDjenTratamento(raw,t);
  if(djen)return djen;

  const doctrinal=/\b(prazo|prazos)\s+(para|pra|de)\s+(contestar|recorrer|apelar|embargar|agravar|impugnar|apelacao|contestacao|recurso|embargos|agravo|resposta|manifestacao)\b|\b(qual|quanto)\s+(e\s+)?o\s+prazo\s+(legal|processual|para|pra|de)\b|\bcontagem\s+de\s+prazo\b|\bprazo\s+em\s+dobro\b|\bcpc\b|\bart(igo)?\.?\s*\d/;
  // Modelos do escritório (também sem IA): listar.
  if(/^\/?(modelos|meus modelos|modelos do escritorio|quais (sao )?(os |meus )?modelos( do escritorio)?)$/.test(t))
    return{action:'modelos',requires_process:false};

  // Financeiro (também sem IA): resumo de honorários, atrasos e o que vence. "Quem deve fazer"
  // é tarefa, não dívida; prazo, processo, tarefa e peça ficam com os seus executores.
  const financeiro=!/\b(prazos?|processos?|tarefas?|pecas?|minutas?|peticao|contestacao|recurso)\b/.test(t)&&(
    /^\/?(honorarios|financeiro|recebimentos|inadimplencia|inadimplentes)$/.test(t)
    ||/\b(honorarios|financeiro)\b.*\b(receber|recebid\w*|atras\w*|vencid\w*|mes|escritorio|resumo|como esta|como estao)\b/.test(t)
    ||/\bquem\s+(me\s+|nos\s+|ainda\s+)?(deve|esta devendo|ta devendo|nao pagou|atrasou)(\s+(honorarios?|parcelas?|pagamento|ao escritorio|pro escritorio|para o escritorio))?$/.test(t)
    ||/\bclientes?\b.*\b(devendo|em atraso|atrasad\w*|inadimpl\w*|nao pag\w*)\b/.test(t)
    ||/\bparcelas?\s+(vencidas?|atrasadas?|em atraso)\b/.test(t)
    ||/\binadimpl\w*\b/.test(t));
  if(financeiro)return{action:'honorarios',requires_process:false};
  // Planilha da carteira (também sem IA): a resposta ao resumo ("pode importar"), "importar a
  // planilha", "desfazer a importação", "descarta a planilha". Importar do PJe/OAB não é isto.
  if(/^(por favor\s+)?(lex\s*,?\s*)?(sim\s*,?\s*)?(pode\s+)?(importa|importe|importar)(\s+(tudo|os novos|eles|todos))?$/.test(t)
    ||/^(por favor\s+)?(lex\s*,?\s*)?(sim\s*,?\s*)?(pode\s+)?(importa|importe|importar)\b.*\bplanilha\b/.test(t))
    return{action:'carteira_importacao',acao:'importar',requires_process:false};
  if(/^(por favor\s+)?(lex\s*,?\s*)?(desfaz|desfazer|desfaca)\s+(a\s+|essa\s+|esta\s+|ultima\s+)?importac(ao|oes)\b/.test(t))
    return{action:'carteira_importacao',acao:'desfazer',requires_process:false};
  // "Cancela a importação" é ambíguo: com planilha esperando, não importa; depois, pergunta.
  if(/^(por favor\s+)?(lex\s*,?\s*)?(cancela|cancele|cancelar)\s+(a\s+|essa\s+|esta\s+|ultima\s+)?importac(ao|oes)\b/.test(t))
    return{action:'carteira_importacao',acao:'cancelar',requires_process:false};
  if(/^(por favor\s+)?(lex\s*,?\s*)?(descarta|descarte|descartar|esquece|esqueca|nao importe|nao importar)\s+(a\s+|essa\s+|esta\s+)?planilha\b/.test(t))
    return{action:'carteira_importacao',acao:'descartar',requires_process:false};

  // Painel do escritório: indicadores e o que pede ação (produção, êxito, parados).
  // Ordem com verbo de ação ("atualize os processos parados") segue para o executor próprio.
  const ordemDeAcao=/^(por favor\s+)?(lex\s*,?\s*)?(atualiz|sincroniz|puxe|traga|analis|fac|faz|elabor|prepar|redij|mand|envi|respond|cadastr|mov|distribu|arquiv|exclu|apag)\w*\b/.test(t);
  if(!ordemDeAcao&&(/^\/?(painel|indicadores|desempenho|produtividade|metricas|taskscore)( (do|da|de) (escritorio|equipe|carteira|time))?$/.test(t)
    ||/\b(painel|indicadores|desempenho|produtividade|metricas)\b.*\b(escritorio|equipe|carteira|time|advogad[oa]s?)\b/.test(t)
    ||/\b(processos|casos)\s+(que\s+)?(estao\s+|ficaram\s+|tao\s+)?parados\b/.test(t)
    ||/\btaxa de (exito|sucesso|vitoria)\b/.test(t)))
    return{action:'office_panel',requires_process:false};
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

// Frases do titular para tratar intimação do Diário. Número = nº da intimação no LEX (djen_id).
const NUM_INTIMACAO=String.raw`(?:(?:a\s+)?intima[cç][aã]o\s+)?(?:n[ºo°]?\.?\s*|#\s*)?(\d{3,20})`;
const RX_CONFIRMO_PRAZO=new RegExp(String.raw`^\s*confirmo\s+(?:o\s+)?prazo\s+(?:d[aeo]\s+)?`+NUM_INTIMACAO+String.raw`\s+(?:para\s+|em\s+|vencendo\s+(?:em\s+)?|vence\s+(?:em\s+)?)?(\d{1,2})\/(\d{1,2})\/(\d{4})\s*[.!]?\s*$`,'i');
const RX_TRATAR=new RegExp(String.raw`^\s*(sem\s+prazo|n[aã]o\s+[eé]\s+noss[oa]|j[aá]\s+tratei|tratada\s+fora)\s+(?:d[aeo]\s+)?`+NUM_INTIMACAO+String.raw`(?:\s*[-—:,;]\s*(.{1,300}?))?\s*[.!]?\s*$`,'i');
const RX_REABRIR=new RegExp(String.raw`^\s*reabr(?:ir|a|e)\s+`+NUM_INTIMACAO+String.raw`\s*[.!]?\s*$`,'i');
function parseDjenTratamento(raw,t){
  let m=raw.match(RX_CONFIRMO_PRAZO);
  if(m){
    const dia=m[2].padStart(2,'0'),mes=m[3].padStart(2,'0'),ano=m[4];
    return{action:'djen_confirmar_prazo',requires_process:false,djen_id:m[1],due_at:ano+'-'+mes+'-'+dia};
  }
  // Sem a data: não confirma — devolve a frase completa com a data proposta.
  m=raw.match(new RegExp(String.raw`^\s*confirmo\s+(?:o\s+)?prazo\s+(?:d[aeo]\s+)?`+NUM_INTIMACAO+String.raw`\s*[.!]?\s*$`,'i'));
  if(m)return{action:'djen_confirmar_prazo',requires_process:false,djen_id:m[1],due_at:null};
  m=raw.match(RX_TRATAR);
  if(m){
    const k=norm(m[1]);
    const acao=k==='sem prazo'?'sem_prazo':/^nao e noss/.test(k)?'nao_e_nosso':'tratada_fora';
    return{action:'djen_tratar',requires_process:false,djen_id:m[2],acao,motivo:m[3]?m[3].trim():null};
  }
  m=raw.match(RX_REABRIR);
  if(m&&/intimac/.test(t))return{action:'djen_reabrir',requires_process:false,djen_id:m[1]};
  if(/^\/?(intimacoes|publicacoes|diario)( do diario)? (a|pra|para) tratar$|^(o que|que) (falta|tem|ha) (a |pra |para )?tratar( no diario| do diario)?$|^(intimacoes|publicacoes) (pendentes|sem tratar|nao tratadas)$/.test(t)
    ||/\b(intimac(ao|oes)|publicac(ao|oes))\b.*\b(a tratar|pra tratar|para tratar|sem tratar|nao tratad\w*|pendentes? de tratamento)\b/.test(t))
    return{action:'djen_pendentes',requires_process:false};
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
const {ymdSP}=require('./data-brasil');
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

// Do mais novo para o mais antigo pela data real, em qualquer formato (lib/andamentos.js).
function sortedMovements(p){return Andamentos.ordenarAndamentos(p.andamentos)}
// Leitura oficial: hora de Brasília e a fonte (o registro guarda em UTC).
const FMT_QUANDO=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function quandoEmBrasilia(iso){const ms=Date.parse(iso||'');return Number.isFinite(ms)?FMT_QUANDO.format(new Date(ms)).replace(',',''):null}
function leituraOficialTexto(p){
  const quando=quandoEmBrasilia(p?.last_court_sync_at);if(!quando)return null;
  const fonte={datajud:'Datajud',pje:'PJe',djen:'Diário (DJEN)'}[String(p.last_court_sync_source||'').toLowerCase()]||null;
  return quando+' (Brasília)'+(fonte?', pelo '+fonte:'');
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
      for(const a of movs){const d=Andamentos.dataLegivel(a);lines.push('• '+(d?d+' — ':'')+Andamentos.textoDoAndamento(a).slice(0,220))}
    }else lines.push('Nenhum andamento registrado.');
    if(p.proxacao)lines.push('Próxima ação: '+String(p.proxacao).slice(0,200));
  }
  if(p.last_court_sync_at)lines.push('Última leitura oficial: '+(leituraOficialTexto(p)||String(p.last_court_sync_at).slice(0,16).replace('T',' ')));
  else lines.push('Sem leitura oficial registrada. Peça "atualize este processo" para consultar o tribunal.');
  if(p.datajud_nao_encontrado_em)lines.push('⚠️ O Datajud não encontrou este número na última tentativa ('+(quandoEmBrasilia(p.datajud_nao_encontrado_em)||'data não registrada')+', Brasília): pode ser segredo de justiça ou número a conferir.');
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
    '⚠️ Abrir o teor do aviso '+a.sigla+' #'+a.id_aviso+' ('+a.tipo_descricao+(a.processo_nome?' — '+a.processo_nome:'')+') REGISTRA A CIÊNCIA no PJe agora.',
    PjeMonitor.REGRA_DJEN,
    a.ciencia_tacita_data?'Sem abrir, a ciência tácita no sistema ocorre em '+a.ciencia_tacita_data.split('-').reverse().join('/')+' às 23:59.':'',
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
    const lines=['✅ Ciência registrada no PJe ('+a.sigla+' #'+a.id_aviso+'). Para o advogado, o prazo conta da publicação no DJEN (Res. CNJ 455/2022, art. 11, §3º): confira a data lá. Só se o ato não saiu no DJEN o prazo corre do dia útil seguinte a hoje (CPC, art. 231, V).'];
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

// "Atualize o processo": pelo PJe quando ele está ligado e cobre o tribunal do processo. Senão,
// para UM processo, lê o Datajud agora — e diz que é a base pública do CNJ (atrasa e não traz o
// Diário). Sem nenhuma fonte, diz que não consultou (ok:false); nunca "atualizado" sem leitura.
const AVISO_DATAJUD='O Datajud é a base pública do CNJ: pode atrasar alguns dias e não traz o Diário (intimações). Para prazo, vale a publicação.';
function semFonte(faltando){return'O PJe ainda não está conectado a este LEX (faltam '+faltando.join(', ')+') e o Datajud também não (falta a chave DATAJUD_API_KEY): não consigo consultar o tribunal agora. Nada foi atualizado.'}
function motivoSemPje(report){
  if(report.sem_cnj?.length)return'O cadastro não tem número CNJ completo, então o PJe não leu este processo.';
  if(report.sem_tribunal?.length)return'O PJe ligado não cobre o tribunal deste processo ('+(report.sem_tribunal[0].tribunal||'tribunal não identificado')+').';
  if(report.falhas?.length)return'O PJe não respondeu para este processo: '+report.falhas[0].erro;
  return'O PJe não leu este processo.';
}
async function courtUpdateQuery(deps,command,now){
  const pje=deps.pje,pjeLigado=!!(pje?.config?.configurado&&pje.client);
  const faltandoPje=pje?.config?.faltando?.length?pje.config.faltando:['PJE_MNI_TRIBUNAIS','PJE_MNI_CPF','PJE_MNI_SENHA'];
  const apiKey=deps.datajudApiKey??process.env.DATAJUD_API_KEY,temDatajud=!!String(apiKey||'').trim();
  let viaPje=null;
  if(pjeLigado){
    const report=await PjeProcessSync.syncProcessesFromPje({client:pje.client,processStore:deps.processStore,now,processId:command.processo_id??null,oabs:(()=>{try{return require('./djen-monitor').parseOabs()}catch{return[]}})()});
    if(command.processo_id==null||report.atualizados.length||!temDatajud)
      return{handled:true,command,result:{...report,ok:report.ok&&(command.processo_id==null||report.atualizados.length>0),fonte:'pje'},message:PjeProcessSync.syncReportMessage(report)};
    viaPje=report; // o PJe não leu este processo: tenta o Datajud
  }
  if(command.processo_id==null){
    const message=temDatajud
      ?'O PJe não está ligado a este LEX, então não leio a carteira inteira agora. O Datajud (base pública do CNJ) lê todos os processos ativos toda manhã, na rotina diária. Para ler um processo agora, diga qual — o nome do cliente ou o número.'
      :semFonte(faltandoPje);
    return{handled:true,command,result:{ok:false,configurado:false,fonte:null},message};
  }
  if(!temDatajud)
    return{handled:true,command,result:{ok:false,configurado:false,fonte:null},message:semFonte(faltandoPje)};
  const processes=await readProcesses(deps);
  const p=processes.find(x=>String(x.id)===String(command.processo_id));
  if(!p)return{handled:true,command,needs_input:true,result:{ok:false},message:'Não encontrei esse processo no LEX.'};
  const antes=viaPje?motivoSemPje(viaPje)+'\n':'';
  let r;
  try{r=await Datajud.syncProcess(deps.processStore,p.id,{apiKey,integrityKey:deps.integrityKey,fetchImpl:deps.fetchImpl||globalThis.fetch,actor:'LEX Datajud'})}
  catch(error){return{handled:true,command,result:{ok:false,fonte:'datajud',erro:error.message},message:antes+'Não consegui ler o Datajud agora: '+error.message+' Nada foi alterado no processo.'}}
  if(!r.ok)return{handled:true,command,result:{ok:false,fonte:'datajud',nao_encontrado:!!r.nao_encontrado,tribunal_datajud:r.alias||null},
    message:antes+r.error+' Confira o número no cadastro; se estiver certo, acompanhe pelo site do tribunal.'};
  const lines=[antes+'✅ Li '+safeProcessLabel(p)+' no Datajud agora: '+r.novos+' andamento(s) novo(s).'];
  for(const a of r.novos_andamentos.slice(0,5)){const d=Andamentos.dataLegivel(a);lines.push('• '+(d?d+' — ':'')+String(a.texto).slice(0,200))}
  if(r.novos>5)lines.push('• e mais '+(r.novos-5)+'.');
  lines.push(AVISO_DATAJUD);
  return{handled:true,command,result:{ok:true,fonte:'datajud',novos:r.novos,consultados:r.consultados,corrigidos:r.corrigidos||0,novos_andamentos:r.novos_andamentos,tribunal_datajud:r.alias,lido_em:r.reading?.observed_at||null},message:lines.join('\n')};
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
  'Por trás desses setores, o backend registra 14 agentes internos: Roteador, Cadastrador/Autuação, Cobrador, Assessor, Jurídico judicial, Jurídico administrativo, Pesquisa decisória, Pericial, PJe, Coordenador, Redação, Revisão, Controladoria e Documental. Você não precisa escolher um deles: eu aciono o especialista correto conforme a ordem.',
  'Análise do processo é função do Assessor/Jurídico; perfil e padrão decisório do magistrado ficam em Pesquisa decisória; jurisprudência é pesquisa especializada acionada pelo LEX com fonte verificável.',
  '',
  'Dê a ordem assim: "LEX, quero X, no processo Y, faça desse jeito Z". Você também pode falar normalmente: "prazos de hoje", "tem intimação nova?", "como está o processo X?", "analise este processo", "painel do escritório" ou "perfil do magistrado". Se faltar processo, documento, autorização ou dado, eu pergunto só o que estiver faltando e continuo dali.',
  '',
  'Mesmo sem IA paga eu continuo executando rotinas determinísticas do escritório: consultar a carteira, conferir números, atualizar fontes já conectadas, mostrar prazos e publicações, mover processo entre setores, cadastrar contato/processo e organizar a fila.',
  'Análise jurídica livre, redação de peça, jurisprudência e texto pericial precisam do provedor de IA com crédito. Se o crédito acabar, eu aviso somente nessa etapa; o banco e os demais setores continuam funcionando.',
  'Atos críticos — protocolo, ciência, envio sensível e outras ações com efeito externo — continuam sujeitos à autorização humana.'
].join('\n');

// Painel do escritório: carteira, êxito, prazos oficiais, produção, equipe e alertas
// acionáveis — tudo dos registros (office-insights.js). Secretária vê o painel sem
// o bloco de equipe e responsáveis.
async function officePanelQuery(deps,command,now,extra={}){
  const Insights=require('./office-insights');
  const processes=await readProcesses(deps);
  let prazos=null;
  try{prazos=DeadlineWatch.watchlist(processes,now,[],[],{integrityKey:deps.integrityKey})}catch(e){deps.log?.('[LEX] painel: prazos '+e.message)}
  let tasks=null;
  if(typeof deps.engine?.list==='function'){try{tasks=await deps.engine.list()}catch(e){deps.log?.('[LEX] painel: tarefas '+e.message)}}
  const opcoes={};
  if(Number(command.dias_parado)>=30)opcoes.dias_parado=Math.min(Math.floor(Number(command.dias_parado)),365);
  const r=Insights.computeOfficeInsights({processes,tasks,prazos,now,opcoes});
  const incluirEquipe=extra.profile!=='secretaria';
  const result=incluirEquipe?r:{...r,equipe:null,responsaveis:[]};
  return{handled:true,command,result,message:Insights.officeInsightsMessage(result,{incluirEquipe})};
}

// Planilha da carteira: importar ou desfazer (lib/carteira-import.js). A leitura e a
// conversa acontecem quando o arquivo chega; aqui só a ordem do titular.
async function carteiraImportacaoQuery(deps,command,extra={}){
  const I=deps.carteiraImport||require('./carteira-import').current();
  if(!I)return{handled:true,command,message:'A importação de planilha não está disponível neste servidor.'};
  let r;
  if(command.acao==='desfazer'){
    // Sem a lista de tarefas, desfazer não apaga nada (erro ao listar não vira "nenhuma tarefa").
    let tarefas=null;try{tarefas=deps.engine?.list?await deps.engine.list():null}catch{tarefas=null}
    r=await I.desfazer({perfil:extra.profile,tarefas});
  }else if(command.acao==='descartar')r=await I.descartar({perfil:extra.profile});
  else if(command.acao==='cancelar')r=await I.cancelar({perfil:extra.profile});
  else r=await I.importar({perfil:extra.profile});
  return{handled:true,command,result:r,message:r.texto||r.erro||'Feito.'};
}

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
  // O que falta tratar do Diário, de qualquer dia: só sai daqui com a decisão do titular.
  try{const T=require('./djen-tratamento');const r=await T.listarPendentes(deps,{now});parts.push(T.linhaResumo(r))}
  catch(e){parts.push('📌 Diário: não consegui ler o que falta tratar ('+e.message+'). Isso NÃO significa que não há intimações.')}
  const pje=await pjeSection(deps).catch(()=>null);
  if(pje?.listed){
    const p=pje.proxima;
    parts.push('\n⚖️ PJe: '+pje.pendentes+' expediente(s) pendente(s) — só aviso; prazo do advogado conta do DJEN'+(p?' · próxima ciência tácita no sistema: '+(p.dias_para_ciencia_tacita<=0?'HOJE':'em '+p.dias_para_ciencia_tacita+'d')+' ('+(p.processo_nome||p.cnj||p.sigla)+')':''));
  }
  try{const r=require('./carteira-audit').auditCarteira({processes:await readProcesses(deps)});if(r.problemas.length)parts.push('\n🔢 '+r.problemas.length+' processo(s) com número CNJ faltando ou errado — diga "confira os números" que eu acho o número certo.')}catch(e){deps.log?.('[LEX] conferência CNJ no resumo: '+e.message)}
  try{
    const Insights=require('./office-insights');
    const procs=await readProcesses(deps);
    // Tarefa indisponível não apaga o resto do painel (prazos e processos parados continuam).
    let tasks=null;
    if(typeof deps.engine?.list==='function'){try{tasks=await deps.engine.list()}catch(e){deps.log?.('[LEX] painel no resumo: tarefas '+e.message)}}
    const line=Insights.officeInsightsBriefLine(Insights.computeOfficeInsights({processes:procs,tasks,prazos:DeadlineWatch.watchlist(procs,now,[],[],{integrityKey:deps.integrityKey}),now}));
    if(line)parts.push('\n'+line);
  }catch(e){deps.log?.('[LEX] painel no resumo: '+e.message)}
  if(typeof extra.workQueue==='function'){
    try{const w=await extra.workQueue();parts.push('\n📋 '+w.message)}catch(e){parts.push('\n📋 Pendências: não consegui ler ('+e.message+').')}
  }
  parts.push('\nDiga "prazos da semana", "tem intimação nova?" ou "o que precisa de mim" para detalhar.');
  return{handled:true,command,message:parts.join('\n')};
}

// Recibos do dia: tudo que o LEX FEZ hoje (Brasília), com hora, alvo, quem autorizou e origem.
// Determinístico e só a partir de registros gravados: ordens enviadas pelos canais
// (outbox), atendimentos da recepção, andamentos importados (datajud/djen/pje/conector),
// prazos confirmados ou baixados e tarefas concluídas. Nada é estimado; sem registro, sem recibo.
async function dailyReceipts(deps,command,now){
  const nowMs=now instanceof Date?now.getTime():Number(now)||Date.now();
  const today=ymdSP(new Date(nowMs));
  const dayOf=v=>{if(!v)return null;const str=String(v);if(/^\d{4}-\d{2}-\d{2}$/.test(str))return str;if(/^\d{2}\/\d{2}\/\d{4}$/.test(str)){const[a,b,c]=str.split('/');return c+'-'+b+'-'+a}const d=new Date(str);return Number.isNaN(d.getTime())?null:ymdSP(d)};
  const hm=v=>{const d=v?new Date(v):null;if(!d||Number.isNaN(d.getTime()))return '';return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(d)};
  const receipts=[],failures=[];
  const add=r=>receipts.push({tipo:r.tipo,hora:hm(r.quando)||'',quando:r.quando||null,oque:String(r.oque||'').slice(0,300),para:String(r.para||'').slice(0,160),autorizado_por:r.autorizado_por||null,origem:r.origem||null,ref:r.ref||null});
  // 1) Ordens/mensagens enviadas pelos canais (WhatsApp/Telegram) — outbox
  try{
    const rows=typeof deps.records?.list==='function'?await deps.records.list('lex_channel_command_'):[];
    for(const j of rows||[]){
      if(!j)continue;
      if(j.status==='enviado'&&dayOf(j.enviado_em)===today)add({tipo:'mensagem_enviada',quando:j.enviado_em,oque:j.texto_final||j.comando,para:(j.origem||'canal')+' · '+(j.contato_nome||j.contato_id||''),autorizado_por:j.confirmado_por||j.autor||'titular',origem:j.origem,ref:j.id});
      else if(j.status==='confirmado'&&dayOf(j.confirmado_em)===today)add({tipo:'ordem_confirmada',quando:j.confirmado_em,oque:j.texto_final||j.comando,para:(j.origem||'canal')+' · '+(j.contato_nome||j.contato_id||''),autorizado_por:j.confirmado_por||'titular',origem:j.origem,ref:j.id});
    }
  }catch{failures.push('mensagens dos canais')}
  // 2) Atendimentos da recepção (WhatsApp) — eventos persistidos de saída do LEX hoje.
  // A fila atual não serve como histórico: contatos podem mudar de status e o volume pode passar de uma página.
  try{
    const store=deps.reception||deps.receptionStore;
    if(store&&typeof store.listEvents==='function'){
      const start=new Date(today+'T00:00:00-03:00').toISOString();
      const end=new Date(new Date(today+'T00:00:00-03:00').getTime()+86400000).toISOString();
      const pageSize=100;
      for(let offset=0;;offset+=pageSize){
        const page=await store.listEvents({since:start,until:end,limit:pageSize,offset});
        const rows=Array.isArray(page)?page:[];
        for(const it of rows){
          if(it?.direcao!=='saida_lex'||dayOf(it.criado_em)!==today)continue;
          add({tipo:'atendimento_recepcao',quando:it.criado_em,oque:'Respondi '+(it.nome||it.numero||'contato')+(it.texto?' · '+it.texto:''),para:'WhatsApp · '+(it.numero||''),autorizado_por:null,origem:'whatsapp',ref:it.numero||null});
        }
        if(rows.length<pageSize)break;
      }
    }else if(store&&typeof store.list==='function'){
      // Compatibilidade com implementações antigas/injetadas: pagina a fila, sem limitar a 50.
      let afterNumero='';
      for(;;){
        const rows=await store.list({status:'aguardando_advogado',limit:100,afterNumero});
        const items=Array.isArray(rows)?rows:[];
        for(const it of items){
          const stamp=it.atualizado_em||it.ultimo_contato||it.criado_em;
          if(dayOf(stamp)===today)add({tipo:'atendimento_recepcao',quando:stamp,oque:'Acolhi '+(it.nome||it.numero||'contato')+(it.classe?' · '+it.classe:'')+' — sem posição do escritório; aguarda você',para:'WhatsApp · '+(it.numero||''),autorizado_por:null,origem:'whatsapp',ref:it.numero||null});
        }
        if(items.length<100)break;
        const next=String(items.at(-1)?.numero||'').replace(/\D/g,'');
        if(!next||next===afterNumero)break;
        afterNumero=next;
      }
    }
  }catch{failures.push('recepção')}
  // 3) Andamentos importados hoje, prazos confirmados/baixados hoje
  try{
    const processes=await readProcesses(deps);
    for(const p of processes){
      const label=safeProcessLabel(p);
      for(const a of Array.isArray(p.andamentos)?p.andamentos:[]){
        const stamp=a.importado_em||a.criado_em||null;
        const src=a.origem||(/^\[DATAJUD\]/.test(String(a.txt||''))?'datajud':/^\[DJEN\]/i.test(String(a.txt||''))?'djen':/^\[PJe\]/i.test(String(a.txt||''))?'pje':null);
        if(src&&src!=='lex'&&(stamp?dayOf(stamp)===today:dayOf(a.data)===today))add({tipo:'andamento_registrado',quando:stamp||null,oque:String(a.txt||'').slice(0,200),para:label,autorizado_por:null,origem:src,ref:p.id});
      }
      // Cada confirmação do dia (o processo pode ter vários prazos, um por intimação): do histórico assinado.
      const confirmacoes=(Array.isArray(p.deadline_history)?p.deadline_history:[]).filter(h=>h&&dayOf(h.confirmed_at)===today);
      if(confirmacoes.length){
        for(const h of confirmacoes)add({tipo:'prazo_confirmado',quando:h.confirmed_at,oque:'Prazo confirmado para '+(h.truth?.due_at||h.authorization?.due_at||'')+(h.djen_id?' (intimação nº '+h.djen_id+' do DJEN)':''),para:label,autorizado_por:h.authorization?.human_id||'titular',origem:'djen',ref:p.id});
      }else if(p.prazo_confirmado_em&&dayOf(p.prazo_confirmado_em)===today)add({tipo:'prazo_confirmado',quando:p.prazo_confirmado_em,oque:'Prazo confirmado para '+(p.prazoReal||p.prazo||'')+(p.djen_id_origem?' (publicação DJEN)':''),para:label,autorizado_por:p.prazo_confirmado_por||'titular',origem:p.djen_id_origem?'djen':'manual',ref:p.id});
      // Baixas do dia: uma por prazo (a baixa parcial deixa o processo com o próximo prazo aberto).
      const baixas=(Array.isArray(p.prazos_cumpridos)?p.prazos_cumpridos:[]).filter(c=>c&&!c.desfeito_em&&dayOf(c.marcado_em)===today);
      if(baixas.length){
        for(const c of baixas)add({tipo:'prazo_cumprido',quando:c.marcado_em,oque:'Prazo de '+(c.due_at||'')+' marcado como cumprido'+(c.djen_id?' (intimação nº '+c.djen_id+')':''),para:label,autorizado_por:c.marcado_por||'titular',origem:'lex',ref:p.id});
      }else if(p.prazo_baixa?.ativa===true&&dayOf(p.prazo_baixa.marcado_em)===today)add({tipo:'prazo_cumprido',quando:p.prazo_baixa.marcado_em,oque:'Prazo de '+(p.prazo_baixa.vencimento||'')+' marcado como cumprido',para:label,autorizado_por:p.prazo_baixa.marcado_por||'titular',origem:'lex',ref:p.id});
    }
  }catch{failures.push('processos e prazos')}
  // 4) Tarefas do Task Engine concluídas hoje e entregas prontas hoje
  let concluidas=0,andamento=0,aguardam=0;
  try{
    const tasks=typeof deps.engine?.list==='function'?await deps.engine.list():[];
    for(const t of tasks||[]){
      if(!t)continue;
      if(['na_fila','executando'].includes(t.status))andamento++;
      if(['aguardando_revisao','aguardando_dados','aguardando_documento_nitido','aguardando_configuracao','falhou'].includes(t.status))aguardam++;
      if(t.status==='concluida'&&dayOf(t.revisado_em||t.atualizada_em)===today){concluidas++;add({tipo:'tarefa_concluida',quando:t.revisado_em||t.atualizada_em,oque:(t.tipo||'tarefa')+' aprovada'+(t.processo_nome?' — '+t.processo_nome:''),para:t.agente||'',autorizado_por:t.revisado_por||'titular',origem:'task_engine',ref:t.id});}
      if(t.status==='aguardando_revisao'&&dayOf(t.atualizada_em)===today)add({tipo:'minuta_pronta',quando:t.atualizada_em,oque:(t.tipo||'minuta')+' pronta para sua revisão'+(t.processo_nome?' — '+t.processo_nome:''),para:t.agente||'',autorizado_por:null,origem:'task_engine',ref:t.id});
    }
  }catch{failures.push('tarefas')}
  // 5) Registro da rotina noturna (Datajud/DJEN), quando o servidor guarda
  try{
    const log=typeof deps.records?.read==='function'?(await deps.records.read('lex_rotina_noturna_'+today))?.value:null;
    if(log)add({tipo:'rotina_noturna',quando:log.terminou_em||log.iniciou_em,oque:log.datajud_ativo===false?'Rotina do dia rodou SEM Datajud (chave não configurada): a carteira não foi atualizada no CNJ'+(log.djen_consultadas?' · DJEN: '+log.djen_consultadas+' comunicações lidas':''):'Atualizei a carteira: '+Number(log.consultados||0)+' consultados · '+Number(log.novos||0)+' andamentos novos · '+Number(log.erros||0)+' erros'+(log.djen_consultadas?' · DJEN: '+log.djen_consultadas+' comunicações lidas':''),para:'Datajud/DJEN',autorizado_por:null,origem:'datajud',ref:null});
  }catch{/* opcional */}
  receipts.sort((a,b)=>String(b.quando||'').localeCompare(String(a.quando||'')));
  const contagens={concluidas,em_andamento:andamento,aguardam_voce:aguardam,recibos:receipts.length};
  const message=receipts.length?'Hoje ('+brDate(today)+') eu fiz '+receipts.length+' coisa'+(receipts.length===1?'':'s')+' registrada'+(receipts.length===1?'':'s')+': '+receipts.slice(0,5).map(r=>(r.hora?r.hora+' ':'')+r.oque).join(' · ')+(receipts.length>5?' · e mais '+(receipts.length-5):'')
    :'Hoje ('+brDate(today)+') não há ação minha registrada'+(failures.length?' — e não consegui ler '+failures.join(', ')+'.':'.');
  return{handled:true,command,result:{dia:today,recibos:receipts,contagens,falhas:failures},message};
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

// Intimações do Diário a tratar: listar (qualquer perfil) e os atos do titular (admin/advogado).
async function djenTratamentoQuery(deps,command,now,extra={}){
  const T=require('./djen-tratamento');
  const perfil=String(extra.profile||'');
  try{
    if(command.action==='djen_pendentes'){
      const r=await T.listarPendentes(deps,{now});
      return{handled:true,command,result:{total:r.total,orfas:r.orfas,urgentes:r.urgentes,pendentes:r.pendentes.slice(0,20)},message:T.mensagemPendentes(r)};
    }
    if(command.action==='djen_tratar'){
      const r=await T.tratar(deps,{djenId:command.djen_id,acao:command.acao,motivo:command.motivo,perfil,now});
      const t=r.tratamento;
      return{handled:true,command,result:r,message:r.ja_tratada
        ?'A intimação nº '+r.djen_id+' já estava marcada ('+t.descricao+', por '+t.por+' em '+brDate(String(t.em).slice(0,10))+'). Nada mudou.'
        :'✅ Intimação nº '+r.djen_id+' marcada: '+t.descricao+(t.motivo?' — '+t.motivo:'')+'. Ela sai da lista do que falta tratar e fica registrada (você, '+brDate(ymdSP(now))+'). Para desfazer: REABRIR INTIMAÇÃO '+r.djen_id+'.'};
    }
    if(command.action==='djen_reabrir'){
      const r=await T.reabrir(deps,{djenId:command.djen_id,perfil,now});
      return{handled:true,command,result:r,message:r.ok?'↩️ Intimação nº '+r.djen_id+' voltou para a lista do que falta tratar.':r.erro};
    }
    // Confirmar o prazo de uma intimação casada: ato do titular, com a data que ele digitou.
    if(!['admin','advogado'].includes(perfil))return{handled:true,command,message:'Só o advogado ou o administrador pode confirmar prazo.'};
    const dbReq=typeof deps.sbReq==='function'?deps.sbReq:deps.records?.request;
    if(typeof dbReq!=='function')return{handled:true,command,message:'Banco de intimações indisponível: o prazo NÃO foi confirmado.'};
    const Auth=require('./deadline-authorization');
    let row;
    try{row=await Auth.getCommunication(dbReq,command.djen_id)}catch(e){return{handled:true,command,message:e.message+' O prazo NÃO foi confirmado.'}}
    if(row.status==='orfa')return{handled:true,command,message:'A intimação nº '+command.djen_id+' é de um processo que não está cadastrado no LEX ('+T.cnjMask(row.cnj)+'). Cadastre primeiro — diga "cadastre o processo '+T.cnjMask(row.cnj)+'" — e depois confirme o prazo. Nada foi confirmado.'};
    const sug=row.prazo_sugestao&&typeof row.prazo_sugestao==='object'?row.prazo_sugestao:null;
    if(!command.due_at)return{handled:true,command,needs_input:true,message:'Para confirmar, digite também a data final: CONFIRMO PRAZO '+row.djen_id+' '+(sug?.due_at_proposto?brDate(sug.due_at_proposto):'dd/mm/aaaa')
      +(sug?.due_at_proposto?' (data que o LEX propôs: '+brDate(sug.due_at_proposto)+(sug.dias?', '+sug.dias+' dias':'')+'; confira antes).':'.')+' Nada foi confirmado.'};
    const out=await Auth.confirmDjenDeadline({processStore:deps.processStore,sbReq:dbReq,djenId:row.djen_id,dueAt:command.due_at,humanId:perfil,
      regime:sug?.regime||'manual',note:'Confirmado pela frase do titular no canal',suggestionSourceHash:sug?.source_hash||null,
      integrityKey:deps.integrityKey??deps.courtReadingIntegrityKey??process.env.COURT_READING_INTEGRITY_KEY,now,
      refreshCommunication:r=>require('./djen-monitor').refreshCommunication({sbReq:dbReq,row:r,clientOptions:{base:process.env.DJEN_BASE,gatewayKey:process.env.DJEN_GATEWAY_KEY,...(deps.djenClientOptions||{})}})});
    const diferente=sug?.due_at_proposto&&sug.due_at_proposto!==command.due_at;
    return{handled:true,command,result:{ok:true,processo_id:out.processo?.id||null,due_at:command.due_at,proposto:sug?.due_at_proposto||null,fila_atualizada:out.queue_updated},
      message:'✅ Prazo confirmado: '+safeProcessLabel(out.processo||{})+' vence em '+brDate(command.due_at)+'.'
        +(diferente?' (O LEX tinha proposto '+brDate(sug.due_at_proposto)+'; valeu a sua data.)':'')
        +(Array.isArray(out.outros_prazos_abertos)&&out.outros_prazos_abertos.length?'\nEste processo tem mais '+out.outros_prazos_abertos.length+' prazo(s) aberto(s): '+out.outros_prazos_abertos.map(x=>brDate(x.due_at)+(x.djen_id?' (nº '+x.djen_id+')':'')).join('; ')+'. Todos seguem na vigia.':'')
        +(out.data_manual_substituida?'\n⚠️ O processo tinha a data '+brDate(out.data_manual_substituida)+' anotada à mão; agora vale a confirmada. Se aquela era de outro prazo, anote de novo.':'')
        +(out.queue_updated===false?'\n⚠️ O prazo foi gravado no processo, mas a fila do Diário não confirmou a baixa ('+out.queue_error+'); ela pode continuar aparecendo como pendente.':'')};
  }catch(e){
    return{handled:true,command,message:(command.action==='djen_pendentes'?'Não consegui ler as intimações a tratar: ':'Não fiz: ')+e.message};
  }
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
  if(['djen_pendentes','djen_tratar','djen_reabrir','djen_confirmar_prazo'].includes(command.action))return djenTratamentoQuery(deps,command,now,extra);
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
  if(command.action==='daily_receipts')return dailyReceipts(deps,command,now);
  if(command.action==='office_panel')return officePanelQuery(deps,command,now,extra);
  if(command.action==='carteira_importacao')return carteiraImportacaoQuery(deps,command,extra);
  if(command.action==='modelos'){
    const M=deps.officeModels||require('./office-models').current();
    if(!M)return{handled:true,command,message:'Modelos do escritório indisponíveis neste servidor.'};
    const r=await M.listar();
    const linhas=r.modelos.map(x=>'• '+x.peca+': "'+x.nome+'" (versão '+x.versao+')');
    return{handled:true,command,result:r,message:(linhas.length?'Modelos do escritório que eu sigo ao redigir:\n'+linhas.join('\n'):'Ainda não há modelo do escritório. Mande o Word com "modelo" no nome (por exemplo, "modelo contestação.docx") que eu guardo.')+(r.arquivo_esperando_tipo?'\nO arquivo "'+r.arquivo_esperando_tipo+'" está esperando você dizer de qual peça é.':'')};
  }
  if(command.action==='honorarios'){
    const H=require('./honorarios');const r=H.resumoCarteira(await readProcesses(deps),ymdSP(now));
    const porResponsavel=String(extra.profile||'')!=='secretaria';
    if(!porResponsavel)r.por_responsavel=Object.create(null);
    return{handled:true,command,result:r,message:H.textoResumo(r,{porResponsavel})};
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

const QUERY_ACTIONS=Object.freeze(['help','deadlines','publications','process_status','daily_brief','daily_receipts','office_panel','carteira_importacao','honorarios','modelos','pje_avisos','pje_open','pje_confirm','court_update','carteira_audit','cnj_fix','pje_teste','oab_set','process_register','djen_pendentes','djen_tratar','djen_reabrir','djen_confirmar_prazo']);

module.exports={oabMessage,parseOfficeQuery,executeOfficeQuery,processHint,isLegalQuestion,pickChoice,dailyBriefText,leituraOficialTexto,quandoEmBrasilia,QUERY_ACTIONS,HELP};
