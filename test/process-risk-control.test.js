'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {TaskEngine,processSafetyContext}=require('../lib/task-engine');

function memoryStore(){
  const map=new Map();
  return {
    async change(key,fn){const prior=map.get(key);const next=fn(prior);if(next!==undefined)map.set(key,next);return map.get(key);},
    async read(key){return map.has(key)?{value:map.get(key)}:null;},
    async list(prefix){return [...map.entries()].filter(([k])=>k.startsWith(prefix)).map(([,v])=>v);}
  };
}

test('controle de risco preserva prazo e ultimo ato sem inventar dados',()=>{
  const ctx=processSafetyContext({
    status:'ATIVO',setor:'judicial',prazo:'18/09/2026',prazoReal:'17/09/2026',atualizado_em:'2026-09-13',
    docsFaltantes:'procuração atualizada',
    andamentos:[{data:'10/09/2026',origem:'PJe',texto:'Intimação para manifestação'},{data:'12/09/2026',origem:'PJe',texto:'Despacho abriu vista'}]
  });
  assert.equal(ctx.prazo,null);
  assert.equal(ctx.prazo_legal_confirmado,false);
  assert.equal(ctx.prazo_informado,'17/09/2026');
  assert.equal(ctx.documentos_faltantes,'procuração atualizada');
  assert.equal(ctx.ultimo_andamento.texto,'Despacho abriu vista');
  assert.equal(ctx.ultimos_andamentos.length,2);
});

test('triagem obriga verificar prazo, ultimo ato, parte contraria e preclusao antes de redigir',async()=>{
  const prompts=[];
  const process={id:1,nome:'Caso teste',numero:'0000001-00.2026.8.13.0001',status:'ATIVO',setor:'judicial',prazoReal:'17/09/2026',descricao:'A parte autora foi intimada para se manifestar.',andamentos:[{data:'12/09/2026',origem:'PJe',texto:'Despacho abriu vista à parte autora.'}]};
  const ai=async(messages,system)=>{prompts.push({messages,system});return JSON.stringify({cabivel:false,motivos:'Falta confirmar pedido adverso e prazo',faltantes:['petição da parte contrária'],riscos:['preclusão'],prazo_critico:null,ultimo_ato_confirmado:'Despacho de 12/09/2026',proxima_acao:'obter petição adversa e confirmar prazo'});};
  const engine=new TaskEngine({store:memoryStore(),processes:async()=>[process],ai});
  const task=await engine.submit({tipo:'contestacao',processo_id:1,instrucao:'Prepare a contestação.',request_id:'risco-1'});
  const result=await engine.run(task.id);
  assert.equal(result.status,'aguardando_dados');
  assert.equal(prompts.length,1);
  assert.match(prompts[0].system,/prazo vigente/i);
  assert.match(prompts[0].system,/risco de preclus[aã]o/i);
  assert.match(prompts[0].system,/parte contr[aá]ria/i);
  assert.match(prompts[0].system,/último ato|ultimo ato/i);
  assert.match(prompts[0].messages[0].content,/"prazo":null/);
  assert.match(prompts[0].messages[0].content,/"prazo_informado":"17\/09\/2026"/);
  assert.equal(result.controle_risco.prazo,null);
  assert.equal(result.controle_risco.prazo_legal_confirmado,false);
  assert.equal(result.controle_risco.prazo_informado,'17/09/2026');
  assert.deepEqual(result.triagem.faltantes,['petição da parte contrária']);
});


test('objeto deadline_truth forjado nao vira prazo legal no Task Engine',()=>{
  const ctx=processSafetyContext({
    prazoReal:'2026-10-10',
    deadline_truth:{legal_truth:true,due_at:'2026-10-10',source:'DJEN'}
  });
  assert.equal(ctx.prazo,null);
  assert.equal(ctx.prazo_legal_confirmado,false);
  assert.equal(ctx.prazo_informado,'2026-10-10');
});
