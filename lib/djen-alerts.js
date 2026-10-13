'use strict';
// Aviso imediato de intimação/publicação nova do Diário (DJEN) ao titular.
//
// A leitura do DJEN (djen-monitor.syncDjen) grava e casa as publicações, mas regrava
// as mesmas linhas a cada rodada — não serve para saber o que é "novo". Aqui guardamos,
// num registro próprio, os djen_id já avisados POR CANAL. Regras:
// - só avisa publicação já classificada (casada com processo ou órfã);
// - cada canal (WhatsApp, Telegram) tem o seu controle: só marca como avisada naquele
//   canal DEPOIS que ele confirmar a entrega; canal que falhou tenta de novo na próxima
//   rodada, sem repetir no canal que já recebeu;
// - lê a janela inteira em páginas (não para nas primeiras 500);
// - na primeira vez não despeja o acervo: manda um aviso de "ligado" e marca o que já existe;
// - banco fora: falha fechada, não envia nem marca nada;
// - prazo nunca nasce aqui: a mensagem lembra que a sugestão só vale com a confirmação;
// - intimação gravada e não ligada ao processo ("nova" parada há 15 min) também é avisada;
// - intimação CANCELADA no Diário depois de avisada (ou com prazo já confirmado) gera um aviso
//   único: o titular pode ter contado prazo dela.
const {rowsFromResult}=require('./supabase');

const KEY='lex_djen_avisados';
const MAX_ITENS=8;
// "nova" é a comunicação gravada e ainda não ligada a processo. Logo depois da leitura é normal
// (está sendo classificada); parada há 15 minutos, é falha de ligação e o titular precisa saber.
const NOVA_PARADA_MS=15*60*1000;
const PAGINA=500,MAX_PAGINAS=20;

function ymd(date){return new Date(date.getTime()-3*3600*1000).toISOString().slice(0,10)}
function brDate(s){const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(s||''));return m?m[3]+'/'+m[2]:'—'}
function cnjMask(d){
  const x=String(d||'').replace(/\D/g,'');
  return x.length===20?x.slice(0,7)+'-'+x.slice(7,9)+'.'+x.slice(9,13)+'.'+x.slice(13,14)+'.'+x.slice(14,16)+'.'+x.slice(16):(x||'sem número');
}

function compose(novas,nomes){
  const n=novas.length;
  const lines=['📰 '+n+(n===1?' intimação/publicação nova':' intimações/publicações novas')+' no Diário (DJEN):'];
  for(const r of novas.slice(0,MAX_ITENS)){
    const nome=r.status==='casada'&&r.processo_id?nomes.get(String(r.processo_id)):null;
    const onde=nome?nome+' ('+cnjMask(r.cnj)+')':r.status==='nova'?cnjMask(r.cnj)+' — ⚠️ o LEX leu, mas não conseguiu ligar ao processo: confira':cnjMask(r.cnj)+' — não está cadastrado no LEX';
    const oab=String(r.numero_oab||'')==='NOME'?' · ⚠️ achada pelo NOME do advogado, sem a sua OAB — confira se é sua':r.numero_oab?' · OAB '+r.numero_oab+'/'+String(r.uf_oab||'').toUpperCase():'';
    const num=/^[A-Za-z0-9_-]{1,40}$/.test(String(r.djen_id||''))?'nº '+r.djen_id+' · ':'';
    lines.push('• '+num+brDate(r.data_disponibilizacao)+' · '+(r.tribunal||'tribunal?')+' · '+(r.tipo||'Comunicação')+' — '+onde+oab);
  }
  if(n>MAX_ITENS)lines.push('… e mais '+(n-MAX_ITENS)+'.');
  lines.push('Diga "intimações a tratar" (ou abra Prazos › Diário) para ver o texto e o prazo proposto. O prazo do advogado conta da publicação no DJEN; o prazo sugerido só vale depois da sua confirmação (CONFIRMO PRAZO nº dd/mm/aaaa).');
  return lines.join('\n');
}
function composeCanceladas(canceladas,nomes){
  const lines=['⚠️ '+(canceladas.length===1?'Intimação CANCELADA':'Intimações CANCELADAS')+' no Diário (DJEN) pelo tribunal:'];
  for(const r of canceladas.slice(0,MAX_ITENS)){
    const nome=r.processo_id?nomes.get(String(r.processo_id)):null;
    lines.push('• nº '+String(r.djen_id)+' · '+brDate(r.data_disponibilizacao)+' · '+(r.tribunal||'tribunal?')+' · '+(nome?nome+' ('+cnjMask(r.cnj)+')':cnjMask(r.cnj))
      +(r.motivo_cancelamento?' — '+String(r.motivo_cancelamento).replace(/\s+/g,' ').slice(0,160):'')
      +(r.prazo_cunhado===true?'\n  ⚠️ Há prazo que você confirmou a partir dela no processo: confira e, se não vale mais, dê baixa.':''));
  }
  if(canceladas.length>MAX_ITENS)lines.push('… e mais '+(canceladas.length-MAX_ITENS)+'.');
  lines.push('Se o tribunal republicar, a nova publicação chega como intimação nova, com o prazo contado dela.');
  return lines.join('\n');
}

async function lerJanela(sbReq,desde){
  const out=[];
  for(let pagina=0;pagina<MAX_PAGINAS;pagina++){
    const rows=rowsFromResult(await sbReq('GET','djen_comunicacoes',null,{
      status:'in.(casada,orfa,nova,cancelada)',data_disponibilizacao:'gte.'+desde,order:'data_disponibilizacao.asc,djen_id.asc',
      limit:String(PAGINA),offset:String(pagina*PAGINA)
    }),'Listar publicações DJEN para aviso');
    out.push(...rows);
    if(rows.length<PAGINA)return out;
  }
  throw new Error('Janela do DJEN com mais de '+(PAGINA*MAX_PAGINAS)+' publicações; aviso suspenso para não perder nenhuma.');
}

// canais: {whatsapp: text=>Promise<bool>, telegram: ...} ou função que devolve esse mapa
// (avaliada a cada rodada; só entram canais configurados).
function createDjenAlerts({sbReq,records,processStore,canais,log=()=>{},now=()=>new Date(),janelaDias=10}={}){
  if(typeof sbReq!=='function'||!records?.read||!records?.change||!canais)throw new Error('Aviso do DJEN sem dependências.');
  let running=false;

  // Guarda os avisados que ainda estão na janela lida (+ os novos). Fora da janela a
  // publicação não volta a ser lida, então pode sair; dentro dela, nunca sai (sem repetir).
  async function marcar(canal,ids,current,naJanela,canceladasIds=[]){
    await records.change(KEY,cur=>{
      const base=cur||{ligado_em:current.toISOString(),canais:{}};
      const antes=base.canais?.[canal]?.ids||[];
      const todos=[...new Set([...antes.map(String).filter(id=>naJanela.has(id)),...ids])];
      const cancAntes=base.canais?.[canal]?.canceladas||[];
      const canceladas=[...new Set([...cancAntes.map(String).filter(id=>naJanela.has(id)),...canceladasIds.map(String)])];
      return{...base,canais:{...(base.canais||{}),[canal]:{ids:todos,canceladas,avisado_em:new Date().toISOString()}}};
    });
  }

  async function tick(){
    if(running)return{skipped:'em_execucao'};
    running=true;
    try{
      const mapa=Object.entries((typeof canais==='function'?canais():canais)||{}).filter(([,fn])=>typeof fn==='function');
      if(!mapa.length)return{skipped:'sem_canal'};
      const current=now();
      const rows=await lerJanela(sbReq,ymd(new Date(current.getTime()-janelaDias*86400000)));
      const naJanela=new Set(rows.filter(r=>r&&r.djen_id!=null).map(r=>String(r.djen_id)));
      const estado=(await records.read(KEY))?.value||{};
      let nomes=null,ok=true,maxNovas=0;
      const porCanal={};
      // Avisável: classificada (casada/órfã) ou "nova" parada (não ligada ao processo há 15 min).
      const avisavel=r=>r.status==='casada'||r.status==='orfa'||(r.status==='nova'&&!(current.getTime()-Date.parse(r.observado_em||'')<NOVA_PARADA_MS));
      for(const [canal,enviar] of mapa){
        const reg=estado.canais?.[canal];
        const primeira=!reg;
        const vistos=new Set((reg?.ids||[]).map(String));
        const cancVistas=new Set((reg?.canceladas||[]).map(String));
        const novas=rows.filter(r=>r&&r.djen_id!=null&&!vistos.has(String(r.djen_id))&&avisavel(r));
        // Cancelada depois de avisada (ou com prazo já confirmado a partir dela): aviso uma vez.
        const canceladas=primeira?[]:rows.filter(r=>r&&r.djen_id!=null&&r.status==='cancelada'&&!cancVistas.has(String(r.djen_id))&&(vistos.has(String(r.djen_id))||r.prazo_cunhado===true));
        maxNovas=Math.max(maxNovas,novas.length);
        if(!novas.length&&!canceladas.length){
          if(primeira)await marcar(canal,[],current,naJanela);
          porCanal[canal]={ok:true,novas:0,primeira};
          continue;
        }
        let text;
        if(primeira){
          text='📰 Avisos do Diário (DJEN) ligados. Já estão no LEX '+novas.length+' publicação(ões) dos últimos '+janelaDias+' dias — diga "tem intimação nova?" para ver. De agora em diante aviso cada nova assim que o LEX ler o Diário.';
        }else{
          if(!nomes){
            nomes=new Map();
            try{const st=await processStore?.read?.();nomes=new Map((st?.processes||[]).map(p=>[String(p.id),p.nome||p.cliente||'Processo']))}
            catch{/* sem nome do processo: o número basta */}
          }
          text=[novas.length?compose(novas,nomes):null,canceladas.length?composeCanceladas(canceladas,nomes):null].filter(Boolean).join('\n\n');
        }
        let entregue=false;
        try{entregue=(await enviar(text))===true}catch{entregue=false}
        if(!entregue){
          ok=false;
          log('[DJEN avisos] '+canal+' não confirmou a entrega; nova tentativa na próxima rodada.');
          porCanal[canal]={ok:false,reason:'entrega_nao_confirmada',novas:novas.length};
          continue;
        }
        await marcar(canal,novas.map(r=>String(r.djen_id)),current,naJanela,canceladas.map(r=>String(r.djen_id)));
        porCanal[canal]={ok:true,novas:novas.length,canceladas:canceladas.length,primeira};
      }
      return ok?{ok:true,novas:maxNovas,por_canal:porCanal}:{ok:false,reason:'entrega_nao_confirmada',novas:maxNovas,por_canal:porCanal};
    }catch(error){
      log('[DJEN avisos] falhou: '+error.message);
      return{ok:false,error:error.message};
    }finally{running=false}
  }
  return{tick};
}
module.exports={createDjenAlerts,KEY,compose,composeCanceladas,cnjMask};
