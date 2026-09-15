'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {excellenceFor}=require('../lib/agent-excellence');const {playbookFor}=require('../lib/agent-playbooks');
test('cadastro exige lista exata e gate',()=>{const s=excellenceFor('', 'cadastro');assert.match(s,/Liste exatamente o que falta/);assert.match(s,/Document Gate/)});
test('prazos nunca viram verdade fatal sem humano',()=>{const s=excellenceFor('', 'prazos');assert.match(s,/Prazo calculado por IA e sugestao/);assert.match(s,/confirmacao humana/);assert.match(s,/silencio nunca significa tudo certo/)});
test('pericia exige fonte e humano',()=>{const s=playbookFor('pericia','pericia');assert.match(s,/documento\/pagina\/campo/);assert.match(s,/Especialista humano valida/);assert.match(s,/MEMORIAL DE CALCULO/)});
test('jurisprudencia nao confirmada fica explicita',()=>{const s=playbookFor('analise','revisao');assert.match(s,/Jurisprudência não confirmada/);assert.match(s,/Nunca complete numero, relator, data ou ementa/)});
test('regra de ouro vale para qualquer agente',()=>{for(const x of [['peticao','pecas'],['analise','processos'],['quesitos','pericia'],['','recepcao']]){const s=playbookFor(...x);assert.match(s,/a maquina avisa; o humano decide; a maquina nunca cala/i);assert.match(s,/payload\/versao exatos/)}});
