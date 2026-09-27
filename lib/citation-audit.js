'use strict';
// Auditoria de citações de uma peça (tarefa 30): extrai TODAS as citações — julgados,
// súmulas, temas, artigos dos códigos, leis e números CNJ — numa lista obrigatória, e
// aponta erros objetivos que não dependem de IA:
//  - artigo além do último artigo do código (ex.: "art. 1.500 do CPC"; o CPC tem 1.072);
//  - número CNJ cujo dígito verificador não confere (número inexistente).
// Não afirma que um julgado é falso: isso exige conferir na fonte oficial.
// validarClassificacao() confere se a entrega da IA classificou cada citação da lista.
const {cnjValid,cnjCheckDigits,formatCnj}=require('./carteira-audit');

// Último artigo de cada código (texto original; artigos acrescidos com letra, ex. 1.071-A,
// não aumentam a numeração principal).
const ULTIMO_ARTIGO=Object.freeze({CPC:1072,CC:2046,CF:250,CDC:119,CTN:218,CLT:922,CPP:811,CP:361});
const NOME_CODIGO=[
  [/^c[óo]digo de processo civil$/i,'CPC'],[/^c[óo]digo civil$/i,'CC'],[/^constitui[çc][ãa]o(?: federal)?$/i,'CF'],
  [/^c[óo]digo de defesa do consumidor$/i,'CDC'],[/^c[óo]digo tribut[áa]rio nacional$/i,'CTN']
];
const num=s=>Number(String(s||'').replace(/\D/g,''));
const milhar=n=>Number(n).toLocaleString('pt-BR');
function codigo(nome){const t=String(nome||'').trim();for(const [rx,sigla] of NOME_CODIGO)if(rx.test(t))return sigla;return t.toUpperCase()}

// Julgados. Siglas longas aceitam qualquer caixa (RESP, resp); as curtas (RE, HC, MS, CC…)
// só na grafia oficial, para não confundir com palavras comuns.
const NUM_JULGADO=String.raw`\s*(?:n[º°o.]\s*)?(\d{1,3}(?:\.\d{3})+|\d{2,7})(?:\s*\/\s*([A-Za-z]{2}))?`;
const PREFIXO=String.raw`(?:(?:AgInt|AgRg|EDcl)\s+n[oa]s?\s+)?`;
const RX_JULGADO_LONGO=new RegExp(String.raw`\b(`+PREFIXO+String.raw`(?:REsp|AREsp|EREsp|ADI|ADPF|ADC))`+NUM_JULGADO,'gi');
const RX_JULGADO_CURTO=new RegExp(String.raw`\b(`+PREFIXO+String.raw`(?:RE|ARE|RMS|RHC|HC|MS|Rcl|CC|AI))`+NUM_JULGADO,'g');
const SIGLA=Object.freeze({agint:'AgInt',agrg:'AgRg',edcl:'EDcl',resp:'REsp',aresp:'AREsp',eresp:'EREsp',adi:'ADI',adpf:'ADPF',adc:'ADC',no:'no',na:'na',nos:'nos',nas:'nas'});
const classe=c=>String(c).trim().split(/\s+/).map(w=>SIGLA[w.toLowerCase()]||w).join(' ');

const RX_SUMULA=/S[úu]mula\s+(Vinculante\s+)?(?:n[º°o.]?\s*)?(\d{1,3})(?:\s+d[oa]\s+(STJ|STF|TST|TSE|TNU|TCU))?/gi;
const RX_TEMA=/\bTema\s+(?:Repetitivo\s+|de Repercuss[ãa]o Geral\s+)?(?:n[º°o.]?\s*)?(\d{1,2}\.\d{3}|\d{1,4})(?:\s+d[oa]\s+(STJ|STF|TST|TNU))?/gi;

// Artigos, no singular, no plural ou em intervalo: "art. 422 do CC", "arts. 341 e 1.500 do CPC",
// "arts. 141, 492 e 1.022 do CPC", "arts. 1.000 a 1.500 do CPC" (registra as duas pontas).
// Número inteiro (nunca só o começo: "art. 12345" é lido como 12345 e acusado).
const NUM_ART=String.raw`(?:\d{1,3}(?:\.\d{3})+|\d+)\s*(?:º|°)?`;
const CODIGOS=String.raw`(CPC|CDC|CTN|CLT|CPP|CC|CF|CP|C[óo]digo de Processo Civil|C[óo]digo de Defesa do Consumidor|C[óo]digo Tribut[áa]rio Nacional|C[óo]digo Civil|Constitui[çc][ãa]o(?: Federal)?)`;
const RX_ARTIGO=new RegExp(String.raw`\bart(?:igo)?s?\.?\s*(`+NUM_ART+String.raw`(?:\s*(?:,|e|a|at[ée])\s*`+NUM_ART+String.raw`)*)[^.;\n]{0,40}?\b(?:do|da)\s+`+CODIGOS+String.raw`\b`,'gi');
const RX_NUM_ART=/\d{1,3}(?:\.\d{3})+|\d+/g;

const RX_LEI=/\bLei\s+(Complementar\s+)?(?:n[º°o.]?\s*)?(\d{1,2}\.\d{3}|\d{3,5})(?:\s*\/\s*(\d{2,4}))?/gi;

// CNJ com máscara, ou 20 dígitos seguidos só quando o texto diz processo, autos, feito ou CNJ
// ("nº" sozinho não basta: nota fiscal, código de barras e protocolo também têm 20 dígitos).
const RX_CNJ=/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g;
const RX_CNJ_SEM_MASCARA=/\b(?:processo|autos|feito|cnj)\s*(?:n[º°o]\.?\s*)?(?:de\s+)?(\d{20})\b/gi;

function extrairCitacoes(texto){
  const t=String(texto||''),vistos=new Set(),out=[];
  const add=(tipo,chave,trecho)=>{const k=tipo+'|'+chave;if(vistos.has(k))return;vistos.add(k);out.push({tipo,chave,trecho:String(trecho).trim().slice(0,160)})};
  for(const rx of [RX_JULGADO_LONGO,RX_JULGADO_CURTO])
    for(const m of t.matchAll(rx))add('julgado',classe(m[1])+' '+num(m[2])+(m[3]?'/'+m[3].toUpperCase():''),m[0]);
  for(const m of t.matchAll(RX_SUMULA))add('sumula',m[1]?'Súmula Vinculante '+Number(m[2]):'Súmula '+Number(m[2])+(m[3]?' '+m[3].toUpperCase():''),m[0]);
  for(const m of t.matchAll(RX_TEMA))add('tema','Tema '+num(m[1])+(m[2]?' '+m[2].toUpperCase():''),m[0]);
  for(const m of t.matchAll(RX_ARTIGO)){
    const sigla=codigo(m[2]);
    for(const n of m[1].match(RX_NUM_ART)||[])add('artigo','art. '+num(n)+' '+sigla,m[0]);
  }
  for(const m of t.matchAll(RX_LEI))add('lei',(m[1]?'LC ':'Lei ')+num(m[2])+(m[3]?'/'+m[3]:''),m[0]);
  for(const m of t.matchAll(RX_CNJ))add('cnj',formatCnj(m[0]),m[0]);
  for(const m of t.matchAll(RX_CNJ_SEM_MASCARA))add('cnj',formatCnj(m[1]),m[0]);
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

// A entrega da IA termina com "CLASSIFICACAO_JSON: [{"chave":..., "classificacao":...}]".
// Sem ele, ou faltando citação, a auditoria fica incompleta. Erro objetivo do LEX tem de
// sair como ERRO_OBJETIVO.
const CLASSES=Object.freeze(['CONFIRMADA','FONTE_NAO_CONSULTADA','NAO_LOCALIZADA','CONTEUDO_DIVERGENTE','FORA_DE_CONTEXTO','ERRO_OBJETIVO']);
// textoAuditado: texto integral da peça; o "trecho" de cada erro objetivo tem de estar nele.
const normTrecho=s=>String(s||'').normalize('NFC').replace(/["“”'‘’]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
function validarClassificacao(resultado,controle,textoAuditado){
  const texto=String(resultado||''),i=texto.lastIndexOf('CLASSIFICACAO_JSON:');
  if(i<0)return{ok:false,motivo:'a entrega não trouxe o bloco CLASSIFICACAO_JSON',faltando:(controle?.citacoes||[]).map(c=>c.chave),invalidas:[],erros_objetivos:[],achados_incompletos:[]};
  const resto=texto.slice(i),a=resto.indexOf('['),b=resto.lastIndexOf(']');
  let lista;
  try{lista=JSON.parse(resto.slice(a,b+1));if(!Array.isArray(lista))throw new Error('não é lista')}
  catch{return{ok:false,motivo:'o bloco CLASSIFICACAO_JSON não é uma lista válida',faltando:(controle?.citacoes||[]).map(c=>c.chave),invalidas:[],erros_objetivos:[],achados_incompletos:[]}}
  const dada=new Map(),itens=new Map();
  for(const item of lista)if(item&&typeof item.chave==='string'){dada.set(item.chave.trim(),String(item.classificacao||'').trim().toUpperCase());itens.set(item.chave.trim(),item);}
  const faltando=[],invalidas=[],erros_objetivos=[],achados_incompletos=[];
  const objetivos=new Set((controle?.sinais||[]).map(s=>s.chave));
  for(const c of controle?.citacoes||[]){
    const cls=dada.get(c.chave);
    if(!cls){faltando.push(c.chave);continue}
    if(!CLASSES.includes(cls)){invalidas.push(c.chave+' ('+cls+')');continue}
    if(objetivos.has(c.chave)){
      if(cls!=='ERRO_OBJETIVO'){erros_objetivos.push(c.chave);continue}
      // Achado do erro objetivo: trecho literal da peça e onde usar na nossa resposta.
      const it=itens.get(c.chave);
      const trecho=normTrecho(it?.trecho);
      const naPeca=textoAuditado==null||(trecho.length>=15&&normTrecho(textoAuditado).includes(trecho));
      if(!trecho||!String(it?.uso||'').trim()||!naPeca)achados_incompletos.push(c.chave);
    }
  }
  const ok=!faltando.length&&!invalidas.length&&!erros_objetivos.length&&!achados_incompletos.length;
  return{ok,motivo:ok?null:'classificação incompleta',faltando,invalidas,erros_objetivos,achados_incompletos};
}

module.exports={extrairCitacoes,auditarCitacoes,validarClassificacao,CLASSES,ULTIMO_ARTIGO};
