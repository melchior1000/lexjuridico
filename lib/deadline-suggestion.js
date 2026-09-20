'use strict';
const Calendar=require('./forensic-calendar');

function cleanText(value){return String(value||'').replace(/\s+/g,' ').trim()}
function excerpt(text,start,end,window=120){const a=Math.max(0,start-window),b=Math.min(text.length,end+window);return cleanText(text.slice(a,b))}
function explicitDeadlineCandidates(text){
  const raw=String(text||''),out=[],seen=new Set();
  const patterns=[
    /\b(?:no\s+)?prazo\s+(?:legal\s+)?(?:de\s+)?(\d{1,3})\s+dias?\s*(uteis|úteis|corridos|consecutivos)?\b/giu,
    /\b(?:manifest(?:e-se|ar-se)?|responda|conteste|recorra|apresente|cumpra|emende|regularize)\b[\s\S]{0,80}?\b(?:em|no\s+prazo\s+de)\s+(\d{1,3})\s+dias?\s*(uteis|úteis|corridos|consecutivos)?\b/giu
  ];
  for(const re of patterns){
    let m;
    while((m=re.exec(raw))){
      const dias=Number(m[1]);if(!Number.isInteger(dias)||dias<1||dias>365)continue;
      const qualifier=String(m[2]||'').toLowerCase();
      const modo=/corridos|consecutivos/.test(qualifier)?'corridos':/uteis|úteis/.test(qualifier)?'uteis':'nao_informado';
      const key=dias+'|'+modo+'|'+m.index;
      if(seen.has(key))continue;seen.add(key);
      out.push({index:out.length,dias,modo,trecho:excerpt(raw,m.index,m.index+m[0].length)});
    }
  }
  return out.slice(0,12);
}
function defaultRegime(communication={}){
  const tribunal=String(communication.tribunal||'').toUpperCase();
  if(/^TRT\b|TRABALH/.test(tribunal))return'clt';
  return'unknown';
}
function parseAiJson(raw){
  const text=String(raw||'').trim();
  const match=text.match(/\{[\s\S]*\}/);
  if(!match)throw new Error('IA não devolveu JSON de prazo.');
  const data=JSON.parse(match[0]);
  return data&&typeof data==='object'?data:{};
}
async function chooseCandidateWithAi({text,candidates,communication,aiAnalyze}={}){
  if(!candidates.length)return{status:'sem_prazo_explicito',candidate:null,regime:'unknown',confidence:1};
  if(typeof aiAnalyze!=='function'){
    return{status:'candidato_sem_ia',candidate:candidates.length===1?candidates[0]:null,regime:defaultRegime(communication),confidence:0};
  }
  const payload=await aiAnalyze({
    text:cleanText(text).slice(0,18000),
    candidates:candidates.map(c=>({index:c.index,dias:c.dias,modo:c.modo,trecho:c.trecho})),
    tribunal:communication?.tribunal||null,
    tipo:communication?.tipo||null
  });
  const parsed=typeof payload==='string'?parseAiJson(payload):payload;
  const idx=Number(parsed?.candidate_index);
  if(!Number.isInteger(idx)||idx<0||idx>=candidates.length)return{status:'ambigua',candidate:null,regime:'unknown',confidence:Number(parsed?.confidence)||0};
  const candidate=candidates[idx];
  const regime=['cpc','clt'].includes(String(parsed?.regime||'').toLowerCase())?String(parsed.regime).toLowerCase():defaultRegime(communication);
  const confidence=Math.max(0,Math.min(1,Number(parsed?.confidence)||0));
  const cited=cleanText(parsed?.trecho||'');
  if(cited&&!cleanText(text).includes(cited))return{status:'ia_sem_ancora',candidate:null,regime:'unknown',confidence};
  return{status:'selecionado',candidate,regime,confidence,justificativa:cleanText(parsed?.justificativa||'').slice(0,800)};
}
async function buildDeadlineSuggestion({communication,aiAnalyze,feriados=[],calendarioVerificado=false}={}){
  const text=cleanText(communication?.texto);
  if(!text)return{status:'sem_texto',legal_truth:false};
  const candidates=explicitDeadlineCandidates(text);
  const chosen=await chooseCandidateWithAi({text,candidates,communication,aiAnalyze});
  if(!chosen.candidate)return{...chosen,legal_truth:false,candidates};
  const c=chosen.candidate;
  let proposta=null,calendarError=null;
  if(c.modo!=='corridos'&&['cpc','clt'].includes(chosen.regime)&&communication?.data_disponibilizacao){
    try{
      proposta=Calendar.proposeDjenDeadline({
        regime:chosen.regime,dias:c.dias,data_disponibilizacao:communication.data_disponibilizacao,
        feriados,calendario_verificado:calendarioVerificado===true
      });
    }catch(error){calendarError=error.message}
  }
  return{
    status:proposta?'proposta_calculada':chosen.status,
    legal_truth:false,dias:c.dias,modo:c.modo,regime:chosen.regime,confidence:chosen.confidence,
    trecho:c.trecho,justificativa:chosen.justificativa||null,
    due_at_proposto:proposta?.due_at_proposto||null,
    data_publicacao_proposta:proposta?.data_publicacao||null,
    termo_inicial_proposto:proposta?.termo_inicial||null,
    calendario_verificado:proposta?.calendario_verificado===true,
    avisos:proposta?.warnings||[],
    calendar_error:calendarError,
    candidates
  };
}
module.exports={cleanText,explicitDeadlineCandidates,defaultRegime,parseAiJson,chooseCandidateWithAi,buildDeadlineSuggestion};
