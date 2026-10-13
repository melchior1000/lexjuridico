'use strict';
const {rowsFromResult}=require('./supabase');
const {cnjDigits,hasCnj,applyPjeMovement}=require('./pje-sync');
const Djen=require('./djen');
const DeadlineSuggestion=require('./deadline-suggestion');
const {hojeBrasil}=require('./data-brasil');

// OABs ligadas pela tela/WhatsApp (gravadas na configuração do escritório).
let runtimeOabs=()=>[];
function setOabsProvider(fn){runtimeOabs=typeof fn==='function'?fn:()=>[]}
// Nomes dos advogados para a segunda rede (busca pelo nome): DJEN_NOMES ("Nome Um;Nome Dois") ou a
// configuração do escritório (nome informado junto com a OAB).
let runtimeNomes=()=>[];
function setNomesProvider(fn){runtimeNomes=typeof fn==='function'?fn:()=>[]}
function parseNomes(value=process.env.DJEN_NOMES||''){
  const lista=String(value||'').trim()?String(value).split(/[;\n]/):(()=>{try{return runtimeNomes()||[]}catch{return[]}})();
  const vistos=new Set(),out=[];
  for(const n of lista){const x=String(n||'').replace(/\s+/g,' ').trim();const k=x.toLowerCase();if(x.length>=8&&/\s/.test(x)&&!vistos.has(k)){vistos.add(k);out.push(x)}}
  return out;
}
// Campo da comunicação em qualquer das grafias que o DJEN usa (camelCase, snake_case, minúsculas).
function campo(item,...nomes){for(const n of nomes){const v=item?.[n];if(v!=null&&String(v).trim())return v}return null}
function dataIso(v){const s=String(v||'').trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return m[1]+'-'+m[2]+'-'+m[3];m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);return m?m[3]+'-'+m[2]+'-'+m[1]:null}
const UFS=new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
// Aceita "123456/MG", "123.456 MG", "MG 123456", "OAB/MG 123456", várias separadas por vírgula ou "e".
function parseOabInput(text){
  const out=[],seen=new Set(),t=String(text||'').toUpperCase().replace(/(\d)\.(\d)/g,'$1$2');
  const re=/\b(?:OAB\s*[\/-]?\s*)?([A-Z]{2})?\s*[\/-]?\s*(\d{3,7})(?:\s*[\/-]?\s*([A-Z]{2}))?\b/g;
  let m;while((m=re.exec(t))){const uf=m[3]||m[1];if(!uf||!UFS.has(uf))continue;const oab=String(Number(m[2]));const k=oab+'/'+uf;if(!seen.has(k)){seen.add(k);out.push({oab,uf})}}
  return out;
}
function parseOabs(value=process.env.DJEN_OABS||''){
  if(!String(value||'').trim()){try{return(runtimeOabs()||[]).filter(o=>o&&o.oab&&o.uf)}catch{return[]}}
  return String(value).split(',').map(x=>x.trim()).filter(Boolean).map(x=>{const m=x.match(/^(\d+)\s*:\s*([A-Za-z]{2})$/);if(!m)throw new Error('DJEN_OABS inválido: '+x);return{oab:m[1],uf:m[2].toUpperCase()}});
}
function communicationRow(item,oab,uf,audit={}){
  const djenId=item.id??item.hash;if(djenId==null||!String(djenId).trim())return null;
  // Cancelada: motivo informado, comunicação inativa ou data de cancelamento (grafias do DJEN).
  const dataCancel=campo(item,'data_cancelamento','dataCancelamento','datacancelamento');
  const cancel=item.motivoCancelamento||item.motivo_cancelamento||(item.ativo===false?'comunicação inativa no DJEN':null)||(dataCancel?'cancelada no DJEN em '+(dataIso(dataCancel)||String(dataCancel).slice(0,10)):null)||null;
  return{
    djen_id:String(djenId),djen_hash:item.hash?String(item.hash):null,numero_oab:String(oab),uf_oab:String(uf).toUpperCase(),
    cnj:cnjDigits(item.numeroProcesso||item.numero_processo||item.numeroprocessocommascara||''),
    tribunal:item.siglaTribunal||item.tribunal||null,tipo:item.tipoComunicacao||item.tipo||null,
    data_disponibilizacao:dataIso(campo(item,'dataDisponibilizacao','data_disponibilizacao','datadisponibilizacao')),
    data_publicacao:dataIso(campo(item,'dataPublicacao','data_publicacao','datapublicacao')),
    texto:Djen.sanitizeText(item.texto).slice(0,20000),motivo_cancelamento:cancel?String(cancel):null,payload:item,
    raw_receipt:String(audit.raw_receipt||''),receipt_item_key:Djen.itemKey(item),receipt_page:Number(audit.pagina)||null,
    status:cancel?'cancelada':'nova',requisitado_em:audit.requested_at||null,observado_em:audit.responded_at||new Date().toISOString(),endpoint:audit.endpoint||null,request_id:audit.request_id||null
  };
}
async function upsertCommunication(sbReq,row){
  const result=await sbReq('POST','djen_comunicacoes',row,{on_conflict:'djen_id'},{Prefer:'resolution=merge-duplicates,return=representation'});
  const rows=rowsFromResult(result,'Gravar comunicação DJEN');return rows[0]||row;
}
async function markCommunication(sbReq,djenId,patch){
  const result=await sbReq('PATCH','djen_comunicacoes',{...patch,atualizado_em:new Date().toISOString()},{djen_id:'eq.'+djenId},{Prefer:'return=representation'});
  return rowsFromResult(result,'Atualizar comunicação DJEN')[0]||null;
}
async function listPendingMint(sbReq,limit=100){
  return rowsFromResult(await sbReq('GET','djen_comunicacoes',null,{status:'eq.casada',prazo_cunhado:'eq.false',order:'data_disponibilizacao.asc',limit:String(limit)}),'Listar comunicações para cunhagem');
}

// Lê todas as comunicações de um CNJ em páginas. Antes o fluxo de correção/cadastro
// parava silenciosamente em 50 publicações e podia deixar intimação antiga órfã.
async function readCommunicationsByCnj(sbReq,cnj,{status=null,order='data_disponibilizacao.asc',pageSize=200,maxRows=10000}={}){
  const digits=cnjDigits(cnj)||'';
  if(typeof sbReq!=='function'||digits.length!==20)return[];
  const out=[];let offset=0;
  while(offset<maxRows){
    const query={cnj:'eq.'+digits,order,limit:String(pageSize),offset:String(offset)};
    if(status)query.status='eq.'+status;
    const batch=rowsFromResult(await sbReq('GET','djen_comunicacoes',null,query),'Ler publicações do processo');
    out.push(...batch);
    if(batch.length<pageSize)return out;
    offset+=batch.length;
  }
  throw new Error('Há mais de '+maxRows+' publicações para este processo; a leitura foi interrompida para não truncar silenciosamente.');
}

async function persistDeadlineSuggestion(sbReq,djenId,suggestion){
  const patch={prazo_sugestao:suggestion,prazo_sugerido_em:new Date().toISOString(),atualizado_em:new Date().toISOString()};
  const rows=rowsFromResult(await sbReq('PATCH','djen_comunicacoes',patch,{djen_id:'eq.'+String(djenId)},{Prefer:'return=representation'}),'Salvar sugestão de prazo');
  if(!rows[0])throw new Error('Salvar sugestão de prazo: nenhuma comunicação foi atualizada.');
  return rows[0];
}
async function suggestPendingDeadlines(sbReq,rows=[],options={}){
  const out=[],failures=[];
  for(const row of Array.isArray(rows)?rows:[]){
    const currentHash=DeadlineSuggestion.sourceHash(row),stored=row?.prazo_sugestao;
    const sameVersion=stored?.suggestion_version===DeadlineSuggestion.SUGGESTION_VERSION;
    const needsAiUpgrade=stored?.status==='candidato_sem_ia'&&typeof options.aiAnalyze==='function';
    if(stored?.status&&stored.source_hash===currentHash&&sameVersion&&!needsAiUpgrade){out.push(row);continue}
    try{
      const suggestion=await DeadlineSuggestion.buildDeadlineSuggestion({
        communication:row,aiAnalyze:options.aiAnalyze,feriados:options.feriados||[],calendarioVerificado:options.calendarioVerificado===true
      });
      const persisted=await persistDeadlineSuggestion(sbReq,row.djen_id,suggestion);
      out.push(persisted);
    }catch(error){
      failures.push({djen_id:row?.djen_id||null,error:error.message});
      out.push(row);
    }
  }
  return{rows:out,failures};
}

async function readSyncState(sbReq,oab,uf){
  const rows=rowsFromResult(await sbReq('GET','djen_sync_state',null,{numero_oab:'eq.'+String(oab),uf_oab:'eq.'+String(uf).toUpperCase(),limit:'1'}),'Ler cursor DJEN');
  return rows[0]||null;
}
async function saveSyncState(sbReq,oab,uf,date){
  const row={numero_oab:String(oab),uf_oab:String(uf).toUpperCase(),last_success_date:String(date),last_success_at:new Date().toISOString(),last_error:null};
  const rows=rowsFromResult(await sbReq('POST','djen_sync_state',row,{on_conflict:'numero_oab,uf_oab'},{Prefer:'resolution=merge-duplicates,return=representation'}),'Salvar cursor DJEN');
  return rows[0]||row;
}
function syncWindows(lastSuccess,now=new Date(),initialLookbackDays=7){
  const end=Djen.ymdBrasil(now);
  let start=/^\d{4}-\d{2}-\d{2}$/.test(String(lastSuccess||''))?String(lastSuccess):Djen.addDaysYmd(end,-(Math.max(1,initialLookbackDays)-1));
  if(start>end)start=end;
  const out=[];
  for(let cursor=start;cursor<=end;){
    const chunkEnd=[Djen.addDaysYmd(cursor,6),end].sort()[0];
    out.push({inicio:cursor,fim:chunkEnd});
    if(chunkEnd===end)break;
    cursor=Djen.addDaysYmd(chunkEnd,1);
  }
  return out;
}
// Relê UMA comunicação no DJEN (mesma OAB, mesmo dia de disponibilização) para a confirmação de
// prazo nascer de leitura recente (lib/deadline-authorization.js exige frescor). Atualiza só a
// prova (horários, endereço, recibo), o texto e o cancelamento; o vínculo com o processo fica.
// Texto mudado barra a confirmação adiante (hash da sugestão); cancelada também.
async function refreshCommunication({sbReq,row,clientOptions={}}={}){
  if(typeof sbReq!=='function')throw new Error('Banco indisponível.');
  if(!row?.numero_oab||!row?.uf_oab||!/^\d{4}-\d{2}-\d{2}$/.test(String(row.data_disponibilizacao||'')))throw new Error('Comunicação sem OAB ou data para reler no Diário.');
  const dia={inicio:row.data_disponibilizacao,fim:row.data_disponibilizacao};
  // Lida pelo nome (sem a nossa OAB): relê pelo mesmo nome.
  const r=String(row.numero_oab)==='NOME'
    ?await Djen.porNome(String(row.payload?.lex_nome||''),dia,clientOptions)
    :await Djen.porOab(String(row.numero_oab),String(row.uf_oab),dia,clientOptions);
  const item=r.items.find(it=>Djen.itemKey(it)===String(row.djen_id));
  if(!item&&r.incompletas?.length)throw new Error('a releitura no Diário veio incompleta ('+r.incompletas[0].erro+')');
  if(!item)throw new Error('o Diário não devolveu mais esta intimação na releitura (pode ter sido cancelada ou retirada)');
  const audit=r.itemAudits?.[Djen.itemKey(item)]||r.audits[r.audits.length-1]||{};
  const fresh=communicationRow(item,row.numero_oab,row.uf_oab,audit);
  const patch={requisitado_em:fresh.requisitado_em,observado_em:fresh.observado_em,endpoint:fresh.endpoint,request_id:fresh.request_id,raw_receipt:fresh.raw_receipt,
    receipt_item_key:fresh.receipt_item_key,receipt_page:fresh.receipt_page,texto:fresh.texto,motivo_cancelamento:fresh.motivo_cancelamento,...(fresh.motivo_cancelamento?{status:'cancelada'}:{})};
  const updated=await markCommunication(sbReq,row.djen_id,patch);
  return{...row,...patch,...(updated||{})};
}
// Texto do andamento que a intimação vira no processo. O andamento tem limite de 20 mil caracteres
// (lib/pje-sync.js): sentença publicada inteira passava disso, a intimação não entrava no processo
// e ficava sem aviso. Corta com marca; o teor completo continua na comunicação gravada.
const MAX_TEXTO_ANDAMENTO=19000;
function textoAndamentoDjen(row){
  const t=[row.tipo||'Comunicação DJEN',row.tribunal||'',row.texto||''].filter(Boolean).join(' — ');
  return t.length>MAX_TEXTO_ANDAMENTO?t.slice(0,MAX_TEXTO_ANDAMENTO)+' […] (texto completo na intimação nº '+String(row.djen_id)+')':t;
}
// Número corrigido/cadastrado: as publicações que ficaram órfãs com esse CNJ
// entram no processo na hora, sem esperar a próxima leitura do Diário.
async function attachOrphans({processStore,sbReq,cnj}){
  const digits=cnjDigits(cnj)||'';
  if(!processStore?.read||typeof sbReq!=='function'||digits.length!==20)return{casadas:0,falhas:[]};
  const rows=await readCommunicationsByCnj(sbReq,digits,{status:'orfa',order:'data_disponibilizacao.asc'});
  const out={casadas:0,falhas:[],lidas:rows.length};
  for(const row of rows){
    try{
      const applied=await applyPjeMovement({processStore,origem:'djen'},{cnj:digits,data:row.data_disponibilizacao||hojeBrasil(),andamento_texto:textoAndamentoDjen(row),observed_at:row.observado_em,djen_id:row.djen_id});
      await markCommunication(sbReq,row.djen_id,{status:'casada',processo_id:String(applied.processo.id)});
      if(!applied.duplicado)out.casadas++;
    }catch(error){out.falhas.push({djen_id:row.djen_id,error:error.message})}
  }
  return out;
}
// Grava e classifica UMA comunicação lida (casada com processo, órfã ou cancelada). Se não der para
// ligar ao processo, a comunicação fica "nova": aparece em "intimações a tratar" como "a conferir",
// sai no aviso e é tentada de novo na leitura seguinte — nunca some.
async function classificar({processStore,sbReq,row,resumo,now,gravar=true}){
  if(gravar){resumo.consultadas++;await upsertCommunication(sbReq,row)}
  if(row.status==='cancelada'){resumo.canceladas++;return}
  if(!row.cnj){await markCommunication(sbReq,row.djen_id,{status:'orfa',processo_id:null});resumo.orfas++;return}
  const state=await processStore.read(),matches=state.processes.filter(p=>hasCnj(p,row.cnj));
  if(matches.length!==1){await markCommunication(sbReq,row.djen_id,{status:'orfa',processo_id:null});resumo.orfas++;return}
  try{
    const applied=await applyPjeMovement({processStore,origem:'djen'},{cnj:row.cnj,data:row.data_disponibilizacao||hojeBrasil(now),andamento_texto:textoAndamentoDjen(row),observed_at:row.observado_em,djen_id:row.djen_id});
    await markCommunication(sbReq,row.djen_id,{status:'casada',processo_id:String(applied.processo.id)});
    if(applied.duplicado)resumo.duplicadas++;else resumo.casadas++;
  }catch(error){resumo.falhas_classificacao.push({djen_id:row.djen_id,error:error.message})}
}
// Uma leitura por vez (rotina das 6h, vigia de 2 em 2 horas, OAB recém-ligada): duas ao mesmo tempo
// gravariam e avisariam em dobro. A segunda espera a primeira terminar.
let filaDeLeitura=Promise.resolve();
function syncDjen(args){
  const vez=filaDeLeitura.then(()=>lerDiario(args));
  filaDeLeitura=vez.catch(()=>{});
  return vez;
}
async function lerDiario({processStore,sbReq,oabs=parseOabs(),nomes=parseNomes(),now=new Date(),clientOptions={}}={}){
  if(!processStore?.read||typeof sbReq!=='function')throw new Error('Persistência DJEN indisponível.');
  const resumo={consultadas:0,casadas:0,orfas:0,canceladas:0,duplicadas:0,sem_id:0,falhas:[],falhas_classificacao:[],por_nome:0,nome_falhas:[],reclassificadas:0};
  resumo.janelas=0;
  const lidos=new Set();let inicioMaisAntigo=null;
  // Cada OAB é lida por conta própria: falha numa (fora do ar, leitura incompleta) não impede as
  // outras, e o que já chegou é guardado. O cursor só anda na OAB lida por inteiro.
  for(const cfg of oabs){
    const rotulo=cfg.oab+'/'+String(cfg.uf).toUpperCase();
    let cursor;
    try{cursor=await readSyncState(sbReq,cfg.oab,cfg.uf)}
    catch(error){resumo.falhas.push({oab:rotulo,error:error.message});continue}
    const windows=syncWindows(cursor?.last_success_date,now,Number(clientOptions.initialLookbackDays||7));
    if(windows[0]&&(!inicioMaisAntigo||windows[0].inicio<inicioMaisAntigo))inicioMaisAntigo=windows[0].inicio;
    const failuresBefore=resumo.falhas.length;
    for(const janela of windows){
      resumo.janelas++;
      let result;
      try{result=await Djen.porOab(cfg.oab,cfg.uf,janela,clientOptions)}
      catch(error){resumo.falhas.push({oab:rotulo,janela,error:error.message});continue}
      for(const item of result.items){
        const audit=result.itemAudits?.[Djen.itemKey(item)]||result.audits[result.audits.length-1]||{},row=communicationRow(item,cfg.oab,cfg.uf,audit);
        if(!row){resumo.sem_id++;continue}
        lidos.add(row.djen_id);
        await classificar({processStore,sbReq,row,resumo,now});
      }
      for(const falta of result.incompletas||[])resumo.falhas.push({oab:rotulo,janela,error:falta.erro,incompleta:true});
    }
    if(resumo.falhas.length===failuresBefore)await saveSyncState(sbReq,cfg.oab,cfg.uf,Djen.ymdBrasil(now));
  }
  // Segunda rede: pelo nome do advogado. Pega publicação com OAB faltando ou errada; o que vier só por
  // aqui fica marcado (numero_oab "NOME") para conferência. Falha aqui não trava a leitura por OAB.
  if(Array.isArray(nomes)&&nomes.length){
    const janela={inicio:inicioMaisAntigo||Djen.addDaysYmd(Djen.ymdBrasil(now),-6),fim:Djen.ymdBrasil(now)};
    for(const nome of nomes){
      try{
        const result=await Djen.porNome(nome,janela,clientOptions);
        for(const item of result.items){
          const id=String(item.id??item.hash??'');
          if(!id||lidos.has(id))continue;
          const ja=rowsFromResult(await sbReq('GET','djen_comunicacoes',null,{select:'djen_id',djen_id:'eq.'+id,limit:'1'}),'Conferir comunicação lida pelo nome');
          if(ja.length)continue; // já veio pela OAB antes
          const advs=Djen.advogadosDoItem(item);
          const nossa=advs.find(a=>oabs.some(o=>String(o.oab)===a.oab&&String(o.uf).toUpperCase()===a.uf));
          const audit=result.itemAudits?.[Djen.itemKey(item)]||result.audits[result.audits.length-1]||{};
          const row=communicationRow({...item,lex_captura:'nome',lex_nome:nome},nossa?nossa.oab:'NOME',nossa?nossa.uf:'NM',audit);
          if(!row){resumo.sem_id++;continue}
          lidos.add(row.djen_id);resumo.por_nome++;
          await classificar({processStore,sbReq,row,resumo,now});
        }
        for(const falta of result.incompletas||[])resumo.nome_falhas.push({nome,error:falta.erro,incompleta:true});
      }catch(error){resumo.nome_falhas.push({nome,error:error.message})}
    }
  }
  // Comunicação gravada que não chegou a ser ligada a processo (falha no meio, reinício do servidor,
  // ou já gravada pela busca do nome): tenta de novo a cada leitura, até ligar ou virar órfã.
  try{
    const presas=rowsFromResult(await sbReq('GET','djen_comunicacoes',null,{status:'eq.nova',order:'data_disponibilizacao.asc',limit:'200'}),'Listar comunicações sem classificação');
    for(const row of presas){
      if(!row||row.djen_id==null||lidos.has(String(row.djen_id)))continue;
      const antes=resumo.falhas_classificacao.length;
      await classificar({processStore,sbReq,row,resumo,now,gravar:false});
      if(resumo.falhas_classificacao.length===antes)resumo.reclassificadas++;
    }
  }catch(error){resumo.falhas_classificacao.push({djen_id:null,error:'reclassificação: '+error.message})}
  const cunhar=await listPendingMint(sbReq);
  const ok=resumo.falhas.length===0;
  return{ok,...resumo,...(ok?{}:{error:resumo.falhas.map(f=>(f.oab?'OAB '+f.oab+': ':'')+f.error).slice(0,2).join('; ')}),cunhar};
}
module.exports={refreshCommunication,attachOrphans,readCommunicationsByCnj,parseOabs,parseOabInput,setOabsProvider,parseNomes,setNomesProvider,communicationRow,upsertCommunication,markCommunication,listPendingMint,persistDeadlineSuggestion,suggestPendingDeadlines,readSyncState,saveSyncState,syncWindows,syncDjen};
