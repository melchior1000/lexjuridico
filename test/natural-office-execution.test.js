'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {executeNaturalOfficeCommand}=require('../lib/office-routes');
const agent=require('../lex_agente_vivo');
const Pipeline=require('../lib/office-pipeline');

function processStore(initial){
  let rows=structuredClone(initial),version=1;
  return{
    async read(){return{processes:structuredClone(rows),version}},
    async mutate(fn){const draft=structuredClone(rows),value=fn(draft);rows=draft;version++;return{value:structuredClone(value),processes:structuredClone(rows),version}},
    snapshot(){return structuredClone(rows)}
  };
}
function fakeEngine(){
  const submitted=[];
  return{
    submitted,
    async submit(input,actor){const task={id:'a'.repeat(32),...input,agente:input.tipo==='contestacao'?'Redação':'Jurídico judicial',status:'na_fila',ator:actor};submitted.push(task);return task},
    async run(id){const task=submitted.find(x=>x.id===id);return{...task,status:'aguardando_revisao',processo_id:task.processo_id,processo_nome:'Caso Alfa',resultado:'MINUTA',sha256:'hash',pendencia:'Minuta pronta para revisão.'}},
    async list(){return submitted}
  };
}

test('Core resolve processo pela ordem, cria tarefa real e sincroniza Pipeline',async()=>{
  const numero='5001234-56.2026.8.13.0704';
  const db=processStore([{id:'p1',nome:'Caso Alfa',numero,office_stage:'processos',status:'ATIVO'}]);
  const engine=fakeEngine();
  const out=await executeNaturalOfficeCommand({processStore:db,engine,log:()=>{}},{
    text:'Faça a contestação do processo '+numero,profile:'admin',request_id:'ordem-1'
  });
  assert.equal(out.handled,true);
  assert.equal(out.command.action,'task');
  assert.equal(engine.submitted.length,1);
  assert.equal(engine.submitted[0].processo_id,'p1');
  assert.equal(out.result.status,'aguardando_revisao');
  assert.equal(Pipeline.stageOf(db.snapshot()[0]),'revisao');
  assert.match(out.message,/Minuta pronta para revisão/i);
});

test('Core não escolhe processo quando a ordem é ambígua',async()=>{
  const db=processStore([
    {id:'p1',nome:'Caso Alfa',cliente:'Cliente Igual',office_stage:'processos'},
    {id:'p2',nome:'Caso Beta',cliente:'Cliente Igual',office_stage:'processos'}
  ]);
  const engine=fakeEngine();
  const out=await executeNaturalOfficeCommand({processStore:db,engine},{
    text:'Faça a contestação do Cliente Igual',profile:'admin',request_id:'ordem-2'
  });
  assert.equal(out.handled,true);
  assert.equal(out.needs_input,true);
  assert.equal(engine.submitted.length,0);
  assert.match(out.message,/mais de um caso|número completo/i);
});

test('LEX identifica contato único, usa canal correto e só registra saída confirmada',async()=>{
  const events=[],sent=[];
  const receptionStore={
    async list(){return[{numero:'5561999999999',nome:'Leidyanny',status:'aguardando_advogado',classe:'geral',ultima_mensagem:'Oi'}]},
    async appendEvent(event){events.push(event)}
  };
  const records={async list(){return[]}};
  const channelDelivery=async payload=>{sent.push(payload);return true};
  const deps={processStore:processStore([]),engine:fakeEngine(),receptionStore,records,channelDelivery};
  const out=await executeNaturalOfficeCommand(deps,{text:'Responda a Leidyanny: Amanhã eu te retorno.',profile:'admin'});
  assert.equal(out.handled,true);
  assert.equal(out.result.enviado,true);
  assert.deepEqual(sent,[{origem:'whatsapp',id:'5561999999999',texto:'Amanhã eu te retorno.'}]);
  assert.equal(events.length,1);
  assert.equal(events[0].direcao,'saida_operador');
});

test('LEX localiza contato mas não inventa texto de resposta',async()=>{
  let sent=0;
  const deps={
    processStore:processStore([]),engine:fakeEngine(),
    receptionStore:{async list(){return[{numero:'5561999999999',nome:'Leidyanny',status:'aguardando_advogado'}]},async appendEvent(){}},
    records:{async list(){return[]}},channelDelivery:async()=>{sent++;return true}
  };
  const out=await executeNaturalOfficeCommand(deps,{text:'Responda a Leidyanny',profile:'admin'});
  assert.equal(out.needs_input,true);
  assert.match(out.message,/texto exato/i);
  assert.equal(sent,0);
});

test('LEX informa o que precisa do titular sem transformar consulta em tarefa',async()=>{
  const engine=fakeEngine();
  engine.submitted.push({id:'b'.repeat(32),status:'aguardando_revisao',tipo:'contestacao'});
  const deps={
    processStore:processStore([]),engine,
    receptionStore:{async list(){return[{numero:'5561999999999',nome:'Contato',status:'aguardando_advogado',urgente:true}]},async appendEvent(){}},
    records:{async list(){return[]}}
  };
  const out=await executeNaturalOfficeCommand(deps,{text:'Veja o que precisa de mim',profile:'admin'});
  assert.equal(out.command.action,'work_queue');
  assert.match(out.message,/1 tarefa/);
  assert.match(out.message,/1 contato/);
  assert.match(out.message,/urgente/i);
});

test('/api/vivo/conversar executa ordem operacional antes de chamar Gestor textual',async()=>{
  const processo={id:'p1',nome:'Caso Alfa',numero:'5001234-56.2026.8.13.0704',office_stage:'processos',status:'ATIVO'};
  const db=processStore([processo]),engine=fakeEngine();
  const body={processo_id:'p1',mensagem:'Faça a contestação desse processo',request_id:'web-1'};
  const out={};
  const res={writeHead(status){out.status=status},end(text){out.body=JSON.parse(text)}};
  await agent.tratarRota({method:'POST',headers:{}},res,'/api/vivo/conversar',{
    perfil:'admin',body,CORS:{},lerBody:async()=>body,processos:[processo],processStore:db,engine,log:()=>{}
  });
  assert.equal(out.status,200);
  assert.equal(out.body.execucao.action,'task');
  assert.equal(out.body.execucao.tipo,'contestacao');
  assert.equal(out.body.execucao.status,'na_fila');
  assert.equal(engine.submitted.length,1);
});

test('LEX delega pesquisa de jurisprudencia e analise de julgador aos especialistas certos',()=>{
  assert.equal(agent.specializedIntent('Pesquise jurisprudência sobre fraude à execução'),'jurisprudencia');
  assert.equal(agent.specializedIntent('Analise o juiz relator deste processo'),'julgador');
  assert.equal(agent.specializedIntent('Faça a contestação deste processo'),null);
  assert.deepEqual(agent.namedJudgeFromMessage('Analise o juiz João da Silva do TJMG'),{nome:'João da Silva',tribunal:'TJMG'});
});
