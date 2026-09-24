'use strict';
// "Cadastre o processo NNNNNNN-DD.AAAA.J.TR.OOOO": o LEX confere o número,
// busca no tribunal (PJe/MNI, sem documentos: não dá ciência) e no Diário
// (publicações do DJEN já lidas pela OAB) e só cadastra se alguma fonte
// confirmar que o processo existe. Nunca duplica.
const {cnjValid,cnjCheckDigits,formatCnj}=require('./carteira-audit');
const {processCnjs}=require('./pje-sync');
const {tribunalFromCnj,mergeCourtData}=require('./pje-process-sync');
const {isEproc}=require('./pje-mni');

function erro(msg,status=400){return Object.assign(new Error(msg),{status})}
function brDate(ymd){const m=String(ymd||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:String(ymd||'')}
function titulo(polos,classe){
  const at=(polos||[]).find(p=>p.polo==='AT')?.partes?.[0],pa=(polos||[]).find(p=>p.polo==='PA')?.partes?.[0];
  if(at&&pa)return at+' x '+pa;
  return at||pa||classe||'Processo';
}

async function readPublications(dbReq,cnj){
  if(typeof dbReq!=='function')return[];
  const {rowsFromResult}=require('./supabase');
  const rows=rowsFromResult(await dbReq('GET','djen_comunicacoes',null,{cnj:'eq.'+cnj,order:'data_disponibilizacao.desc',limit:'50'}),'Ler publicações do processo');
  return rows.filter(r=>r.status!=='cancelada');
}

async function registerProcess({cnj:input,processStore,pje=null,dbReq=null,now=new Date(),forcar=false,markCommunication=null}){
  const cnj=String(input||'').replace(/\D/g,'');
  if(cnj.length!==20)throw erro('Informe o número CNJ completo (20 dígitos).');
  if(!cnjValid(cnj))throw erro('O número '+formatCnj(cnj)+' não existe: o dígito verificador deveria ser '+cnjCheckDigits(cnj)+'. Confira o número.');
  const sigla=tribunalFromCnj(cnj);
  if(!sigla)throw erro('O número '+formatCnj(cnj)+' não aponta para um tribunal conhecido.');
  const state=await processStore.read();
  const existente=(state.processes||[]).find(p=>processCnjs(p.numero).includes(cnj));
  if(existente)return{existente:true,processo:existente,sigla};

  // Tribunal
  let tribunal=null,fonteTribunal;
  // Tribunal ligado ao LEX (PJe ou eproc pelo MNI) tem prioridade; eproc sem ligação só avisa.
  if(pje?.config?.configurado&&pje.client&&pje.client.tribunais().includes(sigla)){
    try{tribunal=await pje.client.consultarProcesso(sigla,cnj);fonteTribunal='pje'}
    catch(e){fonteTribunal='falha';tribunal={erro:e.message}}
  }else if(isEproc(sigla))fonteTribunal='eproc';
  else fonteTribunal='nao_conectado';
  const tribunalOk=fonteTribunal==='pje'&&tribunal&&!tribunal.erro;

  // Diário
  let publicacoes=[],erroDiario=null;
  try{publicacoes=await readPublications(dbReq,cnj)}catch(e){erroDiario=e.message}

  if(!tribunalOk&&!publicacoes.length&&!forcar){
    return{cadastrado:false,sigla,fonteTribunal,erroTribunal:tribunal?.erro||null,erroDiario,
      motivo:'nao_confirmado'};
  }

  const saved=await processStore.mutate(ps=>{
    if(ps.some(p=>processCnjs(p.numero).includes(cnj)))throw erro('O processo foi cadastrado por outra pessoa agora há pouco.',409);
    let p={id:Date.now(),numero:formatCnj(cnj),tribunal:sigla,status:'ATIVO',tipo:'judicial',andamentos:[],
      origem_cadastro:'lex',cadastrado_em:now.toISOString(),cadastro_conferido:tribunalOk?'tribunal':publicacoes.length?'diario':'sem_conferencia'};
    if(tribunalOk){
      p=mergeCourtData(p,cnj,tribunal,now).process;
      p.nome=titulo(tribunal.polos,tribunal.classe);
      if(tribunal.classe)p.classe=tribunal.classe;
    }
    for(const r of publicacoes){
      p.andamentos.push({data:String(r.data_disponibilizacao||'').slice(0,10),txt:'[DJEN] '+[r.tipo,String(r.texto||'').replace(/\s+/g,' ').slice(0,300)].filter(Boolean).join(' — '),origem:'djen',djen_id:r.djen_id,cnj});
    }
    p.andamentos.sort((a,b)=>String(b.data||'').localeCompare(String(a.data||'')));
    if(!p.nome){const d=(publicacoes[0]?.payload?.destinatarios||[]).map(x=>x?.nome).filter(Boolean);p.nome=d.length?d.slice(0,2).join(' x '):'Processo '+formatCnj(cnj)}
    ps.push(p);
    return p;
  },'LEX cadastro de processo');
  const processo=saved.value;
  if(typeof markCommunication==='function'){
    for(const r of publicacoes){try{await markCommunication(dbReq,r.djen_id,{status:'casada',processo_id:String(processo.id)})}catch{/* segue: a publicação já está no processo */}}
  }
  return{cadastrado:true,processo,sigla,fonteTribunal,erroTribunal:tribunal?.erro||null,publicacoes:publicacoes.length,erroDiario};
}

function registerMessage(r,cnj){
  const num=formatCnj(String(cnj||'').replace(/\D/g,''));
  if(r.existente)return'Esse processo já está no LEX: '+(r.processo.nome||num)+'. Não cadastrei de novo.';
  const trib={pje:'',eproc:r.sigla+' usa eproc e o eproc ainda não está ligado ao LEX; ',nao_conectado:r.sigla+' não está conectado ao LEX; ',falha:'O tribunal não respondeu ('+(r.erroTribunal||'erro')+'); '}[r.fonteTribunal]||'';
  if(!r.cadastrado)return'Não cadastrei '+num+': '+trib+'e não achei publicação dele no Diário da sua OAB. Sem uma fonte que confirme, o cadastro poderia ficar errado.\nConfira o número. Se estiver certo, diga: "cadastre o processo '+num+' mesmo assim".';
  const p=r.processo,ult=(p.andamentos||[])[0];
  const lines=['✅ Cadastrei '+num+' ('+r.sigla+'): '+p.nome+'.'];
  if(p.classe||p.vara)lines.push([p.classe,p.vara].filter(Boolean).join(' · '));
  if(p.partes)lines.push('Partes: '+p.partes);
  lines.push(ult?'Último andamento: '+brDate(ult.data)+' — '+String(ult.txt||'').replace(/^\[\w+\]\s*/,'').slice(0,160):'Sem andamento encontrado ainda.');
  const fontes=[r.fonteTribunal==='pje'?'tribunal ('+r.sigla+')':null,r.publicacoes?r.publicacoes+' publicação(ões) do Diário':null].filter(Boolean);
  lines.push(fontes.length?'Fonte: '+fontes.join(' e ')+'.':'⚠️ Cadastrado sem conferência em tribunal ou Diário, a seu pedido.');
  if(trib&&r.fonteTribunal!=='pje')lines.push(trib.replace(/; $/,'.')+' Confira as partes.');
  return lines.join('\n');
}

module.exports={registerProcess,registerMessage,titulo};
