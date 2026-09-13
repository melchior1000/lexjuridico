'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {guardPericialDocuments,refusalMessage,auditLabel}=require('../lib/pericial-evidence');
const {TaskEngine}=require('../lib/task-engine');

function memoryStore(){
  const map=new Map();
  return {
    async change(key,fn){const next=fn(map.get(key));if(next!==undefined)map.set(key,next);return map.get(key);},
    async read(key){return map.has(key)?{value:map.get(key)}:null;},
    async list(prefix){return [...map].filter(([k])=>k.startsWith(prefix)).map(([,v])=>v);}
  };
}

test('extrato com confianca media bloqueia qualquer calculo',()=>{
  const r=guardPericialDocuments([{nome:'extrato-agosto.jpg',tipo_documento:'extrato_bancario',confianca_extracao:'media',texto:'03/08 PIX R$ 500,00 saldo R$ 1.200,00'}]);
  assert.equal(r.ok,false);
  assert.equal(r.status,'aguardando_documento_nitido');
  assert.equal(r.blocked[0].problems.includes('confianca_nao_alta'),true);
  assert.match(refusalMessage(),/Nenhum cálculo foi realizado/i);
  assert.match(auditLabel(r),/Perícia bloqueada/i);
});

test('extrato alta com texto segue para a etapa seguinte',()=>{
  const r=guardPericialDocuments([{nome:'extrato.pdf',tipo_documento:'extrato_bancario',confianca_extracao:'alta',texto:'03/08/2026 PIX recebido R$ 500,00 saldo R$ 1.200,00'}]);
  assert.equal(r.ok,true);
});

test('pericia bloqueada nao chama IA nem calcula quando documento e ilegivel',async()=>{
  let calls=0;
  const process={id:1,nome:'Perícia bancária',numero:'0000001-00.2026.8.13.0001',descricao:'Revisar extratos bancários.',documentos:[{nome:'extrato.jpg',tipo_documento:'extrato_bancario',confianca_extracao:'baixa',texto:'imagem parcial'}],andamentos:[]};
  const engine=new TaskEngine({store:memoryStore(),processes:async()=>[process],ai:async()=>{calls++;throw new Error('nao deveria chamar IA');}});
  const task=await engine.submit({tipo:'pericia',processo_id:1,instrucao:'Calcule os valores do extrato.',request_id:'pericia-baixa'});
  const result=await engine.run(task.id);
  assert.equal(result.status,'aguardando_documento_nitido');
  assert.equal(calls,0);
  assert.match(result.pendencia,/Nenhum cálculo foi realizado/i);
  assert.match(result.aviso_assessor,/ATENÇÃO/i);
});
