'use strict';
// =====================================================================
// PAINEL DO ESCRITÓRIO — indicadores e alertas que pedem ação
// ---------------------------------------------------------------------
// O que o ADVBOX vende como Taskscore (produção medida) e o EasyJur como
// "insights acionáveis" (processo parado, prazo em risco, peça parada),
// feito do jeito do LEX: tudo sai dos registros gravados, nada é estimado
// pela IA. Cada alerta diz QUEM + O QUÊ + POR QUÊ + QUAL AÇÃO (AGENTS.md §7)
// e traz a frase que o titular pode dizer ao LEX para agir.
//
// Regras de honestidade:
// - número sem base aparece como sem base (null), nunca como zero;
// - prazo só conta quando confirmado em fonte oficial (lista do DeadlineWatch);
// - "processo parado" distingue "o tribunal não anda" de "o LEX está sem
//   leitura recente do tribunal" — no segundo caso a ação é atualizar antes.
//
// Uso:
//   const I=require('./office-insights');
//   const r=I.computeOfficeInsights({processes,tasks,prazos,now});
//   const texto=I.officeInsightsMessage(r,{incluirEquipe:true});
// =====================================================================
const flow=require('./workflow');

const DIA=86400000;
const PADRAO=Object.freeze({
  dias_parado:90,             // sem andamento há N dias = parado
  dias_prazo_sem_tarefa:5,    // prazo oficial nos próximos N dias sem peça em produção
  horas_revisao:48,           // minuta esperando revisão há mais de N horas
  janela_dias:30,             // janela dos indicadores de produção
  dias_leitura_recente:7,     // leitura oficial do tribunal vale como recente por N dias
  max_alertas:12
});
const TAREFA_EM_PRODUCAO=new Set(['na_fila','executando']);
const TAREFA_ESPERA_VOCE=new Set(['aguardando_dados','aguardando_documento_nitido','aguardando_configuracao','falhou']);
const TAREFA_ABERTA=new Set([...TAREFA_EM_PRODUCAO,'aguardando_revisao',...TAREFA_ESPERA_VOCE]);
const PAPEL=Object.freeze({admin:'Administrador',advogado:'Advogado(a)',secretaria:'Secretária'});
const GRAVIDADE=Object.freeze({alta:0,media:1,baixa:2});
const TIPO_TAREFA=Object.freeze({analise:'análise',decisao_adversa:'análise de decisão',auditoria_peca:'auditoria de peça',peticao:'petição',contestacao:'contestação',recurso:'recurso',pericia:'perícia',quesitos:'quesitos',revisao:'revisão'});

// ---------------------------------------------------------------------
// Datas (dia civil de Brasília)
// ---------------------------------------------------------------------
function ymdSP(d){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}
function dataValida(a,m,d){
  const iso=a+'-'+m+'-'+d,t=Date.parse(iso+'T12:00:00Z');
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===iso?iso:null;
}
// Aceita AAAA-MM-DD, DD/MM/AAAA e data-hora ISO (convertida para o dia de Brasília).
function diaCivil(v){
  const s=String(v||'').trim();if(!s)return null;
  if(/^\d{4}-\d{2}-\d{2}T/.test(s)){const d=new Date(s);return Number.isNaN(d.getTime())?null:ymdSP(d)}
  let m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(m)return dataValida(m[1],m[2],m[3]);
  m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(m)return dataValida(m[3],m[2],m[1]);
  return null;
}
function diasEntre(de,ate){return Math.round((Date.parse(ate+'T12:00:00Z')-Date.parse(de+'T12:00:00Z'))/DIA)}
function brData(ymd){const m=String(ymd||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?m[3]+'/'+m[2]+'/'+m[1]:String(ymd||'')}
function quando(dias){return dias===0?'hoje':dias===1?'amanhã':dias<0?'há '+(-dias)+' dia'+(dias===-1?'':'s'):'em '+dias+' dias'}
function ms(v){const t=Date.parse(String(v||''));return Number.isFinite(t)?t:null}

// ---------------------------------------------------------------------
// Processo
// ---------------------------------------------------------------------
const status=p=>String(p?.status||'ATIVO').toUpperCase();
const encerrado=p=>flow.CLOSED.has(status(p));
function rotulo(p){return String(p?.nome_oficial||p?.nome||p?.partes||p?.numero||('processo '+(p?.id??'?'))).slice(0,120)}
function referencia(p){return String(p?.numero||'').trim()||rotulo(p)}
// Último andamento com data válida até hoje (data futura é erro de cadastro e fica fora).
function ultimoAndamento(p,hoje){
  let melhor=null;
  for(const a of flow.array(p?.andamentos)){
    const d=require('./andamentos').diaDoAndamento(a); // dia de Brasília; "sem hora" à meia-noite UTC é o próprio dia
    if(!d||d>hoje)continue;
    if(!melhor||d>melhor.data)melhor={data:d,origem:a.origem||null};
  }
  return melhor;
}
function leituraOficial(p){return diaCivil(p?.last_court_sync_at)}

// ---------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------
function computeOfficeInsights({processes=[],tasks=[],prazos=null,now=new Date(),opcoes={}}={}){
  const o={...PADRAO,...Object.fromEntries(Object.entries(opcoes||{}).filter(([,v])=>Number.isFinite(Number(v))&&Number(v)>0).map(([k,v])=>[k,Number(v)]))};
  const agora=now instanceof Date?now:new Date(now);
  const agoraMs=agora.getTime(),hoje=ymdSP(agora);
  const desde=agoraMs-o.janela_dias*DIA;
  const procs=flow.array(processes).filter(p=>p&&p.id!=null);
  const tarefas=Array.isArray(tasks)?tasks.filter(Boolean):null;
  const porId=new Map(procs.map(p=>[String(p.id),p]));

  // Carteira — mesmas regras de setor da Home (workflow.summary), para não divergir.
  const resumo=flow.summary(procs);
  const ganhos=procs.filter(p=>status(p)==='GANHO').length,perdidos=procs.filter(p=>status(p)==='PERDIDO').length;
  const baseExito=ganhos+perdidos;
  const carteira={
    total:resumo.total,ativos:resumo.total-resumo.concluidos,judicial:resumo.judicial,administrativo:resumo.administrativo,
    em_preparacao:resumo.autuacao,concluidos:resumo.concluidos,ganhos,perdidos,
    taxa_exito:baseExito?Math.round(ganhos*100/baseExito):null,base_exito:baseExito
  };

  // Prazos oficiais (somente os confirmados em fonte oficial; os anotados à mão ficam "a conferir").
  let prazosResumo=null;const prazosConfirmados=[];
  if(Array.isArray(prazos)){
    for(const i of prazos){
      if(!i||i.deadline_status!=='confirmed'||i.deadline_legal_truth!==true||!i.prazo||i.days_to_due==null)continue;
      const p=porId.get(String(i.case_id));
      if(p?.prazo_baixa?.ativa===true)continue; // marcado como cumprido
      prazosConfirmados.push({...i,processo:p||null});
    }
    prazosResumo={
      vencidos:prazosConfirmados.filter(i=>i.days_to_due<0).length,
      hoje:prazosConfirmados.filter(i=>i.days_to_due===0).length,
      proximos_7_dias:prazosConfirmados.filter(i=>i.days_to_due>0&&i.days_to_due<=7).length,
      a_conferir:prazos.filter(i=>i&&i.deadline_status!=='confirmed'&&i.prazo&&i.days_to_due!=null).length
    };
  }

  // Produção (Task Engine) e equipe.
  let producao=null,equipe=null;
  if(tarefas){
    const naJanela=v=>{const t=ms(v);return t!=null&&t>=desde&&t<=agoraMs};
    const concluidas=tarefas.filter(t=>t.status==='concluida'&&naJanela(t.revisado_em));
    const temposRevisao=concluidas.map(t=>{const a=ms(t.atualizada_em),b=ms(t.revisado_em);return a!=null&&b!=null&&b>=a?(b-a)/3600000:null}).filter(v=>v!=null);
    const media=v=>v.length?Math.round(v.reduce((s,x)=>s+x,0)/v.length*10)/10:null;
    producao={
      janela_dias:o.janela_dias,
      em_producao:tarefas.filter(t=>TAREFA_EM_PRODUCAO.has(t.status)).length,
      aguardando_revisao:tarefas.filter(t=>t.status==='aguardando_revisao').length,
      esperando_voce:tarefas.filter(t=>TAREFA_ESPERA_VOCE.has(t.status)).length,
      aprovadas:concluidas.length,
      devolvidas:tarefas.filter(t=>naJanela(t.devolvido_em)).length,
      revisao_media_horas:media(temposRevisao),
      base_revisao_media:temposRevisao.length
    };
    // Equipe: quem deu ordem, quem revisou, quem devolveu. Hoje o Task Engine grava o
    // perfil (admin/advogado/secretaria); quando gravar a conta individual, o mesmo
    // cálculo passa a separar por pessoa sem mudar nada aqui.
    const pessoas=new Map();
    // Com conta individual gravada (ator_conta etc.), agrupa pela pessoa; sem ela, pelo perfil.
    const pessoa=(k,conta)=>{
      const id=conta?.id?'conta:'+conta.id:(String(k||'').trim()||'não registrado');
      if(!pessoas.has(id))pessoas.set(id,{id,nome:conta?.nome||PAPEL[id]||id,ordens:0,revisoes:0,devolucoes:0,horas:[]});
      return pessoas.get(id);
    };
    for(const t of tarefas){
      if(naJanela(t.criada_em))pessoa(t.ator,t.ator_conta).ordens++;
      if(t.status==='concluida'&&naJanela(t.revisado_em)){
        const x=pessoa(t.revisado_por,t.revisado_por_conta);x.revisoes++;
        const a=ms(t.atualizada_em),b=ms(t.revisado_em);if(a!=null&&b!=null&&b>=a)x.horas.push((b-a)/3600000);
      }
      if(naJanela(t.devolvido_em))pessoa(t.devolvido_por,t.devolvido_por_conta).devolucoes++;
    }
    const porPessoa=[...pessoas.values()].map(({horas,...x})=>({...x,revisao_media_horas:media(horas)})).sort((a,b)=>(b.revisoes+b.ordens)-(a.revisoes+a.ordens));
    const soPerfis=porPessoa.length>0&&porPessoa.every(x=>PAPEL[x.id]||x.id==='não registrado');
    equipe={
      janela_dias:o.janela_dias,pessoas:porPessoa,
      observacao:soPerfis?'Estas tarefas foram registradas só com o perfil (administrador, advogado, secretária). Com cada pessoa entrando no app com a própria conta, o painel separa por nome.':null
    };
  }

  // Honorários (lib/honorarios.js): recebido no mês, a receber, vencido. Exigido aqui (e não no
  // topo) porque honorarios.js usa as datas deste módulo.
  const H=require('./honorarios');
  const fin=H.resumoCarteira(procs,hoje);
  const financeiro=fin.contratos?{contratos:fin.contratos,recebido_mes:fin.recebido_mes,a_receber:fin.a_receber,vencido:fin.vencido,parcelas_vencidas:fin.vencidas.length,memorial:fin.memorial}:null;

  // Responsáveis pelos processos (campo "responsavel" do cadastro, quando preenchido).
  const responsaveis=new Map();
  for(const p of procs){
    if(encerrado(p))continue;
    const r=String(p.responsavel||'').trim();if(!r)continue;
    if(!responsaveis.has(r))responsaveis.set(r,{responsavel:r,ativos:0,parados:0,prazos_vencidos:0});
    responsaveis.get(r).ativos++;
  }
  // Receita por responsável (o "receita por advogado" do EasyJur), quando há honorários.
  for(const [r,v] of Object.entries(fin.por_responsavel||{})){
    if(!responsaveis.has(r))continue;
    Object.assign(responsaveis.get(r),{recebido_mes:v.recebido_mes,a_receber:v.a_receber});
  }

  // -------------------------------------------------------------------
  // Alertas — QUEM + O QUÊ + POR QUÊ + AÇÃO + frase para o LEX
  // -------------------------------------------------------------------
  const alertas=[];
  const add=a=>alertas.push(a);
  const temPecaRecente=pid=>!!tarefas&&tarefas.some(t=>String(t.processo_id)===String(pid)&&(TAREFA_ABERTA.has(t.status)||(t.status==='concluida'&&(()=>{const r=ms(t.revisado_em);return r!=null&&r>=desde})())));

  for(const i of prazosConfirmados){
    const p=i.processo,quem=p?rotulo(p):String(i.titulo||i.case_id);
    if(i.days_to_due<0){
      add({tipo:'prazo_vencido',gravidade:'alta',processo_id:i.case_id??null,quem,dias:i.days_to_due,
        oque:'Prazo oficial venceu em '+brData(i.prazo)+' ('+quando(i.days_to_due)+').',
        porque:'O prazo foi confirmado em fonte oficial e não está marcado como cumprido no LEX.',
        acao:'Se já foi cumprido, marque como cumprido; se não, decida hoje a medida cabível.',
        diga:'como está o prazo do processo '+(p?referencia(p):quem)});
      const r=p&&responsaveis.get(String(p.responsavel||'').trim());if(r)r.prazos_vencidos++;
    }else if(i.days_to_due<=o.dias_prazo_sem_tarefa&&tarefas&&!temPecaRecente(i.case_id)){
      add({tipo:'prazo_sem_peca',gravidade:i.days_to_due<=2?'alta':'media',processo_id:i.case_id??null,quem,dias:i.days_to_due,
        oque:'Prazo oficial vence '+quando(i.days_to_due)+' ('+brData(i.prazo)+') e não há peça em produção no LEX.',
        porque:'Nenhuma tarefa aberta nem minuta aprovada nos últimos '+o.janela_dias+' dias para este processo.',
        acao:'Peça a minuta agora ou registre quem está cuidando fora do LEX.',
        diga:'analise o prazo do processo '+(p?referencia(p):quem)+' e prepare a peça cabível'});
    }
  }

  if(tarefas){
    for(const t of tarefas){
      const nome=TIPO_TAREFA[t.tipo]||t.tipo||'tarefa';
      const quem=String(t.processo_nome||(t.processo_id!=null&&porId.has(String(t.processo_id))?rotulo(porId.get(String(t.processo_id))):'')||('tarefa '+String(t.id||'').slice(0,8)));
      if(t.status==='aguardando_revisao'){
        const desdeMs=ms(t.atualizada_em);if(desdeMs==null)continue;
        const horas=(agoraMs-desdeMs)/3600000;
        if(horas<o.horas_revisao)continue;
        const dias=Math.floor(horas/24);
        add({tipo:'minuta_parada',gravidade:'media',processo_id:t.processo_id??null,tarefa_id:t.id??null,quem,dias,
          oque:'Minuta de '+nome+' pronta há '+(dias>=1?dias+' dia'+(dias===1?'':'s'):Math.floor(horas)+' horas')+' esperando sua revisão.',
          porque:'Peça pronta e não revisada não pode ser protocolada.',
          acao:'Revise e aprove, ou devolva dizendo o que corrigir.',
          diga:'veja o que precisa de mim'});
      }else if(TAREFA_ESPERA_VOCE.has(t.status)){
        const porque={aguardando_dados:'O LEX parou porque falta dado ou documento do caso.',aguardando_documento_nitido:'O documento enviado não tem leitura confiável.',aguardando_configuracao:'A IA do servidor não está configurada ou está sem crédito.',falhou:'A execução falhou e precisa de revisão humana antes de nova tentativa.'}[t.status];
        add({tipo:'tarefa_travada',gravidade:t.status==='falhou'?'alta':'media',processo_id:t.processo_id??null,tarefa_id:t.id??null,quem,dias:null,
          oque:'Tarefa de '+nome+' parada'+(t.pendencia?': '+String(t.pendencia).slice(0,180):'.'),
          porque,acao:'Complete o que falta e peça para retomar.',diga:'veja o que precisa de mim'});
      }
    }
  }

  for(const v of fin.vencidas){
    add({tipo:'parcela_vencida',gravidade:v.dias>30?'alta':v.dias>7?'media':'baixa',processo_id:v.processo_id,quem:v.cliente||v.processo,dias:v.dias,
      oque:'Parcela '+v.parcela+'/'+v.de+' de honorários ('+H.brl(v.valor)+') venceu em '+brData(v.vencimento)+' (há '+v.dias+' dia'+(v.dias===1?'':'s')+').',
      porque:'O pagamento não está registrado no LEX.',
      acao:'Se já recebeu, registre o pagamento; se não, combine a cobrança.',
      diga:'cobre '+(v.cliente||v.processo)+' da parcela '+v.parcela+' com educação'});
  }

  let semAndamento=0;
  for(const p of procs){
    if(encerrado(p))continue;
    const setor=flow.sector(p);
    if(setor!=='judicial'&&setor!=='administrativo')continue; // caso em preparação não "anda" no tribunal
    const ult=ultimoAndamento(p,hoje);
    if(!ult){semAndamento++;continue}
    const dias=diasEntre(ult.data,hoje);
    if(dias<o.dias_parado)continue;
    const leitura=leituraOficial(p);
    const leituraRecente=!!leitura&&diasEntre(leitura,hoje)<=o.dias_leitura_recente;
    const r=responsaveis.get(String(p.responsavel||'').trim());if(r)r.parados++;
    add({tipo:'processo_parado',gravidade:dias>=2*o.dias_parado?'media':'baixa',processo_id:p.id,quem:rotulo(p),dias,
      oque:'Sem andamento registrado há '+dias+' dias (último em '+brData(ult.data)+').',
      porque:leituraRecente
        ?'A leitura oficial do tribunal de '+brData(leitura)+' confirma que não houve movimentação desde então.'
        :(leitura?'A última leitura oficial do tribunal é de '+brData(leitura)+': pode ser só falta de atualização.':'O LEX não tem registro de leitura oficial dos andamentos deste processo: pode ser só falta de atualização.'),
      acao:leituraRecente?'Confira se aguarda ato do juízo ou se cabe petição de impulso.':'Atualize no tribunal antes de concluir que está parado.',
      diga:leituraRecente?'analise o processo '+referencia(p)+' e diga se cabe petição de impulso':'atualize o processo '+referencia(p)+' no tribunal'});
  }

  const contagem={};
  for(const a of alertas)contagem[a.tipo]=(contagem[a.tipo]||0)+1;
  alertas.sort((a,b)=>(GRAVIDADE[a.gravidade]-GRAVIDADE[b.gravidade])||((b.dias==null?-1:Math.abs(b.dias))-(a.dias==null?-1:Math.abs(a.dias))));

  return{
    gerado_em:agora.toISOString(),dia:hoje,parametros:o,
    carteira,prazos:prazosResumo,producao,equipe,financeiro,
    responsaveis:[...responsaveis.values()].sort((a,b)=>b.ativos-a.ativos),
    sem_andamento_registrado:semAndamento,
    alertas_total:alertas.length,alertas_por_tipo:contagem,
    alertas:alertas.slice(0,o.max_alertas),
    fonte:'Registros do LEX: processos, prazos confirmados em fonte oficial e tarefas. Nada aqui é estimado.'
  };
}

// ---------------------------------------------------------------------
// Texto para os canais (WhatsApp/Telegram/app)
// ---------------------------------------------------------------------
const ICONE={alta:'🔴',media:'🟠',baixa:'🟡'};
const NOME_TIPO={prazo_vencido:['prazo vencido','prazos vencidos'],parcela_vencida:['parcela de honorários vencida','parcelas de honorários vencidas'],prazo_sem_peca:['prazo sem peça','prazos sem peça'],minuta_parada:['minuta esperando revisão','minutas esperando revisão'],tarefa_travada:['tarefa travada','tarefas travadas'],processo_parado:['processo parado','processos parados']};
function plural(n,um,varios){return n+' '+(n===1?um:varios)}
function horas(h){return String(h).replace('.',',')+' h'}

function alertasResumo(r){
  const ordem=Object.keys(NOME_TIPO);
  return Object.entries(r?.alertas_por_tipo||{})
    .sort(([a],[b])=>ordem.indexOf(a)-ordem.indexOf(b))
    .map(([k,n])=>NOME_TIPO[k]?plural(n,NOME_TIPO[k][0],NOME_TIPO[k][1]):n+' '+k)
    .join(', ');
}

function officeInsightsMessage(r,{incluirEquipe=true,maxAlertas=5}={}){
  const L=[];
  L.push('📊 Painel do escritório — '+brData(r.dia));
  const c=r.carteira;
  L.push('Carteira: '+plural(c.total,'processo','processos')+' ('+c.ativos+' ativo'+(c.ativos===1?'':'s')+': '+c.judicial+' judicia'+(c.judicial===1?'l':'is')+', '+c.administrativo+' administrativo'+(c.administrativo===1?'':'s')+', '+c.em_preparacao+' em preparação; '+plural(c.concluidos,'concluído','concluídos')+').');
  L.push(c.base_exito
    ?'Resultado: '+plural(c.ganhos,'ganho','ganhos')+', '+plural(c.perdidos,'perdido','perdidos')+' — êxito de '+c.taxa_exito+'% (só conta processo marcado como GANHO ou PERDIDO).'
    :'Resultado: nenhum processo marcado como GANHO ou PERDIDO ainda — sem base para taxa de êxito.');
  if(r.prazos)L.push('Prazos oficiais: '+r.prazos.vencidos+' vencido'+(r.prazos.vencidos===1?'':'s')+' · '+r.prazos.hoje+' hoje · '+r.prazos.proximos_7_dias+' nos próximos 7 dias'+(r.prazos.a_conferir?' · '+r.prazos.a_conferir+' data(s) anotada(s) a conferir':'')+'.');
  else L.push('Prazos: não consegui ler a lista de prazos agora.');
  const p=r.producao;
  if(p)L.push('Produção ('+p.janela_dias+' dias): '+plural(p.aprovadas,'minuta aprovada','minutas aprovadas')+' · '+p.aguardando_revisao+' esperando revisão · '+p.em_producao+' em produção · '+p.esperando_voce+' parada'+(p.esperando_voce===1?'':'s')+' esperando você'+(p.devolvidas?' · '+plural(p.devolvidas,'devolvida','devolvidas')+' para correção':'')+(p.revisao_media_horas!=null?' · revisão em '+horas(p.revisao_media_horas)+' em média':'')+'.');
  else L.push('Produção: o Task Engine não respondeu agora.');
  if(r.financeiro){
    const H=require('./honorarios'),f=r.financeiro;
    L.push('Honorários: recebido no mês '+H.brl(f.recebido_mes)+' · a receber '+H.brl(f.a_receber)+' · vencido '+H.brl(f.vencido)+(f.parcelas_vencidas?' ('+f.parcelas_vencidas+' parcela'+(f.parcelas_vencidas===1?'':'s')+')':'')+'.');
  }

  if(r.alertas_total){
    L.push('');
    L.push('⚠️ Pede ação ('+r.alertas_total+'): '+alertasResumo(r)+'.');
    r.alertas.slice(0,maxAlertas).forEach((a,i)=>{
      L.push((i+1)+'. '+ICONE[a.gravidade]+' '+a.quem+' — '+a.oque);
      L.push('   Por quê: '+a.porque);
      L.push('   Ação: '+a.acao+' Diga: "'+a.diga+'".');
    });
    if(r.alertas_total>maxAlertas)L.push('… e mais '+(r.alertas_total-maxAlertas)+'. Diga "painel do escritório" no app para ver todos.');
  }else{
    L.push('');
    L.push('✅ Nada pedindo ação pelos critérios do painel (prazo oficial sem peça, minuta parada há '+r.parametros.horas_revisao+' h, tarefa travada, processo sem andamento há '+r.parametros.dias_parado+' dias).');
  }
  if(r.sem_andamento_registrado)L.push(plural(r.sem_andamento_registrado,'processo ativo está','processos ativos estão')+' sem nenhum andamento registrado no LEX — diga "atualize os processos no tribunal".');

  if(incluirEquipe&&r.equipe?.pessoas?.length){
    L.push('');
    L.push('👥 Equipe ('+r.equipe.janela_dias+' dias):');
    for(const x of r.equipe.pessoas.slice(0,8))L.push('• '+x.nome+': '+plural(x.ordens,'ordem','ordens')+', '+plural(x.revisoes,'revisão','revisões')+(x.devolucoes?', '+plural(x.devolucoes,'devolução','devoluções'):'')+(x.revisao_media_horas!=null?', revisa em '+horas(x.revisao_media_horas)+' em média':'')+'.');
    if(r.equipe.observacao)L.push(r.equipe.observacao);
  }
  if(incluirEquipe&&r.responsaveis?.length){
    const brl=v=>require('./honorarios').brl(v);
    L.push('Por responsável: '+r.responsaveis.slice(0,8).map(x=>x.responsavel+' — '+x.ativos+' ativo'+(x.ativos===1?'':'s')+(x.parados?', '+x.parados+' parado'+(x.parados===1?'':'s'):'')+(x.prazos_vencidos?', '+x.prazos_vencidos+' prazo vencido':'')+(x.recebido_mes!=null?', recebido no mês '+brl(x.recebido_mes):'')).join(' · ')+'.');
  }
  L.push('');
  L.push('Fonte: '+r.fonte);
  return L.join('\n');
}

// Uma linha para o "bom dia": só aparece quando há algo pedindo ação.
function officeInsightsBriefLine(r){
  if(!r?.alertas_total)return null;
  return '📊 Painel: '+r.alertas_total+' ponto'+(r.alertas_total===1?'':'s')+' pedindo ação ('+alertasResumo(r)+'). Diga "painel do escritório".';
}

module.exports={computeOfficeInsights,officeInsightsMessage,officeInsightsBriefLine,diaCivil,PADRAO};
