'use strict';
// =====================================================================
// ANDAMENTOS DO PROCESSO — ordem e dia certos, venham de onde vierem
// ---------------------------------------------------------------------
// O campo `andamentos` mistura fontes e formatos: "13/10/2026" (anotação manual),
// "2026-10-13" (Diário, PJe) e "2026-10-13T14:06:24.000Z" (Datajud). E não tem ordem
// garantida: cada leitura do tribunal reordenava do seu jeito, e a anotação manual entra
// no fim. Por isso quem lê NUNCA confia na posição no array — pede a ordem aqui.
//
// Regras:
// - ordem pela data real, do mais novo para o mais antigo; sem data, vai para o fim;
// - dia sempre o do calendário de Brasília; data "sem hora" que veio como meia-noite UTC
//   (T00:00:00Z) é o próprio dia, não o anterior;
// - entrada vazia ou que não é objeto é ignorada (nunca derruba a leitura).
// =====================================================================

const FMT_DIA=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
const CAMPOS_DATA=['data','dataHora','data_hora'];

function diaValido(a,m,d){
  const dt=new Date(Date.UTC(Number(a),Number(m)-1,Number(d)));
  return dt.getUTCFullYear()===Number(a)&&dt.getUTCMonth()===Number(m)-1&&dt.getUTCDate()===Number(d);
}
// Dia de calendário em Brasília de um instante (ms).
function diaEmBrasilia(ms){return Number.isFinite(ms)?FMT_DIA.format(new Date(ms)):null}

// Instante (ms) de um texto de data, para ordenar. Data sem hora vale como meio-dia em Brasília.
function instanteDeTexto(v){
  const s=String(v??'').trim();if(!s)return null;
  let m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ ,T]+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if(m){
    if(!diaValido(m[3],m[2],m[1]))return null;
    const ms=Date.parse(m[3]+'-'+m[2]+'-'+m[1]+'T'+(m[4]||'12')+':'+(m[5]||'00')+':'+(m[6]||'00')+'-03:00');
    return Number.isFinite(ms)?ms:null;
  }
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m){if(!diaValido(m[1],m[2],m[3]))return null;const ms=Date.parse(s+'T12:00:00-03:00');return Number.isFinite(ms)?ms:null}
  if(/^\d{4}-\d{2}-\d{2}T/.test(s)){
    if(/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?Z$/.test(s)){const ms=Date.parse(s.slice(0,10)+'T12:00:00-03:00');return Number.isFinite(ms)?ms:null}
    const ms=Date.parse(s);return Number.isFinite(ms)?ms:null;
  }
  return null;
}
// Dia (aaaa-mm-dd, calendário de Brasília) de um texto de data.
function diaDeTexto(v){
  const s=String(v??'').trim();if(!s)return null;
  let m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if(m)return diaValido(m[3],m[2],m[1])?m[3]+'-'+m[2]+'-'+m[1]:null;
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m)return diaValido(m[1],m[2],m[3])?s:null;
  // Data sem hora guardada como meia-noite UTC: é o próprio dia (não o anterior, em Brasília).
  if(/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?Z$/.test(s))return s.slice(0,10);
  if(/^\d{4}-\d{2}-\d{2}T/.test(s))return diaEmBrasilia(Date.parse(s));
  return null;
}

function valorDeData(a){
  if(!a||typeof a!=='object')return null;
  for(const k of CAMPOS_DATA)if(a[k]!=null&&String(a[k]).trim())return a[k];
  return null;
}
function instanteDoAndamento(a){return instanteDeTexto(valorDeData(a))}
function diaDoAndamento(a){return diaDeTexto(valorDeData(a))}
function dataLegivel(a){const d=diaDoAndamento(a);return d?d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4):null}
function textoDoAndamento(a){
  if(!a||typeof a!=='object')return'';
  return String(a.txt??a.texto??a.descricao??a.andamento??'').replace(/\s+/g,' ').trim();
}

// Lista do campo andamentos (array, ou JSON de array guardado como texto).
function listaDeAndamentos(valor){
  let v=valor;
  if(typeof v==='string'){try{v=JSON.parse(v)}catch{return[]}}
  return Array.isArray(v)?v.filter(a=>a&&typeof a==='object'):[];
}
// Do mais novo para o mais antigo. Sem data: no fim.
// Mesma data (anotações do mesmo dia, sem hora): fica a ordem gravada. A convenção do LEX é
// pôr o andamento novo NO INÍCIO (unshift), e a lista já ordenada também começa pelo mais novo;
// manter a ordem nos empates faz a reordenação ser estável — ordenar duas vezes dá o mesmo.
function ordenarAndamentos(valor){
  return listaDeAndamentos(valor).map((a,i)=>({a,i,t:instanteDoAndamento(a)}))
    .sort((x,y)=>{
      if(x.t==null&&y.t==null)return x.i-y.i;
      if(x.t==null)return 1;
      if(y.t==null)return -1;
      return (y.t-x.t)||(x.i-y.i);
    }).map(x=>x.a);
}
function ultimosAndamentos(processo,n=5){return ordenarAndamentos(processo?.andamentos).slice(0,Math.max(0,n))}
function ultimoAndamento(processo){return ultimosAndamentos(processo,1)[0]||null}
// O mais novo que já aconteceu: dia (Brasília) até `hoje` (aaaa-mm-dd). Anotação com data futura
// (audiência marcada, data digitada errada) não conta como último movimento nem zera "dias parado".
function ultimoAndamentoAte(processo,hoje){
  const limite=String(hoje||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(limite))return null;
  return ordenarAndamentos(processo?.andamentos).find(a=>{const d=diaDoAndamento(a);return !!d&&d<=limite})||null;
}

module.exports={ordenarAndamentos,ultimosAndamentos,ultimoAndamento,ultimoAndamentoAte,listaDeAndamentos,instanteDoAndamento,diaDoAndamento,
  dataLegivel,textoDoAndamento,diaDeTexto,instanteDeTexto,diaEmBrasilia};
