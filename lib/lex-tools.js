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
const {executeOfficeQuery,leituraOficialTexto,quandoEmBrasilia}=require('./office-queries');
const {hojeBrasil}=require('./data-brasil');
const {ultimoAndamento,ultimoAndamentoAte,ultimosAndamentos,dataLegivel,textoDoAndamento}=require('./andamentos');
const {hasCnj}=require('./pje-sync');

const norm=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const CNJ=/\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/;
const FINAL=/CONCLU|ARQUIV|ENTREGUE|GANHO|PERDIDO/i;
const TASK_TYPES=['analise','decisao_adversa','auditoria_peca','peticao','contestacao','recurso','pericia','quesitos','revisao'];

function processOfficial(p){return !!(p?.last_court_sync_at||p?.partes_verificadas_em||p?.cadastro_conferido==='tribunal'||p?.numero_verificado_fonte==='pje')}
function trustedDeadline(p){return !!(p?.deadline_truth===true||p?.prazo_confirmado===true||p?.prazo_confirmado_em||(p?.deadline_truth&&p.deadline_truth.legal_truth===true))}
function dueOf(p){const t=p?.deadline_truth;return (t&&typeof t==='object'&&t.due_at)||p?.prazoReal||p?.prazo||p?.dataPrazo||null}
function daysTo(due,now){
  if(!due)return null;
  const m=String(due).match(/^(\d{4})-(\d{2})-(\d{2})/);if(!m)return null;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now||Date.now()));
  const get=t=>Number(parts.find(p=>p.type===t)?.value);
  const d=Date.UTC(+m[1],+m[2]-1,+m[3]),n=Date.UTC(get('year'),get('month')-1,get('day'));
  return Math.round((d-n)/86400000);
}

// Resumo curto e seguro de um processo (nunca inventa: só campos gravados).
function resumo(p,now){
  const due=dueOf(p),d=daysTo(due,now);
  return{
    id:String(p.id),nome:p.nome_oficial||p.nome||p.partes||null,numero:p.numero||null,cliente:p.cliente||null,
    status:p.status||null,setor:p.setor||null,tribunal:p.tribunal||p.vara||null,
    dados_conferidos_no_tribunal:processOfficial(p),
    prazo:due?{data:due,dias:d,confirmado:trustedDeadline(p),cumprido:p?.prazo_baixa?.ativa===true}:null,
    // Um processo pode ter vários prazos abertos (um por intimação confirmada): o de cima é o mais próximo.
    ...(()=>{const outros=require('./prazos-abertos').prazosAbertos(p).slice(1);return outros.length?{outros_prazos_abertos:outros.map(x=>({data:x.due_at,dias:daysTo(x.due_at,now),intimacao:x.djen_id??null}))}:{}})(),
    // O mais novo pela data real (a ordem gravada no array não é garantida): lib/andamentos.js.
    ultimo_andamento:(()=>{const a=ultimoAndamentoAte(p,hojeBrasil(now||new Date()))||ultimoAndamento(p);return a?{data:dataLegivel(a)||a.data||null,texto:textoDoAndamento(a).slice(0,300),origem:a.origem||null}:null})(),
    // Quando e por onde o tribunal foi lido pela última vez (hora de Brasília). Sem leitura, null:
    // não diga que está "atualizado".
    leitura_oficial:leituraOficialTexto(p),
    ...(p.datajud_nao_encontrado_em?{datajud_nao_encontrou:'O Datajud não encontrou este número na última tentativa ('+(quandoEmBrasilia(p.datajud_nao_encontrado_em)||'data não registrada')+', Brasília): pode ser segredo de justiça ou número a conferir.'}:{})
  };
}

async function readProcesses(deps){const s=await deps.processStore.read();return Array.isArray(s?.processes)?s.processes:[]}
// Andamento → conversa → mensagem ao cliente (lib/andamento-conversa.js). A IA prepara;
// o envio só sai com o OK do titular, conferido fora da IA (não há ferramenta de envio).
function andamentos(deps){return deps.andamentos||require('./andamento-conversa').current()}
// Honorários moram no próprio processo (lib/honorarios.js): grava pela mesma trava da carteira.
async function gravarHonorarios(deps,ctx,processoId,calcular){
  if(typeof deps.processStore?.mutate!=='function')return{ok:false,erro:'Carteira indisponível para gravação neste servidor.'};
  let out=null;
  try{
    await deps.processStore.mutate(ps=>{
      const i=ps.findIndex(p=>String(p?.id)===String(processoId));
      if(i<0)throw Object.assign(new Error('Processo não encontrado. Use consultar_processos antes.'),{status:404});
      out=calcular(ps[i]);
      ps[i]={...ps[i],honorarios:out.honorarios};
      return ps[i];
    },ctx.profile||'lex');
  }catch(e){return{ok:false,erro:e.message}}
  const H=require('./honorarios');
  return{ok:true,parcelas:(out.honorarios.parcelas||[]).map(x=>({parcela:x.n,valor:H.brl(x.valor),vencimento:x.vencimento,situacao:x.status,pago:H.brl(x.pago||0)})),
    memorial:out.memorial,observacao:'Mostre ao titular o resultado e o memorial; os valores são do código, não arredonde nem refaça a conta.'};
}

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
    {name:'intimacoes_a_tratar',description:'Intimações do Diário (DJEN) esperando decisão do titular: de processo cadastrado sem prazo confirmado e de processo NÃO cadastrado, com o prazo que o LEX PROPÕE (sugestão do texto + calendário), dias desde a publicação, urgência e a frase exata para agir. Use quando perguntarem por intimações, prazos novos, o que precisa dele, ou ao tomar iniciativa sobre risco de prazo. Você não confirma prazo nem dá intimação por tratada: mostre a frase exata para o titular digitar (CONFIRMO PRAZO nº dd/mm/aaaa, SEM PRAZO nº, NÃO É NOSSO nº) ou indique Prazos › Diário. O prazo do advogado conta da publicação no DJEN.',
      input_schema:{type:'object',properties:{},required:[]}},
    {name:'atualizar_no_tribunal',description:'Busca movimentações novas de UM processo nas fontes oficiais (Datajud/PJe). Não dá ciência de intimação. Use quando a pessoa perguntar "como está" um processo e os dados estiverem velhos.',
      input_schema:{type:'object',properties:{processo_id:{type:'string'}},required:['processo_id']}},
    {name:'criar_tarefa',description:'Cria uma tarefa de produção jurídica no Task Engine (análise, petição, contestação, recurso, perícia, quesitos, revisão) para um processo. O LEX executa a tarefa em segundo plano e a minuta vai para revisão humana; nada é protocolado. Use quando a pessoa pedir uma peça, análise ou perícia.',
      input_schema:{type:'object',properties:{tipo:{type:'string',enum:TASK_TYPES},processo_id:{type:'string'},instrucao:{type:'string',description:'O que fazer, com o contexto que a pessoa deu'}},required:['tipo','processo_id','instrucao']}},
    {name:'ordem_operacional',description:'Executa uma ordem operacional do escritório pelo executor validado (com permissões e travas): confirmar prazo sugerido pelo Diário, cadastrar processo/cliente, mover setor, distribuir, responder um contato pelo canal (a resposta exige aprovação humana quando envolve posição do escritório), ver o que precisa de você. Escreva a ordem em português, curta e literal, como o titular diria. Se o executor pedir escolha de processo, devolva as opções à pessoa.',
      input_schema:{type:'object',properties:{texto:{type:'string'},processo_id:{type:'string'}},required:['texto']}},
    {name:'recibos_do_dia',description:'O que o LEX fez hoje, registrado: mensagens enviadas, clientes acolhidos, andamentos importados, prazos confirmados, tarefas concluídas, rotina noturna.',
      input_schema:{type:'object',properties:{},required:[]}},
    {name:'painel_do_escritorio',description:'Painel do escritório tirado dos registros (nada estimado): carteira por setor, taxa de êxito (só com processos marcados GANHO ou PERDIDO), prazos oficiais vencidos e próximos, produção de minutas (aprovadas, esperando revisão, travadas, tempo médio de revisão), equipe e a lista do que pede ação — prazo oficial sem peça em produção, minuta parada esperando revisão, tarefa travada e processo sem andamento há muitos dias. Cada alerta traz quem, o quê, por quê, a ação e a frase para agir. Use quando perguntarem como está o escritório, a produtividade, a equipe, o que está parado ou atrasado, e para tomar iniciativa sobre riscos.',
      input_schema:{type:'object',properties:{dias_parado:{type:'integer',minimum:30,maximum:365,description:'A partir de quantos dias sem andamento o processo conta como parado (padrão 90).'}},required:[]}},
    {name:'andamentos_para_comunicar',description:'Andamentos oficiais novos que o LEX já levou ao titular nos últimos 7 dias: o que aconteceu em cada processo, se o cliente tem contato gravado, se pediu para não receber mensagens (PARE), o que o titular já decidiu, e as mensagens ao cliente preparadas esperando o OK. Use quando o titular responder a um aviso de andamento ou falar em avisar cliente.',
      input_schema:{type:'object',properties:{},required:[]}},
    {name:'preparar_mensagem_cliente',description:'Prepara a mensagem que VOCÊ escreveu para o cliente de um processo, a partir da conversa com o titular (linguagem simples, sem juridiquês, sem prometer resultado, sem afirmar prazo, no tom do escritório). O LEX confere o contato gravado no processo e mostra ao titular o texto exato logo abaixo da sua resposta; só o OK dele, na próxima mensagem, envia. Você não envia nada e nunca diz que enviou. Sem contato gravado, peça o WhatsApp do cliente ao titular e chame de novo com o campo whatsapp. Para avisar vários clientes, chame uma vez por cliente na mesma resposta.',
      input_schema:{type:'object',properties:{processo_id:{type:'string'},texto:{type:'string',description:'Mensagem final ao cliente, pronta para sair (sem marcadores por preencher).'},whatsapp:{type:'string',description:'Só quando o titular informou o número nesta conversa ou escolheu entre os contatos gravados.'}},required:['processo_id','texto']}},
    {name:'descartar_mensagem_cliente',description:'O titular decidiu não avisar o cliente sobre o andamento, ou desistiu da mensagem preparada: retira a mensagem e marca o andamento como resolvido, para o LEX não insistir.',
      input_schema:{type:'object',properties:{processo_id:{type:'string'}},required:['processo_id']}},
    {name:'avisos_de_andamento',description:'Liga ou desliga o LEX chamar o titular para conversar quando entra andamento oficial novo. Use só quando ele pedir.',
      input_schema:{type:'object',properties:{ligar:{type:'boolean'}},required:['ligar']}},
    {name:'importacao_de_carteira',description:'Planilha da carteira que o titular mandou (Excel ou CSV): "ver" mostra o que o LEX leu (novos, já existentes, repetidos, números com problema e por quê); "importar" grava os processos novos como "a conferir" — só quando o titular mandar, em qualquer forma de dizer; "desfazer" remove os processos da última importação em que ninguém trabalhou; "descartar" esquece a planilha sem gravar.',
      input_schema:{type:'object',properties:{acao:{type:'string',enum:['ver','importar','desfazer','descartar']},id:{type:'string',description:'Código da importação, se houver mais de uma; sem ele, vale a mais recente.'}},required:['acao']}},
    {name:'honorarios',description:'Financeiro do escritório tirado dos registros (nada estimado). Sem processo: recebido no mês, a receber, vencido, quem está em atraso, o que vence em 7 dias e por responsável, com memorial de cálculo. Com processo: o contrato, as parcelas e a situação de cada uma. Para cobrar um cliente, escreva você a mensagem (educada, com valor e vencimento) e use preparar_mensagem_cliente — ela só sai com o OK do titular.',
      input_schema:{type:'object',properties:{processo_id:{type:'string'}},required:[]}},
    {name:'registrar_honorarios',description:'Registra o contrato de honorários de um processo a partir do que o titular disser: "fixo" (valor_total, parcelas, primeiro_vencimento), "exito" (percentual_exito), "misto" (os dois) ou "mensal" (valor_mensal, meses, primeiro_vencimento). Juros e multa só se o contrato tiver. Se faltar dado, pergunte. Devolve as parcelas e o memorial de cálculo: mostre ao titular.',
      input_schema:{type:'object',properties:{processo_id:{type:'string'},tipo:{type:'string',enum:['fixo','exito','misto','mensal']},valor_total:{type:'string',description:'Ex.: "6000" ou "R$ 6.000,00"'},parcelas:{type:'integer',minimum:1,maximum:120},primeiro_vencimento:{type:'string',description:'dd/mm/aaaa'},percentual_exito:{type:'number'},valor_mensal:{type:'string'},meses:{type:'integer',minimum:1,maximum:120},juros_mes:{type:'number'},multa:{type:'number'},observacao:{type:'string'},substituir:{type:'boolean',description:'Só quando o titular pedir para trocar um contrato já registrado.'}},required:['processo_id','tipo']}},
    {name:'registrar_pagamento',description:'Registra um pagamento de honorários que o titular ou a equipe informar: com "parcela", quita ou abate aquela; sem parcela, aplica às parcelas em aberto da mais antiga para a mais nova; sem parcelas (êxito), fica como recebimento avulso. Devolve o memorial de cálculo. Se o LEX disser que já registrou um pagamento igual há poucos minutos, pergunte ao titular se é outro pagamento; só então chame de novo com repetido=true.',
      input_schema:{type:'object',properties:{processo_id:{type:'string'},valor:{type:'string',description:'Em reais, no formato brasileiro: "1.500,00" ou "1500"'},parcela:{type:'integer'},data:{type:'string',description:'dd/mm/aaaa; sem ela, hoje'},forma:{type:'string',description:'Pix, boleto, dinheiro, transferência…'},descricao:{type:'string'},repetido:{type:'boolean',description:'Só quando o titular confirmar que é outro pagamento, igual a um registrado há poucos minutos.'}},required:['processo_id']}},
    {name:'modelos_do_escritorio',description:'Modelos de peça do escritório que o LEX segue ao redigir (estrutura e estilo, nunca os fatos): "listar"; "salvar" com tipo e o texto que o titular colou (ou, sem texto, o arquivo de modelo que ele acabou de mandar e que ficou esperando o tipo); "voltar_versao"; "remover". Tipos: peticao, contestacao, recurso, quesitos, pericia, analise.',
      input_schema:{type:'object',properties:{acao:{type:'string',enum:['listar','salvar','voltar_versao','remover']},tipo:{type:'string'},nome:{type:'string'},texto:{type:'string',description:'Texto do modelo colado na conversa.'}},required:['acao']}},
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
    // Por número: vale qualquer CNJ do próprio cadastro ("A / Embargos B" acha por B). Cadastro que
    // só CITA o número ("A confirmar — vinculado a X") não é o processo X: vem à parte.
    let citam=[];
    if(digits){
      const proprios=rows.filter(p=>hasCnj(p,digits));
      citam=rows.filter(p=>!proprios.includes(p)&&String(p.numero||'').replace(/\D/g,'').includes(digits));
      rows=proprios;
    }else rows=rows.filter(p=>norm([p.nome,p.nome_oficial,p.numero,p.cliente,p.partes,p.assunto].join(' ')).includes(q));
    return{ok:true,total:rows.length,processos:rows.slice(0,10).map(p=>resumo(p,ctx.now)),
      ...(citam.length?{citado_em:citam.slice(0,5).map(p=>({id:String(p.id),nome:p.nome_oficial||p.nome||null,numero:p.numero||null}))}:{}),
      observacao:rows.length>1?'Mais de um processo compatível: pergunte à pessoa qual é antes de agir.'
        :rows.length===0?(citam.length?'Nenhum processo tem esse número como próprio; há cadastro(s) que só o citam (citado_em). Não trate como o mesmo processo: pergunte à pessoa.':'Nenhum processo com esse dado. Não invente; pergunte o número ou o nome do cliente.'):null};
  },
  async ver_processo(input,deps,ctx){
    const all=await readProcesses(deps);const p=all.find(x=>String(x.id)===String(input.processo_id));
    if(!p)return{ok:false,erro:'Processo não encontrado na carteira.'};
    let tarefas=[];try{tarefas=(await deps.engine?.list?.()||[]).filter(t=>String(t?.processo_id)===String(p.id)).map(t=>({id:t.id,tipo:t.tipo,status:t.status,pendencia:t.pendencia||null}))}catch{}
    const docs=[...(Array.isArray(p.documentos)?p.documentos:[]),...(Array.isArray(p.arquivos)?p.arquivos:[])].slice(0,20).map(d=>({nome:d.nome||d.titulo||d.arquivo||'documento',tipo:d.tipo||d.mime||null,tem_texto:!!(d.texto||d.conteudo||d.textoExtraido||d.texto_extraido)}));
    return{ok:true,processo:{...resumo(p,ctx.now),partes:p.partes||null,juiz:p.juiz||p.relator||null,descricao:String(p.descricao||p.resumo||'').slice(0,1500)||null,
      // Do mais novo para o mais antigo, pela data real.
      andamentos:ultimosAndamentos(p,15).map(a=>({data:dataLegivel(a)||a.data||null,texto:textoDoAndamento(a).slice(0,300),origem:a.origem||null})),
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
  async intimacoes_a_tratar(input,deps,ctx){
    const T=require('./djen-tratamento');
    try{
      const r=await T.listarPendentes(deps,{now:ctx.now||new Date()});
      return{ok:true,total:r.total,orfas:r.orfas,urgentes:r.urgentes,
        pendentes:r.pendentes.slice(0,15).map(({texto,sugestao_hash,...i})=>({...i,texto:String(texto||'').slice(0,300)})),
        texto:T.mensagemPendentes(r),observacao:'Prazo proposto é sugestão: só vale depois que o titular confirmar com a frase exata ou pelo botão.'};
    }catch(e){return{ok:false,erro:e.message+' Isso NÃO significa que não há intimações.'}}
  },
  async atualizar_no_tribunal(input,deps,ctx){
    const r=await executeOfficeQuery(deps,{action:'court_update',processo_id:input.processo_id},{now:ctx.now||new Date(),profile:ctx.profile});
    // ok só quando o tribunal foi lido de verdade; sem fonte ou sem achar o número, ok:false e o motivo no texto.
    return{...(r.result||{}),ok:r.result?.ok===true,texto:r.message,observacao:'Consulta somente; nenhuma ciência de intimação foi dada.'};
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
    const normalizedText=norm(text);
    // Cinto: ciência em intimação, confirmação de prazo, dar intimação por tratada e aprovação de envio
    // exigem a frase exata digitada pela PESSOA, nunca pelo modelo.
    if(/^(confirmo ciencia|confirmo (o )?prazo|aprovo|sem prazo|nao e noss[oa]|ja tratei|tratada fora|reabr(ir|a|e) (a )?intimacao)\b/i.test(normalizedText))return{ok:false,erro:'Essa confirmação só vale quando o próprio titular a digita; peça a ele a frase exata.'};
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
  async painel_do_escritorio(input,deps,ctx){
    const r=await executeOfficeQuery(deps,{action:'office_panel',dias_parado:input.dias_parado},{now:ctx.now||new Date(),profile:ctx.profile});
    return{ok:true,...(r.result||{}),texto:r.message};
  },
  async andamentos_para_comunicar(input,deps){
    const A=andamentos(deps);if(!A)return{ok:false,erro:'A conversa sobre andamentos não está disponível neste servidor.'};
    return A.listar();
  },
  async preparar_mensagem_cliente(input,deps,ctx){
    const A=andamentos(deps);if(!A)return{ok:false,erro:'A conversa sobre andamentos não está disponível neste servidor.'};
    return A.preparar({processo_id:input.processo_id,texto:input.texto,whatsapp:input.whatsapp,conversa:ctx.conversa,turno:ctx.turno,perfil:ctx.profile});
  },
  async descartar_mensagem_cliente(input,deps,ctx){
    const A=andamentos(deps);if(!A)return{ok:false,erro:'A conversa sobre andamentos não está disponível neste servidor.'};
    return A.descartar({processo_id:input.processo_id,conversa:ctx.conversa,perfil:ctx.profile});
  },
  async avisos_de_andamento(input,deps,ctx){
    const A=andamentos(deps);if(!A)return{ok:false,erro:'A conversa sobre andamentos não está disponível neste servidor.'};
    return A.ligar({ligar:input.ligar===true,perfil:ctx.profile});
  },
  async importacao_de_carteira(input,deps,ctx){
    const I=deps.carteiraImport||require('./carteira-import').current();
    if(!I)return{ok:false,erro:'A importação de planilha não está disponível neste servidor.'};
    const id=input.id?String(input.id):undefined;
    if(input.acao==='ver')return I.ver({id});
    if(input.acao==='importar')return I.importar({id,perfil:ctx.profile});
    if(input.acao==='descartar')return I.descartar({id,perfil:ctx.profile});
    // Sem a lista de tarefas, desfazer não apaga nada (erro ao listar não vira "nenhuma tarefa").
    if(input.acao==='desfazer'){let tarefas=null;try{tarefas=deps.engine?.list?await deps.engine.list():null}catch{tarefas=null}return I.desfazer({id,perfil:ctx.profile,tarefas})}
    return{ok:false,erro:'Ação inválida: use ver, importar, desfazer ou descartar.'};
  },
  async honorarios(input,deps,ctx){
    const H=require('./honorarios'),hoje=hojeBrasil(ctx.now);
    const all=await readProcesses(deps);
    if(input.processo_id!=null&&String(input.processo_id).trim()){
      const p=all.find(x=>String(x.id)===String(input.processo_id));
      if(!p)return{ok:false,erro:'Processo não encontrado na carteira.'};
      if(!p.honorarios?.contrato)return{ok:true,processo:{id:String(p.id),nome:p.nome||p.numero||null,cliente:p.cliente||null},contrato:null,texto:'Não há contrato de honorários registrado neste processo.'};
      const st=H.situacao(p.honorarios,hoje),c=p.honorarios.contrato;
      return{ok:true,processo:{id:String(p.id),nome:p.nome||p.numero||null,cliente:p.cliente||null},
        contrato:{tipo:c.tipo,valor_total:c.valor_total!=null?H.brl(c.valor_total):null,percentual_exito:c.percentual_exito??null,juros_mes:c.juros_mes??null,multa:c.multa??null,observacao:c.observacao||null},
        situacao:{contratado:H.brl(st.contratado),recebido:H.brl(st.recebido),a_receber:H.brl(st.a_receber),vencido:H.brl(st.vencido),encargos_do_contrato:H.brl(st.encargos)},
        parcelas:st.parcelas.map(x=>({parcela:x.n,valor:H.brl(x.valor),vencimento:x.vencimento,situacao:x.status,pago:H.brl(x.pago||0),em_aberto:H.brl(x.aberto),dias_de_atraso:x.dias_atraso,encargos:H.brl(x.encargos)})),
        recebimentos_avulsos:(p.honorarios.avulsos||[]).map(a=>({valor:H.brl(a.valor),data:a.data,descricao:a.descricao||null}))};
    }
    const r=H.resumoCarteira(all,hoje);
    // Receita por advogado é do titular e dos advogados; a secretária vê o escritório.
    const porResponsavel=String(ctx.profile||'')!=='secretaria';
    return{ok:true,contratos:r.contratos,recebido_mes:H.brl(r.recebido_mes),a_receber:H.brl(r.a_receber),vencido:H.brl(r.vencido),
      em_atraso:r.vencidas.slice(0,20).map(v=>({...v,valor:H.brl(v.valor),encargos:H.brl(v.encargos)})),vencem_em_7_dias:r.proximas.slice(0,20).map(v=>({...v,valor:H.brl(v.valor)})),
      ...(porResponsavel?{por_responsavel:Object.fromEntries(Object.entries(r.por_responsavel).map(([k,v])=>[k,{recebido_mes:H.brl(v.recebido_mes),a_receber:H.brl(v.a_receber),vencido:H.brl(v.vencido)}]))}:{}),
      memorial:r.memorial,texto:H.textoResumo(r,{porResponsavel})};
  },
  async registrar_honorarios(input,deps,ctx){
    if(!['admin','advogado'].includes(String(ctx.profile||'')))return{ok:false,erro:'Só advogado ou administrador registra contrato de honorários.'};
    return gravarHonorarios(deps,ctx,input.processo_id,p=>require('./honorarios').registrarContrato(p,input,{por:ctx.profile,agora:new Date(ctx.now||Date.now()).toISOString()}));
  },
  async registrar_pagamento(input,deps,ctx){
    if(!['admin','advogado','secretaria'].includes(String(ctx.profile||'')))return{ok:false,erro:'Seu perfil não registra pagamento.'};
    return gravarHonorarios(deps,ctx,input.processo_id,p=>require('./honorarios').registrarPagamento(p,input,{por:ctx.profile,agora:new Date(ctx.now||Date.now()).toISOString(),turno:ctx.turno||null}));
  },
  async modelos_do_escritorio(input,deps,ctx){
    const M=deps.officeModels||require('./office-models').current();
    if(!M)return{ok:false,erro:'Modelos do escritório indisponíveis neste servidor.'};
    if(input.acao==='listar')return M.listar();
    if(input.acao==='salvar'){
      if(!String(input.texto||'').trim())return M.salvarPendente({tipo:input.tipo,perfil:ctx.profile});
      // Modelo vem do titular, não da IA: só vale o texto que ele colou nesta mensagem.
      const junta=v=>String(v||'').replace(/\s+/g,' ').trim();
      if(!junta(ctx.mensagem_titular).includes(junta(input.texto)))
        return{ok:false,erro:'Só guardo como modelo o texto que o titular colou nesta mensagem, sem mudar nada. Peça para ele colar o modelo inteiro (ou mandar o Word com "modelo" no nome).'};
      return M.salvar({tipo:input.tipo,nome:input.nome,texto:input.texto,perfil:ctx.profile});
    }
    if(input.acao==='voltar_versao')return M.voltarVersao({tipo:input.tipo,perfil:ctx.profile});
    if(input.acao==='remover')return M.remover({tipo:input.tipo,perfil:ctx.profile});
    return{ok:false,erro:'Ação inválida: use listar, salvar, voltar_versao ou remover.'};
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
