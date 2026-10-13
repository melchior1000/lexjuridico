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
// Feriados nacionais por lei federal — dias sem expediente em todo o país, então nunca contam
// como dia útil (CPC, art. 216). Lei 662/1949, art. 1º (red. Lei 10.607/2002): 1º/jan, 21/abr,
// 1º/mai, 7/set, 2/nov, 15/nov e 25/dez; Lei 6.802/1980: 12/out; Lei 14.759/2023: 20/nov (desde
// 2024). Feriado estadual, municipal, Carnaval, Semana Santa e suspensão do tribunal variam por
// lugar: entram como "feriado informado" e a proposta avisa que o calendário local é a conferir.
const FERIADOS_NACIONAIS=Object.freeze({'01-01':'Confraternização Universal (Lei 662/1949)','04-21':'Tiradentes (Lei 662/1949)','05-01':'Dia do Trabalho (Lei 662/1949)',
  '09-07':'Independência (Lei 662/1949)','10-12':'Nossa Senhora Aparecida (Lei 6.802/1980)','11-02':'Finados (Lei 662/1949)','11-15':'Proclamação da República (Lei 662/1949)',
  '11-20':'Zumbi e Consciência Negra (Lei 14.759/2023)','12-25':'Natal (Lei 662/1949)'});
function feriadoNacional(date){
  const md=ymd(date).slice(5);
  if(md==='11-20'&&date.getUTCFullYear()<2024)return null;
  return FERIADOS_NACIONAIS[md]||null;
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
  if(feriadoNacional(date))return'feriado_nacional';
  if(holidays.has(ymd(date)))return'feriado_informado';
  return null;
}
function nextBusinessDay(after,holidays,skipped){
  let d=addDays(after,1);
  for(let guard=0;guard<500;guard++){
    const reason=nonBusinessReason(d,holidays);
    if(!reason)return d;
    if(skipped)skipped.push({data:ymd(d),motivo:reason,...(reason==='feriado_nacional'?{feriado:feriadoNacional(d)}:{})});
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
// Data de publicação no DJEN: o primeiro dia útil seguinte ao da disponibilização (CPC, art. 224, §2º).
function publicacaoDjen(dataDisponibilizacao,feriados=[]){
  return ymd(nextBusinessDay(parseDate(dataDisponibilizacao,'data_disponibilizacao'),holidaySet(feriados)));
}
module.exports={REGIMES,FERIADOS_NACIONAIS,feriadoNacional,parseDate,isRecess,holidaySet,nonBusinessReason,nextBusinessDay,proposeDjenDeadline,publicacaoDjen};
