'use strict';
// Vigia dos expedientes do PJe via MNI.
//
// Lista as intimações/citações pendentes do advogado em cada tribunal
// configurado, casa com o processo do LEX pelo CNJ e calcula a data da
// ciência tácita: sem consulta em 10 dias corridos do envio, o sistema
// registra a ciência automaticamente (Lei 11.419/2006, art. 5º, §3º) e o
// prazo passa a correr. A vigia NUNCA abre o teor (isso daria ciência).
const {hasCnj,applyPjeMovement}=require('./pje-sync');
const {createMniClient,mniConfig,MniError}=require('./pje-mni');
const {syncProcessesFromPje}=require('./pje-process-sync');

const KEY_PREFIX='lex_pje_avisos_';
const TACIT_DAYS=10;

function ymdSP(date){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(date)}
function addDays(ymd,n){const d=new Date(ymd+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function brDate(ymd){const m=String(ymd||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:String(ymd||'')}

// Ciência automática às 23:59:59 (Brasília) do 10º dia corrido após o envio.
function tacitCiencia(disponibilizadoEm){
  const ms=Date.parse(disponibilizadoEm||'');
  if(!Number.isFinite(ms))return null;
  const day=addDays(ymdSP(new Date(ms)),TACIT_DAYS);
  return{data:day,em:new Date(Date.parse(day+'T23:59:59-03:00')).toISOString()};
}
function daysUntil(ymd,now){
  if(!ymd)return null;
  return Math.round((Date.parse(ymd+'T12:00:00Z')-Date.parse(ymdSP(now)+'T12:00:00Z'))/86400000);
}

async function readState(records,sigla){
  return(await records.read(KEY_PREFIX+sigla))?.value||{sigla,avisos:{}};
}

async function syncTribunal({client,records,processStore,sigla,now}){
  let result;
  try{
    result=await client.consultarAvisosPendentes(sigla);
  }catch(error){
    // Falha fechada: preserva o que já se sabia e registra o erro visível.
    await records.change(KEY_PREFIX+sigla,prev=>({...(prev||{sigla,avisos:{}}),sigla,ultima_tentativa_em:now.toISOString(),ultimo_erro:{codigo:error.code||'erro',mensagem:String(error.message).slice(0,300),em:now.toISOString()}}));
    return{sigla,ok:false,erro:error.message,codigo:error.code||null,novos:[]};
  }
  const state=await processStore.read();
  const processes=Array.isArray(state?.processes)?state.processes:[];
  const novos=[];
  const saved=await records.change(KEY_PREFIX+sigla,prev=>{
    const base=prev||{sigla,avisos:{}};
    const avisos={...(base.avisos||{})};
    const listed=new Set();
    for(const a of result.avisos){
      listed.add(a.id_aviso);
      const current=avisos[a.id_aviso];
      const matches=a.cnj?processes.filter(p=>hasCnj(p,a.cnj)):[];
      const tacita=tacitCiencia(a.disponibilizado_em);
      const row={
        ...(current||{}),...a,sigla,
        processo_id:matches.length===1?String(matches[0].id):null,
        processo_nome:matches.length===1?(matches[0].nome||null):null,
        vinculo:matches.length===1?'casado':matches.length>1?'cnj_duplicado':'sem_processo',
        ciencia_tacita_em:tacita?.em||null,ciencia_tacita_data:tacita?.data||null,
        status:current?.status==='ciencia_dada'?'ciencia_dada':'pendente',
        visto_primeiro_em:current?.visto_primeiro_em||now.toISOString(),
        visto_ultimo_em:now.toISOString()
      };
      if(!current)novos.push(row);
      avisos[a.id_aviso]=row;
    }
    // Deixou de ser listado: foi aberto em outro lugar ou a ciência tácita
    // ocorreu. O prazo pode já estar correndo — nunca tratar como resolvido.
    for(const [id,row] of Object.entries(avisos)){
      if(!listed.has(id)&&row.status==='pendente')avisos[id]={...row,status:'nao_listado',saiu_da_lista_em:now.toISOString()};
    }
    // Retenção: pendentes sempre; demais por 90 dias.
    const cutoff=now.getTime()-90*86400000;
    for(const [id,row] of Object.entries(avisos)){
      if(row.status!=='pendente'&&Date.parse(row.visto_ultimo_em||0)<cutoff)delete avisos[id];
    }
    return{sigla,avisos,ultima_leitura_em:now.toISOString(),ultima_tentativa_em:now.toISOString(),ultimo_erro:null,mensagem:result.mensagem||null};
  });
  const pendentes=Object.values(saved?.avisos||{}).filter(a=>a.status==='pendente').length;
  return{sigla,ok:true,novos,pendentes};
}

async function syncPjeAvisos({client,records,processStore,now=new Date()}={}){
  if(!client||!records?.read||!records?.change||!processStore?.read)throw new Error('Vigia do PJe sem dependências.');
  const tribunais=[];
  for(const sigla of client.tribunais())tribunais.push(await syncTribunal({client,records,processStore,sigla,now}));
  const novos=tribunais.flatMap(t=>t.novos);
  return{ok:tribunais.every(t=>t.ok),tribunais,novos,falhas:tribunais.filter(t=>!t.ok)};
}

async function listPjeAvisos({records,siglas,now=new Date()}){
  const out=[],estado=[];
  for(const sigla of siglas){
    const st=await readState(records,sigla);
    estado.push({sigla,ultima_leitura_em:st.ultima_leitura_em||null,ultimo_erro:st.ultimo_erro||null});
    for(const a of Object.values(st.avisos||{}))out.push({...a,dias_para_ciencia_tacita:daysUntil(a.ciencia_tacita_data,now)});
  }
  out.sort((x,y)=>(x.dias_para_ciencia_tacita??9999)-(y.dias_para_ciencia_tacita??9999));
  return{avisos:out,estado};
}

function avisoLine(a){
  const quando=a.dias_para_ciencia_tacita==null?'data de envio não informada'
    :a.dias_para_ciencia_tacita<0?'ciência tácita JÁ OCORREU em '+brDate(a.ciencia_tacita_data)
    :a.dias_para_ciencia_tacita===0?'ciência tácita HOJE às 23:59'
    :'ciência tácita em '+brDate(a.ciencia_tacita_data)+' ('+a.dias_para_ciencia_tacita+(a.dias_para_ciencia_tacita===1?' dia':' dias')+')';
  const quem=a.processo_nome||(a.cnj?a.cnj.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/,'$1-$2.$3.$4.$5.$6'):'processo sem número');
  const alerta=a.vinculo==='sem_processo'?' — ⚠️ processo NÃO cadastrado no LEX':a.vinculo==='cnj_duplicado'?' — ⚠️ CNJ duplicado no LEX':'';
  return'• ['+a.sigla+' #'+a.id_aviso+'] '+a.tipo_descricao+' — '+quem+(a.orgao?' · '+a.orgao:'')+'\n  '+quando+alerta;
}

function pjeAvisosMessage({avisos,estado},{config}){
  if(!config.configurado)return'O PJe ainda não está conectado ao LEX ('+(config.erro||'faltam '+config.faltando.join(', '))+'). Até lá, confira os expedientes direto no painel do PJe.';
  const pend=avisos.filter(a=>a.status==='pendente');
  const saiu=avisos.filter(a=>a.status==='nao_listado'&&Date.parse(a.saiu_da_lista_em||0)>Date.now()-15*86400000);
  const lines=[];
  if(!pend.length)lines.push('Nenhum expediente pendente no PJe na última leitura.');
  else{
    lines.push(pend.length+' expediente(s) pendente(s) no PJe (ainda sem ciência):');
    for(const a of pend.slice(0,12))lines.push(avisoLine(a));
    if(pend.length>12)lines.push('… e mais '+(pend.length-12)+'.');
    lines.push('\nPara abrir um teor, diga "abrir intimação TRIBUNAL #número". Abrir DÁ CIÊNCIA e o prazo começa a correr (Lei 11.419/2006, art. 5º, §1º).');
  }
  if(saiu.length)lines.push('\n'+saiu.length+' expediente(s) saíram da lista (abertos em outro lugar ou ciência tácita): confira o prazo no processo.');
  for(const e of estado){
    if(e.ultimo_erro)lines.push('⚠️ '+e.sigla+': última leitura falhou ('+e.ultimo_erro.mensagem+'). Isso NÃO significa que não há intimações.');
    else if(!e.ultima_leitura_em)lines.push('⚠️ '+e.sigla+': ainda sem leitura bem-sucedida.');
    else{
      const h=Math.floor((Date.now()-Date.parse(e.ultima_leitura_em))/3600000);
      if(h>6)lines.push('⚠️ '+e.sigla+': última leitura há '+h+'h.');
    }
  }
  return lines.join('\n');
}

// Abertura do teor com autorização humana: dá ciência, grava o teor e
// registra o andamento no processo. O LEX não calcula o prazo aqui.
async function openPjeAviso({client,records,processStore,sigla,idAviso,authorization,now=new Date()}){
  const S=String(sigla||'').toUpperCase(),id=String(idAviso||'');
  const st=await readState(records,S);
  const aviso=st.avisos?.[id];
  if(!aviso)throw new MniError('aviso_desconhecido','Não encontrei o aviso '+S+' #'+id+' na última leitura do PJe.');
  const teor=await client.consultarTeorComunicacao(S,{cnj:aviso.cnj,idAviso:id},authorization);
  const texto=teor.comunicacoes.map(c=>c.teor).filter(Boolean).join('\n\n').trim();
  await records.change(KEY_PREFIX+S,prev=>{
    const base=prev||{sigla:S,avisos:{}};
    return{...base,avisos:{...base.avisos,[id]:{...(base.avisos?.[id]||aviso),status:'ciencia_dada',ciencia_em:now.toISOString(),ciencia_autorizada_por:authorization.perfil,teor:texto.slice(0,20000),documentos:teor.comunicacoes.flatMap(c=>c.documentos)}}};
  });
  let andamento=null;
  if(aviso.vinculo==='casado'&&aviso.cnj){
    try{
      andamento=await applyPjeMovement({processStore,origem:'pje'},{
        cnj:aviso.cnj,data:ymdSP(now),observed_at:now.toISOString(),
        andamento_texto:'Ciência de '+aviso.tipo_descricao.toLowerCase()+' registrada via LEX (MNI, aviso '+id+'). '+(texto?texto.slice(0,1500):'Teor sem texto; ver documentos.')
      });
    }catch(error){andamento={erro:error.message}}
  }
  return{aviso:{...aviso,status:'ciencia_dada',ciencia_em:now.toISOString()},teor:texto,documentos:teor.comunicacoes.flatMap(c=>c.documentos),andamento};
}

function createPjeMonitor({records,processStore,notify=async()=>{},log=()=>{},env=process.env,transport,now=()=>new Date(),intervalMs=2*60*60*1000}={}){
  const config=mniConfig(env);
  const client=config.configurado?createMniClient(config,{transport,now}):null;
  let timer=null,running=false;
  async function tick(){
    if(!client)return{skipped:'nao_configurado'};
    const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(now()));
    if(hour<6||hour>22)return{skipped:'fora_horario'};
    if(running)return{skipped:'em_execucao'};
    running=true;
    try{
      const result=await syncPjeAvisos({client,records,processStore,now:now()});
      if(result.novos.length){
        const listed=await listPjeAvisos({records,siglas:client.tribunais(),now:now()});
        const fresh=new Set(result.novos.map(a=>a.sigla+'#'+a.id_aviso));
        const lines=listed.avisos.filter(a=>fresh.has(a.sigla+'#'+a.id_aviso)).map(avisoLine);
        await notify('⚖️ PJe: '+result.novos.length+' novo(s) expediente(s) pendente(s):\n'+lines.join('\n')+'\n\nNada foi aberto: a ciência só ocorre quando você mandar abrir ou no fim do prazo de 10 dias.');
      }
      for(const f of result.falhas)await notify('⚠️ PJe '+f.sigla+': leitura falhou ('+f.erro+'). O LEX não considera os expedientes desse tribunal atualizados.');
      // Uma vez por dia: andamentos e partes de toda a carteira.
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(now());
      const last=(await records.read('lex_pje_carteira_dia'))?.value;
      if(last?.date!==today){
        const carteira=await syncProcessesFromPje({client,processStore,now:now()});
        await records.change('lex_pje_carteira_dia',()=>({date:today,atualizados:carteira.atualizados.length,novos:carteira.novos_andamentos,falhas:carteira.falhas.length,em:now().toISOString()}));
        if(carteira.novos_andamentos)await notify('⚖️ PJe: '+carteira.novos_andamentos+' andamento(s) novo(s) em '+carteira.atualizados.filter(a=>a.novos).length+' processo(s):\n'+carteira.atualizados.filter(a=>a.novos).slice(0,8).map(a=>'• '+a.nome+' — '+a.novos+' novo(s)').join('\n'));
        result.carteira=carteira;
      }
      return result;
    }catch(error){log('[PJe] vigia falhou: '+error.message);return{ok:false,error:error.message}}
    finally{running=false}
  }
  function start(){if(!client||timer)return;setTimeout(()=>tick().catch(e=>log('[PJe] '+e.message)),90*1000);timer=setInterval(()=>tick().catch(e=>log('[PJe] '+e.message)),intervalMs)}
  function stop(){if(timer){clearInterval(timer);timer=null}}
  return{config,client,tick,start,stop,
    list:()=>listPjeAvisos({records,siglas:config.tribunais.map(t=>t.sigla),now:now()}),
    open:args=>client?openPjeAviso({client,records,processStore,now:now(),...args}):Promise.reject(new MniError('nao_configurado','PJe (MNI) não configurado.'))};
}

module.exports={KEY_PREFIX,TACIT_DAYS,tacitCiencia,syncPjeAvisos,listPjeAvisos,pjeAvisosMessage,avisoLine,openPjeAviso,createPjeMonitor};
