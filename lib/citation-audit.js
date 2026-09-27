'use strict';
// Auditoria de citações de uma peça (tarefa 30): extrai TODAS as citações — julgados,
// súmulas, temas, artigos dos códigos, leis e números CNJ — numa lista obrigatória, e
// aponta erros objetivos que não dependem de IA:
//  - artigo além do último artigo do código (ex.: "art. 1.500 do CPC"; o CPC tem 1.072);
//  - número CNJ cujo dígito verificador não confere (número inexistente).
// Não afirma que um julgado é falso: isso exige conferir na fonte oficial.
const {cnjValid,cnjCheckDigits,formatCnj}=require('./carteira-audit');

// Último artigo de cada código (texto original; artigos acrescidos com letra, ex. 1.071-A,
// não aumentam a numeração principal).
const ULTIMO_ARTIGO=Object.freeze({CPC:1072,CC:2046,CF:250,CDC:119,CTN:218,CLT:922,CPP:811,CP:361});
const NOME_CODIGO=[
  [/^c[óo]digo de processo civil$/i,'CPC'],[/^c[óo]digo civil$/i,'CC'],[/^constitui[çc][ãa]o(?: federal)?$/i,'CF'],
  [/^c[óo]digo de defesa do consumidor$/i,'CDC'],[/^c[óo]digo tribut[áa]rio nacional$/i,'CTN']
];
const num=s=>Number(String(s||'').replace(/\./g,''));
const milhar=n=>Number(n).toLocaleString('pt-BR');
function codigo(nome){const t=String(nome||'').trim();for(const [rx,sigla] of NOME_CODIGO)if(rx.test(t))return sigla;return t.toUpperCase()}

const RX_JULGADO=/\b((?:(?:AgInt|AgRg|EDcl)\s+n[oa]s?\s+)?(?:REsp|AREsp|EREsp|RE|ARE|RMS|RHC|HC|MS|Rcl|CC|ADI|ADPF|ADC|AI))\s*(?:n[º°o.]\s*)?(\d{1,3}(?:\.\d{3})+|\d{2,7})(?:\s*\/\s*([A-Z]{2}))?/g;
const RX_SUMULA=/S[úu]mula\s+(Vinculante\s+)?(?:n[º°o.]?\s*)?(\d{1,3})(?:\s+d[oa]\s+(STJ|STF|TST|TSE|TNU|TCU))?/gi;
const RX_TEMA=/\bTema\s+(?:Repetitivo\s+|de Repercuss[ãa]o Geral\s+)?(?:n[º°o.]?\s*)?(\d{1,2}\.\d{3}|\d{1,4})(?:\s+d[oa]\s+(STJ|STF|TST|TNU))?/gi;
const RX_ARTIGO=/\bart(?:igo)?s?\.?\s*(\d{1,2}\.\d{3}|\d{1,4})\s*(?:º|°)?[^.;\n]{0,40}?\b(?:do|da)\s+(CPC|CDC|CTN|CLT|CPP|CC|CF|CP|C[óo]digo de Processo Civil|C[óo]digo de Defesa do Consumidor|C[óo]digo Tribut[áa]rio Nacional|C[óo]digo Civil|Constitui[çc][ãa]o(?: Federal)?)\b/gi;
const RX_LEI=/\bLei\s+(Complementar\s+)?(?:n[º°o.]?\s*)?(\d{1,2}\.\d{3}|\d{3,5})(?:\s*\/\s*(\d{2,4}))?/gi;
const RX_CNJ=/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g;

function extrairCitacoes(texto){
  const t=String(texto||''),vistos=new Set(),out=[];
  const add=(tipo,chave,trecho)=>{const k=tipo+'|'+chave;if(vistos.has(k))return;vistos.add(k);out.push({tipo,chave,trecho:String(trecho).trim().slice(0,160)})};
  for(const m of t.matchAll(RX_JULGADO))add('julgado',m[1].replace(/\s+/g,' ')+' '+num(m[2])+(m[3]?'/'+m[3]:''),m[0]);
  for(const m of t.matchAll(RX_SUMULA))add('sumula',m[1]?'Súmula Vinculante '+Number(m[2]):'Súmula '+Number(m[2])+(m[3]?' '+m[3].toUpperCase():''),m[0]);
  for(const m of t.matchAll(RX_TEMA))add('tema','Tema '+num(m[1])+(m[2]?' '+m[2].toUpperCase():''),m[0]);
  for(const m of t.matchAll(RX_ARTIGO))add('artigo','art. '+num(m[1])+' '+codigo(m[2]),m[0]);
  for(const m of t.matchAll(RX_LEI))add('lei',(m[1]?'LC ':'Lei ')+num(m[2])+(m[3]?'/'+m[3]:''),m[0]);
  for(const m of t.matchAll(RX_CNJ))add('cnj',formatCnj(m[0]),m[0]);
  return out;
}

function auditarCitacoes(texto){
  const citacoes=extrairCitacoes(texto),sinais=[];
  for(const c of citacoes){
    if(c.tipo==='artigo'){
      const [,n,sigla]=c.chave.match(/^art\. (\d+) (\w+)$/)||[];
      const max=ULTIMO_ARTIGO[sigla];
      if(max&&Number(n)>max)sinais.push({chave:c.chave,motivo:'artigo inexistente: o '+sigla+' tem '+milhar(max)+' artigos',trecho:c.trecho});
    }
    if(c.tipo==='cnj'&&!cnjValid(c.chave))
      sinais.push({chave:c.chave,motivo:'número inexistente: o dígito verificador não confere (deveria ser '+cnjCheckDigits(c.chave)+')',trecho:c.trecho});
  }
  return{citacoes,sinais,total:citacoes.length};
}

module.exports={extrairCitacoes,auditarCitacoes,ULTIMO_ARTIGO};
