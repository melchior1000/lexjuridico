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
  assert.match(p,/FONTE_NAO_CONSULTADA/,'sem consulta registrada, diz que não consultou');
  assert.match(p,/nunca descrever uma busca que nao consta do material/i,'não inventa busca');
  assert.match(p,/CLASSIFICACAO_JSON/,'bloco conferível pelo código');
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

function motor(processo,respostaFinal){
  const {TaskEngine}=require('../lib/task-engine');
  const map=new Map();
  const store={async read(k){return map.has(k)?{value:map.get(k)}:null},async change(k,fn){const next=fn(map.get(k));if(next!==undefined)map.set(k,next);return map.get(k)},async list(){return[...map.values()]}};
  const chamadas=[];
  const ai=async(messages)=>{chamadas.push(messages[0].content);return chamadas.length%2===1?JSON.stringify({cabivel:true,faltantes:[],motivos:''}):respostaFinal(chamadas.at(-1))};
  return{engine:new TaskEngine({store,processes:async()=>[processo],ai}),chamadas};
}
const blocoCompleto=conteudo=>{
  const lista=JSON.parse(conteudo.split('LISTA OBRIGATÓRIA DE CITAÇÕES (extraída pelo LEX; classifique todas):\n')[1].split('\n')[0]);
  const sinais=new Set(lista.sinais.map(s=>s.chave));
  return 'Quadro...\nCLASSIFICACAO_JSON: '+JSON.stringify(lista.citacoes.map(c=>sinais.has(c.chave)?{chave:c.chave,classificacao:'ERRO_OBJETIVO',trecho:c.trecho,uso:'réplica'}:{chave:c.chave,classificacao:'FONTE_NAO_CONSULTADA'}));
};

test('tarefa de auditoria roda no motor: a IA recebe a lista obrigatória e só fica pronta com todas classificadas',async()=>{
  const processo={id:7,nome:'Cliente X x Banco Y',numero:'0703506-31.2024.8.07.0001',documentos:[{nome:'contestacao_banco.pdf',texto:PECA}]};
  const {engine,chamadas}=motor(processo,blocoCompleto);
  const t=await engine.submit({tipo:'auditoria_peca',processo_id:7,instrucao:'ache os erros na contestação da parte contrária',request_id:'r1'});
  const out=await engine.run(t.id);
  assert.equal(out.status,'aguardando_revisao',out.pendencia);
  assert.match(chamadas[1],/LISTA OBRIGATÓRIA DE CITAÇÕES/);
  assert.match(chamadas[1],/art\. 1500 CPC/);
  assert.ok(out.controle_citacoes.total>=11);
  assert.equal(out.controle_citacoes.classificacao.ok,true);
  assert.ok(out.controle_citacoes.sinais.some(s=>/1\.072 artigos/.test(s.motivo)));
});

// CodeRabbit #150: entrega sem classificar cada citação não pode sair como pronta.
test('auditoria sem classificar todas as citações fica incompleta, não pronta',async()=>{
  const processo={id:7,nome:'X',documentos:[{texto:PECA}]};
  const faltando=conteudo=>{const b=blocoCompleto(conteudo);const arr=JSON.parse(b.split('CLASSIFICACAO_JSON: ')[1]);return 'Quadro...\nCLASSIFICACAO_JSON: '+JSON.stringify(arr.slice(1));};
  for(const resposta of [()=>'Quadro de citações ...',faltando]){
    const {engine}=motor(processo,resposta);
    const t=await engine.submit({tipo:'auditoria_peca',processo_id:7,instrucao:'audite a peça da parte contrária',request_id:'r'+Math.random()});
    const out=await engine.run(t.id);
    assert.equal(out.status,'aguardando_dados');
    assert.match(out.pendencia,/Auditoria incompleta/);
    assert.ok(out.resultado,'a entrega fica guardada para o advogado ver');
  }
});

test('erro objetivo apontado pelo LEX tem de ser classificado como ERRO_OBJETIVO',async()=>{
  const processo={id:7,nome:'X',documentos:[{texto:PECA}]};
  const tudoNaoConsultada=conteudo=>{const b=blocoCompleto(conteudo);return b.replace(/ERRO_OBJETIVO/g,'FONTE_NAO_CONSULTADA');};
  const {engine}=motor(processo,tudoNaoConsultada);
  const t=await engine.submit({tipo:'auditoria_peca',processo_id:7,instrucao:'audite a peça da parte contrária',request_id:'r9'});
  const out=await engine.run(t.id);
  assert.equal(out.status,'aguardando_dados');
  assert.match(out.pendencia,/art\. 1500 CPC/);
});

// CodeRabbit #150: citação depois do corte do texto enviado à IA continua na lista.
test('peça longa: a lista cobre o texto inteiro e registra que a IA viu só parte',async()=>{
  const longa='Preâmbulo. '.repeat(4000)+' Conforme o REsp 9.876.543/RJ, o pedido procede.';
  const processo={id:8,nome:'Y',documentos:[{texto:longa}]};
  const {engine,chamadas}=motor(processo,blocoCompleto);
  const t=await engine.submit({tipo:'auditoria_peca',processo_id:8,instrucao:'audite a peça da parte contrária',request_id:'r10'});
  const out=await engine.run(t.id);
  assert.ok(out.controle_citacoes.citacoes.some(c=>c.chave==='REsp 9876543/RJ'),'citação após o corte está na lista');
  assert.equal(out.controle_citacoes.cobertura.texto_ia_parcial,true);
  assert.match(chamadas[1],/texto enviado está cortado/i);
});

test('tarefas que não são auditoria não recebem a lista',async()=>{
  const processo={id:7,nome:'X',documentos:[{texto:PECA}]};
  const {engine,chamadas}=motor(processo,()=>'Análise pronta');
  const t=await engine.submit({tipo:'analise',processo_id:7,instrucao:'analise',request_id:'r2'});
  const out=await engine.run(t.id);
  assert.doesNotMatch(chamadas[1],/LISTA OBRIGATÓRIA/);
  assert.equal(out.controle_citacoes,null);
  assert.equal(out.status,'aguardando_revisao');
});

// CodeRabbit #150: grafias que escapavam.
test('extrai RESP em maiúsculas, artigos no plural e número CNJ sem pontuação',()=>{
  const c=extrairCitacoes('Vide RESP 1.234.567/SP e resp 1.234.567/SP; arts. 341 e 1.500 do CPC; arts. 9º e 10 do CPC; nos autos do processo nº 50000019920268130704.').map(x=>x.tipo+':'+x.chave);
  assert.equal(c.filter(x=>x==='julgado:REsp 1234567/SP').length,1,'uma só, normalizada');
  for(const k of ['artigo:art. 341 CPC','artigo:art. 1500 CPC','artigo:art. 9 CPC','artigo:art. 10 CPC','cnj:5000001-99.2026.8.13.0704'])assert.ok(c.includes(k),'faltou '+k+' em '+JSON.stringify(c));
  assert.ok(auditarCitacoes('processo nº 50000019920268130704').sinais.some(s=>/dígito verificador/.test(s.motivo)));
  assert.deepEqual(extrairCitacoes('código de barras 12345678901234567890 do boleto').filter(x=>x.tipo==='cnj'),[],'20 dígitos sem contexto de processo não viram CNJ');
});

test('"revise a peça da parte contrária" é auditoria, não a revisão comum',()=>{
  assert.equal(tipo('revisar a peça da parte contrária e conferir as citações'),'auditoria_peca');
  assert.equal(parseOfficeCommand('revisar a minuta',{processo_id:'p1'})?.action,'lex_review','revisão comum continua');
});

// CodeRabbit #150 (2ª rodada).
test('intervalo de artigos registra as duas pontas; "nº" sozinho não vira processo',()=>{
  const c=extrairCitacoes('Vide arts. 1.000 a 1.500 do CPC. Nota fiscal nº 12345678901234567890.').map(x=>x.tipo+':'+x.chave);
  assert.ok(c.includes('artigo:art. 1000 CPC')&&c.includes('artigo:art. 1500 CPC'),JSON.stringify(c));
  assert.ok(auditarCitacoes('arts. 1.000 a 1.500 do CPC').sinais.some(s=>s.chave==='art. 1500 CPC'));
  assert.equal(c.filter(x=>x.startsWith('cnj:')).length,0,'nota fiscal não é processo');
  assert.equal(extrairCitacoes('feito 50000019920268130704').filter(x=>x.tipo==='cnj').length,1);
});

test('dois documentos curtos enviados inteiros: cobertura completa',async()=>{
  const processo={id:9,nome:'Z',documentos:[{texto:'Peça A com REsp 1.234.567/SP.'},{texto:'Peça B com Súmula 297 do STJ.'}]};
  const {engine}=motor(processo,blocoCompleto);
  const t=await engine.submit({tipo:'auditoria_peca',processo_id:9,instrucao:'audite a peça da parte contrária',request_id:'r11'});
  const out=await engine.run(t.id);
  assert.equal(out.controle_citacoes.cobertura.texto_ia_parcial,false);
  assert.equal(out.status,'aguardando_revisao',out.pendencia);
});

test('erro objetivo sem trecho literal ou uso na resposta deixa a auditoria incompleta',async()=>{
  const processo={id:7,nome:'X',documentos:[{texto:PECA}]};
  const semTrecho=conteudo=>blocoCompleto(conteudo).replace(/"trecho":"[^"]*",/g,'');
  const {engine}=motor(processo,semTrecho);
  const t=await engine.submit({tipo:'auditoria_peca',processo_id:7,instrucao:'audite a peça da parte contrária',request_id:'r12'});
  const out=await engine.run(t.id);
  assert.equal(out.status,'aguardando_dados');
  assert.match(out.pendencia,/sem trecho literal ou uso/);
});
