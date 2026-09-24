'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {executeNaturalOfficeCommand}=require('../lib/office-routes');
const agent=require('../lex_agente_vivo');

function store(initial=[]){
  let rows=structuredClone(initial);
  return{
    async read(){return{processes:structuredClone(rows),version:1}},
    async mutate(fn){const draft=structuredClone(rows),value=await fn(draft);rows=draft;return{value,processes:structuredClone(rows),version:2}},
    snapshot(){return structuredClone(rows)}
  };
}
function engine(){
  const submitted=[];
  return{
    submitted,
    async submit(input){const task={id:'a'.repeat(32),...input,status:'na_fila'};submitted.push(task);return task},
    async run(){throw new Error('não deveria rodar sem crédito')},
    async list(){return submitted}
  };
}

test('concierge preserva banco processual, 9 setores e especialistas essenciais',()=>{
  const src=fs.readFileSync('lex2-coordinator-ui.js','utf8');
  assert.match(src,/Banco processual/);
  for(const setor of ['Recepção','Cadastro','Iniciais','Processos','Prazos','Peças','Perícia','Revisão','Concluídos'])assert.match(src,new RegExp(setor));
  for(const agente of ['Roteador','Cadastrador / Autuação','Cobrador','Assessor','Jurídico judicial','Jurídico administrativo','Pesquisa decisória','Pericial','PJe','Coordenador','Redação','Revisão','Controladoria','Documental'])assert.ok(src.includes(agente),agente+' está ausente');
  assert.match(src,/14 agentes do LEX/);
  assert.match(src,/Análise do processo/);
  assert.match(src,/Perfil \/ padrão decisório do magistrado/);
  assert.match(src,/window\.lexHome=render/,'Início abre o LEX coordenador');
  assert.match(src,/window\.lexMais=settings/,'Mais vira infraestrutura, não carteira antiga');
});

test('sem crédito, tarefa de IA não é criada nem altera o processo',async()=>{
  const old=process.env.LEX_AI_NO_CREDIT;process.env.LEX_AI_NO_CREDIT='1';
  try{
    const db=store([{id:'p1',nome:'Caso',numero:'5001234-56.2026.8.13.0704',office_stage:'processos',status:'ATIVO'}]),eng=engine();
    const out=await executeNaturalOfficeCommand({processStore:db,engine:eng},{
      text:'Faça a contestação do processo 5001234-56.2026.8.13.0704',profile:'admin'
    });
    assert.equal(out.handled,true);
    assert.equal(out.result.status,'pausado_sem_credito');
    assert.equal(eng.submitted.length,0);
    assert.equal(db.snapshot()[0].office_stage,'processos');
    assert.match(out.message,/sem crédito/i);
    assert.match(out.message,/não alterei o processo/i);
  }finally{if(old===undefined)delete process.env.LEX_AI_NO_CREDIT;else process.env.LEX_AI_NO_CREDIT=old}
});

test('sem crédito, rotina operacional continua funcionando',async()=>{
  const old=process.env.LEX_AI_NO_CREDIT;process.env.LEX_AI_NO_CREDIT='1';
  try{
    const eng=engine();eng.submitted.push({id:'b'.repeat(32),status:'aguardando_revisao',tipo:'contestacao'});
    const out=await executeNaturalOfficeCommand({
      processStore:store([]),engine:eng,
      receptionStore:{async list(){return[{numero:'5561999999999',nome:'Contato',status:'aguardando_advogado',urgente:true}]},async appendEvent(){}},
      records:{async list(){return[]}}
    },{text:'Veja o que precisa de mim',profile:'admin'});
    assert.equal(out.handled,true);
    assert.equal(out.command.action,'work_queue');
    assert.match(out.message,/1 tarefa/);
    assert.match(out.message,/1 contato/);
  }finally{if(old===undefined)delete process.env.LEX_AI_NO_CREDIT;else process.env.LEX_AI_NO_CREDIT=old}
});

test('perfil do magistrado e jurisprudência explicam pausa por crédito sem erro genérico',async()=>{
  const old=process.env.LEX_AI_NO_CREDIT;process.env.LEX_AI_NO_CREDIT='1';
  try{
    for(const mensagem of ['Analise o perfil do juiz deste processo','Pesquise jurisprudência sobre fraude à execução']){
      const out={};const res={writeHead(status){out.status=status},end(body){out.body=JSON.parse(body)}};
      const processo={id:'p1',numero:'5001234-56.2026.8.13.0704',juiz:'Juiz Teste',tribunal:'TJMG'};
      await agent.tratarRota({method:'POST',headers:{}},res,'/api/vivo/conversar',{
        perfil:'admin',body:{processo_id:'p1',mensagem},CORS:{},processos:[processo],processStore:store([processo]),engine:engine()
      });
      assert.equal(out.status,200);
      assert.equal(out.body.ia_estado,'sem_credito');
      assert.match(out.body.texto,/sem crédito/i);
      assert.match(out.body.texto,/processo permanece intacto/i);
    }
  }finally{if(old===undefined)delete process.env.LEX_AI_NO_CREDIT;else process.env.LEX_AI_NO_CREDIT=old}
});

test('backend registra exatamente os 14 agentes exibidos pelo concierge',()=>{
  const bot=fs.readFileSync('bot.js','utf8');
  const regs=[...bot.matchAll(/Lex\.registrar\(new\s+(Agente\w+)\(\)\)/g)].map(m=>m[1]);
  assert.deepEqual(regs,[
    'AgenteRoteador','AgenteCadastrador','AgenteCobrador','AgenteAssessor','AgenteJudicial','AgenteAdministrativo',
    'AgentePesquisaDecisoria','AgentePericial','AgentePJe','AgenteCoordenador','AgenteRedacao','AgenteRevisao',
    'AgenteControladoria','AgenteDocumental'
  ]);
});
