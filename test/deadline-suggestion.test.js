'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../lib/deadline-suggestion');

test('extrai prazo explícito de 5 dias úteis sem inventar outro',()=>{
  const c=S.explicitDeadlineCandidates('Intime-se a parte para manifestar-se no prazo de 5 dias úteis.');
  assert.equal(c.length,1);assert.equal(c[0].dias,5);assert.equal(c[0].modo,'uteis');
});

test('IA só pode escolher candidato que veio do texto',async()=>{
  const out=await S.buildDeadlineSuggestion({
    communication:{texto:'Manifeste-se no prazo de 5 dias úteis.',tribunal:'TJMG',data_disponibilizacao:'2026-09-21'},
    aiAnalyze:async()=>({candidate_index:0,regime:'cpc',confidence:.98,trecho:'Manifeste-se no prazo de 5 dias úteis.'}),
    calendarioVerificado:true
  });
  assert.equal(out.status,'proposta_calculada');
  assert.equal(out.dias,5);assert.equal(out.regime,'cpc');assert.equal(out.due_at_proposto,'2026-09-29');
  assert.equal(out.legal_truth,false);
});

test('resposta da IA com trecho inexistente é rejeitada',async()=>{
  const out=await S.buildDeadlineSuggestion({
    communication:{texto:'Manifeste-se no prazo de 5 dias.',data_disponibilizacao:'2026-09-21'},
    aiAnalyze:async()=>({candidate_index:0,regime:'cpc',confidence:.9,trecho:'prazo de 15 dias'})
  });
  assert.equal(out.status,'ia_sem_ancora');assert.equal(out.due_at_proposto,undefined);
});

test('prazo corrido não é passado ao calendário de dias úteis',async()=>{
  const out=await S.buildDeadlineSuggestion({
    communication:{texto:'Cumpra-se no prazo de 10 dias corridos.',data_disponibilizacao:'2026-09-21'},
    aiAnalyze:async()=>({candidate_index:0,regime:'cpc',confidence:.9,trecho:'Cumpra-se no prazo de 10 dias corridos.'})
  });
  assert.equal(out.modo,'corridos');assert.equal(out.due_at_proposto,null);assert.equal(out.legal_truth,false);
});

test('múltiplos prazos sem escolha segura permanecem ambíguos',async()=>{
  const out=await S.buildDeadlineSuggestion({
    communication:{texto:'Contestação em 15 dias. Documento complementar no prazo de 5 dias.'},
    aiAnalyze:async()=>({candidate_index:null,regime:'cpc',confidence:.4})
  });
  assert.equal(out.status,'ambigua');assert.equal(out.legal_truth,false);
});
