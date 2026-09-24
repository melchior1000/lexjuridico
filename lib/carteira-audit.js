'use strict';
// Conferência da carteira: número CNJ de cada processo judicial.
// 1. Dígito verificador (Res. CNJ 65/2008, ISO 7064 mod 97-10): número com
//    dígito errado não existe em tribunal nenhum.
// 2. Segmento J.TR precisa apontar para um tribunal conhecido.
// 3. Número inválido ou ausente: procura nas publicações do DJEN da OAB do
//    escritório que não casaram com nenhum processo (status "orfa") o número
//    certo — por semelhança de dígitos (erro de digitação) e pelos nomes das
//    partes. A correção só é gravada quando o advogado confirma.
const {processCnjs}=require('./pje-sync');
const {tribunalFromCnj}=require('./pje-process-sync');

function cnjCheckDigits(digits){
  const d=String(digits||'').replace(/\D/g,'');
  if(d.length!==20)return null;
  const n=d.slice(0,7),rest=d.slice(9);
  const r=Number(BigInt(n+rest+'00')%97n);
  return String(98-r).padStart(2,'0');
}
function cnjValid(digits){
  const d=String(digits||'').replace(/\D/g,'');
  return d.length===20&&cnjCheckDigits(d)===d.slice(7,9);
}
function formatCnj(digits){
  const d=String(digits||'').replace(/\D/g,'');
  if(d.length!==20)return String(digits||'');
  return d.slice(0,7)+'-'+d.slice(7,9)+'.'+d.slice(9,13)+'.'+d[13]+'.'+d.slice(14,16)+'.'+d.slice(16);
}
function isAdministrative(p){
  return /administr|extrajud|consult/i.test(String(p?.tipo||''))||/administr|extrajud|consult/i.test(String(p?.setor||''));
}

const STOP=new Set(('acao execucao processo cumprimento sentenca embargos agravo instrumento recurso apelacao vara civel federal estadual justica '
  +'tribunal comarca foro regional autor autora reu requerente requerido exequente executado executada embargante embargado agravante agravado '
  +'contra versus parte partes outros outras dos das com para pela pelo sobre ltda eireli s/a sa me epp honorarios fazenda').split(' '));
function norm(v){return String(v||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()}
// Siglas usuais no nome do caso x nome por extenso na publicação.
const ALIAS={cef:'caixa economica',bb:'banco brasil',inss:'instituto nacional seguro social',incra:'instituto nacional colonizacao reforma agraria',pgfn:'procuradoria geral fazenda nacional'};
function tokens(v){const words=norm(v).replace(/[^a-z0-9\s]/g,' ').split(/\s+/).flatMap(w=>ALIAS[w]?[w,...ALIAS[w].split(' ')]:[w]);return new Set(words.filter(w=>w.length>=4&&!STOP.has(w)&&!/^\d+$/.test(w)))}
function digitDistance(a,b){
  if(a.length!==b.length)return 99;
  let diff=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])diff++;
  // Troca de dois dígitos vizinhos conta como um erro só.
  if(diff===2){for(let i=0;i<a.length-1;i++)if(a[i]!==b[i]){if(a[i]===b[i+1]&&a[i+1]===b[i]&&a.slice(i+2)===b.slice(i+2))return 1;break}}
  return diff;
}
function communicationParties(c){
  const p=c?.payload||{};
  const names=[...(Array.isArray(p.destinatarios)?p.destinatarios:[]).map(x=>x?.nome),...(Array.isArray(p.destinatarioadvogados)?[]:[])].filter(Boolean);
  return{names,classe:p.nomeClasse||p.classe||'',orgao:p.nomeOrgao||p.orgao||''};
}
function processText(p){return[p.nome,p.partes,p.cliente,p.grupo,p.assunto].filter(Boolean).join(' ')}
function rawDigitsIn(value){return(String(value||'').match(/\d[\d.\-\s]{15,}\d/g)||[]).map(x=>x.replace(/\D/g,'')).filter(x=>x.length===20)}

function suggestionsFor(p,orphans){
  const own=tokens(processText(p)),typed=rawDigitsIn(p.numero),seen=new Map();
  for(const c of orphans){
    const cnj=String(c?.cnj||'').replace(/\D/g,'');
    if(!cnjValid(cnj))continue;
    const parties=communicationParties(c),theirs=tokens([parties.names.join(' '),c.texto?.slice(0,1500)].join(' '));
    const shared=[...own].filter(w=>theirs.has(w));
    const dist=typed.length?Math.min(...typed.map(t=>digitDistance(t,cnj))):99;
    let score=shared.length;if(dist<=2)score+=4;
    if(score<2)continue;
    const prev=seen.get(cnj);
    if(!prev||score>prev.score)seen.set(cnj,{cnj,numero:formatCnj(cnj),tribunal:c.tribunal||tribunalFromCnj(cnj),score,
      motivo:[dist<=2?'difere '+dist+' dígito(s) do número cadastrado':null,shared.length?'partes em comum: '+shared.slice(0,4).join(', '):null].filter(Boolean).join(' · '),
      partes:parties.names.slice(0,4),data:c.data_disponibilizacao||null,djen_id:c.djen_id||null});
  }
  return[...seen.values()].sort((a,b)=>b.score-a.score).slice(0,3);
}

function auditCarteira({processes=[],orphans=[]}={}){
  const out={total:0,administrativos:0,ok:[],problemas:[]};
  const used=new Map();
  for(const p of processes){for(const cnj of processCnjs(p.numero)){if(!used.has(cnj))used.set(cnj,[]);used.get(cnj).push(p)}}
  for(const p of processes){
    if(/^(ARQUIVADO|CONCLUIDO|ENCERRADO)$/i.test(String(p.status||'')))continue;
    if(isAdministrative(p)){out.administrativos++;continue}
    out.total++;
    const label=p.nome||p.numero||String(p.id);
    const cnjs=processCnjs(p.numero);
    let tipo=null,motivo='';
    if(!cnjs.length){
      const typed=rawDigitsIn(p.numero);
      if(typed.length&&!cnjValid(typed[0])){tipo='cnj_invalido';motivo='o número digitado não existe (dígito verificador não confere)'}
      else{tipo='sem_cnj';motivo=String(p.numero||'').trim()?'o campo número não começa com um CNJ ("'+String(p.numero).slice(0,40)+'")':'sem número CNJ'}
    }else{
      const bad=cnjs.find(c=>!cnjValid(c));
      const noCourt=cnjs.find(c=>!tribunalFromCnj(c));
      const dup=cnjs.find(c=>(used.get(c)||[]).length>1);
      if(bad){tipo='cnj_invalido';motivo=formatCnj(bad)+' não existe: dígito verificador deveria ser '+cnjCheckDigits(bad)}
      else if(noCourt){tipo='tribunal_desconhecido';motivo=formatCnj(noCourt)+' aponta para um tribunal que não existe (segmento '+noCourt[13]+'.'+noCourt.slice(14,16)+')'}
      else if(dup){tipo='duplicado';motivo=formatCnj(dup)+' também está em: '+used.get(dup).filter(x=>x!==p).map(x=>x.nome||x.id).join(', ')}
    }
    if(!tipo){out.ok.push({id:p.id,nome:label,numero:formatCnj(cnjs[0]),confirmado_tribunal:!!p.last_court_sync_at});continue}
    out.problemas.push({id:p.id,nome:label,numero_atual:String(p.numero||''),tipo,motivo,sugestoes:tipo==='duplicado'?[]:suggestionsFor(p,orphans)});
  }
  return out;
}

function auditMessage(r){
  const lines=[];
  if(!r.total)return'Não há processos judiciais ativos para conferir.';
  if(!r.problemas.length)lines.push('✅ Conferi os '+r.total+' processos judiciais: todos os números CNJ são válidos.');
  else lines.push('Conferi os '+r.total+' processos judiciais: '+r.ok.length+' com número válido, '+r.problemas.length+' precisam de correção.');
  const naoConfirmados=r.ok.filter(x=>!x.confirmado_tribunal).length;
  if(r.ok.length&&naoConfirmados)lines.push(naoConfirmados+' válido(s) ainda não conferido(s) no tribunal — diga "atualize meus processos".');
  r.problemas.forEach((p,i)=>{
    lines.push('\n'+(i+1)+') '+p.nome+' — '+p.motivo+'.');
    if(p.sugestoes.length){
      const s=p.sugestoes[0];
      lines.push('   Número provável: '+s.numero+(s.tribunal?' ('+s.tribunal+')':'')+(s.data?' · DJEN '+s.data.split('-').reverse().join('/'):'')+(s.motivo?' · '+s.motivo:''));
      lines.push('   Para gravar: corrigir número de '+p.nome+' para '+s.numero);
    }else if(p.tipo!=='duplicado')lines.push('   Não achei o número nas publicações da sua OAB. Mande o número certo: corrigir número de '+p.nome+' para NNNNNNN-DD.AAAA.J.TR.OOOO');
  });
  if(r.administrativos)lines.push('\n('+r.administrativos+' administrativo(s) fora da conferência de CNJ.)');
  return lines.join('\n');
}

async function applyCnjCorrection({processStore,processId,numero,now=new Date(),actor='advogado'}){
  const cnj=String(numero||'').replace(/\D/g,'');
  if(!cnjValid(cnj))throw Object.assign(new Error('Número '+String(numero||'')+' inválido: o dígito verificador não confere'+(cnj.length===20?' (deveria ser '+cnjCheckDigits(cnj)+')':'')+'. Nada foi alterado.'),{status:400});
  if(!tribunalFromCnj(cnj))throw Object.assign(new Error('Número '+formatCnj(cnj)+' não aponta para um tribunal conhecido. Nada foi alterado.'),{status:400});
  const saved=await processStore.mutate(ps=>{
    const i=ps.findIndex(x=>String(x.id)===String(processId));
    if(i<0)throw Object.assign(new Error('Processo não encontrado.'),{status:404});
    const other=ps.find(x=>String(x.id)!==String(processId)&&processCnjs(x.numero).includes(cnj));
    if(other)throw Object.assign(new Error('O número '+formatCnj(cnj)+' já está no processo "'+(other.nome||other.id)+'". Nada foi alterado.'),{status:409});
    const p=ps[i],anterior=String(p.numero||'');
    const andamentos=Array.isArray(p.andamentos)?p.andamentos.slice():[];
    andamentos.unshift({data:now.toISOString().slice(0,10),txt:'[LEX] Número corrigido'+(anterior?' de "'+anterior+'"':'')+' para '+formatCnj(cnj)+' (confirmado por '+actor+')',origem:'lex'});
    ps[i]={...p,numero:formatCnj(cnj),numero_anterior:anterior||null,tribunal:p.tribunal||tribunalFromCnj(cnj),andamentos,last_court_sync_at:null};
    return{processo:ps[i],anterior};
  },'LEX conferência CNJ');
  return saved.value;
}

async function readOrphans(dbReq,{limit=500}={}){
  if(typeof dbReq!=='function')return[];
  const {rowsFromResult}=require('./supabase');
  return rowsFromResult(await dbReq('GET','djen_comunicacoes',null,{status:'eq.orfa',order:'data_disponibilizacao.desc',limit:String(limit)}),'Listar publicações sem processo');
}

module.exports={cnjCheckDigits,cnjValid,formatCnj,isAdministrative,digitDistance,auditCarteira,auditMessage,applyCnjCorrection,readOrphans,suggestionsFor};
