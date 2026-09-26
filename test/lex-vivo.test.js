'use strict';
// LEX vivo: a inteligência dirige (modelo com ferramentas), o código é o cinto.
// Testa o corpo (lib/lex-tools), o laço (tool_use → executor real → texto) e as portas.
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const LexTools=require('../lib/lex-tools');
const core=require('../lex_agente_vivo_core');
const vivo=require('../lex_agente_vivo');

// ---------- transporte falso da API Anthropic ----------
function fakeHttps(script){
  // script: array de respostas (objetos da API) devolvidas em ordem; guarda os payloads enviados.
  const calls=[];
  return{calls,request(opts,onRes){
    const req=new EventEmitter();let body='';
    req.write=c=>{body+=c};req.setTimeout=()=>{};req.destroy=()=>{};
    req.end=()=>{calls.push(JSON.parse(body));const r=new EventEmitter();r.statusCode=200;const out=script.shift()||{content:[{type:'text',text:'(sem roteiro)'}],stop_reason:'end_turn'};onRes(r);setImmediate(()=>{r.emit('data',JSON.stringify(out));r.emit('end')})};
    return req;
  }};
}
const toolUse=(name,input,id='tu1')=>({content:[{type:'tool_use',id,name,input}],stop_reason:'tool_use'});
const text=t=>({content:[{type:'text',text:t}],stop_reason:'end_turn'});

const PROCS=[
  {id:'p1',nome:'Banco Alfa · Execução 1.0042',numero:'1000042-11.2025.4.06.3818',cliente:'Banco Alfa',status:'ATIVO',last_court_sync_at:'2026-09-25T10:00:00Z',prazoReal:'2026-09-25',prazo_confirmado_em:'2026-09-20T10:00:00Z',andamentos:[{data:'2026-09-24',txt:'[DATAJUD] Juntada de petição',origem:'datajud'}]},
  {id:'p2',nome:'Banco Alfa · Execução 1.0007',numero:'1000007-42.2025.4.06.3818',cliente:'Banco Alfa',status:'ATIVO'},
  {id:'p3',nome:'Maria Souza · Ação',numero:'5004158-61.2024.8.13.0704',status:'ATIVO',prazo:'2026-10-01'}
];
function deps(over={}){
  const submitted=[],run=[];
  return{
    processos:PROCS,processStore:{read:async()=>({processes:PROCS})},
    engine:{list:async()=>[{id:'t1',tipo:'contestacao',status:'aguardando_revisao',processo_id:'p1',processo_nome:'Banco Alfa · Execução 1.0042'}],submit:async(input,actor)=>{const t={id:'a'.repeat(32),...input,status:'na_fila',ator:actor};submitted.push(t);return t}},
    records:{read:async()=>null,list:async()=>[],change:async()=>({})},
    executeNaturalOfficeCommand:async(d,input)=>({handled:true,command:{action:'work_queue'},message:'Executado: '+input.text}),
    assertTaskGate:async()=>{},runTask:async t=>{run.push(t.id)},
    log(){},submitted,run,...over
  };
}

test('corpo: consultar_processos nunca escolhe sozinho quando há mais de um compatível',async()=>{
  const r=await LexTools.executar('consultar_processos',{busca:'Banco Alfa'},deps(),{profile:'admin'});
  assert.equal(r.ok,true);assert.equal(r.total,2);assert.match(r.observacao,/pergunte/);
  const one=await LexTools.executar('consultar_processos',{busca:'5004158-61.2024.8.13.0704'},deps(),{profile:'admin'});
  assert.equal(one.total,1);assert.equal(one.processos[0].id,'p3');
  const none=await LexTools.executar('consultar_processos',{busca:'Zé Ninguém'},deps(),{profile:'admin'});
  assert.equal(none.total,0);assert.match(none.observacao,/Não invente/);
});

test('corpo: ver_processo devolve só o que está gravado e marca prazo confirmado vs. a conferir',async()=>{
  const r=await LexTools.executar('ver_processo',{processo_id:'p1'},deps(),{profile:'admin'});
  assert.equal(r.processo.prazo.confirmado,true);assert.equal(r.processo.dados_conferidos_no_tribunal,true);
  assert.equal(r.processo.tarefas.length,1);assert.equal(r.processo.aviso,null);
  const p3=await LexTools.executar('ver_processo',{processo_id:'p3'},deps(),{profile:'admin'});
  assert.equal(p3.processo.prazo.confirmado,false);assert.match(p3.processo.aviso,/a conferir/);
  const missing=await LexTools.executar('ver_processo',{processo_id:'x'},deps(),{profile:'admin'});
  assert.equal(missing.ok,false);
});

test('cinto: criar_tarefa exige advogado/admin, tipo válido e processo existente; roda em segundo plano',async()=>{
  const d=deps();
  const sec=await LexTools.executar('criar_tarefa',{tipo:'contestacao',processo_id:'p1',instrucao:'x'},d,{profile:'secretaria'});
  assert.equal(sec.ok,false);assert.match(sec.erro,/advogado/);
  const bad=await LexTools.executar('criar_tarefa',{tipo:'protocolo',processo_id:'p1',instrucao:'x'},d,{profile:'admin'});
  assert.equal(bad.ok,false);
  const ok=await LexTools.executar('criar_tarefa',{tipo:'contestacao',processo_id:'p1',instrucao:'embargos com base nos autos'},d,{profile:'admin'});
  assert.equal(ok.ok,true);assert.equal(d.submitted.length,1);assert.equal(d.run[0],ok.tarefa.id);assert.match(ok.texto,/nada será protocolado/);
});

test('cinto: ordem_operacional passa pelo executor validado e recusa confirmações que só o titular digita',async()=>{
  const d=deps();
  const r=await LexTools.executar('ordem_operacional',{texto:'veja o que precisa de mim'},d,{profile:'admin'});
  assert.equal(r.ok,true);assert.match(r.texto,/Executado: veja o que precisa de mim/);
  for(const t of ['CONFIRMO CIENCIA TJMG 123','APROVO 8f3a21c0 R2']){const x=await LexTools.executar('ordem_operacional',{texto:t},d,{profile:'admin'});assert.equal(x.ok,false);assert.match(x.erro,/titular/)}
  const unknown=await LexTools.executar('ordem_operacional',{texto:'faz mágica'},deps({executeNaturalOfficeCommand:async()=>null}),{profile:'admin'});
  assert.equal(unknown.ok,false);assert.match(unknown.erro,/não reconheceu/);
});

test('corpo: ferramenta desconhecida ou que lança nunca derruba a conversa',async()=>{
  const r=await LexTools.executar('teletransporte',{},deps(),{});assert.equal(r.ok,false);
  const boom=await LexTools.executar('tarefas',{},deps({engine:{list:async()=>{throw new Error('banco fora')}}}),{});
  assert.equal(boom.ok,false);assert.match(boom.erro,/banco fora/);
});

test('laço: o modelo chama uma ferramenta, o executor real responde e o texto final sai do modelo',async()=>{
  const https=fakeHttps([toolUse('consultar_processos',{busca:'Maria Souza'}),text('Achei a ação da Maria Souza (5004158-61.2024.8.13.0704). Prazo anotado para 01/10, ainda a conferir. Quer que eu confira no tribunal?')]);
  const d=deps();
  const out=await core.conversarLex({...d,ANTHROPIC_KEY:'k',https,tools:vivo.lexToolsFor(d,{profile:'admin'})},{mensagem:'como está o caso da Maria?',historico:[],canal:'whatsapp'});
  assert.match(out.texto,/Maria Souza/);
  assert.deepEqual(out.toolsUsadas.map(t=>t.name),['consultar_processos']);
  assert.equal(https.calls.length,2);
  const first=https.calls[0];
  assert.ok(first.tools.some(t=>t.name==='consultar_processos')&&first.tools.some(t=>t.name==='criar_tarefa'),'corpo inteiro oferecido ao modelo');
  assert.match(first.system,/Você é o LEX, assessor/);assert.match(first.system,/CANAL: whatsapp/);assert.match(first.system,/ESCRITÓRIO AGORA/);
  const toolResult=https.calls[1].messages.at(-1).content[0];
  assert.equal(toolResult.type,'tool_result');
  const payload=JSON.parse(toolResult.content);
  assert.equal(payload.total,1);assert.equal(payload.processos[0].id,'p3');
});

test('laço: com processo em contexto, propor_atualizacao continua disponível junto com o corpo',async()=>{
  const https=fakeHttps([text('Anotado.')]);
  const d=deps();
  await core.conversarLex({...d,ANTHROPIC_KEY:'k',https,tools:vivo.lexToolsFor(d,{profile:'admin'})},{mensagem:'oi',historico:[],processo_id:'p1',canal:'web'});
  const names=https.calls[0].tools.map(t=>t.name);
  assert.ok(names.includes('propor_atualizacao')&&names.includes('buscar_documentos')&&names.includes('ver_processo'));
});

test('porta do app: conversa livre vai ao LEX vivo; comando com barra e frase de confirmação vão ao executor; sem IA, executor é a reserva',async()=>{
  const seen=[];
  const mk=(over={})=>({...deps(),ANTHROPIC_KEY:'k',https:fakeHttps([text('LEX vivo respondeu')]),perfil:'admin',CORS:{},
    executeNaturalOfficeCommand:async(d,input)=>{seen.push(input.text);return{handled:true,command:{action:'work_queue'},message:'executor: '+input.text}},...over});
  const res=()=>{const r={};r.writeHead=(s)=>{r.status=s};r.end=b=>{r.body=JSON.parse(b)};return r};
  // 1) conversa livre → vivo
  let r=res();await vivo.tratarRota({method:'POST',headers:{}},r,'/api/vivo/conversar',{...mk(),body:{mensagem:'como estamos hoje?'}});
  assert.equal(r.body.texto,'LEX vivo respondeu',JSON.stringify(r.body));assert.equal(seen.length,0);
  // 2) comando literal → executor determinístico real (o LEX vivo não é chamado: nenhuma chamada à API)
  let d=mk();r=res();await vivo.tratarRota({method:'POST',headers:{}},r,'/api/vivo/conversar',{...d,body:{mensagem:'/resumo'}});
  assert.match(r.body.texto,/^Resumo de /);assert.equal(d.https.calls.length,0);assert.equal(r.body.execucao.action,'daily_brief');
  d=mk();r=res();await vivo.tratarRota({method:'POST',headers:{}},r,'/api/vivo/conversar',{...d,body:{mensagem:'CONFIRMO CIENCIA TJMG 123'}});
  assert.equal(d.https.calls.length,0,'frase de confirmação nunca passa pelo modelo');
  // 3) sem chave de IA → executor determinístico como reserva
  d=mk({ANTHROPIC_KEY:''});r=res();await vivo.tratarRota({method:'POST',headers:{}},r,'/api/vivo/conversar',{...d,body:{mensagem:'bom dia'}});
  assert.equal(d.https.calls.length,0);assert.match(r.body.texto,/^Resumo de /);
});

test('iniciativa: minuta pronta, pendência ou falha viram aviso imediato ao titular; concluída não gera ruído',async()=>{
  const {runTaskThroughOffice,taskResultNotice}=require('../lib/office-routes');
  assert.match(taskResultNotice({id:'abcdef1234',status:'aguardando_revisao',tipo:'contestacao',processo_nome:'Banco Alfa'}),/Minuta pronta[\s\S]*Banco Alfa[\s\S]*Nada foi protocolado/);
  assert.match(taskResultNotice({id:'abcdef1234',status:'aguardando_dados',pendencia:'falta a decisão'}),/Parei a tarefa abcdef12[\s\S]*falta a decisão/);
  assert.match(taskResultNotice({id:'abcdef1234',status:'falhou',pendencia:'fonte fora'}),/falhou: fonte fora/);
  assert.equal(taskResultNotice({id:'x',status:'concluida'}),null);
  assert.equal(taskResultNotice({id:'x',status:'executando'}),null);
  const sent=[];
  const d={processStore:{read:async()=>({processes:[{id:'p1',nome:'Caso'}]}),mutate:async fn=>{const ps=[{id:'p1',nome:'Caso'}];await fn(ps);return{processes:ps}}},
    engine:{run:async()=>({id:'a'.repeat(32),status:'aguardando_revisao',tipo:'peticao',processo_id:'p1',processo_nome:'Caso'})},
    onTaskResult:async n=>{sent.push(n)},log(){}};
  const r=await runTaskThroughOffice(d,{id:'a'.repeat(32),processo_id:'p1',tipo:'peticao'},'admin');
  assert.equal(r.status,'aguardando_revisao');assert.equal(sent.length,1);assert.match(sent[0],/Minuta pronta/);
  // aviso que falha não derruba a tarefa
  const r2=await runTaskThroughOffice({...d,onTaskResult:async()=>{throw new Error('canal fora')}},{id:'a'.repeat(32),processo_id:'p1',tipo:'peticao'},'admin');
  assert.equal(r2.status,'aguardando_revisao');
});
