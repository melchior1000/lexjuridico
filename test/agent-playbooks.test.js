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

test('recepcao recebe somente o nucleo quando nao ha modulo pelo tipo',()=>{
  assert.equal(playbookFor('', 'recepcao'),CORE);
  assert.equal(playbookFor('', 'Recepção'),CORE);
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
