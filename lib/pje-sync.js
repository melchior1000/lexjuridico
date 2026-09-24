'use strict';
const {withProcessLock}=require('./process-lock');
const {rowsFromResult}=require('./supabase');

function cnjDigits(value){
  const text=String(value||'').trim();
  if(!/^[\d.\-\s]+$/.test(text))return null;
  const digits=text.replace(/\D/g,'');
  return digits.length===20?digits:null;
}
// Campo "número" do cadastro pode listar vários autos do mesmo caso
// ("6002060-50... / Embargos 6002846-94..."). Valem todos os CNJs quando o
// campo COMEÇA com um CNJ. Se começa com texto ("A confirmar — vinculado a
// X"), nenhum vale: o número citado é de outro processo.
const CNJ_ANY=/\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/g;
const CNJ_START=/^\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}(?!\d)/;
function processCnjs(value){
  const text=String(value||'').trim();
  if(!text)return[];
  const pure=cnjDigits(text);
  if(pure)return[pure];
  if(!CNJ_START.test(text))return[];
  return[...new Set((text.match(CNJ_ANY)||[]).map(x=>x.replace(/\D/g,'')).filter(x=>x.length===20))];
}
function primaryCnj(value){return processCnjs(value)[0]||null}
function hasCnj(process,cnj){return !!cnj&&processCnjs(process?.numero).includes(String(cnj))}
function sourceMeta(origem){
  const source=String(origem||'pje').toLowerCase();
  if(!['pje','datajud','djen'].includes(source))throw new Error('Origem judicial inválida.');
  return{source,label:source==='pje'?'PJe':source==='djen'?'DJEN':'DATAJUD'};
}
function buildMovement(current,dados,origem){
  const {source,label}=sourceMeta(origem);
  const cnj=cnjDigits(dados&&dados.cnj);
  if(!cnj)throw new Error('Informe o número CNJ completo.');
  const texto=String(dados.andamento_texto||'').trim();
  const data=String(dados.data||'').trim();
  if(!texto||texto.length>20000||!data||data.length>40)throw new Error('Andamento sem texto ou data válidos.');
  const txt='['+label+'] '+texto;
  const andamentos=Array.isArray(current.andamentos)?current.andamentos:[];
  if(andamentos.some(a=>String(a.data)===data&&String(a.txt||a.texto)===txt))return{duplicado:true,record:current};
  const observed=String(dados.observed_at||'').trim();
  const patch={
    andamentos:[{data,txt,origem:source,cnj,importado_em:new Date().toISOString(),...(dados.djen_id?{djen_id:String(dados.djen_id)}:{})},...andamentos]
  };
  if(observed&&Number.isFinite(Date.parse(observed))){
    patch.last_court_sync_at=new Date(Date.parse(observed)).toISOString();
    patch.last_court_sync_source=source;
  }
  if(source==='djen'&&dados.djen_id)patch.djen_id_origem=String(dados.djen_id);
  return{duplicado:false,record:{...current,...patch},patch};
}

// Recebe somente movimentos de conector oficial. Não calcula prazo legal.
async function applyPjeMovement({processos,processStore,sbReq,onPersisted,origem='pje'},dados){
  const cnj=cnjDigits(dados&&dados.cnj);
  if(!cnj)throw new Error('Informe o número CNJ completo.');
  if(processStore?.mutate){
    const result=await processStore.mutate(ps=>{
      const matches=ps.map((p,i)=>({p,i})).filter(x=>hasCnj(x.p,cnj));
      if(matches.length!==1)throw new Error(matches.length?'CNJ duplicado no LEX; revise o cadastro.':'CNJ não cadastrado no LEX.');
      const {i}=matches[0],built=buildMovement(ps[i],dados,origem);
      if(!built.duplicado)ps[i]=built.record;
      return{sucesso:true,duplicado:built.duplicado,processo:built.duplicado?ps[i]:built.record};
    },'LEX '+sourceMeta(origem).label);
    if(onPersisted&&!result.value.duplicado)onPersisted();
    return result.value;
  }

  if(!Array.isArray(processos)||typeof sbReq!=='function')throw new Error('Persistência processual indisponível.');
  const matches=processos.filter(p=>hasCnj(p,cnj));
  if(matches.length!==1)throw new Error(matches.length?'CNJ duplicado no LEX; revise o cadastro.':'CNJ não cadastrado no LEX.');
  const id=matches[0].id;
  return withProcessLock(processos,id,async()=>{
    const index=processos.findIndex(p=>String(p.id)===String(id)),atual=processos[index];
    if(!atual||!hasCnj(atual,cnj))throw new Error('Cadastro alterado durante a importação.');
    const built=buildMovement(atual,dados,origem);
    if(built.duplicado)return{sucesso:true,duplicado:true,processo:atual};
    const payload={andamentos:JSON.stringify(built.record.andamentos)};
    if(built.patch.last_court_sync_at)payload.last_court_sync_at=built.patch.last_court_sync_at;
    if(built.patch.last_court_sync_source)payload.last_court_sync_source=built.patch.last_court_sync_source;
    if(built.patch.djen_id_origem)payload.djen_id_origem=built.patch.djen_id_origem;
    const response=await sbReq('PATCH','processos',payload,{id:'eq.'+id},{Prefer:'return=representation'});
    const rows=rowsFromResult(response,'Importar andamento '+sourceMeta(origem).label);
    if(!rows.some(p=>String(p.id)===String(id)))throw new Error('Banco não confirmou o cadastro atualizado.');
    processos[index]=built.record;
    if(onPersisted)onPersisted();
    return{sucesso:true,duplicado:false,processo:built.record};
  });
}
module.exports={processCnjs,primaryCnj,hasCnj,cnjDigits,applyPjeMovement,sourceMeta,buildMovement};
