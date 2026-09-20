'use strict';

const REGIMES=new Set(['cpc','clt']);
function parseDate(value,label='data'){
  const text=String(value||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))throw new Error(label+' deve estar em AAAA-MM-DD.');
  const d=new Date(text+'T12:00:00Z');
  if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==text)throw new Error(label+' inválida.');
  return d;
}
function ymd(date){return date.toISOString().slice(0,10)}
function addDays(date,n){const d=new Date(date.getTime());d.setUTCDate(d.getUTCDate()+n);return d}
function isRecess(date){
  const m=date.getUTCMonth()+1,d=date.getUTCDate();
  return (m===12&&d>=20)||(m===1&&d<=20);
}
function holidaySet(values=[]){
  const set=new Set();
  for(const value of Array.isArray(values)?values:[]){
    const d=parseDate(value,'feriado');set.add(ymd(d));
  }
  return set;
}
function nonBusinessReason(date,holidays){
  const day=date.getUTCDay();
  if(day===0||day===6)return'fim_de_semana';
  if(isRecess(date))return'recesso_20_12_a_20_01';
  if(holidays.has(ymd(date)))return'feriado_informado';
  return null;
}
function nextBusinessDay(after,holidays,skipped){
  let d=addDays(after,1);
  for(let guard=0;guard<500;guard++){
    const reason=nonBusinessReason(d,holidays);
    if(!reason)return d;
    if(skipped)skipped.push({data:ymd(d),motivo:reason});
    d=addDays(d,1);
  }
  throw new Error('Calendário não encontrou próximo dia útil.');
}
function proposeDjenDeadline(input={}){
  const regime=String(input.regime||'').toLowerCase();
  if(!REGIMES.has(regime))throw new Error('Regime suportado nesta proposta: cpc ou clt.');
  const dias=Number(input.dias);
  if(!Number.isInteger(dias)||dias<1||dias>365)throw new Error('dias deve ser inteiro entre 1 e 365.');
  const disponibilidade=parseDate(input.data_disponibilizacao,'data_disponibilizacao');
  const holidays=holidaySet(input.feriados),skipped=[];
  const publicacao=nextBusinessDay(disponibilidade,holidays,skipped);
  const inicio=nextBusinessDay(publicacao,holidays,skipped);
  const contados=[ymd(inicio)];
  let cursor=inicio;
  while(contados.length<dias){
    cursor=nextBusinessDay(cursor,holidays,skipped);
    contados.push(ymd(cursor));
  }
  const warnings=[
    'PROPOSTA: não é prazo jurídico confirmado e não pode ser gravada como legal_truth sem autorização humana.',
    'A classificação do ato e a quantidade de dias devem ser conferidas pelo responsável.'
  ];
  if(input.calendario_verificado!==true)warnings.push('Calendário local não marcado como verificado; feriados locais, suspensões extraordinárias ou expediente do tribunal podem alterar a data.');
  return Object.freeze({
    source:'djen',regime,status:'proposta',legal_truth:false,
    data_disponibilizacao:ymd(disponibilidade),
    data_publicacao:ymd(publicacao),
    termo_inicial:ymd(inicio),
    dias,
    due_at_proposto:contados[contados.length-1],
    dias_contados:Object.freeze(contados),
    dias_pulados:Object.freeze(skipped),
    recesso_aplicado:skipped.some(x=>x.motivo==='recesso_20_12_a_20_01'),
    calendario_verificado:input.calendario_verificado===true,
    warnings:Object.freeze(warnings)
  });
}
module.exports={REGIMES,parseDate,isRecess,holidaySet,nonBusinessReason,nextBusinessDay,proposeDjenDeadline};
