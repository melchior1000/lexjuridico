'use strict';
const crypto=require('node:crypto');
const {cnjDigits}=require('./pje-sync');

function decodeBase64(value){
  if(typeof value!=='string' || !value.trim()) throw new Error('Arquivo não informado.');
  const clean=value.replace(/^data:[^;]+;base64,/, '').replace(/\s/g,'');
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error('Arquivo base64 inválido.');
  const bytes=Buffer.from(clean,'base64');
  if(!bytes.length) throw new Error('Arquivo vazio.');
  return bytes;
}
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function parseDate(value){
  const s=String(value||'').trim();
  if(!s) return null;
  let m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m){const [,d,mo,y,h='0',mi='0',sec='0']=m;const dt=new Date(Date.UTC(+y,+mo-1,+d,+h,+mi,+sec));return Number.isNaN(dt.getTime())?null:dt;}
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m){const [,y,mo,d,h='0',mi='0',sec='0']=m;const dt=new Date(Date.UTC(+y,+mo-1,+d,+h,+mi,+sec));return Number.isNaN(dt.getTime())?null:dt;}
  const dt=new Date(s);return Number.isNaN(dt.getTime())?null:dt;
}
function latestMovement(processo){
  const list=Array.isArray(processo?.andamentos)?processo.andamentos:[];
  let best=null;
  for(const item of list){
    const raw=item?.data||item?.date||item?.criado_em||'';
    const dt=parseDate(raw);
    if(!dt) continue;
    if(!best || dt>best.date) best={date:dt,raw:String(raw),texto:String(item?.txt||item?.texto||'')};
  }
  return best;
}
function cnjFromText(value){
  const text=String(value||'');
  const formatted=text.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
  if(formatted) return cnjDigits(formatted[0]);
  const compact=text.match(/(?:^|\D)(\d{20})(?:\D|$)/);
  return compact?cnjDigits(compact[1]):null;
}
function fileHistory(processo){
  const out=[];
  for(const field of ['entrada_processual','arquivos','recebimentos']){
    const list=Array.isArray(processo?.[field])?processo[field]:[];
    for(const item of list) out.push(item||{});
  }
  return out;
}
function findProcess(processes,input){
  if(input.processo_id!=null && String(input.processo_id).trim()){
    const matches=processes.filter(p=>String(p.id)===String(input.processo_id));
    if(matches.length===1) return matches[0];
    if(matches.length>1) throw new Error('ID de processo duplicado no LEX.');
  }
  const cnj=cnjDigits(input.numero_processo)||cnjFromText(input.nome)||cnjFromText(input.evento_texto);
  if(!cnj) return null;
  const matches=processes.filter(p=>cnjDigits(p.numero)===cnj);
  if(matches.length>1) throw new Error('CNJ duplicado no LEX; revise o cadastro.');
  return matches[0]||null;
}
function inspectIncoming(input,processes){
  const bytes=decodeBase64(input.base64);
  const tamanho=bytes.length;
  const hash=sha256(bytes);
  if(input.tamanho!=null && Number(input.tamanho)!==tamanho) throw new Error('Tamanho informado não confere com o arquivo recebido.');
  if(input.sha256 && String(input.sha256).toLowerCase()!==hash) throw new Error('Hash informado não confere com o arquivo recebido.');
  const processo=findProcess(Array.isArray(processes)?processes:[],input);
  const origem=String(input.origem||'upload').trim().toLowerCase().slice(0,40)||'upload';
  const eventoData=String(input.evento_data||'').trim();
  const eventoTexto=String(input.evento_texto||'').trim().slice(0,20000);
  const recebidoEm=new Date().toISOString();
  const base={nome:String(input.nome||'documento').trim().slice(0,300),mimeType:String(input.mimeType||'application/octet-stream').slice(0,120),tamanho,sha256:hash,origem,recebido_em:recebidoEm};
  if(!processo) return {...base,status:'precisa_conferencia',motivo:'processo_nao_identificado',processo:null,duplicado:false,novo_andamento:false};
  const hist=fileHistory(processo);
  const hashDuplicado=hist.some(x=>String(x.sha256||'').toLowerCase()===hash);
  const tamanhoIgual=hist.some(x=>Number(x.tamanho)===tamanho && tamanho>0);
  const ultimo=latestMovement(processo);
  const novaData=parseDate(eventoData);
  const eventoJaExiste=eventoData&&eventoTexto&&(Array.isArray(processo.andamentos)?processo.andamentos:[]).some(a=>String(a.data||'')===eventoData&&String(a.txt||a.texto||'').trim()===eventoTexto);
  let status='precisa_conferencia',motivo='evento_nao_informado',novoAndamento=false;
  if(hashDuplicado){status='provavel_duplicado';motivo='hash_igual';}
  else if(eventoJaExiste){status='provavel_duplicado';motivo='evento_igual';}
  else if(eventoData&&novaData&&ultimo&&novaData<=ultimo.date){status='provavel_antigo';motivo='evento_nao_posterior';}
  else if(eventoData&&novaData&&eventoTexto){status='novo_andamento';motivo='evento_posterior_ou_sem_referencia';novoAndamento=true;}
  else if(tamanhoIgual){status='precisa_conferencia';motivo='mesmo_tamanho_sem_hash_igual';}
  return {...base,status,motivo,processo:{id:processo.id,numero:processo.numero,nome:processo.nome},duplicado:hashDuplicado||eventoJaExiste,mesmo_tamanho:tamanhoIgual,ultimo_andamento:ultimo?{data:ultimo.raw,texto:ultimo.texto}:null,evento_recebido:eventoData?{data:eventoData,texto:eventoTexto}:null,novo_andamento:novoAndamento};
}
function applyInspection(processo,inspection){
  const entrada=Array.isArray(processo.entrada_processual)?processo.entrada_processual.slice():[];
  const registro={nome:inspection.nome,mimeType:inspection.mimeType,tamanho:inspection.tamanho,sha256:inspection.sha256,origem:inspection.origem,recebido_em:inspection.recebido_em,status:inspection.status,motivo:inspection.motivo,evento_recebido:inspection.evento_recebido||null};
  entrada.unshift(registro);
  const next={...processo,entrada_processual:entrada.slice(0,200),ultima_entrada_processual:inspection.recebido_em};
  if(inspection.novo_andamento&&inspection.evento_recebido){
    const andamentos=Array.isArray(processo.andamentos)?processo.andamentos.slice():[];
    andamentos.unshift({data:inspection.evento_recebido.data,txt:inspection.evento_recebido.texto,origem:inspection.origem,importado_em:inspection.recebido_em,sha256:inspection.sha256,tamanho:inspection.tamanho});
    next.andamentos=andamentos;
    next.ultimo_andamento_importado=inspection.recebido_em;
  }
  return next;
}
module.exports={decodeBase64,sha256,parseDate,latestMovement,cnjFromText,findProcess,inspectIncoming,applyInspection};
