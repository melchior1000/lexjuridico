'use strict';
// =====================================================================
// PRAZOS ABERTOS DO PROCESSO — um por intimação confirmada
// ---------------------------------------------------------------------
// Como nos sistemas de mercado (ADVBOX, Astrea, Projuris), cada intimação confirmada é um prazo
// próprio, com data e baixa próprias. Antes o processo guardava UMA data: confirmar a segunda
// intimação do mesmo processo apagava o prazo da primeira; o prazo cumprido continuava na vigia
// (e virava "vencido"); e um prazo novo, depois de uma baixa, nascia marcado como cumprido.
//
// prazos_abertos: [{djen_id, due_at (AAAA-MM-DD), confirmed_at, truth, authorization}], do mais
// próximo para o mais distante. Os campos de sempre (prazoReal, deadline_truth, …) espelham o mais
// próximo, para as telas e rotinas que leem um prazo só. A vigia (lib/deadline-watch.js) olha
// todos. Prazo nunca nasce aqui: só a confirmação humana (lib/deadline-authorization.js) cria um.
// =====================================================================
const FMT=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'});

function civil(v){
  const s=String(v||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  const ms=Date.parse(s);
  return Number.isFinite(ms)?FMT.format(new Date(ms)):null;
}
// Baixa total registrada (todos os prazos do processo cumpridos) ou verdade antiga já resolvida.
function resolvido(p){return p?.prazo_baixa?.ativa===true||!!p?.deadline_truth_resolvido_em}
function ordenar(a,b){return String(a.due_at).localeCompare(String(b.due_at))||String(a.djen_id??'').localeCompare(String(b.djen_id??''))}
function djenDaVerdade(t){return t&&t.source_ref!=null&&String(t.source_ref).trim()?String(t.source_ref):null}

function prazosAbertos(p){
  if(Array.isArray(p?.prazos_abertos)){
    return p.prazos_abertos.filter(x=>x&&typeof x==='object'&&civil(x.due_at)).map(x=>({...x,due_at:civil(x.due_at)})).sort(ordenar);
  }
  // Processo de antes desta mudança: o prazo único, se confirmado e não baixado, é o prazo aberto.
  // O nº da intimação vem da verdade assinada (djen_id_origem é regravado a cada andamento do Diário).
  const t=p?.deadline_truth;
  if(t&&typeof t==='object'&&t.legal_truth===true&&civil(t.due_at)&&!resolvido(p)){
    return[{djen_id:djenDaVerdade(t)??(p.djen_id_origem!=null?String(p.djen_id_origem):null),due_at:civil(t.due_at),
      confirmed_at:p.prazo_confirmado_em||t.authorized_at||null,truth:t,authorization:p.deadline_authorization||null}];
  }
  return[];
}
// Campos do processo que espelham o prazo aberto mais próximo.
function camposDoPrincipal(lista){
  const ordenada=[...lista].sort(ordenar),p=ordenada[0];
  if(!p)return{prazos_abertos:[]};
  return{prazos_abertos:ordenada,prazoReal:p.due_at,deadline_truth:p.truth||null,deadline_authorization:p.authorization||null,
    djen_id_origem:p.djen_id!=null?String(p.djen_id):null,prazo_confirmado_em:p.confirmed_at||null,deadline_truth_resolvido_em:''};
}
// Impressão digital da lista (para o Desfazer não apagar mudança feita depois da baixa).
function digital(lista){return(lista||[]).map(x=>String(x.djen_id??'')+'@'+civil(x.due_at)).sort().join('|')}
function brData(ymd){const m=String(ymd||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:String(ymd||'')}

module.exports={civil,resolvido,prazosAbertos,camposDoPrincipal,digital,ordenar,brData};
