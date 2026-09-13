'use strict';

const CRITICAL_TYPES = new Set(['extrato','extrato_bancario','holerite','cnis','contrato','rg','cpf','cnh','fgts','trct']);

function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
function confidenceOf(doc){
  const raw=norm(doc?.confianca_extracao||doc?.confianca||doc?.confidence||doc?.meta?.confianca_extracao||doc?.extraido?.confianca_extracao);
  if(['alta','media','baixa'].includes(raw)) return raw;
  return raw ? 'baixa' : 'desconhecida';
}
function typeOf(doc){
  return norm(doc?.tipo_documento||doc?.tipo||doc?.document_type||doc?.meta?.tipo_documento||doc?.extraido?.tipo_documento||doc?.nome);
}
function isCritical(doc){
  const t=typeOf(doc);
  if([...CRITICAL_TYPES].some(x=>t.includes(x))) return true;
  return /extrato|holerite|contracheque|cnis|contrato|identidade|rg\b|cpf\b|cnh\b|fgts|trct/.test(t);
}
function originOf(doc){
  const page=doc?.pagina||doc?.page||doc?.meta?.pagina||doc?.origem?.pagina;
  const date=doc?.data||doc?.date||doc?.meta?.data||doc?.origem?.data;
  const line=doc?.linha||doc?.line||doc?.meta?.linha||doc?.origem?.linha;
  const file=doc?.nome||doc?.arquivo||doc?.filename||doc?.origem?.arquivo||'';
  return {arquivo:file||null,pagina:page??null,data:date??null,linha:line??null};
}
function hasReadableContent(doc){
  const text=doc?.texto||doc?.conteudo||doc?.textoExtraido||doc?.texto_extraido||doc?.extraido?.texto||'';
  if(String(text).trim().length>=20) return true;
  const ex=doc?.extraido;
  if(ex&&typeof ex==='object') return Object.values(ex).some(v=>typeof v==='string'&&v.trim().length>=3);
  return false;
}
function evaluateDocument(doc){
  const confidence=confidenceOf(doc);
  const critical=isCritical(doc);
  const readable=hasReadableContent(doc);
  const origin=originOf(doc);
  const problems=[];
  if(critical&&confidence!=='alta') problems.push('confianca_nao_alta');
  if(critical&&!readable) problems.push('conteudo_nao_lido');
  return {critical,confidence,readable,origin,ok:problems.length===0,problems};
}
function guardPericialDocuments(docs,{requireCritical=true}={}){
  const list=Array.isArray(docs)?docs:[];
  const evaluated=list.map((doc,index)=>({index,nome:doc?.nome||doc?.arquivo||`documento_${index+1}`,...evaluateDocument(doc)}));
  const critical=evaluated.filter(x=>x.critical);
  const blocked=critical.filter(x=>!x.ok);
  if(requireCritical&&critical.length===0){
    return {ok:false,status:'aguardando_documento_nitido',motivo:'Nenhum documento crítico legível foi confirmado para a perícia.',blocked:[],evaluated};
  }
  if(blocked.length){
    return {ok:false,status:'aguardando_documento_nitido',motivo:'Há documento crítico sem leitura de confiança alta. Nenhum cálculo deve ser realizado.',blocked,evaluated};
  }
  return {ok:true,status:'evidencia_confirmada',motivo:'Documentos críticos confirmados com confiança alta.',blocked:[],evaluated};
}
function refusalMessage(){
  return 'Não deu para ler esse documento com segurança. Envie outro arquivo mais nítido, reto e com boa luz, ou o PDF original. Nenhum cálculo foi realizado.';
}
function auditLabel(result){
  if(result?.ok) return '[CIÊNCIA] Evidência pericial confirmada com confiança alta.';
  const names=(result?.blocked||[]).map(x=>x.nome).join(', ');
  return `[ATENÇÃO] Perícia bloqueada — documento não lido com confiança alta${names?': '+names:''}. Nenhum cálculo realizado.`;
}
module.exports={CRITICAL_TYPES,confidenceOf,typeOf,isCritical,originOf,evaluateDocument,guardPericialDocuments,refusalMessage,auditLabel};
