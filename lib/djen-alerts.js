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
// - prazo nunca nasce aqui: a mensagem lembra que a sugestão só vale com a confirmação.
const {rowsFromResult}=require('./supabase');

const KEY='lex_djen_avisados';
const MAX_ITENS=8;
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
    const onde=nome?nome+' ('+cnjMask(r.cnj)+')':cnjMask(r.cnj)+' — não está cadastrado no LEX';
    const oab=r.numero_oab?' · OAB '+r.numero_oab+'/'+String(r.uf_oab||'').toUpperCase():'';
    lines.push('• '+brDate(r.data_disponibilizacao)+' · '+(r.tribunal||'tribunal?')+' · '+(r.tipo||'Comunicação')+' — '+onde+oab);
  }
  if(n>MAX_ITENS)lines.push('… e mais '+(n-MAX_ITENS)+'.');
  lines.push('Diga "tem intimação nova?" para ver o texto. Prazo sugerido a partir do DJEN só vale depois da sua confirmação.');
  return lines.join('\n');
}

async function lerJanela(sbReq,desde){
  const out=[];
  for(let pagina=0;pagina<MAX_PAGINAS;pagina++){
    const rows=rowsFromResult(await sbReq('GET','djen_comunicacoes',null,{
      status:'in.(casada,orfa)',data_disponibilizacao:'gte.'+desde,order:'data_disponibilizacao.asc,djen_id.asc',
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
  async function marcar(canal,ids,current,naJanela){
    await records.change(KEY,cur=>{
      const base=cur||{ligado_em:current.toISOString(),canais:{}};
      const antes=base.canais?.[canal]?.ids||[];
      const todos=[...new Set([...antes.map(String).filter(id=>naJanela.has(id)),...ids])];
      return{...base,canais:{...(base.canais||{}),[canal]:{ids:todos,avisado_em:new Date().toISOString()}}};
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
      for(const [canal,enviar] of mapa){
        const reg=estado.canais?.[canal];
        const primeira=!reg;
        const vistos=new Set((reg?.ids||[]).map(String));
        const novas=rows.filter(r=>r&&r.djen_id!=null&&!vistos.has(String(r.djen_id)));
        maxNovas=Math.max(maxNovas,novas.length);
        if(!novas.length){
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
          text=compose(novas,nomes);
        }
        let entregue=false;
        try{entregue=(await enviar(text))===true}catch{entregue=false}
        if(!entregue){
          ok=false;
          log('[DJEN avisos] '+canal+' não confirmou a entrega; nova tentativa na próxima rodada.');
          porCanal[canal]={ok:false,reason:'entrega_nao_confirmada',novas:novas.length};
          continue;
        }
        await marcar(canal,novas.map(r=>String(r.djen_id)),current,naJanela);
        porCanal[canal]={ok:true,novas:novas.length,primeira};
      }
      return ok?{ok:true,novas:maxNovas,por_canal:porCanal}:{ok:false,reason:'entrega_nao_confirmada',novas:maxNovas,por_canal:porCanal};
    }catch(error){
      log('[DJEN avisos] falhou: '+error.message);
      return{ok:false,error:error.message};
    }finally{running=false}
  }
  return{tick};
}
module.exports={createDjenAlerts,KEY,compose,cnjMask};
