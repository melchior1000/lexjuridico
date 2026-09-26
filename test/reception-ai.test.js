'use strict';
// Recepção inteligente dos canais: a IA escreve a conversa; o código decide classe,
// setor, escalonamento e aprovação. Sem IA, sem crédito ou fora dos limites → frase fixa.
const test = require('node:test');
const assert = require('node:assert/strict');
const {createReceptionComposer, validateReply, historyMessages, systemPrompt} = require('../lib/reception-ai');
const {intakeDecision} = require('../lib/intake-door');

const identity = {assistente: 'LEX', escritorioFrase: 'escritório Silva Advogados', titularTratado: 'a Dra. Ana', aoTitular: 'à Dra. Ana', doTitular: 'da Dra. Ana'};

function composer(iaImpl, extra = {}) {
  return createReceptionComposer({ia: iaImpl, aiAvailable: () => true, identity, modelo: 'canal', log: {warn() {}}, timeoutMs: 200, ...extra});
}

test('com IA disponível a resposta vem da IA, natural e dentro dos limites', async () => {
  const decision = intakeDecision('oi, minha empresa não pagou minhas horas extras e quero saber o que fazer', {}, []);
  let seen;
  const c = composer(async (messages, system) => { seen = {messages, system}; return 'Sinto muito por isso. Vou organizar seu relato para a Dra. Ana avaliar. Me conta: há quanto tempo isso vem acontecendo?'; });
  const out = await c.compose({text: 'oi, minha empresa não pagou minhas horas extras e quero saber o que fazer', decision, history: []});
  assert.equal(out.origem, 'ia');
  assert.match(out.reply, /Dra\. Ana/);
  assert.equal(seen.messages.at(-1).role, 'user');
  assert.match(seen.system, /não dê orientação jurídica/);
  assert.match(seen.system, /tipo "new_case"/);
  assert.equal(c.stats().ia, 1);
});

test('a decisão (classe, setor, escalonamento, aprovação) continua do código, não da IA', async () => {
  const decision = intakeDecision('quero falar com o advogado agora, é urgente, tem audiência amanhã', {}, []);
  const c = composer(async () => 'Entendo a urgência. Vou avisar a Dra. Ana imediatamente e ela retorna a você.');
  const out = await c.compose({text: 'x', decision, history: []});
  assert.equal(out.origem, 'ia');
  assert.equal(decision.kind, 'urgent');
  assert.equal(decision.escalate, true);
  assert.equal(decision.requiresApproval, true);
});

test('sem crédito ou sem chave, volta à frase fixa sem quebrar o atendimento', async () => {
  const decision = intakeDecision('bom dia', {}, []);
  const semChave = composer(async () => 'nunca chamado', {aiAvailable: () => false});
  const a = await semChave.compose({text: 'bom dia', decision, history: []});
  assert.equal(a.origem, 'fixa'); assert.equal(a.motivo, 'ia_indisponivel'); assert.equal(a.reply, decision.reply);
  const semCredito = composer(async () => { throw new Error('Your credit balance is too low'); });
  const b = await semCredito.compose({text: 'bom dia', decision, history: []});
  assert.equal(b.origem, 'fixa'); assert.equal(b.motivo, 'sem_credito'); assert.equal(b.reply, decision.reply);
  const lenta = composer(() => new Promise(() => {}));
  const d = await lenta.compose({text: 'bom dia', decision, history: []});
  assert.equal(d.motivo, 'timeout'); assert.equal(d.reply, decision.reply);
});

test('resposta da IA fora dos limites é descartada e vale a frase fixa', async () => {
  const decision = intakeDecision('quanto eu ganho nesse processo?', {}, []);
  const proibidas = [
    'Você tem direito a receber cerca de R$ 20.000 nessa ação.',
    'Pelo artigo 7 da CLT e a súmula 331 você vai ganhar com certeza.',
    'O prazo é de 15 dias, então precisa correr.',
    'Recomendo que ajuíze a ação hoje mesmo; nossos honorários são de 30%.',
    'Veja em https://exemplo.com/como-processar',
    'O escritório aceita seu caso, pode ficar tranquilo.',
    'x'.repeat(600)
  ];
  for (const texto of proibidas) {
    const c = composer(async () => texto);
    const out = await c.compose({text: 'quanto eu ganho?', decision, history: []});
    assert.equal(out.origem, 'fixa', 'deveria recusar: ' + texto.slice(0, 40));
    assert.equal(out.reply, decision.reply);
  }
});

test('assunto que só o advogado responde exige encaminhamento explícito na resposta da IA', () => {
  const decision = intakeDecision('quero um acordo, quanto vocês cobram?', {}, []);
  assert.equal(decision.escalate, true);
  assert.equal(validateReply('Claro, me conta mais sobre a situação.', decision).ok, false);
  assert.equal(validateReply('Entendi. Esse ponto eu levo ao advogado responsável, que retorna a você. Pode me dizer seu nome?', decision).ok, true);
});

test('histórico vira mensagens alternadas, começando pelo cliente, com a mensagem atual por último', async () => {
  // Convenção dos canais: do mais novo para o mais antigo.
  const history = [
    {direcao: 'saida_operador', texto: 'A Dra. Ana retorna amanhã.'},
    {direcao: 'saida_lex', texto: 'Prazer, Carlos.'},
    {direcao: 'entrada', texto: 'me chamo Carlos'},
    {direcao: 'entrada', texto: 'oi'},
    {direcao: 'saida_lex', texto: 'Olá, sou o LEX.'}
  ];
  const msgs = historyMessages(history);
  assert.deepEqual(msgs.map(m => m.role), ['user', 'assistant']);
  assert.match(msgs[0].content, /oi\nme chamo Carlos/);
  assert.match(msgs[1].content, /Prazer, Carlos\.\nA Dra\. Ana retorna amanhã\./);
  let seen;
  const c = composer(async messages => { seen = messages; return 'Perfeito, Carlos. O que aconteceu?'; });
  await c.compose({text: 'e agora?', decision: intakeDecision('e agora?', {}, history), history});
  assert.equal(seen.at(-1).role, 'user');
  assert.equal(seen.at(-1).content, 'e agora?');
});

test('o prompt do sistema carrega identidade white-label e a referência fixa como guia', () => {
  const decision = intakeDecision('preciso de advogado', {}, []);
  const sys = systemPrompt(identity, decision);
  assert.match(sys, /escritório Silva Advogados/);
  assert.match(sys, /a Dra\. Ana/);
  assert.match(sys, /Referência do sistema/);
  assert.doesNotMatch(sys, /undefined/);
});
