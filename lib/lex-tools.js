'use strict';
// =====================================================================
// FERRAMENTAS DO LEX — o corpo do agente vivo
// ---------------------------------------------------------------------
// A inteligência dirige: o modelo lê a conversa, decide e chama estas
// ferramentas. O código é o cinto de segurança, e ele mora AQUI, dentro de
// cada executor: o LEX não protocola, não dá ciência em intimação, não
// inventa prazo, não fala em nome do escritório sem aprovação humana e não
// grava nada sem confirmação da própria ferramenta. Tudo que sai daqui é
// registro verificável (recibo), nunca "sucesso" de texto.
//
// Uso: const T=require('./lex-tools');
//   T.definitions(ctx)              → lista de tools no formato da API Anthropic
//   await T.executar(name,input,deps,ctx) → {ok, ...resultado} (nunca lança)
// =====================================================================
const {executeOfficeQuery}=require('./office-queries');
const {hojeBrasil}=require('./data-brasil');

const norm=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const CNJ=/\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/;
const FINAL=/CONCLU|ARQUIV|ENTREGUE|GANHO|PERDIDO/i;
const TASK_TYPES=['analise','peticao','contestacao','recurso','pericia','quesitos','revisao'];

function processOfficial(p){return !!(p?.last_court_sync_at||p?.partes_verificadas_em||p?.cadastro_conferido==='tribunal'||p?.numero_verificado_fonte==='pje')}
function trustedDeadline(p){return !!(p?.deadline_truth===true||p?.prazo_confirmado===true||p?.prazo_confirmado_em||(p?.deadline_truth&&p.deadline_truth.legal_truth===true))}
function dueOf(p){const t=p?.deadline_truth;return (t&&typeof t==='object'&&t.due_at)||p?.prazoReal||p?.prazo||p?.dataPrazo||null}
function daysTo(due,now){if(!due)return null;const m=String(due).match(/^(\d{4})-(\d{2})-(\d{2})/);if(!m)return null;const d=new Date(+m[1],+m[2]-1,+m[3]);const n=new Date(now||Date.now());n.setHours(0,0,0,0);return Math.round((d-n)/86400000)}

// Resumo curto e seguro de um processo (nunca inventa: só campos gravados).
function resumo(p,now){
  const due=dueOf(p),d=daysTo(due,now);
  return{
    id:String(p.id),nome:p.nome_oficial||p.nome||p.partes||null,numero:p.numero||null,cliente:p.cliente||null,
    status:p.status||null,setor:p.setor||null,tribunal:p.tribunal||p.vara||null,
    dados_conferidos_no_tribunal:processOfficial(p),
    prazo:due?{data:due,dias:d,confirmado:trustedDeadline(p),cumprido:p?.prazo_baixa?.ativa===true}:null,
    ultimo_andamento:Array.isArray(p.andamentos)&&p.andamentos.length?p.andamentos[p.andamentos.length-1]:null
  };
}

async function readProcesses(deps){const s=await deps.processStore.read();return Array.isArray(s?.processes)?s.processes:[]}

// ---------------------------------------------------------------------
// Definições (o que o modelo enxerga)
// ---------------------------------------------------------------------
function definitions(ctx={}){
  const defs=[
    {name:'consultar_processos',description:'Procura processos da carteira por número CNJ, nome do cliente, parte ou assunto. Use antes de agir sobre um processo quando a pessoa não deu o número. Devolve até 10 candidatos; se vier mais de um parecido, PERGUNTE qual, nunca escolha o primeiro.',
      input_schema:{type:'object',properties:{busca:{type:'string',description:'Trecho: CNJ, nome, cliente, parte ou assunto'},somente_ativos:{type:'boolean'}},required:['busca']}},
    {name:'ver_processo',description:'Abre um processo da carteira: dados, últimos andamentos, prazo (e se está confirmado em fonte oficial), documentos anexados e tarefas em andamento. Use para responder qualquer pergunta factual sobre um caso.',
      input_schema:{type:'object',properties:{processo_id:{type:'string'}},required:['processo_id']}},
    {name:'prazos',description:'Lista os prazos do escritório numa janela (hoje, amanhã, semana, quinzena, mês). Só prazos confirmados em fonte oficial contam como prazo; os anotados à mão aparecem como "a conferir".',
      input_schema:{type:'object',properties:{janela:{type:'string',enum:['hoje','amanha','semana','quinzena','mes']}},required:[]}},
    {name:'publicacoes',description:'Intimações e publicações do Diário (DJEN) das OABs do escritório nos últimos N dias, com o que ainda aguarda confirmação de prazo.',
      input_schema:{type:'object',properties:{dias:{type:'integer',minimum:1,maximum:30}},required:[]}},
    {name:'atualizar_no_tribunal',description:'Busca movimentações novas de UM processo nas fontes oficiais (Datajud/PJe). Não dá ciência de intimação. Use quando a pessoa perguntar "como está" um processo e os dados estiverem velhos.',
      input_schema:{type:'object',properties:{processo_id:{type:'string'}},required:['processo_id']}},
    {name:'criar_tarefa',description:'Cria uma tarefa de produção jurídica no Task Engine (análise, petição, contestação, recurso, perícia, quesitos, revisão) para um processo. O LEX executa a tarefa em segundo plano e a minuta vai para revisão humana; nada é protocolado. Use quando a pessoa pedir uma peça, análise ou perícia.',
      input_schema:{type:'object',properties:{tipo:{type:'string',enum:TASK_TYPES},processo_id:{type:'string'},instrucao:{type:'string',description:'O que fazer, com o contexto que a pessoa deu'}},required:['tipo','processo_id','instrucao']}},
    {name:'ordem_operacional',description:'Executa uma ordem operacional do escritório pelo executor validado (com permissões e travas): confirmar prazo sugerido pelo Diário, cadastrar processo/cliente, mover setor, distribuir, responder um contato pelo canal (a resposta exige aprovação humana quando envolve posição do escritório), ver o que precisa de você. Escreva a ordem em português, curta e literal, como o titular diria. Se o executor pedir escolha de processo, devolva as opções à pessoa.',
      input_schema:{type:'object',properties:{texto:{type:'string'},processo_id:{type:'string'}},required:['texto']}},
    {name:'recibos_do_dia',description:'O que o LEX fez hoje, registrado: mensagens enviadas, clientes acolhidos, andamentos importados, prazos confirmados, tarefas concluídas, rotina noturna.',
      input_schema:{type:'object',properties:{},required:[]}},
    {name:'tarefas',description:'Lista as tarefas do Task Engine (em andamento, aguardando revisão, falhas) — para dizer o que está em produção e o que precisa da pessoa.',
      input_schema:{type:'object',properties:{status:{type:'string'}},required:[]}}
  ];
  return defs;
}

// ---------------------------------------------------------------------
// Executores (o cinto de segurança mora aqui)
// ---------------------------------------------------------------------
const HANDLERS={
  async consultar_processos(input,deps,ctx){
    const q=norm(input.busca);if(q.length<2)return{ok:false,erro:'Informe pelo menos 2 caracteres.'};
    const all=await readProcesses(deps);
    const digits=String(input.busca||'').match(CNJ)?String(input.busca).match(CNJ)[0].replace(/\D/g,''):null;
    let rows=all.filter(p=>!(input.somente_ativos&&FINAL.test(String(p.status||''))));
    rows=digits?rows.filter(p=>String(p.numero||'').replace(/\D/g,'')===digits):rows.filter(p=>norm([p.nome,p.nome_oficial,p.numero,p.cliente,p.partes,p.assunto].join(' ')).includes(q));
    return{ok:true,total:rows.length,processos:rows.slice(0,10).map(p=>resumo(p,ctx.now)),observacao:rows.length>1?'Mais de um processo compatível: pergunte à pessoa qual é antes de agir.':rows.length===0?'Nenhum processo com esse dado. Não invente; pergunte o número ou o nome do cliente.':null};
  },
  async ver_processo(input,deps,ctx){
    const all=await readProcesses(deps);const p=all.find(x=>String(x.id)===String(input.processo_id));
    if(!p)return{ok:false,erro:'Processo não encontrado na carteira.'};
    let tarefas=[];try{tarefas=(await deps.engine?.list?.()||[]).filter(t=>String(t?.processo_id)===String(p.id)).map(t=>({id:t.id,tipo:t.tipo,status:t.status,pendencia:t.pendencia||null}))}catch{}
    const docs=[...(Array.isArray(p.documentos)?p.documentos:[]),...(Array.isArray(p.arquivos)?p.arquivos:[])].slice(0,20).map(d=>({nome:d.nome||d.titulo||d.arquivo||'documento',tipo:d.tipo||d.mime||null,tem_texto:!!(d.texto||d.conteudo||d.textoExtraido||d.texto_extraido)}));
    return{ok:true,processo:{...resumo(p,ctx.now),partes:p.partes||null,juiz:p.juiz||p.relator||null,descricao:String(p.descricao||p.resumo||'').slice(0,1500)||null,
      andamentos:(Array.isArray(p.andamentos)?p.andamentos:[]).slice(-15).map(a=>({data:a.data||null,texto:String(a.txt||a.texto||'').slice(0,300),origem:a.origem||null})),
      documentos:docs,tarefas,
      aviso:processOfficial(p)?null:'Dados deste cadastro ainda não foram conferidos em fonte oficial: trate nome, partes e prazo como "a conferir".'}};
  },
  async prazos(input,deps,ctx){
    const r=await executeOfficeQuery(deps,{action:'deadlines',janela:input.janela||'semana'},{now:ctx.now||new Date(),profile:ctx.profile});
    return{ok:true,...(r.result||{}),texto:r.message};
  },
  async publicacoes(input,deps,ctx){
    const r=await executeOfficeQuery({...deps,pje:null},{action:'publications',dias:Math.min(Math.max(Number(input.dias)||1,1),30)},{now:ctx.now||new Date(),profile:ctx.profile});
    return{ok:true,...(r.result||{}),texto:r.message};
  },
  async atualizar_no_tribunal(input,deps,ctx){
    const r=await executeOfficeQuery(deps,{action:'court_update',processo_id:input.processo_id},{now:ctx.now||new Date(),profile:ctx.profile});
    return{ok:r.result?.ok!==false,...(r.result||{}),texto:r.message,observacao:'Consulta somente; nenhuma ciência de intimação foi dada.'};
  },
  async criar_tarefa(input,deps,ctx){
    if(!['admin','advogado'].includes(String(ctx.profile||'')))return{ok:false,erro:'Só advogado ou administrador pode criar tarefa de produção jurídica.'};
    if(!TASK_TYPES.includes(input.tipo))return{ok:false,erro:'Tipo inválido. Use: '+TASK_TYPES.join(', ')};
    if(!deps.engine?.submit)return{ok:false,erro:'Task Engine indisponível neste servidor.'};
    const all=await readProcesses(deps);if(!all.some(p=>String(p.id)===String(input.processo_id)))return{ok:false,erro:'Processo não encontrado. Use consultar_processos antes.'};
    if(typeof deps.assertTaskGate==='function'){try{await deps.assertTaskGate(deps,{processo_id:input.processo_id,tipo:input.tipo})}catch(e){return{ok:false,erro:e.message}}}
    try{
      const task=await deps.engine.submit({tipo:input.tipo,instrucao:String(input.instrucao||'').slice(0,12000),processo_id:input.processo_id,request_id:ctx.requestId||undefined},ctx.profile||'admin');
      if(typeof deps.runTask==='function')deps.runTask(task).catch?.(()=>{});
      return{ok:true,tarefa:{id:task.id,tipo:task.tipo,status:task.status},texto:'Tarefa '+String(task.id).slice(0,8)+' criada e em execução em segundo plano. A minuta vai para revisão humana; nada será protocolado.'};
    }catch(e){return{ok:false,erro:e.message}}
  },
  async ordem_operacional(input,deps,ctx){
    if(typeof deps.executeNaturalOfficeCommand!=='function')return{ok:false,erro:'Executor de ordens indisponível.'};
    const text=String(input.texto||'').trim();if(!text)return{ok:false,erro:'Ordem vazia.'};
    // Cinto: ciência em intimação e aprovação de envio exigem a frase exata digitada pela PESSOA, nunca pelo modelo.
    if(/^\s*(CONFIRMO\s+CIENCIA|APROVO)\b/i.test(text))return{ok:false,erro:'Essa confirmação só vale quando o próprio titular a digita; peça a ele a frase exata.'};
    try{
      const r=await deps.executeNaturalOfficeCommand(deps,{text,processo_id:input.processo_id,profile:ctx.profile,request_id:ctx.requestId||undefined,defer_task:true});
      if(!r)return{ok:false,erro:'O executor não reconheceu essa ordem. Reformule com uma das ações: confirmar prazo, cadastrar, mover, distribuir, responder contato, ver o que precisa de mim.'};
      return{ok:r.needs_input?false:true,needs_input:!!r.needs_input,candidatos:r.candidates||null,acao:r.command?.action||null,texto:r.message||null,tarefa:r.task?{id:r.task.id,status:r.task.status}:null,resultado:r.result||null};
    }catch(e){return{ok:false,erro:e.message}}
  },
  async recibos_do_dia(input,deps,ctx){
    const r=await executeOfficeQuery(deps,{action:'daily_receipts'},{now:ctx.now||new Date(),profile:ctx.profile});
    return{ok:true,...(r.result||{}),texto:r.message};
  },
  async tarefas(input,deps){
    try{const list=await deps.engine?.list?.()||[];const rows=list.filter(t=>!input.status||t?.status===input.status).map(t=>({id:t.id,tipo:t.tipo,status:t.status,processo_nome:t.processo_nome||null,pendencia:t.pendencia||null,atualizada_em:t.atualizada_em||t.criada_em||null}));return{ok:true,total:rows.length,tarefas:rows.slice(0,30)}}
    catch(e){return{ok:false,erro:e.message}}
  }
};

async function executar(name,input,deps,ctx={}){
  const fn=HANDLERS[name];
  if(!fn)return{ok:false,erro:'Ferramenta desconhecida: '+name};
  const started=Date.now();
  try{
    const out=await fn(input&&typeof input==='object'?input:{},deps,{now:new Date(),...ctx});
    if(typeof deps.audit==='function'){try{await deps.audit({ferramenta:name,input,ok:out?.ok!==false,ms:Date.now()-started,dia:hojeBrasil(),perfil:ctx.profile||null})}catch{}}
    return out;
  }catch(e){return{ok:false,erro:'Falha na ferramenta '+name+': '+String(e?.message||e).slice(0,300)}}
}

module.exports={definitions,executar,HANDLERS,TASK_TYPES,resumo};
