'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {ProcessStore}=require('../lib/process-store');
const {RecordStore}=require('../lib/record-store');
const Workflow=require('../lib/workflow');
const {NotificationDigest,formatDigest,digestItems}=require('../lib/notification-digest');
const {TaskEngine,resolveCase}=require('../lib/task-engine');
const {issueToken,verifyToken,captureMovement}=require('../lib/connector');
const {officeRoutes}=require('../lib/office-routes');
const {setup}=require('./runtime');

function database() {
  const tables=new Map();const calls=[];let refuse=false;
  async function request(method,table,data,query={}) {
    calls.push({method,table});
    if(refuse && method!=='GET')return {ok:false,status:503,body:{}};
    if(!tables.has(table))tables.set(table,[]);
    const rows=tables.get(table),key=table==='processos_cache'?'id':'chave';
    const matches=r=>Object.entries(query||{}).every(([k,v])=>{
      if(['limit','order','offset','select'].includes(k))return true;
      if(String(v).startsWith('like.'))return String(r[k]).startsWith(String(v).slice(5,-1));
      return String(r[k])===String(v).slice(3);
    });
    let body=[];
    if(method==='GET')body=rows.filter(matches);
    if(method==='POST') {
      if(rows.some(r=>r[key]===data[key]))return {ok:false,status:409,body:{}};
      rows.push(structuredClone(data));body=[data];
    }
    if(method==='PATCH') {
      for(let i=0;i<rows.length;i++)if(matches(rows[i])){rows[i]={...rows[i],...structuredClone(data)};body.push(rows[i]);}
    }
    return {ok:true,status:200,body:structuredClone(body)};
  }
  return {request,tables,calls,setRefuse:value=>{refuse=value;}};
}
const caseA={id:1,nome:'Caso bancário Alfa',numero:'0000001-00.2026.8.13.0001',setor:'judicial',status:'URGENTE',prazo:'10/09/2026',descricao:'Documento informado pelo advogado: petição inicial e contrato de empréstimo anexados para análise preliminar.'};
const seed=async(db,rows)=>{const store=new ProcessStore(db.request);await store.replace(rows,0,'teste');return store;};

test('10 casos: duas distribuições deixam 8 em preparação e 2 no judicial, preservando IDs, anexos e prazo',async()=>{
  const db=database();const rows=Array.from({length:10},(_,i)=>({id:i+1,nome:'Caso '+i,status:'EM_PREP',setor:'autuacao',prazo:'15/09/2026',arquivos:[{nome:'original.pdf',hash:'evidencia'}]}));
  const store=await seed(db,rows);
  for(const id of [1,2])await store.distribute(rows[id-1],{setor:'judicial',numero:'000000'+id+'-00.2026.8.13.0001'});
  const final=(await store.read()).processes;const counts=Workflow.summary(final,rows);
  assert.equal(counts.autuacao,8);assert.equal(counts.judicial,2);assert.equal(counts.total,10);
  assert.deepEqual(final[0].arquivos,rows[0].arquivos);assert.equal(final[0].prazo,'15/09/2026');assert.equal(final[0].id,1);
});
test('clique duplicado e reconexão não duplicam a distribuição',async()=>{
  const db=database(),p={id:1,nome:'Caso',status:'EM_PREP',setor:'autuacao'};const store=await seed(db,[p]);
  const input={setor:'judicial',numero:caseA.numero};
  await Promise.all([store.distribute(p,input),store.distribute(p,input)]);
  await new ProcessStore(db.request).distribute(p,input);
  const rows=(await store.read()).processes;assert.equal(rows.length,1);assert.equal(rows[0].andamentos.length,1);
});
test('distribuição sem protocolo não remove a preparação',async()=>{
  const db=database(),p={id:1,nome:'Caso',status:'EM_PREP'};const store=await seed(db,[p]);
  await assert.rejects(store.distribute(p,{setor:'judicial'}),/protocolo/);assert.equal((await store.read()).processes[0].status,'EM_PREP');
});
test('falha no banco não confirma atualização nem altera snapshot',async()=>{
  const db=database();const store=await seed(db,[caseA]);db.setRefuse(true);
  await assert.rejects(store.update(1,()=>({status:'CONCLUIDO'})));
  assert.equal((await store.read()).processes[0].status,'URGENTE');
});
test('duas instâncias preservam alterações concorrentes com comparação de versão no banco',async()=>{
  const db=database();const one=await seed(db,[caseA]),two=new ProcessStore(db.request);
  await Promise.all([one.update(1,()=>({juiz:'Magistrado teste'})),two.update(1,()=>({vara:'Vara teste'}))]);
  const p=(await one.read()).processes[0];assert.equal(p.juiz,'Magistrado teste');assert.equal(p.vara,'Vara teste');
});
test('snapshot desatualizado, versão zero e IDs duplicados não substituem dados atuais',async()=>{
  const db=database(),store=await seed(db,[caseA]);
  await assert.rejects(store.replace([],0,'celular'),e=>e.status===409);
  const state=await store.read();await assert.rejects(store.replace([caseA,caseA],state.version),/duplicados/);
  assert.equal((await store.read()).processes.length,1);
});
test('prazo baixado para vazio continua vazio após nova leitura; campos extras são preservados',async()=>{
  const db=database(),store=await seed(db,[{...caseA,custom:{origem:'teste'}}]);
  const r=await store.gateway('PATCH',{prazo:''},{id:'eq.1'});assert.equal(r.ok,true);
  const p=(await new ProcessStore(db.request).read()).processes[0];assert.equal(p.prazo,'');assert.equal(p.custom.origem,'teste');
});
test('calendário remove a data antiga e o lembrete de preparação distribuída, preservando audiência',()=>{
  const events={'2026-09-10':[{prepId:1,titulo:'antigo'},{titulo:'Audiência',processoId:1}], '2026-09-11':[{prepId:2,titulo:'distribuído'}]};
  const next=Workflow.reconcileCalendar(events,[{id:1,nome:'A',status:'EM_PREP',previsao:'15/09/2026'}]);
  assert.equal(next['2026-09-10'].length,1);assert.equal(next['2026-09-10'][0].titulo,'Audiência');assert.equal(next['2026-09-11'],undefined);assert.equal(next['2026-09-15'][0].prepId,1);
});
test('rotas de atualização recusam secretária e confirmam gravação real para administrador',async()=>{
  const db=database(),store=await seed(db,[caseA]);const app=setup({processStore:store,Workflow});
  let r=await app.request('/api/processo/atualizar',app.token('secretaria'),{processo_id:1,status:'CONCLUIDO'},'POST');assert.equal(r.status,403);
  r=await app.request('/api/processo/atualizar',app.token('admin'),{processo_id:1,prazo:''},'POST');assert.equal(r.status,200);
  assert.equal((await store.read()).processes[0].prazo,'');
  db.setRefuse(true);r=await app.request('/api/processo/atualizar',app.token('admin'),{processo_id:1,status:'CONCLUIDO'},'POST');assert.notEqual(r.status,200);
});
test('lembrete só baixa por ID e confirmação explícita gravada no banco',async()=>{
  const db=database(),store=await seed(db,[{...caseA,lembretes:[{id:'peticao',texto:'Protocolar petição',status:'pendente'},{id:'audiencia',texto:'Preparar audiência',status:'pendente'}]}]);
  const app=setup({processStore:store,Workflow});
  let r=await app.request('/api/processo/atualizar',app.token('admin'),{processo_id:1,andamentos:[{texto:'Movimentação genérica'}]},'POST');
  assert.equal(r.status,200);assert.equal((await store.read()).processes[0].lembretes[0].status,'pendente');
  r=await app.request('/api/processo/lembretes/concluir',app.token('admin'),{processo_id:1,lembrete_ids:['peticao']},'POST');
  assert.equal(r.status,200);
  const reminders=(await store.read()).processes[0].lembretes;
  assert.equal(reminders[0].status,'concluido');assert.equal(reminders[0].concluido_por,'confirmacao_explicita');assert.equal(reminders[1].status,'pendente');
});
test('falha no banco não baixa lembrete na memória',async()=>{
  const db=database(),store=await seed(db,[{...caseA,lembretes:[{id:'peticao',status:'pendente'}]}]);const app=setup({processStore:store,Workflow});
  db.setRefuse(true);const r=await app.request('/api/processo/lembretes/concluir',app.token('admin'),{processo_id:1,lembrete_ids:['peticao']},'POST');
  assert.notEqual(r.status,200);db.setRefuse(false);assert.equal((await store.read()).processes[0].lembretes[0].status,'pendente');
});
test('avisos agrupados: um resumo por destinatário por dia, inclusive após reinício',async()=>{
  const db=database(),records=new RecordStore(db.request);let sent=[];
  const send=async(text,thread,recipient)=>{sent.push({text,recipient});return true;};
  const digest=new NotificationDigest(records,send),now=new Date('2026-09-09T12:00:00Z');
  await digest.enqueue('Novo documento recebido','admin');await digest.enqueue('Novo documento recebido','admin');
  await digest.flush('admin',[caseA],{now});await new NotificationDigest(new RecordStore(db.request),send).flush('admin',[caseA],{now});
  assert.equal(sent.length,1);assert.match(sent[0].text,/Caso bancário Alfa/);assert.match(sent[0].text,/Novo documento/);
});
test('timeout de envio fica registrado e não repete automaticamente o resumo',async()=>{
  const db=database(),records=new RecordStore(db.request);let sends=0;
  const digest=new NotificationDigest(records,async()=>{sends++;throw new Error('timeout');});
  const now=new Date('2026-09-09T12:00:00Z');await digest.flush('admin',[caseA],{now});await digest.flush('admin',[caseA],{now});
  assert.equal(sends,1);assert.equal((await records.read('lex_digest:admin:2026-09-09')).value.status,'envio_incerto');
});
test('resumo preserva prazo mesmo com atualização hoje e respeita limite do Telegram',()=>{
  const now=new Date('2026-09-09T12:00:00Z');const list=digestItems([{...caseA,prazo:'09/09/2026',atualizado_em:'2026-09-09'}],now);assert.match(list[0].text,/prazo hoje/);
  assert.ok(formatDigest(Array.from({length:200},(_,i)=>({text:'Caso '+i+' — '+'x'.repeat(600)}))).length<=4096);
});
test('motor persiste ordem, valida instrumento, gera entrega e recupera o resultado após reinício',async()=>{
  const db=database(),records=new RecordStore(db.request),processes=async()=>[caseA];let calls=0;
  const ai=async()=>++calls===1?JSON.stringify({cabivel:true,motivos:'Análise preliminar possível',faltantes:[]}):'MINUTA TESTE\nAnálise preliminar com base em C1.';
  const engine=new TaskEngine({store:records,processes,ai});const task=await engine.submit({tipo:'analise',processo_id:1,instrucao:'Analise o caso.',request_id:'uma-ordem'});
  const result=await engine.run(task.id);assert.equal(result.status,'aguardando_revisao');assert.equal(calls,2);
  const restarted=new TaskEngine({store:new RecordStore(db.request),processes,ai});assert.equal((await restarted.get(task.id)).resultado,result.resultado);
  const repeat=await restarted.submit({tipo:'analise',processo_id:1,instrucao:'Analise o caso.',request_id:'uma-ordem'});await restarted.run(repeat.id);assert.equal(calls,2);
  await assert.rejects(restarted.review(task.id,'hash_errado','admin'));
  assert.equal((await restarted.review(task.id,result.sha256,'admin')).status,'concluida');
  assert.equal(caseA.status,'URGENTE');
});
test('processos ambíguos ou CNJ incompatível não chamam IA',async()=>{
  const db=database();let calls=0;const cases=[caseA,{...caseA,id:2,numero:'0000002-00.2026.8.13.0001'}];
  const engine=new TaskEngine({store:new RecordStore(db.request),processes:async()=>cases,ai:async()=>{calls++;}});
  let t=await engine.submit({tipo:'contestacao',instrucao:'Faça contestação do Caso bancário Alfa'});t=await engine.run(t.id);assert.equal(t.status,'aguardando_dados');assert.equal(calls,0);
  assert.ok(resolveCase(cases,{processo_id:1,instrucao:'Faça contestação de 0000002-00.2026.8.13.0001'}).reason);
});
test('peça incompatível e falta de credencial não são declaradas concluídas',async()=>{
  const db=database(),records=new RecordStore(db.request);let calls=0;
  const engine=new TaskEngine({store:records,processes:async()=>[caseA],ai:async()=>{calls++;return JSON.stringify({cabivel:false,motivos:'Fase incompatível',faltantes:['decisão']});}});
  const t=await engine.submit({tipo:'contestacao',processo_id:1,instrucao:'Faça contestação.'});assert.equal((await engine.run(t.id)).status,'aguardando_dados');assert.equal(calls,1);
  const offline=new TaskEngine({store:records,processes:async()=>[caseA],available:()=>false,ai:()=>{throw new Error('não chamar');}});
  const t2=await offline.submit({tipo:'analise',processo_id:1,instrucao:'Analise'});assert.equal((await offline.run(t2.id)).status,'aguardando_configuracao');
});
test('sem confirmação do banco a ordem não inicia chamadas pagas',async()=>{
  const db=database();db.setRefuse(true);let calls=0;
  const engine=new TaskEngine({store:new RecordStore(db.request),processes:async()=>[caseA],ai:async()=>{calls++;}});
  await assert.rejects(engine.submit({tipo:'analise',processo_id:1,instrucao:'Analise'}));assert.equal(calls,0);
});
test('token do conector é temporário, restrito e revogável por novo pareamento',()=>{
  const t=issueToken('segredo','pareamento',1000);
  assert.equal(verifyToken(t,'segredo','pareamento',1001),true);
  assert.equal(verifyToken(t+'x','segredo','pareamento',1001),false);
  assert.equal(verifyToken(t,'segredo','outro',1001),false);
  assert.equal(verifyToken(t,'segredo','pareamento',1000+8*3600000),false);
});
test('captura assistida rejeita fonte falsa e duplicados não mudam prazo ou prioridade',async()=>{
  const db=database(),store=await seed(db,[caseA]);const b={cnj:caseA.numero,data:'2026-09-09',andamento_texto:'Juntada de documento',fonte_url:'https://pje.tjmg.jus.br/processo?session=excluir'};
  await captureMovement(store,b);const repeated=await captureMovement(store,b);assert.equal(repeated.value.duplicado,true);
  const p=(await store.read()).processes[0];assert.equal(p.status,'URGENTE');assert.equal(p.prazo,'10/09/2026');assert.equal(p.andamentos.length,1);assert.equal(p.andamentos[0].fonte_url,'https://pje.tjmg.jus.br/processo');
  await assert.rejects(captureMovement(store,{...b,fonte_url:'https://tjmg.jus.br.evil.example'}));
});
test('escritórios com bancos dedicados não compartilham processos nem tarefas',async()=>{
  const a=database(),b=database();await seed(a,[caseA]);const other=await seed(b,[]);
  const engine=new TaskEngine({store:new RecordStore(a.request),processes:async()=>[caseA]});await engine.submit({tipo:'analise',instrucao:'Analise',processo_id:1});
  assert.equal((await other.read()).processes.length,0);assert.deepEqual(await new RecordStore(b.request).list('lex_task:'),[]);
});

module.exports={database};
