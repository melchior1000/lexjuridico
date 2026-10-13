'use strict';
const {rowsFromResult}=require('./supabase');
function markerFor(days){if(!Number.isFinite(days))return null;if(days<0)return'atrasado';if(days===0)return'd0';if(days<=1)return'd1';if(days<=2)return'd2';if(days<=5)return'd5';return null}
function buildDeadlineAlerts(items=[]){
  return(Array.isArray(items)?items:[]).filter(x=>x.deadline_legal_truth===true&&x.prazo&&Number.isFinite(x.days_to_due)).map(x=>({...x,marco:markerFor(x.days_to_due)})).filter(x=>x.marco).map(x=>({processo_id:String(x.case_id),djen_id:x.djen_id_origem||null,due_at:x.prazo,marco:x.marco,status:'pendente'}));
}
async function persistDeadlineAlerts(sbReq,items=[]){
  const alerts=buildDeadlineAlerts(items),created=[];
  for(const row of alerts){
    const result=await sbReq('POST','prazo_alertas',row,{on_conflict:'processo_id,due_at,marco'},{Prefer:'resolution=ignore-duplicates,return=representation'});
    const rows=rowsFromResult(result,'Gravar alerta de prazo');if(rows[0])created.push(rows[0]);
  }
  return{candidatos:alerts.length,novos:created.length,alertas:created};
}
// Lembrete de vencimento que o titular lê no WhatsApp/Telegram: QUAL processo, QUAL data e quanto
// falta (como ADVBOX e Astrea: 5 dias antes, 2, 1, no dia e vencido sem baixa). Antes saía só
// "N novo(s) marco(s) de vencimento entraram na fila de alerta", sem dizer qual.
function brData(ymd){const m=String(ymd||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:String(ymd||'')}
function quando(d){
  if(!Number.isFinite(d))return'data a conferir';
  if(d<0)return'VENCIDO há '+(-d)+(d===-1?' dia':' dias');
  if(d===0)return'HOJE';if(d===1)return'amanhã';return'em '+d+' dias';
}
function intimacoesDoLembrete(l){
  const ids=Array.isArray(l.djen_ids)&&l.djen_ids.length?l.djen_ids.map(String):l.djen_id?[String(l.djen_id)]:[];
  if(!ids.length)return'';
  return ids.length===1?' — intimação nº '+ids[0]:' — intimações nº '+ids.slice(0,-1).join(', ')+' e '+ids[ids.length-1];
}
function textoLembretes(lembretes=[],{max=10}={}){
  const lista=(Array.isArray(lembretes)?lembretes:[]).filter(Boolean).slice().sort((a,b)=>(Number.isFinite(a.dias)?a.dias:99)-(Number.isFinite(b.dias)?b.dias:99));
  if(!lista.length)return null;
  const lines=['⏰ PRAZOS — '+(lista.length===1?'lembrete de vencimento:':lista.length+' lembretes de vencimento:')];
  for(const l of lista.slice(0,max)){
    lines.push('• '+(Number.isFinite(l.dias)&&l.dias<=0?'🔴 ':'')+quando(l.dias)+' ('+brData(l.due_at)+'): '+String(l.titulo||'Processo')
      +(l.numero?' ('+String(l.numero)+')':'')+intimacoesDoLembrete(l)
      +(Number.isFinite(l.dias)&&l.dias<0?' — ainda sem baixa; se já cumpriu, marque "Cumprido" em Prazos › Vencidos.':''));
  }
  if(lista.length>max)lines.push('… e mais '+(lista.length-max)+'. Veja em Prazos.');
  lines.push('Prazos confirmados por você a partir da publicação no DJEN.');
  return lines.join('\n');
}
module.exports={markerFor,buildDeadlineAlerts,persistDeadlineAlerts,textoLembretes};
