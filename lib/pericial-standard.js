'use strict';

function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}
function hasAny(text,patterns){const t=norm(text);return patterns.some(p=>t.includes(p));}
function sectionChecks(text){
  const t=norm(text);
  const checks={
    resumo_executivo:/resumo executivo/.test(t),
    objeto_quesitos:/objeto/.test(t)&&/quesit/.test(t),
    documentos_analisados:/documentos analisad/.test(t)||/documentacao analisad/.test(t),
    metodologia:/metodolog/.test(t),
    analise_tecnica:/analise tecnica/.test(t)||/desenvolvimento tecnico/.test(t),
    memorial_calculo:/memorial de calculo/.test(t)||/memoria de calculo/.test(t),
    respostas_quesitos:/respostas? aos quesitos/.test(t)||/quesito\s*1/.test(t),
    conclusao:/conclusao/.test(t),
    anexos:/anexos?/.test(t)
  };
  return checks;
}
function memorialChecks(text){
  const t=norm(text);
  return {
    fontes:/fontes?\b|documentos?\b|folhas?\b|\bids?\b/.test(t),
    criterios:/(criterio|criterios|indice|indices|taxa|taxas|marco temporal|base de correcao)/.test(t),
    metodologia:/(formula|formulas|ordem das operacoes|passo a passo|metodologia)/.test(t),
    consistencia:/(prova de consistencia|provas de consistencia|conferencia|batimento|teste de fechamento)/.test(t)
  };
}
function sourceIds(text){return [...new Set((String(text||'').match(/\b[DAC]\d+\b/g)||[]))];}
function monetaryClaims(text){return (String(text||'').match(/R\$\s*[\d.]+,\d{2}/g)||[]);}
function validatePericialDeliverable(text,{requireSources=true}={}){
  const body=String(text||'').trim();
  if(body.length<300) return {ok:false,problems:['entrega_muito_curta'],sections:sectionChecks(body),memorial:memorialChecks(body),source_ids:sourceIds(body),monetary_claims:monetaryClaims(body)};
  const sections=sectionChecks(body);
  const memorial=memorialChecks(body);
  const ids=sourceIds(body);
  const money=monetaryClaims(body);
  const problems=[];
  for(const [k,v] of Object.entries(sections)) if(!v) problems.push('secao_'+k+'_ausente');
  for(const [k,v] of Object.entries(memorial)) if(!v) problems.push('memorial_'+k+'_ausente');
  if(requireSources&&ids.length===0) problems.push('fonte_rastreavel_ausente');
  if(money.length&&ids.length===0) problems.push('numero_sem_fonte');
  if(/estimad|aproximad|supost|presum/.test(norm(body))&&money.length) problems.push('valor_estimado_ou_presumido');
  return {ok:problems.length===0,problems,sections,memorial,source_ids:ids,monetary_claims:money};
}
function pericialSystemRules(){
  return [
    'PADRÃO PERICIAL INSTITUCIONAL OBRIGATÓRIO:',
    '1) Nunca invente número, critério, norma ou conclusão. Todo dado deve ser rastreável à fonte do caso por ID.',
    '2) Toda entrega com cálculo deve conter MEMORIAL DE CÁLCULO com: fontes; critérios; metodologia passo a passo e fórmulas; provas de consistência, conferência, batimento ou teste de fechamento.',
    '3) Estruture a entrega com: Resumo Executivo; Objeto e Quesitos; Documentos Analisados; Metodologia; Análise Técnica; Memorial de Cálculo; Respostas aos Quesitos; Conclusão; Anexos.',
    '4) Responda cada quesito objetivamente e de modo verificável por terceiro.',
    '5) Não misture esferas técnicas ou jurídicas e não trate prova a produzir como prova emprestada.',
    '6) Quando houver número sem fonte documental confirmada, escreva [NÃO LIDO] e não calcule.',
    '7) A entrega final deve seguir o padrão Laudo Institucional — Edição Azul na etapa de formatação.'
  ].join('\n');
}
function auditPericialLabel(v){return v?.ok?'[CIÊNCIA] Laudo passou no padrão pericial institucional.':'[ATENÇÃO] Laudo reprovado na validação pericial: '+(v?.problems||[]).join(', ');}
module.exports={norm,sectionChecks,memorialChecks,sourceIds,monetaryClaims,validatePericialDeliverable,pericialSystemRules,auditPericialLabel};
