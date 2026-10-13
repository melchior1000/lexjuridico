'use strict';

const crypto=require('node:crypto');
const {cnjDigits,primaryCnj}=require('./pje-sync');
const {createReadingLogEntry,resolveIntegrityKey}=require('./reading-log-schema');
const {ordenarAndamentos,listaDeAndamentos}=require('./andamentos');

const UF_BY_TR={'01':'ac','02':'al','03':'ap','04':'am','05':'ba','06':'ce','07':'dft','08':'es','09':'go','10':'ma','11':'mt','12':'ms','13':'mg','14':'pa','15':'pb','16':'pr','17':'pe','18':'pi','19':'rj','20':'rn','21':'rs','22':'ro','23':'rr','24':'sc','25':'se','26':'sp','27':'to'};
function aliasForCnj(value){const cnj=cnjDigits(value);if(!cnj)throw new Error('Informe o número CNJ completo.');const ramo=cnj[13],tribunal=cnj.slice(14,16);if(ramo==='8'){const uf=UF_BY_TR[tribunal];if(!uf)throw new Error('Tribunal estadual não mapeado no Datajud.');return uf==='dft'?'tjdft':'tj'+uf}if(ramo==='4')return'trf'+String(Number(tribunal));if(ramo==='5')return tribunal==='00'?'tst':'trt'+String(Number(tribunal));if(ramo==='6'){if(tribunal==='00')return'tse';const uf=UF_BY_TR[tribunal];if(!uf)throw new Error('Tribunal eleitoral não mapeado no Datajud.');return'tre-'+uf}if(ramo==='7')return'stm';if(ramo==='9'){if(tribunal==='13')return'tjmmg';if(tribunal==='21')return'tjmrs';if(tribunal==='26')return'tjmsp';throw new Error('Tribunal militar estadual não mapeado no Datajud.')}if(ramo==='3')return'stj';if(ramo==='1'||ramo==='2')throw new Error((ramo==='1'?'O STF':'O CNJ')+' não tem base pública no Datajud: acompanhe pelo site do tribunal.');throw new Error('Ramo de justiça ainda não mapeado no Datajud.')}
function movementName(mov={}){return String(mov.nome||mov.descricao||mov.movimentoNacional?.nome||'Movimentação').trim()}
function movementText(mov={}){const nome=movementName(mov),comps=Array.isArray(mov.complementosTabelados)?mov.complementosTabelados:[],detalhes=comps.map(c=>String(c?.nome||'').trim()).filter(Boolean);return detalhes.length?nome+' — '+detalhes.join('; '):nome}
// Textos que versões anteriores do LEX gravaram para ESTE mesmo movimento: o complemento pelo
// tipo ("tipo_de_documento") e a varredura antiga do servidor, só com o nome. Servem para
// corrigir no lugar o que já está na carteira, em vez de gravar o movimento de novo.
function legacyTexts(mov={}){
  const nome=movementName(mov),comps=Array.isArray(mov.complementosTabelados)?mov.complementosTabelados:[];
  const antigos=comps.map(c=>String(c?.descricao||c?.nome||c?.valor||'').trim()).filter(Boolean);
  const out=new Set();
  if(antigos.length)out.add(nome+' — '+antigos.join('; '));
  out.add(mov.nome?String(mov.nome).trim():'Movimentacao processual');
  out.delete(movementText(mov));
  return[...out].filter(Boolean);
}
function movementDate(mov={}){return String(mov.dataHora||mov.data||mov.dataMovimento||'').trim()}
function movementsFromPayload(payload){
  const hits=Array.isArray(payload?.hits?.hits)?payload.hits.hits:[],vistos=new Set(),out=[];
  for(const h of hits)for(const m of (Array.isArray(h?._source?.movimentos)?h._source.movimentos:[])){
    const x={data:movementDate(m),texto:movementText(m)};if(!x.data||!x.texto)continue;
    const k=x.data+'|'+x.texto;if(vistos.has(k))continue;vistos.add(k);
    const anteriores=legacyTexts(m);if(anteriores.length)x.anteriores=anteriores;
    out.push(x);
  }
  return out.sort((a,b)=>(Date.parse(b.data)||0)-(Date.parse(a.data)||0));
}
function headerValue(response,name){try{return response?.headers?.get?.(name)||''}catch{return''}}
async function responseBody(response){
  if(typeof response?.text==='function'){const raw=await response.text();return{raw,payload:JSON.parse(raw)}}
  const payload=await response.json();return{raw:JSON.stringify(payload),payload};
}
async function queryByCnj(value,{apiKey=process.env.DATAJUD_API_KEY,fetchImpl=globalThis.fetch}={}){
  const cnj=cnjDigits(value);if(!cnj)throw new Error('Informe o número CNJ completo.');
  const key=String(apiKey||'').trim();if(!key)throw new Error('DATAJUD_API_KEY não configurada.');
  if(typeof fetchImpl!=='function')throw new Error('Cliente HTTP do Datajud indisponível.');
  const alias=aliasForCnj(cnj),endpoint='https://api-publica.datajud.cnj.jus.br/api_publica_'+alias+'/_search',requestId=crypto.randomUUID(),requestedAt=new Date().toISOString();
  const response=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':/^APIKey\s/i.test(key)?key:'APIKey '+key},body:JSON.stringify({size:10,query:{match:{numeroProcesso:cnj}}})});
  const respondedAt=new Date().toISOString();
  if(!response?.ok){const status=Number(response?.status)||502;throw Object.assign(new Error('Datajud respondeu HTTP '+status+'.'),{status})}
  const {raw,payload}=await responseBody(response);
  // Só é "não encontrado" quando o Datajud responde a busca com a lista vazia. Resposta sem a
  // lista (erro da base, formato inesperado) é falha de consulta, não ausência do processo.
  if(!Array.isArray(payload?.hits?.hits))throw Object.assign(new Error('O Datajud não confirmou a consulta (resposta sem resultado de busca).'),{status:502});
  const movimentos=movementsFromPayload(payload),encontrado=payload.hits.hits.length>0;
  return{cnj,alias,movimentos,encontrado,_audit:{endpoint,request_id:requestId,requested_at:requestedAt,responded_at:respondedAt,status_code:Number(response.status)||200,content_type:headerValue(response,'content-type'),remote_request_id:headerValue(response,'x-request-id')||headerValue(response,'request-id'),raw_receipt:raw}};
}
// Junta o que veio do Datajud ao que já existe, sem duplicar e sem apagar nada: entrada vazia é
// descartada e histórico antigo guardado como texto vira uma anotação. A lista sai do mais novo
// para o mais antigo pela data real (lib/andamentos.js), não pela ordem alfabética do texto.
// O mesmo movimento gravado antes com o texto antigo (complemento pelo tipo, ou só o nome) é
// corrigido no lugar — conta como "corrigido", não como novo — e guarda o texto anterior em
// txt_anterior, para quem já o viu não recebê-lo de novo como andamento novo.
function mergeMovements(processo,movimentos){
  let antigos;
  if(typeof processo.andamentos==='string'&&processo.andamentos.trim()&&!listaDeAndamentos(processo.andamentos).length)
    antigos=[{data:null,txt:processo.andamentos.trim().slice(0,5000),origem:'anotacao_antiga'}];
  else antigos=listaDeAndamentos(processo.andamentos);
  const agora=new Date().toISOString(),cnj=primaryCnj(processo.numero)||cnjDigits(processo.numero),usados=new Set(),pendentes=[],adicionados=[];
  let novos=0,duplicados=0,corrigidos=0;
  // 1ª passada: já gravado com o texto de hoje.
  for(const mov of movimentos){
    const txt='[DATAJUD] '+mov.texto;
    const i=antigos.findIndex((a,k)=>!usados.has(k)&&String(a.data)===String(mov.data)&&String(a.txt)===txt);
    if(i>=0){usados.add(i);duplicados++}else pendentes.push(mov);
  }
  // 2ª passada: gravado por versão anterior do LEX com outro texto → corrige no lugar; senão, é novo.
  for(const mov of pendentes){
    const txt='[DATAJUD] '+mov.texto,velhos=new Set((mov.anteriores||[]).map(t=>'[DATAJUD] '+t));
    const i=velhos.size?antigos.findIndex((a,k)=>!usados.has(k)&&String(a.data)===String(mov.data)&&velhos.has(String(a.txt))):-1;
    if(i>=0){usados.add(i);antigos[i]={...antigos[i],txt,txt_anterior:antigos[i].txt_anterior||antigos[i].txt,texto_corrigido_em:agora};corrigidos++;continue}
    adicionados.push({data:mov.data,txt,origem:'datajud',cnj,importado_em:agora});novos++;
  }
  // O novo entra no início (convenção do LEX): no empate de data, fica à frente do que já havia.
  const entrada=ordenarAndamentos(adicionados);
  return{andamentos:ordenarAndamentos([...entrada,...antigos]),novos,duplicados,corrigidos,adicionados:entrada};
}
function leituraParaGuardar(reading,anteriores=[]){
  const copia={...reading,recibo:{...(reading.recibo||{})}};delete copia.raw_receipt;
  const hash=reading?.integridade?.response_hash;
  const igual=hash&&anteriores.find(r=>r?.integridade?.response_hash===hash&&r?.recibo?.raw_receipt);
  if(igual){delete copia.recibo.raw_receipt;copia.recibo.mesmo_corpo_de=igual.reading_id||null}
  return copia;
}
async function syncProcess(processStore,processoId,opts={}){
  if(!processoId)throw new Error('Informe o processo para consultar o Datajud.');
  const state=await processStore.read(),matches=state.processes.filter(p=>String(p.id)===String(processoId));
  if(matches.length!==1)throw Object.assign(new Error('Processo selecionado não existe.'),{status:404});
  const current=matches[0],cnj=primaryCnj(current.numero);if(!cnj)throw new Error('O processo selecionado ainda não possui número CNJ completo.');
  // Duplicado é outro cadastro com o MESMO número principal. Número citado dentro de outro
  // cadastro ("A / Embargos B") não impede ler B no próprio cadastro dele.
  const same=state.processes.filter(p=>primaryCnj(p.numero)===cnj);if(same.length!==1)throw new Error('CNJ duplicado no LEX; revise o cadastro antes de consultar o Datajud.');
  // Antes de gastar a consulta: sem a chave do Datajud não há leitura; sem a chave que assina a
  // leitura, a resposta não poderia ser guardada como prova. Nos dois casos, não consulta.
  if(!String((opts.apiKey===undefined?process.env.DATAJUD_API_KEY:opts.apiKey)||'').trim())throw new Error('DATAJUD_API_KEY não configurada.');
  let integrityKey;
  try{integrityKey=resolveIntegrityKey(opts.integrityKey)}
  catch{throw Object.assign(new Error('A chave que assina as leituras do tribunal (COURT_READING_INTEGRITY_KEY) não está configurada no servidor; sem ela a leitura não fica guardada como prova, então não consultei.'),{code:'READING_INTEGRITY_KEY_REQUIRED'})}
  const result=await queryByCnj(cnj,opts);
  // O Datajud não achou o número (segredo de justiça, número ou tribunal errado, processo ainda
  // não indexado): isso NÃO é "o tribunal confirmou que nada mudou". Fica registrado à parte e
  // a leitura oficial continua sendo a anterior.
  if(!result.encontrado){
    const quando=result._audit.responded_at;
    await processStore.mutate(processes=>{
      const i=processes.findIndex(p=>String(p.id)===String(processoId));
      if(i<0)return null;
      processes[i]={...processes[i],datajud_nao_encontrado_em:quando,datajud_alias:result.alias};
      return processes[i];
    },opts.actor||'LEX Datajud');
    return{ok:false,nao_encontrado:true,synced:false,explicit_no_change:false,movement_received:false,cnj,alias:result.alias,consultados:0,novos:0,duplicados:0,
      error:'O Datajud não encontrou este número (pode ser segredo de justiça, número ou tribunal a conferir, ou processo ainda não indexado).'};
  }
  const saved=await processStore.mutate(processes=>{
    const i=processes.findIndex(p=>String(p.id)===String(processoId));
    if(i<0)throw new Error('Processo mudou durante a consulta. Atualize a tela.');
    if(primaryCnj(processes[i].numero)!==cnj)throw new Error('Número CNJ mudou durante a consulta.');
    const merged=mergeMovements(processes[i],result.movimentos);
    const ultimo=result.movimentos[0]||null; // movementsFromPayload já ordena do mais novo para o mais antigo
    const reading=createReadingLogEntry({
      processo:cnj,process_id:processoId,source:'datajud',observed_at:result._audit.responded_at,ok:true,status_code:result._audit.status_code,
      proveniencia:{conector:'lib/datajud',endpoint:result._audit.endpoint,request_id:result._audit.request_id,authenticated:true,timestamp_requisicao:result._audit.requested_at,timestamp_resposta:result._audit.responded_at},
      content_type:result._audit.content_type,metadata:{remote_request_id:result._audit.remote_request_id||null},raw_receipt:result._audit.raw_receipt,
      movimentos_encontrados:result.movimentos.length,ultimo_movimento:ultimo,sincronizado:true,explicit_no_change:merged.novos===0,movement_received:merged.novos>0
    },{integrityKey});
    const readings=Array.isArray(processes[i].court_readings)?processes[i].court_readings:[];
    const resto={...processes[i]};delete resto.datajud_nao_encontrado_em;
    processes[i]={...resto,andamentos:merged.andamentos,court_readings:[leituraParaGuardar(reading,readings),...readings].slice(0,50),datajud_atualizado_em:reading.observed_at,last_court_sync_at:reading.observed_at,last_court_sync_source:'datajud',datajud_alias:result.alias};
    return{processo:processes[i],reading,novos:merged.novos,duplicados:merged.duplicados,corrigidos:merged.corrigidos,adicionados:merged.adicionados};
  },opts.actor||'LEX Datajud');
  const v=saved.value;
  return{ok:true,synced:true,explicit_no_change:v.novos===0,movement_received:v.novos>0,cnj,alias:result.alias,consultados:result.movimentos.length,novos:v.novos,duplicados:v.duplicados,corrigidos:v.corrigidos,
    novos_andamentos:(v.adicionados||[]).slice(0,10).map(a=>({data:a.data,texto:String(a.txt||'').replace(/^\[DATAJUD\]\s*/,'')})),reading:v.reading,processo:v.processo};
}
// Atualiza toda a carteira com CNJ válido. Concorrência limitada (padrão 4): a API pública do
// CNJ recusa rajadas, e um processo por vez levaria minutos numa carteira de centenas.
// A ordem dos resultados segue a da carteira; cada falha fica no próprio item, nunca derruba o lote.
const ENCERRADO=/^(ARQUIVADO|BAIXADO|ENCERRADO|CONCLUIDO|CONCLUÍDO|EXTINTO)$/i;
async function syncRegistered(processStore,opts={}){
  // Sem a chave que assina a leitura, a consulta não seria guardada: não gasta chamada ao CNJ.
  const integrityKey=String(opts.integrityKey??process.env.COURT_READING_INTEGRITY_KEY??'');
  if(Buffer.byteLength(integrityKey,'utf8')<32)return{ok:false,skipped:true,reason:'COURT_READING_INTEGRITY_KEY_NOT_CONFIGURED',total:0,novos:0,erros:0,nao_encontrados:0,resultados:[]};
  // Sem a chave pública do Datajud, cada processo falharia igual: diz uma vez e não tenta.
  if(!String((opts.apiKey===undefined?process.env.DATAJUD_API_KEY:opts.apiKey)||'').trim())return{ok:false,skipped:true,reason:'DATAJUD_API_KEY_NOT_CONFIGURED',total:0,novos:0,erros:0,nao_encontrados:0,resultados:[]};
  // Processo arquivado/encerrado não é lido todo dia (desarquivamento chega pelo Diário).
  const state=await processStore.read(),rows=state.processes.filter(p=>primaryCnj(p.numero)&&!ENCERRADO.test(String(p.status||'').trim())),results=new Array(rows.length);
  const limit=Math.max(1,Math.min(Number(opts.concurrency)||4,8));let next=0;
  async function worker(){
    while(next<rows.length){
      const i=next++,p=rows[i];
      try{results[i]={processo_id:p.id,...await syncProcess(processStore,p.id,{...opts,integrityKey})}}
      catch(error){results[i]={processo_id:p.id,ok:false,error:error.message}}
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,rows.length)},worker));
  const novos=results.reduce((n,r)=>n+(Number(r?.novos)||0),0),corrigidos=results.reduce((n,r)=>n+(Number(r?.corrigidos)||0),0),naoEncontrados=results.filter(r=>r?.nao_encontrado).length,erros=results.filter(r=>r?.ok===false&&!r?.nao_encontrado).length;
  return{ok:erros===0,total:rows.length,novos,corrigidos,erros,nao_encontrados:naoEncontrados,resultados:results};
}
module.exports={aliasForCnj,movementsFromPayload,queryByCnj,mergeMovements,syncProcess,syncRegistered};
