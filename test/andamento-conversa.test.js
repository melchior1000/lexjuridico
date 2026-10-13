'use strict';
// Andamento oficial novo → o LEX conversa com o titular → a IA escreve ao cliente → sai só
// com o "pode" dele, conferido no código. Pedido do titular: interação, nada de texto pronto.
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createAndamentoConversa,ehOk}=require('../lib/andamento-conversa');
const {createChannelCommandOutbox}=require('../lib/channel-command-outbox');
const LexTools=require('../lib/lex-tools');
const core=require('../lex_agente_vivo_core');
const vivo=require('../lex_agente_vivo');

function records(){
  const map=new Map();
  return{
    async read(key){return map.has(key)?{value:structuredClone(map.get(key)),stamp:new Date().toISOString()}:null},
    async change(key,fn){
      const old=map.has(key)?structuredClone(map.get(key)):null;
      const next=await fn(old);
      if(next!==undefined)map.set(key,structuredClone(next));
      return next===undefined?old:structuredClone(next);
    },
    async list(prefix){return[...map.entries()].filter(([k])=>k.startsWith(prefix)).map(([,v])=>structuredClone(v)).filter(v=>v!=null)},
    map
  };
}
function carteira(rows){
  let ps=structuredClone(rows);
  return{
    async read(){return{processes:structuredClone(ps),version:1}},
    async mutate(fn){const copy=structuredClone(ps);const value=await fn(copy);ps=copy;return{value}},
    set(next){ps=structuredClone(next)},
    get rows(){return ps}
  };
}

const MARIA={id:'p1',nome:'Maria Silva x Banco Alfa',numero:'5001234-56.2026.8.13.0704',cliente:'Maria Silva',status:'ATIVO',setor:'judicial',
  origem_recepcao:{chave:'whatsapp:5561988887777',origem:'whatsapp',id:'5561988887777',nome:'Maria Silva'},
  andamentos:[{data:'2026-10-05',txt:'[DATAJUD] Juntada de petição',origem:'datajud'}]};
const JOAO={id:'p2',nome:'João Souza x Estado',numero:'5009999-11.2026.8.13.0001',cliente:'João Souza',status:'ATIVO',setor:'judicial',andamentos:[]};
const ENCERRADO={id:'p3',nome:'Caso encerrado',status:'ARQUIVADO',andamentos:[]};
const BASE=[MARIA,JOAO,ENCERRADO];
const comAndamento=(p,a)=>({...p,andamentos:[a,...p.andamentos]});
const CONCLUSOS={data:'2026-10-12',txt:'[DATAJUD] Conclusos para decisão',origem:'datajud'};
const SENTENCA={data:'2026-10-12',txt:'[DJEN] Sentença — julgado procedente o pedido',origem:'djen',djen_id:'777'};
const TEXTO_MARIA='Olá, Maria! O seu processo foi para o juiz decidir. Assim que sair a decisão, eu te explico. Qualquer dúvida, é só responder.';

function montar(over={}){
  const rec=records(),store=carteira(over.processos||BASE);
  const entregas=[],composicoes=[],deliveries=[],provedor={falha:false},pare=new Set(over.pare||[]);
  let agora=Date.parse('2026-10-13T13:00:00Z'); // 10h em Brasília
  const outbox=createChannelCommandOutbox({records:rec,compose:async()=>{throw new Error('compositor não deve ser usado')},
    deliverDetailed:async input=>{deliveries.push(input);return provedor.falha?{ok:false,state:'erro',error:'Evolution fora do ar'}:{ok:true,state:'confirmado',provider_id:'m'+deliveries.length}},
    receptionStore:{appendEvent:async()=>{}},log:()=>{}});
  const A=createAndamentoConversa({records:rec,processStore:store,outbox,
    podeReceber:async n=>!pare.has(n),
    contatosDoProcesso:async pid=>(over.contatos||{})[pid]||[],
    iaDisponivel:()=>!over.semIa,
    compor:async ({system,mensagem})=>{composicoes.push({system,mensagem});if(over.iaFalha)throw new Error('provedor fora');return'Dr., saiu movimentação no processo da Maria: foi concluso para decisão. Quer que eu avise a cliente?'},
    entregarAoTitular:async texto=>{entregas.push(texto);return over.entregaFalha?.ativa?[{conversa:'telegram:1',ok:false}]:[{conversa:'telegram:1',ok:true}]},
    dentroDoHorario:()=>!(over.horario&&over.horario.fora),
    now:()=>agora,esperaMs:0,esperaTentativas:20,dormir:()=>new Promise(r=>setImmediate(r)),log:()=>{}});
  return{A,rec,store,outbox,entregas,composicoes,deliveries,provedor,pare,avancar(ms){agora+=ms}};
}
// Primeira varredura (marca o que existe) e depois chega andamento novo na Maria.
async function comAndamentoNovo(m,mov=CONCLUSOS){
  await m.A.varrer();
  m.store.set(m.store.rows.map(p=>p.id==='p1'?comAndamento(p,mov):p));
  return m.A.varrer();
}

test('primeira varredura não chama ninguém: o que já estava na carteira fica como visto',async()=>{
  const m=montar();
  const r=await m.A.varrer();
  assert.equal(r.primeira_vez,true);assert.equal(r.processos_com_andamento,0);
  assert.equal(m.entregas.length,0);
});

test('andamento oficial novo vira conversa escrita pela IA, uma vez só; ruído e histórico ficam fora',async()=>{
  const m=montar();
  await m.A.varrer();
  m.store.set([
    comAndamento(MARIA,CONCLUSOS),
    comAndamento(comAndamento(JOAO,{data:'2026-10-12',txt:'Liguei para o cliente',origem:'advogado'}),{data:'2026-08-01',txt:'[DATAJUD] Distribuído',origem:'datajud'}),
    ENCERRADO,
    {id:'p4',nome:'Processo novo na carteira',status:'ATIVO',setor:'judicial',andamentos:[{data:'2026-10-11',txt:'[PJe] Citação expedida',origem:'pje'}]}
  ]);
  const r=await m.A.varrer();
  assert.equal(r.processos_com_andamento,1,'só a Maria: anotação do advogado, andamento velho e processo recém-chegado não chamam');
  assert.equal(m.entregas.length,1);
  assert.match(m.entregas[0],/Quer que eu avise a cliente\?/);
  const {system,mensagem}=m.composicoes[0];
  assert.match(system,/nunca calcule nem afirme data de prazo/);assert.match(system,/não invente/);
  assert.match(mensagem,/Conclusos para decisão/);assert.match(mensagem,/"contato":"whatsapp"/);
  assert.doesNotMatch(mensagem,/Juntada|Citação expedida|Liguei/);
  await m.A.varrer();
  assert.equal(m.entregas.length,1,'mesmo andamento não chama de novo');
});

test('sem IA o LEX diz a verdade em poucas linhas; com IA falhando também',async()=>{
  for(const over of [{semIa:true},{iaFalha:true}]){
    const m=montar(over);
    await comAndamentoNovo(m);
    assert.equal(m.entregas.length,1);
    assert.match(m.entregas[0],/Maria Silva x Banco Alfa — 12\/10\/2026: Conclusos para decisão/);
    assert.match(m.entregas[0],/A IA está indisponível agora/);
  }
});

test('fora do horário guarda para depois; entrega que falha tenta de novo, sem repetir depois que der certo',async()=>{
  const horario={fora:true};
  const m=montar({horario});
  await comAndamentoNovo(m);
  assert.equal(m.entregas.length,0);
  horario.fora=false;
  await m.A.varrer();await m.A.varrer();
  assert.equal(m.entregas.length,1);
  const falha={ativa:true};
  const n=montar({entregaFalha:falha});
  await comAndamentoNovo(n);
  assert.equal(n.entregas.length,1);
  falha.ativa=false;
  await n.A.varrer();await n.A.varrer();
  assert.equal(n.entregas.length,2,'uma tentativa que falhou e uma que deu certo');
});

test('a IA prepara, o código mostra, e só o "pode" logo depois da prévia envia — exatamente o texto mostrado',async()=>{
  const m=montar();
  await comAndamentoNovo(m);
  const p=await m.A.preparar({processo_id:'p1',texto:TEXTO_MARIA,conversa:'telegram:1',turno:'T1',perfil:'admin'});
  assert.equal(p.ok,true);assert.equal(p.para.contato,'WhatsApp +55 61 98888-7777');assert.match(p.observacao,/Nunca diga que enviou/);
  // Sem a prévia mostrada, "pode" não envia nada.
  let r=await m.A.confirmarSeFor({conversa:'telegram:1',mensagem:'pode',perfil:'admin'});
  assert.equal(r.handled,false);assert.equal(m.deliveries.length,0);
  await m.A.preparar({processo_id:'p1',texto:TEXTO_MARIA,conversa:'telegram:1',turno:'T2',perfil:'admin'});
  const previa=await m.A.previaDoTurno({conversa:'telegram:1',turno:'T2'});
  assert.match(previa,/Vai sair assim/);assert.ok(previa.includes(TEXTO_MARIA));assert.match(previa,/Maria Silva/);assert.match(previa,/\+55 61 98888-7777/);
  r=await m.A.confirmarSeFor({conversa:'telegram:1',mensagem:'Pode!',perfil:'admin'});
  assert.equal(r.handled,true);assert.equal(r.enviado,true);assert.match(r.message,/mandei para Maria Silva/);
  assert.deepEqual(m.deliveries,[{origem:'whatsapp',id:'5561988887777',texto:TEXTO_MARIA}]);
  const lista=await m.A.listar();
  assert.equal(lista.andamentos.find(i=>i.processo_id==='p1').situacao,'cliente já avisado');
  const job=(await m.rec.list('lex_channel_command_')).find(j=>j.tipo==='mensagem_cliente');
  assert.equal(job.status,'enviado');assert.equal(job.confirmado_por,'admin','o recibo do dia mostra quem autorizou');
  r=await m.A.confirmarSeFor({conversa:'telegram:1',mensagem:'pode',perfil:'admin'});
  assert.equal(r.handled,false);assert.equal(m.deliveries.length,1,'o OK vale uma vez');
});

test('qualquer outra mensagem fecha a janela; prévia velha, outra conversa e secretária não autorizam',async()=>{
  const m=montar();
  await comAndamentoNovo(m);
  const abrir=async turno=>{await m.A.preparar({processo_id:'p1',texto:TEXTO_MARIA,conversa:'telegram:1',turno,perfil:'admin'});await m.A.previaDoTurno({conversa:'telegram:1',turno})};
  await abrir('A');
  assert.equal((await m.A.confirmarSeFor({conversa:'telegram:1',mensagem:'muda o final, fala que eu ligo amanhã',perfil:'admin'})).handled,false);
  assert.equal((await m.A.confirmarSeFor({conversa:'telegram:1',mensagem:'pode',perfil:'admin'})).handled,false,'a janela fechou com a mensagem anterior');
  await abrir('B');
  assert.equal((await m.A.confirmarSeFor({conversa:'whatsapp:outro',mensagem:'pode',perfil:'admin'})).handled,false,'OK de outra conversa não vale');
  m.avancar(31*60*1000);
  assert.equal((await m.A.confirmarSeFor({conversa:'telegram:1',mensagem:'pode',perfil:'admin'})).handled,false,'prévia de mais de 30 min não vale');
  await abrir('C');
  const sec=await m.A.confirmarSeFor({conversa:'telegram:1',mensagem:'pode',perfil:'secretaria'});
  assert.equal(sec.handled,true);assert.equal(sec.enviado,false);assert.match(sec.message,/Só o advogado/);
  assert.equal(m.deliveries.length,0);
});

test('PARE vale ao preparar e de novo na hora de enviar',async()=>{
  const m=montar();
  await comAndamentoNovo(m);
  await m.A.preparar({processo_id:'p1',texto:TEXTO_MARIA,conversa:'telegram:1',turno:'T',perfil:'admin'});
  await m.A.previaDoTurno({conversa:'telegram:1',turno:'T'});
  m.pare.add('5561988887777'); // a cliente pediu para parar depois da prévia
  const r=await m.A.confirmarSeFor({conversa:'telegram:1',mensagem:'manda',perfil:'admin'});
  assert.equal(r.handled,true);assert.equal(r.enviado,false);assert.match(r.message,/PARE/);
  assert.equal(m.deliveries.length,0);
  const de=await m.A.preparar({processo_id:'p1',texto:TEXTO_MARIA,conversa:'telegram:1',turno:'T2',perfil:'admin'});
  assert.equal(de.ok,false);assert.match(de.erro,/PARE/);
});

test('provedor fora: nada é dado como enviado, e dá para tentar de novo depois',async()=>{
  const m=montar();
  await comAndamentoNovo(m);
  m.provedor.falha=true;
  await m.A.preparar({processo_id:'p1',texto:TEXTO_MARIA,conversa:'telegram:1',turno:'T',perfil:'admin'});
  await m.A.previaDoTurno({conversa:'telegram:1',turno:'T'});
  let r=await m.A.confirmarSeFor({conversa:'telegram:1',mensagem:'pode',perfil:'admin'});
  assert.equal(r.enviado,false);assert.match(r.message,/Não consegui mandar para Maria Silva: o provedor não confirmou/);assert.match(r.message,/tente de novo\?/);
  assert.notEqual((await m.A.listar()).andamentos.find(i=>i.processo_id==='p1').situacao,'cliente já avisado');
  m.provedor.falha=false;
  await m.A.preparar({processo_id:'p1',texto:TEXTO_MARIA,conversa:'telegram:1',turno:'T2',perfil:'admin'});
  await m.A.previaDoTurno({conversa:'telegram:1',turno:'T2'});
  r=await m.A.confirmarSeFor({conversa:'telegram:1',mensagem:'pode',perfil:'admin'});
  assert.equal(r.enviado,true);
  assert.equal(m.deliveries.length,2,'uma tentativa recusada pelo provedor e uma aceita');
});

test('o OK vale só para o que foi mostrado na última resposta; número informado pelo titular fica gravado',async()=>{
  const m=montar();
  await comAndamentoNovo(m);
  await m.A.preparar({processo_id:'p1',texto:TEXTO_MARIA,conversa:'telegram:1',turno:'T1',perfil:'admin'});
  await m.A.previaDoTurno({conversa:'telegram:1',turno:'T1'});
  await m.A.confirmarSeFor({conversa:'telegram:1',mensagem:'espera, me fala do João antes',perfil:'admin'});
  const semContato=await m.A.preparar({processo_id:'p2',texto:'Olá, João! Tudo certo por aqui.',conversa:'telegram:1',turno:'T2',perfil:'admin'});
  assert.equal(semContato.ok,false);assert.match(semContato.erro,/Pergunte ao titular o WhatsApp do cliente/);
  const joao=await m.A.preparar({processo_id:'p2',texto:'Olá, João! Tudo certo por aqui.',whatsapp:'(61) 97777-6666',conversa:'telegram:1',turno:'T2',perfil:'admin'});
  assert.equal(joao.ok,true);assert.equal(joao.para.fonte,'informado pelo titular');
  const previa=await m.A.previaDoTurno({conversa:'telegram:1',turno:'T2'});
  assert.ok(previa.includes('Olá, João!'));assert.ok(!previa.includes(TEXTO_MARIA),'a da Maria não foi mostrada de novo');
  assert.match(previa,/\+55 61 97777-6666 \(número dito agora na conversa — confira\)/,'número que não estava gravado aparece por extenso e com alerta');
  const r=await m.A.confirmarSeFor({conversa:'telegram:1',mensagem:'ok',perfil:'admin'});
  assert.equal(r.enviado,true);
  assert.deepEqual(m.deliveries.map(d=>d.id),['5561977776666']);
  assert.equal(m.store.rows.find(p=>p.id==='p2').cliente_whatsapp,'5561977776666');
});

test('duas mensagens na mesma resposta saem com um OK; contatos ambíguos e marcadores são recusados',async()=>{
  const m=montar({contatos:{p2:[{telefone:'61966665555',nome:'João'},{telefone:'61955554444',nome:'Esposa do João'}]}});
  await comAndamentoNovo(m);
  const amb=await m.A.preparar({processo_id:'p2',texto:'Olá, João!',conversa:'telegram:1',turno:'T',perfil:'admin'});
  assert.equal(amb.ok,false);assert.match(amb.erro,/mais de um contato/);assert.equal(amb.contatos.length,2);
  for(const [texto,erro] of [['Olá, [NOME]!',/marcador/],['',/Escreva/],['x'.repeat(1600),/longa/]]){
    const r=await m.A.preparar({processo_id:'p1',texto,conversa:'telegram:1',turno:'T',perfil:'admin'});
    assert.equal(r.ok,false);assert.match(r.erro,erro);
  }
  assert.match((await m.A.preparar({processo_id:'p1',texto:TEXTO_MARIA,conversa:'telegram:1',turno:'T',perfil:'secretaria'})).erro,/Só advogado/);
  assert.match((await m.A.preparar({processo_id:'p1',texto:TEXTO_MARIA,turno:'T',perfil:'admin'})).erro,/Conversa sem identificação/);
  assert.match((await m.A.preparar({processo_id:'p1',texto:TEXTO_MARIA,whatsapp:'123',conversa:'telegram:1',turno:'T',perfil:'admin'})).erro,/inválido/);
  await m.A.preparar({processo_id:'p1',texto:TEXTO_MARIA,conversa:'telegram:1',turno:'T',perfil:'admin'});
  await m.A.preparar({processo_id:'p2',texto:'Olá, João! Tudo certo.',whatsapp:'61966665555',conversa:'telegram:1',turno:'T',perfil:'admin'});
  await m.A.previaDoTurno({conversa:'telegram:1',turno:'T'});
  const r=await m.A.confirmarSeFor({conversa:'telegram:1',mensagem:'pode mandar',perfil:'advogado'});
  assert.equal(r.enviado,true);assert.equal(m.deliveries.length,2);
});

test('"não precisa" fica registrado; a IA enxerga o que está em aberto e para de insistir',async()=>{
  const m=montar();
  await comAndamentoNovo(m);
  const ctx=await m.A.contextoParaIA();
  assert.match(ctx,/ANDAMENTOS NOVOS QUE VOCÊ JÁ LEVOU AO TITULAR/);assert.match(ctx,/processo_id p1/);assert.match(ctx,/whatsapp gravado/);
  const d=await m.A.descartar({processo_id:'p1',conversa:'telegram:1',perfil:'admin'});
  assert.equal(d.ok,true);
  assert.equal((await m.A.listar()).andamentos[0].situacao,'titular decidiu não avisar');
  assert.equal(await m.A.contextoParaIA(),null);
});

test('desligar para de chamar; religar recomeça do zero, sem enxurrada do que entrou no meio',async()=>{
  const m=montar();
  await m.A.varrer();
  assert.equal((await m.A.ligar({ligar:false,perfil:'admin'})).ligado,false);
  m.store.set(m.store.rows.map(p=>p.id==='p1'?comAndamento(p,CONCLUSOS):p));
  assert.equal((await m.A.varrer()).ativo,false);
  assert.equal((await m.A.ligar({ligar:true,perfil:'secretaria'})).ok,false);
  assert.equal((await m.A.ligar({ligar:true,perfil:'admin'})).ligado,true);
  const r=await m.A.varrer();
  assert.equal(r.primeira_vez,true);assert.equal(m.entregas.length,0);
  m.store.set(m.store.rows.map(p=>p.id==='p1'?comAndamento(p,SENTENCA):p));
  await m.A.varrer();
  assert.equal(m.entregas.length,1);
});

test('OK de verdade é curto e sem ressalva',()=>{
  for(const s of ['pode','Pode!','pode mandar','manda','sim','Sim, pode','ok','👍','manda aí','aprovo'])assert.equal(ehOk(s),true,s);
  for(const s of ['não','pode não','manda só a da Maria','muda o texto','espera','pode mandar amanhã cedo','qual o prazo?',''])assert.equal(ehOk(s),false,s);
});

test('ferramentas: a IA prepara e descarta, mas não existe ferramenta de envio',async()=>{
  const m=montar();
  await comAndamentoNovo(m);
  const nomes=LexTools.definitions({}).map(d=>d.name);
  for(const n of ['andamentos_para_comunicar','preparar_mensagem_cliente','descartar_mensagem_cliente','avisos_de_andamento'])assert.ok(nomes.includes(n),n);
  assert.ok(!nomes.some(n=>/enviar|mandar|send/.test(n)),'nenhuma ferramenta envia mensagem ao cliente');
  const deps={andamentos:m.A,processStore:m.store};
  const lista=await LexTools.executar('andamentos_para_comunicar',{},deps,{profile:'admin'});
  assert.equal(lista.andamentos[0].processo_id,'p1');
  const p=await LexTools.executar('preparar_mensagem_cliente',{processo_id:'p1',texto:TEXTO_MARIA},deps,{profile:'admin',conversa:'telegram:1',turno:'X'});
  assert.equal(p.ok,true);assert.equal(m.deliveries.length,0,'preparar nunca envia');
});

// ---------- conversa de verdade: modelo falso chamando a ferramenta pelo app ----------
function fakeHttps(script){
  const calls=[];
  return{calls,request(opts,onRes){
    const req=new EventEmitter();let body='';
    req.write=c=>{body+=c};req.setTimeout=()=>{};req.destroy=()=>{};
    req.end=()=>{calls.push(JSON.parse(body));const r=new EventEmitter();r.statusCode=200;const out=script.shift()||{content:[{type:'text',text:'(sem roteiro)'}],stop_reason:'end_turn'};onRes(r);setImmediate(()=>{r.emit('data',JSON.stringify(out));r.emit('end')})};
    return req;
  }};
}

test('pelo app: "avisa a Maria" → a IA escreve, o LEX mostra; "pode" envia sem passar pelo modelo',async()=>{
  const m=montar();
  await comAndamentoNovo(m);
  const https=fakeHttps([
    {content:[{type:'tool_use',id:'tu1',name:'preparar_mensagem_cliente',input:{processo_id:'p1',texto:TEXTO_MARIA}}],stop_reason:'tool_use'},
    {content:[{type:'text',text:'Escrevi para a Maria explicando que o processo foi para decisão. Posso mandar?'}],stop_reason:'end_turn'}
  ]);
  const d={processStore:m.store,engine:{list:async()=>[]},records:m.rec,andamentos:m.A,ANTHROPIC_KEY:'k',https,perfil:'admin',CORS:{},log(){},
    executeNaturalOfficeCommand:async()=>null,assertTaskGate:async()=>{},runTask:async()=>{}};
  const res=()=>{const r={};r.writeHead=s=>{r.status=s};r.end=b=>{r.body=JSON.parse(b)};return r};
  let r=res();
  await vivo.tratarRota({method:'POST',headers:{}},r,'/api/vivo/conversar',{...d,body:{mensagem:'avisa a Maria'}});
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.match(r.body.texto,/Posso mandar\?/);assert.match(r.body.texto,/Vai sair assim/);assert.ok(r.body.texto.includes(TEXTO_MARIA));
  assert.match(https.calls[0].system,/ANDAMENTOS NOVOS QUE VOCÊ JÁ LEVOU AO TITULAR/);
  assert.match(https.calls[0].system,/Nada de texto pronto/);
  assert.equal(m.deliveries.length,0);
  r=res();
  await vivo.tratarRota({method:'POST',headers:{}},r,'/api/vivo/conversar',{...d,body:{mensagem:'pode'}});
  assert.match(r.body.texto,/mandei para Maria Silva/);assert.equal(r.body.execucao.action,'mensagem_cliente_ok');
  assert.equal(https.calls.length,2,'o OK não passa pelo modelo');
  assert.deepEqual(m.deliveries,[{origem:'whatsapp',id:'5561988887777',texto:TEXTO_MARIA}]);
});

test('resposta sem preparar mensagem não mostra prévia nem arma envio',async()=>{
  const m=montar();
  await comAndamentoNovo(m);
  const https=fakeHttps([{content:[{type:'text',text:'Esse andamento é de rotina; não precisa avisar.'}],stop_reason:'end_turn'}]);
  const d={processStore:m.store,engine:{list:async()=>[]},records:m.rec,andamentos:m.A,ANTHROPIC_KEY:'k',https};
  const out=await core.conversarLex({...d,tools:vivo.lexToolsFor(d,{profile:'admin',conversa:'telegram:1'})},{mensagem:'precisa avisar?',historico:[],canal:'telegram'});
  assert.equal(out.texto,'Esse andamento é de rotina; não precisa avisar.');
  assert.equal(await m.A.temJanela('telegram:1'),false);
});

// ---------- ligação no servidor (bot.js) ----------
test('servidor: o OK do titular é conferido antes da IA, e o "pode" solto do WhatsApp só segue com prévia aberta ou IA no ar',async()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const source=fs.readFileSync(require.resolve('../bot.js'),'utf8');
  const ini=source.indexOf('async function processarMensagem('),fim=source.indexOf('\nasync function ',ini+30);
  const proc=source.slice(ini,fim);
  assert.ok(proc.indexOf('andamentoConversa.confirmarSeFor')>0,'gate no tratamento das mensagens do titular');
  assert.ok(proc.indexOf('andamentoConversa.confirmarSeFor')<proc.indexOf('lex_agente_vivo.conversarLex('),'o OK é conferido antes de qualquer chamada ao modelo');
  assert.match(proc,/lexToolsFor\(vivoDeps,\{[^}]*chatId\}/,'as ferramentas sabem de qual conversa vieram');
  // Adaptador do WhatsApp executado isolado, como nos testes da porta de entrada.
  const {isWhatsappOperator}=require('../lib/integration-status');
  const rodar=async({conversaAtiva,previaAberta})=>{
    let chamadas=0;const enviados=[];
    const c=vm.createContext({process:{env:{LEX_OPERATOR_WHATSAPP:'5561999171717'}},global:{},isWhatsappOperator,claimWhatsappEvent:async()=>true,EVO_INST:'LEX',
      _idLex:()=>require('../lib/office-identity').getIdentity(),_titularSaudacao:()=>'Dr.',
      _lexConversaAtiva:()=>conversaAtiva,_okDoTitularAberto:async()=>previaAberta,
      publicWhatsappReception:async()=>true,handleWhatsappOperatorCommand:async()=>false,envWhatsApp:async t=>{enviados.push(t);return true},
      processarMensagem:async()=>{chamadas++}});
    const start=source.indexOf('async function adapterEvolution(');
    vm.runInContext(source.slice(start,source.indexOf('async function ',start+30)),c);
    await c.adapterEvolution({data:{key:{id:'k'+Math.random(),fromMe:false,remoteJid:'556199171717@s.whatsapp.net'},message:{conversation:'pode'},pushName:'Titular'}});
    return{chamadas,enviados};
  };
  assert.equal((await rodar({conversaAtiva:false,previaAberta:true})).chamadas,1,'prévia aberta: o "pode" chega ao gate');
  assert.equal((await rodar({conversaAtiva:true,previaAberta:false})).chamadas,1,'IA no ar: a conversa entende o "pode"');
  const nada=await rodar({conversaAtiva:false,previaAberta:false});
  assert.equal(nada.chamadas,0);assert.match(nada.enviados[0],/Nenhuma mensagem foi autorizada/);
});

// Apontamento do CodeRabbit no PR #162: reconciliar não pode soltar mensagem cuja fila ainda pode entregar.
test('reinício no meio do envio: fila ainda ativa mantém a mensagem em envio; só fila parada devolve para o OK',async()=>{
  const m=montar();
  const rascunho=(id,extra)=>m.rec.change('lex_cliente_msg_'+id,()=>({id,conversa:'telegram:1',processo_id:'p1',processo:'Maria Silva x Banco Alfa',
    destino:{origem:'whatsapp',id:'5561988887777',nome:'Maria Silva'},texto:TEXTO_MARIA,status:'enviando',tentativas:1,
    preparado_em:new Date(Date.parse('2026-10-13T12:40:00Z')).toISOString(),aprovado_em:new Date(Date.parse('2026-10-13T12:45:00Z')).toISOString(),...extra}));
  // a) job ainda "confirmado" na fila (não terminal), com job_id gravado
  const ativo=await m.outbox.enqueueApproved({origem:'whatsapp',id:'5561988887777',texto:TEXTO_MARIA,confirmado_por:'admin',request_id:'cliente-a-1'});
  await rascunho('a',{job_id:ativo.id});
  // b) caiu entre criar o job e gravar o job_id: o id do job é previsível pelo rascunho
  await m.rec.change('lex_channel_command_cliente-b-1',()=>({id:'cliente-b-1',origem:'whatsapp',contato_id:'5561911112222',status:'enviando',texto_final:'x'}));
  await rascunho('b',{job_id:null});
  // c) fila terminou falhando
  await m.rec.change('lex_channel_command_cliente-c-1',()=>({id:'cliente-c-1',origem:'whatsapp',contato_id:'5561933334444',status:'falhou',last_error:'reinício'}));
  await rascunho('c',{job_id:'cliente-c-1'});
  // d) nenhum job na fila
  await rascunho('d',{job_id:null});
  await m.A.reconciliarEnvios();
  const st=async id=>(await m.rec.read('lex_cliente_msg_'+id)).value;
  assert.equal((await st('a')).status,'enviando');assert.equal((await st('a')).job_id,ativo.id,'continua ligado ao job da fila');
  assert.equal((await st('b')).status,'enviando','job achado pelo id previsível');
  assert.equal((await st('c')).status,'aguardando_ok');assert.match((await st('c')).ultimo_erro,/confira a conversa/);
  assert.equal((await st('d')).status,'aguardando_ok');
});
