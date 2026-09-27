'use strict';
// Tarefa 30 (27/09/2026): "os advogados estão usando IA" — caçar erros na peça da parte
// contrária. O código extrai TODAS as citações (lista obrigatória) e aponta erros objetivos;
// a IA confere o resto, sem afirmar falsidade sem prova.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {extrairCitacoes,auditarCitacoes}=require('../lib/citation-audit');
const {parseOfficeCommand}=require('../lib/office-command');
const {TYPES}=require('../lib/task-engine');
const {playbookFor}=require('../lib/agent-playbooks');

const PECA=`Conforme o REsp 1.234.567/SP e o AgInt no AREsp 2.345.678/MG, bem como a Súmula 297 do STJ
e a Súmula Vinculante 25, aplica-se o Tema 1.076 do STJ. Nos termos do art. 1.500 do CPC e do
art. 422 do Código Civil, e da Lei nº 8.078/90, veja o processo 0703506-31.2024.8.07.0001 e o
precedente 5000001-99.2026.8.13.0704. Ainda o art. 5º, XXXV, da CF.`;

test('extrai todas as citações da peça, sem repetir',()=>{
  const c=extrairCitacoes(PECA+'\nDe novo o REsp 1.234.567/SP.');
  const textos=c.map(x=>x.tipo+':'+x.chave);
  for(const esperado of ['julgado:REsp 1234567/SP','julgado:AgInt no AREsp 2345678/MG','sumula:Súmula 297 STJ','sumula:Súmula Vinculante 25','tema:Tema 1076 STJ',
    'artigo:art. 1500 CPC','artigo:art. 422 CC','artigo:art. 5 CF','lei:Lei 8078/90','cnj:0703506-31.2024.8.07.0001','cnj:5000001-99.2026.8.13.0704'])
    assert.ok(textos.includes(esperado),'faltou '+esperado+' em '+JSON.stringify(textos));
  assert.equal(textos.filter(t=>t==='julgado:REsp 1234567/SP').length,1,'sem repetição');
});

test('aponta erros objetivos: artigo além do fim do código e número CNJ com dígito que não fecha',()=>{
  const a=auditarCitacoes(PECA);
  const sinais=a.sinais.map(s=>s.chave+' -> '+s.motivo);
  assert.ok(sinais.some(s=>/art\. 1500 CPC -> .*1\.072 artigos/.test(s)),JSON.stringify(sinais));
  assert.ok(sinais.some(s=>/5000001-99\.2026\.8\.13\.0704 -> .*dígito verificador/.test(s)),JSON.stringify(sinais));
  assert.ok(!sinais.some(s=>/0703506-31\.2024\.8\.07\.0001/.test(s)),'número válido não é acusado');
  assert.ok(!sinais.some(s=>/art\. 422 CC/.test(s)),'artigo existente não é acusado');
  assert.equal(a.total,a.citacoes.length);
});

test('texto sem citação devolve lista vazia, sem erro',()=>{
  const a=auditarCitacoes('Excelência, o autor não tem razão.');
  assert.deepEqual(a.citacoes,[]);assert.deepEqual(a.sinais,[]);
});

const tipo=frase=>parseOfficeCommand(frase,{processo_id:'p1'})?.tipo;
test('ordem natural para conferir a peça da parte contrária vira auditoria',()=>{
  for(const frase of [
    'ache os erros na contestação da parte contrária',
    'confira a inicial do advogado contrário',
    'verifique as citações da peça da outra parte',
    'audite o recurso da parte adversa',
    'procure jurisprudência inventada na petição do adversário'
  ])assert.equal(tipo(frase),'auditoria_peca',frase);
});

test('pedido de redigir a nossa peça continua sendo a nossa peça',()=>{
  assert.equal(tipo('faça a contestação apontando os erros da inicial da parte contrária'),'contestacao');
  assert.equal(tipo('prepare o recurso contra a sentença'),'recurso');
  assert.equal(tipo('ache os erros da sentença que perdemos'),'decisao_adversa');
  assert.equal(tipo('faça a contestação'),'contestacao');
});

test('tarefa registrada no motor, nas ferramentas e na pausa sem crédito; roteiro com as travas',()=>{
  assert.equal(TYPES.auditoria_peca,'Jurídico judicial');
  assert.match(fs.readFileSync(path.join(__dirname,'..','lib','lex-tools.js'),'utf8'),/TASK_TYPES=\[[^\]]*'auditoria_peca'/);
  assert.match(fs.readFileSync(path.join(__dirname,'..','lib','office-routes.js'),'utf8'),/auditoria_peca:'Auditoria da peça contrária'/);
  const p=playbookFor('auditoria_peca');
  assert.match(p,/MODULO: AUDITORIA DA PECA CONTRARIA/);
  assert.match(p,/LISTA OBRIGATORIA/);
  assert.match(p,/NAO LOCALIZADA/,'sem prova não chama de falsa');
  assert.match(p,/nunca afirmar que foi inventada sem prova/i);
  assert.match(p,/trecho literal/i);
  assert.match(p,/art\. 80/,'litigância de má-fé só com base concreta');
});

test('motor entrega a lista obrigatória à IA e guarda o controle das citações na tarefa',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','lib','task-engine.js'),'utf8');
  assert.match(src,/task\.tipo==='auditoria_peca'/);
  assert.match(src,/auditarCitacoes\(/);
  assert.match(src,/LISTA OBRIGATÓRIA DE CITAÇÕES/);
  assert.match(src,/controle_citacoes/);
});

test('tarefa de auditoria roda no motor: a IA recebe a lista obrigatória e a tarefa guarda o controle',async()=>{
  const {TaskEngine}=require('../lib/task-engine');
  const map=new Map();
  const store={async read(k){return map.has(k)?{value:map.get(k)}:null},async change(k,fn){const next=fn(map.get(k));if(next!==undefined)map.set(k,next);return map.get(k)},async list(){return[...map.values()]}};
  const processo={id:7,nome:'Cliente X x Banco Y',numero:'0703506-31.2024.8.07.0001',documentos:[{nome:'contestacao_banco.pdf',texto:PECA}]};
  const chamadas=[];
  const ai=async(messages)=>{chamadas.push(messages[0].content);return chamadas.length===1?JSON.stringify({cabivel:true,faltantes:[],motivos:''}):'Quadro de citações ...'};
  const engine=new TaskEngine({store,processes:async()=>[processo],ai});
  const t=await engine.submit({tipo:'auditoria_peca',processo_id:7,instrucao:'ache os erros na contestação da parte contrária',request_id:'r1'});
  const out=await engine.run(t.id);
  assert.equal(out.status,'aguardando_revisao');
  assert.match(chamadas[1],/LISTA OBRIGATÓRIA DE CITAÇÕES/);
  assert.match(chamadas[1],/art\. 1500 CPC/);
  assert.ok(out.controle_citacoes.total>=11);
  assert.ok(out.controle_citacoes.sinais.some(s=>/1\.072 artigos/.test(s.motivo)));
  // Outras tarefas não recebem a lista.
  const t2=await engine.submit({tipo:'analise',processo_id:7,instrucao:'analise',request_id:'r2'});
  chamadas.length=0;
  const out2=await engine.run(t2.id);
  assert.doesNotMatch(chamadas[1],/LISTA OBRIGATÓRIA/);
  assert.equal(out2.controle_citacoes,null);
});
