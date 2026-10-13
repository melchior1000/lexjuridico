'use strict';
// =====================================================================
// INTIMAÇÕES DO DIÁRIO (DJEN) A TRATAR
// ---------------------------------------------------------------------
// Como fazem ADVBOX, Projuris, Astrea e AASP: cada intimação fica PENDENTE até uma pessoa
// decidir o que fazer com ela — o contador só zera com decisão humana. Antes, o LEX avisava
// uma vez e, se ninguém agisse, a intimação de processo não cadastrado sumia do radar, e a
// casada esperava uma confirmação que nenhuma tela oferecia.
//
// Pendente é:
//  - "casada" com um processo e sem prazo confirmado (prazo_cunhado false);
//  - "órfã": o número não está na carteira (processo não cadastrado ou número a conferir);
//  - "nova": lida e gravada, mas o LEX não conseguiu ligar ao processo (aparece "a conferir");
// e que ninguém marcou como "sem prazo para o escritório", "não é nosso" ou "já tratada fora".
//
// Regras (cinto):
//  - marcar é ato do titular (admin/advogado), pela frase exata ou pelo botão — nunca pela IA;
//  - fica registrado quem, quando, o quê e por quê; pode ser desfeito (reabrir);
//  - nada é apagado: a comunicação continua no banco e no histórico do processo;
//  - banco fora do ar: falha fechada (nunca "nenhuma pendência").
// Desde 16/05/2025 o prazo do advogado conta da publicação no DJEN (Res. CNJ 455/2022, art. 11,
// §3º, red. Res. 569/2024): publicação no 1º dia útil após a disponibilização e início no dia útil
// seguinte (CPC, art. 224, §§ 2º e 3º).
// =====================================================================
const {rowsFromResult}=require('./supabase');
const Calendar=require('./forensic-calendar');

const KEY='lex_djen_tratamento';
const ACOES=Object.freeze({
  sem_prazo:'sem prazo para o escritório',
  nao_e_nosso:'não é processo do escritório',
  tratada_fora:'já tratada fora do LEX'
});
const PODE_TRATAR=new Set(['admin','advogado']);
const JANELA_DIAS=120,PAGINA=500,MAX_PAGINAS=20,HISTORICO_MAX=300;
const CAMPOS='djen_id,status,cnj,tribunal,tipo,data_disponibilizacao,data_publicacao,processo_id,prazo_cunhado,prazo_sugestao,motivo_cancelamento,numero_oab,uf_oab,texto';

const FMT_DIA=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'});
function ymdSP(d){return FMT_DIA.format(d)}
function addDays(ymd,n){const d=new Date(ymd+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function diasEntre(de,ate){return Math.round((Date.parse(ate+'T12:00:00Z')-Date.parse(de+'T12:00:00Z'))/86400000)}
function brData(ymd){const m=String(ymd||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:'—'}
function brCurta(ymd){const m=String(ymd||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]:'—'}
function cnjMask(d){const x=String(d||'').replace(/\D/g,'');return x.length===20?x.slice(0,7)+'-'+x.slice(7,9)+'.'+x.slice(9,13)+'.'+x.slice(13,14)+'.'+x.slice(14,16)+'.'+x.slice(16):(x||'sem número')}
function dbDe(deps){return typeof deps?.sbReq==='function'?deps.sbReq:typeof deps?.records?.request==='function'?deps.records.request:null}
function erro(msg,status=400){return Object.assign(new Error(msg),{status})}

// Publicação: a informada pelo DJEN ou o 1º dia útil seguinte à disponibilização (CPC, art. 224, §2º).
function publicacaoDe(row){
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(row?.data_publicacao||'')))return row.data_publicacao;
  try{return Calendar.publicacaoDjen(String(row?.data_disponibilizacao||''))}catch{return null}
}

async function lerComunicacoes(sbReq,desde){
  const out=[];
  for(let pagina=0;pagina<MAX_PAGINAS;pagina++){
    const rows=rowsFromResult(await sbReq('GET','djen_comunicacoes',null,{
      // Só o que pode estar pendente: órfã, ou casada sem prazo confirmado (o banco filtra; a
      // confirmada não precisa vir com o texto inteiro a cada abertura do app).
      select:CAMPOS,or:'(status.eq.orfa,status.eq.nova,and(status.eq.casada,prazo_cunhado.not.is.true))',data_disponibilizacao:'gte.'+desde,
      order:'data_disponibilizacao.asc,djen_id.asc',limit:String(PAGINA),offset:String(pagina*PAGINA)
    }),'Listar intimações do Diário a tratar');
    out.push(...rows);
    if(rows.length<PAGINA)return out;
  }
  // Nunca corta em silêncio: com mais do que isso, o LEX não afirma que a lista está completa.
  throw new Error('Há mais de '+(PAGINA*MAX_PAGINAS)+' intimações na janela; a lista foi interrompida para não esconder nenhuma.');
}

async function lerEstado(records){
  const v=(await records.read(KEY))?.value;
  return v&&typeof v==='object'?{itens:v.itens&&typeof v.itens==='object'?v.itens:{},historico:Array.isArray(v.historico)?v.historico:[]}:{itens:{},historico:[]};
}

function itemDe(row,{hoje,nomes,tratamento}){
  const sug=row.prazo_sugestao&&typeof row.prazo_sugestao==='object'?row.prazo_sugestao:null;
  const publicada=publicacaoDe(row);
  const proposto=/^\d{4}-\d{2}-\d{2}$/.test(String(sug?.due_at_proposto||''))?sug.due_at_proposto:null;
  const diasAte=proposto?diasEntre(hoje,proposto):null;
  const diasDesde=publicada?diasEntre(publicada,hoje):null;
  const orfa=row.status==='orfa',naoLigada=row.status==='nova';
  return{
    djen_id:String(row.djen_id),situacao:orfa?'processo_nao_cadastrado':naoLigada?'a_conferir':'prazo_a_confirmar',
    processo_id:orfa||naoLigada?null:(row.processo_id!=null?String(row.processo_id):null),
    processo:orfa||naoLigada?null:(nomes.get(String(row.processo_id))||null),
    cnj:row.cnj||null,cnj_formatado:row.cnj?cnjMask(row.cnj):null,tribunal:row.tribunal||null,tipo:row.tipo||'Comunicação',
    disponibilizada_em:row.data_disponibilizacao||null,publicada_em:publicada,dias_desde_publicacao:diasDesde,
    prazo_proposto:proposto,dias_ate_prazo_proposto:diasAte,termo_inicial_proposto:sug?.termo_inicial_proposto||null,
    dias_prazo:Number.isFinite(Number(sug?.dias))?Number(sug.dias):null,regime:sug?.regime||null,trecho:sug?.trecho?String(sug.trecho).slice(0,300):null,
    sugestao_hash:sug?.source_hash||null,
    // Urgente: prazo proposto em até 3 dias (ou já passado); sem proposta, publicada há 3 dias ou mais.
    urgente:proposto?diasAte<=3:(diasDesde!=null&&diasDesde>=3),
    oab:row.numero_oab&&String(row.numero_oab)!=='NOME'?String(row.numero_oab)+'/'+String(row.uf_oab||'').toUpperCase():null,
    // Achada só pelo nome do advogado (OAB faltando ou errada na publicação): pode ser homônimo.
    achada_pelo_nome:String(row.numero_oab||'')==='NOME',
    texto:String(row.texto||'').replace(/\s+/g,' ').trim().slice(0,600),
    ...(tratamento?{tratamento}:{})
  };
}
function ordenar(a,b){
  if(a.urgente!==b.urgente)return a.urgente?-1:1;
  if(a.prazo_proposto&&b.prazo_proposto&&a.prazo_proposto!==b.prazo_proposto)return a.prazo_proposto<b.prazo_proposto?-1:1;
  if(!!a.prazo_proposto!==!!b.prazo_proposto)return a.prazo_proposto?-1:1;
  return String(a.disponibilizada_em||'').localeCompare(String(b.disponibilizada_em||''))||a.djen_id.localeCompare(b.djen_id);
}

// Lista o que falta tratar (e as últimas tratadas, para conferência e para desfazer).
async function listarPendentes(deps={},{now=new Date(),janelaDias=JANELA_DIAS}={}){
  const sbReq=dbDe(deps);
  if(typeof sbReq!=='function'||!deps.records?.read)throw erro('Banco de intimações indisponível: isso NÃO significa que não há intimações. Confira o DJEN diretamente.',503);
  const hoje=ymdSP(now),desde=addDays(hoje,-Math.max(1,janelaDias));
  const [rows,estado]=await Promise.all([lerComunicacoes(sbReq,desde),lerEstado(deps.records)]);
  let nomes=new Map();
  try{const st=await deps.processStore?.read?.();nomes=new Map((st?.processes||[]).map(p=>[String(p.id),String(p.nome_oficial||p.nome||p.cliente||p.partes||'Processo')]))}catch{/* sem nome: o número basta */}
  const pendentes=[],tratadas=[];
  for(const row of rows){
    if(!row||row.djen_id==null||row.motivo_cancelamento)continue;
    if(row.status==='casada'&&row.prazo_cunhado===true)continue;
    const t=estado.itens[String(row.djen_id)];
    if(t){tratadas.push(itemDe(row,{hoje,nomes,tratamento:t}));continue}
    pendentes.push(itemDe(row,{hoje,nomes}));
  }
  pendentes.sort(ordenar);
  tratadas.sort((a,b)=>String(b.tratamento.em||'').localeCompare(String(a.tratamento.em||'')));
  return{ok:true,total:pendentes.length,orfas:pendentes.filter(i=>i.situacao==='processo_nao_cadastrado').length,
    urgentes:pendentes.filter(i=>i.urgente).length,pendentes,tratadas_recentes:tratadas.slice(0,10),janela_desde:desde};
}

async function lerComunicacao(sbReq,djenId){
  const id=String(djenId||'').trim();
  if(!/^[A-Za-z0-9_-]{1,40}$/.test(id))throw erro('Número da intimação inválido.');
  const rows=rowsFromResult(await sbReq('GET','djen_comunicacoes',null,{select:CAMPOS,djen_id:'eq.'+id,limit:'2'}),'Ler intimação do Diário');
  if(rows.length!==1)throw erro(rows.length?'Intimação duplicada no banco; confira antes de tratar.':'Não encontrei a intimação nº '+id+' no LEX.',rows.length?409:404);
  return rows[0];
}

// Marca uma intimação como tratada sem prazo confirmado no LEX. Ato do titular.
async function tratar(deps={},{djenId,acao,motivo='',perfil,now=new Date()}={}){
  if(!PODE_TRATAR.has(String(perfil||'')))throw erro('Só o advogado ou o administrador pode dar uma intimação por tratada.',403);
  if(!ACOES[acao])throw erro('Escolha: sem prazo para o escritório, não é nosso, ou já tratada fora do LEX.');
  const sbReq=dbDe(deps);
  if(typeof sbReq!=='function'||!deps.records?.change)throw erro('Banco de intimações indisponível; nada foi marcado.',503);
  const row=await lerComunicacao(sbReq,djenId);
  if(row.motivo_cancelamento)throw erro('Essa intimação foi cancelada no Diário; não precisa de tratamento.',409);
  if(row.status==='casada'&&row.prazo_cunhado===true)throw erro('O prazo dessa intimação já foi confirmado; não há o que tratar.',409);
  if(!['casada','orfa','nova'].includes(String(row.status)))throw erro('Essa intimação não está entre as que esperam tratamento.',409);
  const quando=now.toISOString(),id=String(row.djen_id);
  const registro={acao,descricao:ACOES[acao],motivo:String(motivo||'').replace(/\s+/g,' ').trim().slice(0,300)||null,por:String(perfil),em:quando,situacao_anterior:row.status};
  let jaTratada=null;
  await deps.records.change(KEY,cur=>{
    const base=cur&&typeof cur==='object'?cur:{};
    const itens={...(base.itens||{})};
    if(itens[id]){jaTratada=itens[id];return undefined}
    itens[id]=registro;
    // Retenção: some da lista de tratadas depois de 180 dias (a comunicação continua no banco).
    const corte=now.getTime()-180*86400000;
    for(const [k,v] of Object.entries(itens))if(Date.parse(v?.em||0)<corte)delete itens[k];
    const historico=[{djen_id:id,...registro},...(Array.isArray(base.historico)?base.historico:[])].slice(0,HISTORICO_MAX);
    return{...base,itens,historico};
  });
  if(jaTratada)return{ok:true,ja_tratada:true,djen_id:id,tratamento:jaTratada};
  return{ok:true,djen_id:id,tratamento:registro};
}

// Desfaz a marcação: a intimação volta para a lista de pendentes.
async function reabrir(deps={},{djenId,perfil,now=new Date()}={}){
  if(!PODE_TRATAR.has(String(perfil||'')))throw erro('Só o advogado ou o administrador pode reabrir uma intimação.',403);
  if(!deps.records?.change)throw erro('Banco indisponível; nada foi alterado.',503);
  const id=String(djenId||'').trim();
  let antes=null;
  await deps.records.change(KEY,cur=>{
    const base=cur&&typeof cur==='object'?cur:{};
    if(!base.itens?.[id])return undefined;
    antes=base.itens[id];
    const itens={...base.itens};delete itens[id];
    const historico=[{djen_id:id,acao:'reaberta',por:String(perfil),em:now.toISOString()},...(Array.isArray(base.historico)?base.historico:[])].slice(0,HISTORICO_MAX);
    return{...base,itens,historico};
  });
  if(!antes)return{ok:false,djen_id:id,erro:'A intimação nº '+id+' não estava marcada como tratada.'};
  return{ok:true,djen_id:id,reaberta:true,antes};
}

// Texto para conversa, resumo da manhã e "o que precisa de mim". Cada linha diz QUEM, O QUÊ,
// POR QUÊ e a AÇÃO (com a frase exata, que só vale digitada pelo titular).
function linhaPendente(i){
  const onde=i.situacao==='processo_nao_cadastrado'?i.cnj_formatado+' — ⚠️ processo NÃO cadastrado no LEX'
    :i.situacao==='a_conferir'?(i.cnj_formatado||'sem número')+' — ⚠️ o LEX leu, mas não conseguiu ligar ao processo (tenta de novo a cada leitura)'
    :(i.processo||'Processo')+(i.cnj_formatado?' ('+i.cnj_formatado+')':'');
  const prazo=i.prazo_proposto?'prazo proposto '+brData(i.prazo_proposto)+(i.dias_ate_prazo_proposto<0?' — JÁ PASSOU':i.dias_ate_prazo_proposto===0?' — HOJE':' — faltam '+i.dias_ate_prazo_proposto+(i.dias_ate_prazo_proposto===1?' dia':' dias'))
    :'sem prazo calculado'+(i.dias_desde_publicacao!=null&&i.dias_desde_publicacao>0?' — publicada há '+i.dias_desde_publicacao+(i.dias_desde_publicacao===1?' dia':' dias'):'');
  const acao=i.situacao==='processo_nao_cadastrado'
    ?'cadastre: "cadastre o processo '+i.cnj_formatado+'" ou responda NÃO É NOSSO '+i.djen_id
    :i.situacao==='a_conferir'
    ?'confira no processo e anote o prazo; depois responda JÁ TRATEI '+i.djen_id+' (ou SEM PRAZO '+i.djen_id+')'
    :'confirme: CONFIRMO PRAZO '+i.djen_id+' '+(i.prazo_proposto?brData(i.prazo_proposto):'dd/mm/aaaa')+' — ou SEM PRAZO '+i.djen_id;
  return'• '+(i.urgente?'🔴 ':'')+'nº '+i.djen_id+' · '+brCurta(i.disponibilizada_em)+' · '+(i.tribunal||'tribunal?')+' · '+i.tipo+' — '+onde
    +(i.achada_pelo_nome?'\n  ⚠️ achada pelo nome do advogado, sem a sua OAB: confira se é sua (homônimo → NÃO É NOSSO '+i.djen_id+')':'')+'\n  '+prazo+'\n  '+acao;
}
function mensagemPendentes(r,{max=8}={}){
  if(!r?.total)return'✅ Nenhuma intimação do Diário (DJEN) esperando tratamento.';
  const lines=['📌 '+r.total+(r.total===1?' intimação do Diário a tratar':' intimações do Diário a tratar')+(r.orfas?' ('+r.orfas+' de processo não cadastrado)':'')+(r.urgentes?' — '+r.urgentes+' urgente(s)':'')+':'];
  for(const i of r.pendentes.slice(0,max))lines.push(linhaPendente(i));
  if(r.total>max)lines.push('… e mais '+(r.total-max)+'. Veja todas em Prazos › Diário.');
  lines.push('Prazo do advogado conta da publicação no DJEN. Confirmar prazo, "sem prazo" e "não é nosso" só valem digitados por você (ou pelos botões em Prazos › Diário).');
  return lines.join('\n');
}
function linhaResumo(r){
  if(!r)return null;
  if(!r.total)return'📌 Diário: nenhuma intimação esperando tratamento.';
  const top=r.pendentes[0];
  return'📌 Diário: '+r.total+' intimação(ões) a tratar'+(r.orfas?' ('+r.orfas+' de processo não cadastrado)':'')+(r.urgentes?' · '+r.urgentes+' URGENTE(S)':'')
    +(top?' — a primeira: nº '+top.djen_id+' · '+(top.processo||top.cnj_formatado||'sem número')+(top.prazo_proposto?' · prazo proposto '+brData(top.prazo_proposto):''):'');
}

module.exports={KEY,ACOES,JANELA_DIAS,listarPendentes,tratar,reabrir,mensagemPendentes,linhaPendente,linhaResumo,publicacaoDe,cnjMask};
