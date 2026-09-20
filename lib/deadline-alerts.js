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
module.exports={markerFor,buildDeadlineAlerts,persistDeadlineAlerts};
