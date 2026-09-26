'use strict';
// Data "de hoje" no fuso do produto (America/Sao_Paulo, UTC-3).
// O servidor (Render) roda em UTC: entre 21h e 0h de Brasília,
// new Date().toISOString().slice(0,10) já devolve o dia SEGUINTE e grava
// andamento, login e prazo com a data errada. Use hojeBrasil() para isso.
const FUSO='America/Sao_Paulo';
const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:FUSO,year:'numeric',month:'2-digit',day:'2-digit'});
function ymdSP(now=new Date()){
  const d=now instanceof Date?now:new Date(now);
  if(Number.isNaN(d.getTime()))throw new Error('hojeBrasil: data inválida');
  return fmt.format(d);
}
function hojeBrasil(now){return ymdSP(now===undefined?new Date():now)}
module.exports={FUSO,ymdSP,hojeBrasil};
