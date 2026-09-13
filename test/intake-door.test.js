'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {intakeDecision,INTRO}=require('../lib/intake-door');
const {publicWhatsappReception,handleWhatsappOperatorCommand,whatsappAccessMode}=require('../lib/integration-status');
const {createTelegramReception,isTelegramOwner}=require('../lib/telegram-reception');
const vm=require('node:vm');
const fs=require('node:fs');

function turn(history,text,data={}) {
  const decision=intakeDecision(text,data,[...history].reverse());
  history.push({direcao:'entrada',texto:text},{direcao:'saida_lex',texto:decision.reply});
  return decision;
}
test('print: oi + quem é vc tem apresentação única e não arquiva',()=>{
  const d=intakeDecision('Oi | Quem é vc?');
  assert.equal(d.reply,INTRO);assert.equal(d.archive,false);
  assert.match(d.reply,/assistente virtual.*LEX Jurídico.*Dr. Kleuber/);
});
test('Kleuber → João da Silva mantém o pedido e não pergunta o nome novamente',()=>{
  const history=[];
  assert.equal(turn(history,'Quero falar com Kleuber').kind,'lawyer');
  const next=turn(history,'João da Silva');
  assert.equal(next.kind,'lawyer');assert.equal(next.name,'João da Silva');
  assert.match(next.reply,/Dr. Kleuber/);assert.doesNotMatch(next.reply,/diga seu nome/);
  const third=turn(history,'Ele pode me retornar?');
  assert.equal(third.name,'João da Silva');assert.doesNotMatch(third.reply,/diga seu nome/);
});
test('nome espontâneo explícito → assunto avança e não repete cadastro',()=>{
  const history=[];
  assert.equal(turn(history,'Meu nome é João da Silva').name,'João da Silva');
  const d=turn(history,'Fui demitido');
  assert.equal(d.destino,'cadastro');assert.doesNotMatch(d.reply,/diga seu nome/);
});
test('intenção não pode ser confundida com nome após pergunta de identificação',()=>{
  const history=[];turn(history,'Preciso de ajuda');
  for(const text of ['Quero falar com Kleuber','Quem é você?','Preciso de ajuda','Sim autorizo']) {
    assert.equal(intakeDecision(text,{},[...history].reverse()).name,null);
  }
});
test('consentimento não vira caso nem autorização jurídica',()=>{
  const d=intakeDecision('Sim autorizo');
  assert.equal(d.kind,'consent');assert.equal(d.destino,'recepcao');
  assert.match(d.reply,/não autoriza decisões/);
});
test('porta separa cadastro, instrução, andamento e perícia sem calcular',()=>{
  for(const [text,destino] of [['Fui demitido','cadastro'],['Segue documento','instrucao'],['Informação do processo','andamento'],['Perícia de juros de 123 mil','pericia']]) {
    const d=intakeDecision(text);assert.equal(d.destino,destino);assert.equal(d.requiresApproval,true);
    assert.doesNotMatch(d.reply,/123|R\$|heurística|classificação automática/i);
  }
});
test('identidade e administrativo nunca arquivam automaticamente',()=>{
  for(const text of ['Quem é vc?','Sou fornecedor e tenho fatura']) assert.equal(intakeDecision(text).archive,false);
});
test('mudança explícita de assunto prevalece sobre histórico antigo',()=>{
  const h=[];turn(h,'Quero falar com Kleuber');turn(h,'João da Silva');
  assert.equal(turn(h,'Agora preciso de perícia contábil').destino,'pericia');
});
const cfg={operator:'5561999171717',url:'https://example.invalid',key:'test'};
const body=(text,sender='5561988888888')=>({data:{key:{id:text,fromMe:false,remoteJid:sender+'@s.whatsapp.net'},message:{conversation:text},pushName:'Contato'}});
test('WhatsApp real da função: dois turnos consultam histórico e reportam uma vez por turno',async()=>{
  const history=[],sent=[],names=[];
  const store={history:async()=>[...history].reverse(),upsert:async(_,nome)=>{names.push(nome);return {classe:'geral'};},appendEvent:async e=>history.push(e)};
  const request=async(_,opts)=>{sent.push(opts.data);return {key:{id:'sent'}};};
  for(const input of ['Quero falar com Kleuber','João da Silva']) await publicWhatsappReception(body(input),'LEX',{...cfg,store,request});
  const clients=sent.filter(x=>x.number!=='5561999171717');
  const reports=sent.filter(x=>x.number==='5561999171717');
  assert.equal(clients.length,2);assert.equal(reports.length,2);
  assert.match(clients[1].text,/João da Silva/);assert.doesNotMatch(clients[1].text,/diga seu nome/);
  assert.match(reports[1].text,/AGUARDA SUA DECISÃO/);assert.equal(names[1],'João da Silva');
});
test('terceiro não executa /responder mesmo chamando o handler diretamente',async()=>{
  let sent=0;
  const result=await handleWhatsappOperatorCommand(body('/responder 5561987777777 Aceito o acordo'),'LEX',{...cfg,request:async()=>{sent++;}});
  assert.equal(result,false);assert.equal(sent,0);
});
test('operador brasileiro sem nono dígito tem mesma autoridade, ausente não libera legado',()=>{
  assert.equal(whatsappAccessMode('556199171717@s.whatsapp.net',cfg.operator),'operator');
  assert.equal(whatsappAccessMode('5561988888888@s.whatsapp.net',''),'public');
});
test('autorização envia exatamente o texto ao destinatário indicado, sem reescrita',async()=>{
  const sent=[];
  await handleWhatsappOperatorCommand(body('/responder 5561988888888 Analisei. Retorno às 15h.',cfg.operator),'LEX',{...cfg,request:async(_,o)=>{sent.push(o.data);return {key:{id:'ok'}};},store:{appendEvent:async()=>{}}});
  assert.equal(sent[0].number,'5561988888888');assert.equal(sent[0].text,'Analisei. Retorno às 15h.');
});
function recordFake(){const map=new Map();return {map,read:async k=>map.has(k)?{value:structuredClone(map.get(k))}:null,list:async()=>[...map.values()],change:async(k,fn)=>{const v=await fn(structuredClone(map.get(k)||null));if(v!==undefined)map.set(k,v);return v;}};}
const tg=(id,text,n=1,extra={})=>({chat:{id,type:'private'},from:{id,first_name:'Contato'},message_id:n,text,...extra});
test('Telegram: mesma porta e memória sobrevivem à recriação do serviço',async()=>{
  const records=recordFake(),sent=[],reported=[];
  const options={records,owner:'7171',send:async(id,text)=>{sent.push({id,text});return true;},report:async t=>{reported.push(t);return true;}};
  await createTelegramReception(options).receive(tg('123','Quero falar com Kleuber'));
  await createTelegramReception(options).receive(tg('123','João da Silva',2));
  assert.match(sent[1].text,/João da Silva/);assert.doesNotMatch(sent[1].text,/diga seu nome/);assert.equal(reported.length,2);
});
test('Telegram: documento com pedido pericial apenas registra setor e referência',async()=>{
  const records=recordFake();
  const service=createTelegramReception({records,owner:'7171',send:async()=>true,report:async()=>true});
  await service.receive(tg('123','',1,{caption:'Perícia contábil',document:{file_id:'doc-1'}}));
  const row=[...records.map.values()][0];assert.equal(row.destino,'pericia');assert.equal(row.ultimo_arquivo.file_id,'doc-1');
  assert.equal(row.requiresApproval,true);assert.equal(row.status,'aguardando_advogado');
});
test('Telegram: grupo, encaminhamento de comando e terceiro não autorizam envio',async()=>{
  assert.equal(isTelegramOwner(tg('7171','x',1,{from:{id:'123'}}),'7171'),false);
  const sent=[];const service=createTelegramReception({records:recordFake(),owner:'7171',send:async(...x)=>sent.push(x),report:async()=>true});
  assert.equal(await service.ownerCommand(tg('123','/respondertg 999 orientação')),false);
  assert.equal(await service.receive(tg('123','/liberar 123 admin',1,{chat:{id:'-123',type:'group'}})),false);
  assert.equal(sent.length,0);
});
test('Telegram: banco indisponível não aciona motor e não afirma registro',async()=>{
  const sent=[];const service=createTelegramReception({records:{change:async()=>{throw Error('offline');}},owner:'7171',send:async(_,t)=>{sent.push(t);return true;},report:async()=>true});
  assert.equal(await service.receive(tg('123','Meu processo')),false);assert.match(sent[0],/Não consegui registrar/);
});
test('Telegram: entrega repetida não duplica resposta',async()=>{
  let sends=0;const service=createTelegramReception({records:recordFake(),owner:'7171',send:async()=>{sends++;return true;},report:async()=>true});
  await service.receive(tg('123','Oi'));await service.receive(tg('123','Oi'));assert.equal(sends,1);
});
test('legado: ok/sim e mensagem livre não enviam para vários clientes',async()=>{
  const source=fs.readFileSync(require.resolve('../bot.js'),'utf8');
  const cut=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
  const c=vm.createContext({});
  vm.runInContext(cut('async function _registrarRespostaAdvogadoWhats(', '// ── MEDIAÇÃO INTELIGENTE: Lex pega')+cut('async function _processarAutorizacaoLex(', 'async function _conversarWhatsAppCliente('),c);
  assert.equal((await c._registrarRespostaAdvogadoWhats('Oi')).notificados,0);
  for(const text of ['ok','sim','autorizo','pode mandar']) assert.equal(await c._processarAutorizacaoLex(text),false);
});

test('adaptador Telegram interrompe texto e documento de terceiro antes do download e motor',async()=>{
  const source=fs.readFileSync(require.resolve('../bot.js'),'utf8');
  let calls=0;
  const c=vm.createContext({CHAT_ID:'7171',isTelegramOwner,telegramReception:{receive:async()=>{calls++;return true;}},
    processarMensagem:()=>{throw Error('motor não autorizado');},baixarTelegram:()=>{throw Error('download indevido');}});
  vm.runInContext(source.slice(source.indexOf('async function adapterTelegram('),source.indexOf('// ── EVOLUTION (WhatsApp) adapter')),c);
  await c.adapterTelegram(tg('123','Quem é vc?'));
  await c.adapterTelegram(tg('123','',2,{document:{file_id:'x',mime_type:'application/pdf'}}));
  assert.equal(calls,2);
});

test('adaptador WhatsApp reconhece dono no JID legado e não o cadastra',async()=>{
  const source=fs.readFileSync(require.resolve('../bot.js'),'utf8');
  let calls=0;const sent=[];
  const c=vm.createContext({process:{env:{LEX_OPERATOR_WHATSAPP:cfg.operator}},whatsappAccessMode,EVO_INST:'LEX',
    handleWhatsappOperatorCommand:async()=>false,envWhatsApp:async t=>sent.push(t),processarMensagem:async()=>{calls++;}});
  const start=source.indexOf('async function adapterEvolution(');
  const end=source.indexOf('async function ',start+30);
  vm.runInContext(source.slice(start,end),c);
  await c.adapterEvolution(body('Oi','556199171717'));
  assert.match(sent[0],/Dr. Kleuber/);assert.equal(calls,0);
  await c.adapterEvolution(body('Prepare uma tarefa','556199171717'));assert.equal(calls,1);
});

test('saída interna do cadastrador envia resumo e pergunta somente ao dono',async()=>{
  const source=fs.readFileSync(require.resolve('../bot.js'),'utf8');
  const sent=[];const c=vm.createContext({process:{env:{LEX_OPERATOR_WHATSAPP:cfg.operator}},envWhatsApp:async(text,to)=>{sent.push({text,to});return true;}});
  vm.runInContext(source.slice(source.indexOf('async function _enviarIntakeParaRevisao('),source.indexOf('async function _cadastradorRecebeu(')),c);
  await c._enviarIntakeParaRevisao({chatId:'CLIENTE'},'Área identificada: Cível','Confirme seus documentos');
  assert.equal(sent.length,1);assert.equal(sent[0].to,cfg.operator);
  assert.match(sent[0].text,/Área identificada/);assert.match(sent[0].text,/não foi enviado ao cliente/);
});
