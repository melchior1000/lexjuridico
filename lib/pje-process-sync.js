'use strict';
// Atualização da carteira pelo PJe (MNI consultarProcesso, sem documentos:
// não dá ciência de intimação). Traz andamentos novos e as partes (polos).
// O tribunal é deduzido do próprio CNJ (segmento J.TR).
const crypto=require('node:crypto');
const {processCnjs}=require('./pje-sync');

const UF_BY_TR=['','AC','AL','AP','AM','BA','CE','DFT','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SE','SP','TO'];
const POLO=Object.freeze({AT:'Autor',PA:'Réu',TC:'Terceiro',FL:'Fiscal da lei',VI:'Vítima',AD:'Assistente'});

// NNNNNNN-DD.AAAA.J.TR.OOOO → sigla do tribunal (TJMG, TRF6, TRT3...).
function tribunalFromCnj(cnj){
  const d=String(cnj||'').replace(/\D/g,'');
  if(d.length!==20)return null;
  const j=d[13],tr=Number(d.slice(14,16));
  if(j==='8'){const uf=UF_BY_TR[tr];return uf?'TJ'+uf:null}
  if(j==='4')return tr>=1&&tr<=6?'TRF'+tr:null;
  if(j==='5')return tr>=1&&tr<=24?'TRT'+tr:null;
  if(j==='3')return'STJ';
  return null;
}

function partesText(polos){
  return(polos||[]).filter(p=>p.partes?.length).map(p=>(POLO[p.polo]||p.polo||'Parte')+': '+p.partes.join(', ')).join(' · ');
}
function tituloOficial(polos,classe){
  const at=(polos||[]).find(p=>p.polo==='AT')?.partes?.[0];
  const pa=(polos||[]).find(p=>p.polo==='PA')?.partes?.[0];
  if(at&&pa)return at+' x '+pa;
  return at||pa||classe||null;
}

function movementFingerprint(cnj,m){
  return crypto.createHash('sha256').update([cnj,m.id||'',m.data||'',m.descricao||''].join('|')).digest('hex').slice(0,24);
}

// Aplica o resultado ao processo, sem apagar nada que já existe.
function mergeCourtData(process,cnj,result,now){
  const andamentos=Array.isArray(process.andamentos)?process.andamentos.slice():[];
  const known=new Set(andamentos.map(a=>a.fingerprint).filter(Boolean));
  let novos=0;
  for(const m of result.movimentos||[]){
    if(!m.descricao)continue;
    const fingerprint=movementFingerprint(cnj,m);
    if(known.has(fingerprint))continue;
    known.add(fingerprint);novos++;
    andamentos.push({data:m.data.slice(0,10),txt:'[PJe] '+m.descricao,origem:'pje',cnj,fingerprint,codigo_nacional:m.codigo||null,importado_em:now.toISOString()});
  }
  andamentos.sort((a,b)=>String(b.data||'').localeCompare(String(a.data||'')));
  const observadoEm=now.toISOString();
  const next={...process,andamentos,last_court_sync_at:observadoEm,last_court_sync_source:'pje',pje_atualizado_em:observadoEm,
    cadastro_conferido:'tribunal',numero_verificado_em:observadoEm,numero_verificado_fonte:'pje'};
  const partes=partesText(result.polos);
  const partesMudaram=!!partes&&partes!==process.partes;
  if(partes){
    // Regra fail-closed: dado manual/legado que diverge do tribunal nunca continua
    // produzindo prazo, urgência ou identidade como se estivesse confirmado.
    const conflitoLegado=!!process.partes&&partes!==process.partes&&!process.partes_verificadas_em&&!process.last_court_sync_at;
    if(conflitoLegado){
      next.dados_anteriores_nao_confirmados={
        nome:process.nome||null,partes:process.partes||null,
        prazo:process.prazo||process.prazoReal||process.dataPrazo||null,
        status:process.status||null,preservado_em:observadoEm
      };
      next.verificacao_conflito=true;
      next.verificacao_conflito_em=observadoEm;
      next.prazo='';next.prazoReal='';next.dataPrazo='';
      next.prazo_bloqueado_por_conflito=true;
      if(/^URGENTE$/i.test(String(process.status||'')))next.status='ATIVO';
    }
    next.partes=partes;
    next.polos=result.polos;
    next.partes_verificadas_em=observadoEm;
    next.partes_verificadas_fonte='pje';
    const nomeOficial=tituloOficial(result.polos,result.classe);
    if(nomeOficial){
      next.nome_oficial=nomeOficial;
      next.nome_oficial_verificado_em=observadoEm;
      if(conflitoLegado&&/(?:\bvs\.?\b|\bx\b|versus|—)/i.test(String(process.nome||''))){
        next.nome_anterior_nao_confirmado=process.nome;
        next.nome=nomeOficial;
      }
    }
  }
  if(!process.vara&&result.orgao)next.vara=result.orgao;
  if(!process.classe&&result.classe)next.classe=result.classe;
  return{process:next,novos,partesMudaram};
}

// OAB do escritório entre os advogados do processo no tribunal? "123456:MG" casa "MG123456", "123456/MG" etc.
function oabDigits(v){return String(v||'').replace(/\D/g,'').replace(/^0+/,'')}
function officeInCase(polos,oabs){
  const mine=new Set((oabs||[]).map(o=>oabDigits(o.oab||o)).filter(Boolean));
  const listed=(polos||[]).flatMap(p=>p.advogados||[]).map(a=>oabDigits(a.inscricao)).filter(Boolean);
  if(!mine.size||!listed.length)return null; // sem dado para afirmar
  return listed.some(x=>mine.has(x));
}

async function syncProcessesFromPje({client,processStore,now=new Date(),processId=null,oabs=[]}={}){
  if(!client||!processStore?.read||!processStore?.mutate)throw new Error('Atualização pelo PJe sem dependências.');
  const configured=new Set(client.tribunais());
  const state=await processStore.read();
  const list=(state.processes||[]).filter(p=>processId==null||String(p.id)===String(processId));
  const report={atualizados:[],sem_cnj:[],sem_tribunal:[],falhas:[],nao_consta:[],novos_andamentos:0,partes_atualizadas:0};
  for(const p of list){
    const label=p.nome||p.numero||p.id;
    if(/^(ARQUIVADO|CONCLUIDO|ENCERRADO)$/i.test(String(p.status||''))&&processId==null)continue;
    const cnjs=processCnjs(p.numero);
    if(!cnjs.length){report.sem_cnj.push({id:p.id,nome:label,numero:p.numero||''});continue}
    // Principal primeiro; os demais (embargos, apensos) completam andamentos.
    let updatedAny=false;
    for(const cnj of cnjs){
      const sigla=tribunalFromCnj(cnj);
      if(!sigla||!configured.has(sigla)){report.sem_tribunal.push({id:p.id,nome:label,cnj,tribunal:sigla});continue}
      try{
        const result=await client.consultarProcesso(sigla,cnj);
        if(result.numero&&result.numero!==cnj)throw new Error('Tribunal devolveu outro número.');
        const officeMatch=cnj===cnjs[0]?officeInCase(result.polos,oabs):null;
        if(officeMatch===false)report.nao_consta.push({id:p.id,nome:tituloOficial(result.polos,result.classe)||label,cnj,tribunal:sigla,advogados:(result.polos||[]).flatMap(x=>x.advogados||[]).map(a=>a.nome).filter(Boolean).slice(0,4)});
        const saved=await processStore.mutate(ps=>{
          const i=ps.findIndex(x=>String(x.id)===String(p.id));
          if(i<0)throw new Error('Processo removido durante a atualização.');
          const merged=mergeCourtData(ps[i],cnj,cnj===cnjs[0]?result:{...result,polos:[]},now);
          if(cnj===cnjs[0]&&officeMatch!==null){
            merged.process.escritorio_consta_no_processo=officeMatch;
            merged.process.escritorio_consta_verificado_em=now.toISOString();
            merged.process.escritorio_consta_verificado_fonte='pje';
          }
          ps[i]=merged.process;
          return merged;
        },'LEX PJe');
        report.novos_andamentos+=saved.value.novos;
        if(saved.value.partesMudaram)report.partes_atualizadas++;
        if(!updatedAny)report.atualizados.push({id:p.id,nome:label,cnj,tribunal:sigla,novos:saved.value.novos});
        else report.atualizados[report.atualizados.length-1].novos+=saved.value.novos;
        updatedAny=true;
      }catch(error){report.falhas.push({id:p.id,nome:label,cnj,tribunal:sigla,erro:error.message})}
    }
  }
  report.ok=report.falhas.length===0;
  return report;
}

function syncReportMessage(r,{configurado=true,faltando=[]}={}){
  if(!configurado)return'O PJe ainda não está conectado a este LEX (faltam '+faltando.join(', ')+'). Configure o acesso e peça de novo "atualize meus processos".';
  const lines=[];
  lines.push(r.atualizados.length?'✅ '+r.atualizados.length+' processo(s) atualizado(s) pelo PJe: '+r.novos_andamentos+' andamento(s) novo(s)'+(r.partes_atualizadas?', partes atualizadas em '+r.partes_atualizadas:'')+'.':'Nenhum processo foi atualizado pelo PJe.');
  for(const a of r.atualizados.filter(a=>a.novos).slice(0,8))lines.push('• '+a.nome+' — '+a.novos+' novo(s)');
  if(r.falhas.length){lines.push('\n⚠️ Falharam '+r.falhas.length+':');for(const f of r.falhas.slice(0,6))lines.push('• '+f.nome+' ('+f.tribunal+'): '+f.erro)}
  if(r.nao_consta.length){lines.push('\n⚠️ Você não consta como advogado no tribunal em '+r.nao_consta.length+':');for(const n of r.nao_consta.slice(0,8))lines.push('• '+n.nome+' ('+n.cnj.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/,'$1-$2.$3.$4.$5.$6')+')'+(n.advogados.length?' — advogados: '+n.advogados.join(', '):''));lines.push('Confira o número. Se o processo não é seu, arquive no LEX.')}
  if(r.sem_cnj.length){lines.push('\n'+r.sem_cnj.length+' sem número CNJ — informe o número para eu acompanhar:');for(const s of r.sem_cnj.slice(0,8))lines.push('• '+s.nome)}
  const {isEproc}=require('./pje-mni');
  const semTrib=[...new Set(r.sem_tribunal.map(s=>s.tribunal||'desconhecido'))];
  const eproc=semTrib.filter(t=>isEproc(t)),outros=semTrib.filter(t=>!isEproc(t));
  if(eproc.length)lines.push('\n'+eproc.join(', ')+' usa eproc e ainda não está ligado. No TRF6, MNI exige credenciamento institucional e credencial própria fornecida pelo tribunal; login pessoal do eproc não substitui a integração. Enquanto isso, use consulta pública/DJEN e mantenha os dados como não conferidos.');
  if(outros.length)lines.push('\nTribunal não conectado: '+outros.join(', ')+'. Inclua em PJE_MNI_TRIBUNAIS para atualizar esses processos.');
  return lines.join('\n');
}

module.exports={officeInCase,tribunalFromCnj,partesText,mergeCourtData,syncProcessesFromPje,syncReportMessage};
