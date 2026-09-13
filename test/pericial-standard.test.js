'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validatePericialDeliverable,pericialSystemRules}=require('../lib/pericial-standard');

const base=`
I. RESUMO EXECUTIVO
Conclusão técnica baseada exclusivamente nas fontes D1 e D2.
II. OBJETO E QUESITOS
Objeto da perícia e quesitos apresentados.
III. DOCUMENTOS ANALISADOS
D1 — Extrato bancário, página 2. D2 — Contrato, página 5.
IV. METODOLOGIA
Critério: taxa contratual indicada em D2. Metodologia passo a passo e fórmula aplicada.
V. ANÁLISE TÉCNICA
Desenvolvimento técnico dos dados confirmados.
VI. MEMORIAL DE CÁLCULO
Fontes: D1 e D2. Critérios: taxa, marco temporal e base de correção. Fórmula e ordem das operações. Prova de consistência: conferência, batimento e teste de fechamento.
VII. RESPOSTAS AOS QUESITOS
Quesito 1: resposta objetiva e verificável.
VIII. CONCLUSÃO
Conclusão falseável e limitada aos documentos.
IX. ANEXOS
Quadros de apoio e batimentos.
`;

test('laudo completo passa no padrão institucional',()=>{
  const r=validatePericialDeliverable(base);
  assert.equal(r.ok,true);
  assert.deepEqual(r.problems,[]);
  assert.deepEqual(r.source_ids.sort(),['D1','D2']);
});

test('sem memorial completo não pode ficar pronto',()=>{
  const r=validatePericialDeliverable(base.replace(/VI\. MEMORIAL DE CÁLCULO[\s\S]*?VII\./,'VI. MEMORIAL DE CÁLCULO\nCálculo realizado.\nVII.'));
  assert.equal(r.ok,false);
  assert.equal(r.problems.some(x=>x.startsWith('memorial_')),true);
});

test('valor sem fonte rastreável é bloqueado',()=>{
  const semFonte=base.replace(/D1|D2/g,'documento').replace('Conclusão técnica baseada exclusivamente nas fontes documento e documento.','Conclusão técnica.').replace('Desenvolvimento técnico dos dados confirmados.','Desenvolvimento técnico: R$ 12.345,67.');
  const r=validatePericialDeliverable(semFonte);
  assert.equal(r.ok,false);
  assert.equal(r.problems.includes('fonte_rastreavel_ausente'),true);
  assert.equal(r.problems.includes('numero_sem_fonte'),true);
});

test('prompt institucional exige memorial e não invenção',()=>{
  const s=pericialSystemRules();
  assert.match(s,/Nunca invente/i);
  assert.match(s,/MEMORIAL DE CÁLCULO/i);
  assert.match(s,/provas de consistência/i);
  assert.match(s,/\[NÃO LIDO\]/i);
});
