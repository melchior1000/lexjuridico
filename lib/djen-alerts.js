'use strict';
// Aviso imediato de intimação/publicação nova do Diário (DJEN) ao titular.
//
// A leitura do DJEN (djen-monitor.syncDjen) grava e casa as publicações, mas regrava
// as mesmas linhas a cada rodada — não serve para saber o que é "novo". Aqui guardamos,
// num registro próprio, os djen_id já avisados. Regras:
// - só avisa publicação já classificada (casada com processo ou órfã);
// - só marca como avisada DEPOIS que o canal confirmar a entrega (falha: tenta na próxima);
// - na primeira vez não despeja o acervo: manda um aviso de "ligado" e marca o que já existe;
// - banco fora: falha fechada, não envia nem marca nada;
// - prazo nunca nasce aqui: a mensagem lembra que a sugestão só vale com a confirmação.
const {rowsFromResult}=require('./supabase');

const KEY='lex_djen_avisados';
const MAX_IDS=5000;
const MAX_ITENS=8;

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

function createDjenAlerts({sbReq,records,processStore,deliver,log=()=>{},now=()=>new Date(),janelaDias=10}={}){
  if(typeof sbReq!=='function'||!records?.read||!records?.change||typeof deliver!=='function')throw new Error('Aviso do DJEN sem dependências.');
  let running=false;
  async function tick(){
    if(running)return{skipped:'em_execucao'};
    running=true;
    try{
      const current=now();
      const desde=ymd(new Date(current.getTime()-janelaDias*86400000));
      const rows=rowsFromResult(await sbReq('GET','djen_comunicacoes',null,{
        status:'in.(casada,orfa)',data_disponibilizacao:'gte.'+desde,order:'data_disponibilizacao.asc',limit:'500'
      }),'Listar publicações DJEN para aviso');
      const prev=(await records.read(KEY))?.value;
      const primeira=!prev;
      const vistos=new Set((prev?.ids||[]).map(String));
      const novas=rows.filter(r=>r&&r.djen_id!=null&&!vistos.has(String(r.djen_id)));
      if(!novas.length){
        if(primeira)await records.change(KEY,cur=>cur||{ids:[],ligado_em:current.toISOString()});
        return{ok:true,novas:0,primeira};
      }
      let text;
      if(primeira){
        text='📰 Avisos do Diário (DJEN) ligados. Já estão no LEX '+novas.length+' publicação(ões) dos últimos '+janelaDias+' dias — diga "tem intimação nova?" para ver. De agora em diante aviso cada nova assim que o LEX ler o Diário.';
      }else{
        let nomes=new Map();
        try{const st=await processStore?.read?.();nomes=new Map((st?.processes||[]).map(p=>[String(p.id),p.nome||p.cliente||'Processo']))}
        catch{/* sem nome do processo: o número basta */}
        text=compose(novas,nomes);
      }
      const delivered=await deliver(text);
      if(delivered!==true){
        log('[DJEN avisos] canal não confirmou a entrega; nova tentativa na próxima rodada.');
        return{ok:false,reason:'entrega_nao_confirmada',novas:novas.length};
      }
      await records.change(KEY,cur=>{
        const ids=[...new Set([...(cur?.ids||[]).map(String),...novas.map(r=>String(r.djen_id))])].slice(-MAX_IDS);
        return{...(cur||{ligado_em:current.toISOString()}),ids,avisado_em:new Date().toISOString()};
      });
      return{ok:true,novas:novas.length,primeira};
    }catch(error){
      log('[DJEN avisos] falhou: '+error.message);
      return{ok:false,error:error.message};
    }finally{running=false}
  }
  return{tick};
}
module.exports={createDjenAlerts,KEY,compose,cnjMask};
