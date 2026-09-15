'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {CORE,playbookFor}=require('../lib/agent-playbooks');

test('peticao, pericia e analise sempre recebem o nucleo comum',()=>{
  for(const tipo of ['peticao','pericia','analise']) {
    const playbook=playbookFor(tipo,'recepcao');
    assert.ok(playbook.startsWith(CORE));
  }
});

test('recepcao recebe somente o nucleo comum de excelencia quando nao ha modulo pelo tipo',()=>{
  for(const setor of ['recepcao','Recepção']) {
    const playbook=playbookFor('',setor);
    assert.ok(playbook.startsWith(CORE));
    assert.match(playbook,/REGRA DE OURO: a maquina avisa; o humano decide; a maquina nunca cala/);
    assert.match(playbook,/TRIAGEM DOCUMENTAL/);
    assert.doesNotMatch(playbook,/MODULO: PETICAO|MODULO: PERICIA|MODULO: ANALISE PROFISSIONAL/);
  }
});

test('peticao exige escolha do instrumento correto',()=>{
  const playbook=playbookFor('peticao','pecas');
  assert.match(playbook,/INSTRUMENTO CORRETO PRIMEIRO/);
  assert.match(playbook,/apelacao x agravo x embargos x REsp\/RE x reclamacao/);
});

test('pericia exige memorial de calculo',()=>{
  const playbook=playbookFor('pericia','pericia');
  assert.match(playbook,/MEMORIAL DE CALCULO e obrigatorio/);
  assert.match(playbook,/fontes, criterios, metodologia e provas de consistencia/);
});
