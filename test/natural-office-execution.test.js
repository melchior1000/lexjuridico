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

test('processo selecionado e CNJ escrito na ordem precisam ser o mesmo caso',async()=>{
  const cnj1='5001111-11.2026.8.13.0704',cnj2='5002222-22.2026.8.13.0704';
  const db=processStore([
    {id:'p1',nome:'Caso Alfa',numero:cnj1,office_stage:'processos',status:'ATIVO'},
    {id:'p2',nome:'Caso Beta',numero:cnj2,office_stage:'processos',status:'ATIVO'}
  ]);
  const before=db.snapshot();
  const out=await executeNaturalOfficeCommand({processStore:db,engine:fakeEngine()},{
    text:'Move para revisão o processo '+cnj2,processo_id:'p1',profile:'admin'
  });
  assert.equal(out.handled,true);
  assert.equal(out.needs_input,true);
  assert.match(out.message,/não corresponde ao processo selecionado/i);
  assert.deepEqual(db.snapshot(),before);
});

test('processo_id inexistente vira needs_input antes de criar tarefa',async()=>{
  const db=processStore([{id:'p1',nome:'Caso Alfa',numero:'5001111-11.2026.8.13.0704',office_stage:'processos'}]);
  const engine=fakeEngine();
  const out=await executeNaturalOfficeCommand({processStore:db,engine},{
    text:'Faça a contestação desse processo',processo_id:'inexistente',profile:'admin',request_id:'ordem-id-invalido'
  });
  assert.equal(out.handled,true);
  assert.equal(out.needs_input,true);
  assert.match(out.message,/não existe/i);
  assert.equal(engine.submitted.length,0);
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

test('LEX cadastra contato nomeado na Recepção sem liberar produção jurídica',async()=>{
  const db=processStore([]);
  const deps={
    processStore:db,engine:fakeEngine(),
    receptionStore:{async list(){return[{numero:'5561999999999',nome:'Leidyanny',status:'aguardando_advogado',ultima_mensagem:'Preciso falar sobre meu processo'}]},async appendEvent(){}},
    records:{async list(){return[]}}
  };
  const out=await executeNaturalOfficeCommand(deps,{text:'Cadastre o cliente Leidyanny',profile:'admin'});
  assert.equal(out.handled,true);
  assert.equal(out.result.setor,'cadastro');
  const created=db.snapshot()[0];
  assert.equal(created.nome,'Leidyanny');
  assert.equal(created.status,'EM_PREP');
  assert.equal(created.cadastro_conferido,false);
  assert.equal(created.bloqueio_peca,true);
  assert.equal(created.origem_recepcao.origem,'whatsapp');
});

test('LEX não escolhe cliente aleatório em cadastre esse cliente',async()=>{
  const db=processStore([]);
  const deps={
    processStore:db,engine:fakeEngine(),
    receptionStore:{async list(){return[
      {numero:'1',nome:'Cliente A',status:'aguardando_advogado'},
      {numero:'2',nome:'Cliente B',status:'aguardando_advogado'}
    ]},async appendEvent(){}},
    records:{async list(){return[]}}
  };
  const out=await executeNaturalOfficeCommand(deps,{text:'Cadastre esse cliente',profile:'admin'});
  assert.equal(out.handled,true);
  assert.equal(out.needs_input,true);
  assert.equal(db.snapshot().length,0);
  assert.match(out.message,/não vou escolher/i);
});

test('mande isso usa apenas texto anterior confirmado e respeita o canal pedido',async()=>{
  const sent=[];
  const deps={
    processStore:processStore([]),engine:fakeEngine(),
    receptionStore:{async list(){return[{numero:'5561999999999',nome:'Leidyanny',status:'aguardando_advogado'}]},async appendEvent(){}},
    records:{async list(){return[]}},
    channelDelivery:async payload=>{sent.push(payload);return true}
  };
  const out=await executeNaturalOfficeCommand(deps,{
    text:'Mande isso no WhatsApp para Leidyanny',profile:'admin',previous_text:'Texto aprovado pelo titular.'
  });
  assert.equal(out.handled,true);
  assert.equal(out.result.enviado,true);
  assert.deepEqual(sent,[{origem:'whatsapp',id:'5561999999999',texto:'Texto aprovado pelo titular.'}]);
});

test('mande isso sem texto anterior não inventa conteúdo',async()=>{
  let sent=0;
  const deps={
    processStore:processStore([]),engine:fakeEngine(),
    receptionStore:{async list(){return[{numero:'5561999999999',nome:'Leidyanny',status:'aguardando_advogado'}]},async appendEvent(){}},
    records:{async list(){return[]}},channelDelivery:async()=>{sent++;return true}
  };
  const out=await executeNaturalOfficeCommand(deps,{text:'Mande isso no WhatsApp para Leidyanny',profile:'admin'});
  assert.equal(out.needs_input,true);
  assert.equal(sent,0);
  assert.match(out.message,/texto anterior/i);
});

test('pesquisador de julgador pode ser chamado pelo coordenador sem rota HTTP externa',async()=>{
  const out=await agent.executarPesquisaJulgador({nome:'Juiz Teste',tribunal:'TJMG'},{
    analisarPerfilJuiz:async()=>({achados:[],advertencia:'Amostra insuficiente; não inferir perfil pessoal.'}),CORS:{}
  });
  assert.equal(out.ok,true);
  assert.match(out.texto,/Não há material suficiente/);
  assert.match(out.texto,/Amostra insuficiente/);
});

test('canais do bot chamam os mesmos pesquisadores do LEX vivo',()=>{
  const fs=require('node:fs');
  const src=fs.readFileSync('bot.js','utf8');
  assert.match(src,/specializedIntent\?\.\(txt\)/);
  assert.match(src,/executarPesquisaJuris/);
  assert.match(src,/executarPesquisaJulgador/);
  assert.match(src,/resolveCase\(processos,\{instrucao:txt\}\)/);
});

test('executor natural falha fechado quando perfil autenticado não é informado',async()=>{
  await assert.rejects(
    ()=>executeNaturalOfficeCommand({processStore:processStore([]),engine:fakeEngine()},{text:'Veja o que precisa de mim'}),
    err=>err?.status===401&&/Perfil não informado/.test(err.message)
  );
});

test('pesquisador não expõe detalhe interno do provedor ao operador',async()=>{
  await assert.rejects(
    ()=>agent.executarPesquisaJulgador({nome:'Juiz Teste',tribunal:'TJMG'},{
      analisarPerfilJuiz:async()=>{throw new Error('segredo-interno-do-provedor')},CORS:{}
    }),
    err=>/Não foi possível concluir a pesquisa especializada agora/.test(err.message)&&!/segredo-interno/.test(err.message)
  );
});
