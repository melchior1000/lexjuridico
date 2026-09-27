'use strict';
// Tarefa 31 (27/09/2026): analisar a sentença/decisão que julgou contra o escritório —
// erros, omissões, nulidades e caminho de reforma — como tarefa real do LEX.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {parseOfficeCommand}=require('../lib/office-command');
const {TYPES}=require('../lib/task-engine');
const {playbookFor}=require('../lib/agent-playbooks');

const tipo=frase=>parseOfficeCommand(frase,{processo_id:'p1'})?.tipo;

test('ordens naturais sobre decisão contra nós viram a tarefa de decisão adversa',()=>{
  for(const frase of [
    'analise a sentença que perdemos no processo da Eliane',
    'ache os erros da decisão contra nós',
    'quero as falhas da sentença desfavorável',
    'disseque o acórdão que julgou contra o cliente',
    'procure nulidades na sentença',
    'faça embargos de declaração da sentença',
    'ataque a decisão do juiz'
  ])assert.equal(tipo(frase),'decisao_adversa',frase);
});

test('ordens que já existiam continuam iguais',()=>{
  assert.equal(tipo('faça o recurso'),'recurso');
  assert.equal(tipo('faça a apelação'),'recurso');
  assert.equal(tipo('faça a contestação desse processo'),'contestacao');
  assert.equal(tipo('analise esse processo'),'analise');
  assert.equal(tipo('faça os quesitos'),'quesitos');
});

test('tarefa existe no motor com o agente jurídico e na lista de ferramentas do LEX',()=>{
  assert.equal(TYPES.decisao_adversa,'Jurídico judicial');
  const tools=fs.readFileSync(path.join(__dirname,'..','lib','lex-tools.js'),'utf8');
  assert.match(tools,/TASK_TYPES=\[[^\]]*'decisao_adversa'/);
  const routes=fs.readFileSync(path.join(__dirname,'..','lib','office-routes.js'),'utf8');
  assert.match(routes,/decisao_adversa:'Análise de decisão desfavorável'/,'nome na pausa sem crédito');
});

test('roteiro da decisão adversa: vícios, fundamentação, precedentes, instrumento e minuta completa',()=>{
  const p=playbookFor('decisao_adversa');
  assert.match(p,/MODULO: DECISAO ADVERSA/);
  assert.match(p,/NUNCA fabricar jurisprudencia/,'regra central do LEX continua valendo');
  assert.match(p,/art\. 1\.022/);        // omissão, contradição, obscuridade, erro material
  assert.match(p,/art\. 489, par\. 1/);  // fundamentação deficiente
  assert.match(p,/art\. 93, IX/);        // CF
  assert.match(p,/art\. 927/);           // precedentes obrigatórios
  assert.match(p,/arts?\. 9 e 10/);      // decisão surpresa
  assert.match(p,/arts\. 141 e 492/);    // extra/ultra/citra petita
  assert.match(p,/art\. 1\.025/);        // prequestionamento ficto
  assert.match(p,/cerceamento de defesa/i);
  assert.match(p,/Lei 9\.099/,'rito dos Juizados tem prazos próprios');
  assert.match(p,/PRAZO NAO NASCE AQUI/,'prazo vem do LEX com fonte, não da IA');
  assert.match(p,/MINUTA COMPLETA/,'entrega a peça inteira, não trechos');
  assert.match(p,/trecho literal/i,'cada erro aponta o trecho da decisão');
});
