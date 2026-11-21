'use strict';
// Ligações por voz ao cliente (Etapa 1): só saem com o OK do titular, só dentro do horário,
// nunca para quem pediu para não receber; o resultado volta gravado no processo e ao titular.
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createVozLigacoes,telefoneParaLigar,telefoneLegivel}=require('../lib/voz-ligacoes');
const {createRetellProvider}=require('../lib/voz-retell');

function records(){
  const map=new Map();
  return{
    async read(key){return map.has(key)?{value:structuredClone(map.get(key)),stamp:new Date().toISOString()}:null},
    async change(key,fn){const old=map.has(key)?structuredClone(map.get(key)):null;const next=await fn(old);if(next!==undefined){if(next===null)map.delete(key);else map.set(key,structuredClone(next))}return next===undefined?old:structuredClone(next)},
    async list(prefix){return[...map.entries()].filter(([k])=>k.startsWith(prefix)).map(([,v])=>structuredClone(v)).filter(v=>v!=null)},
    map
  };
}
function carteira(rows){
  let ps=structuredClone(rows);
  return{async read(){return{processes:structuredClone(ps),version:1}},
    async mutate(fn){const copy=structuredClone(ps);const value=await fn(copy);ps=copy;return{value}},get rows(){return ps}};
}
const ENV={RETELL_API_KEY:'key_teste',RETELL_AGENT_ID:'agent_1',LEX_VOZ_NUMERO:'+5561933334444'};
const MARIA={id:'p1',nome:'Maria Silva x INSS',cliente:'Maria Silva',status:'ATIVO',andamentos:[{data:'2026-11-10',txt:'[DJEN] Perícia designada',origem:'djen'}]};
const assinar=(corpo,ms,chave='key_teste')=>'v='+ms+',d='+crypto.createHmac('sha256',chave).update(corpo+ms).digest('hex');

function montar(over={}){
  const rec=records(),store=carteira(over.processos||[MARIA]);
  let agora=over.agora??Date.parse('2026-11-23T13:00:00Z'); // segunda, 10h em Brasília
  const pedidos=[],entregas=[],composicoes=[],pare=new Set(over.pare||[]);
  const respostas=over.respostas||[];
  const fetchImpl=async(url,opts)=>{
    pedidos.push(JSON.parse(opts.body));
    const r=respostas.length?respostas.shift():{status:201,body:{call_id:'call_'+pedidos.length,call_status:'registered'}};
    if(r.lanca)throw new Error(r.lanca);
    return{status:r.status,ok:r.status<300,text:async()=>JSON.stringify(r.body||{})};
  };
  const env={...ENV,...(over.env||{})};
  const provider=createRetellProvider({env,fetchImpl,now:()=>agora});
  const V=createVozLigacoes({records:rec,processStore:store,provider:over.semProvedor?null:provider,env,now:()=>agora,log:()=>{},
    identidade:()=>({escritorioFrase:'escritório Camargos Advocacia',titular:'Wanderson Camargos'}),
    podeReceber:async n=>{if(over.pareFalha)throw new Error('banco fora');return!pare.has(n)},
    iaDisponivel:()=>!over.semIa,
    compor:async({system,mensagem})=>{composicoes.push({system,mensagem});if(over.iaFalha)throw new Error('ia fora');return over.resumoIa||JSON.stringify({resumo:'Maria confirmou que vai à perícia de terça às 9h e vai levar os exames.',combinado:'Levar exames e documento com foto.',pediu_para_nao_ligar:false,pendencias:''})},
    entregarAoTitular:async texto=>{entregas.push(texto);return over.entregaFalha?.ativa?[{ok:false}]:[{conversa:'telegram:1',ok:true}]}});
  return{V,rec,store,pedidos,entregas,composicoes,pare,provider,avancar(ms){agora+=ms},get agora(){return agora}};
}
const PEDIDO={id:'L1',processo_id:'p1',processo:'Maria Silva x INSS',cliente:'Maria Silva',telefone:'+5561988887777',
  objetivo:'Lembrar a Maria da perícia médica de terça, 25/11, às 9h, no fórum de Unaí, e pedir que leve os exames.',aprovado_por:'admin',conversa:'telegram:1'};

async function avisar(m,ev){
  const corpo=JSON.stringify(ev);
  return m.V.receberAviso({corpo,assinatura:assinar(corpo,m.agora)});
}
const FIM={event:'call_ended',call:{call_id:'call_1',call_status:'ended',metadata:{ligacao_id:'L1',processo_id:'p1'},start_timestamp:1000,end_timestamp:181000,
  disconnection_reason:'agent_hangup',transcript:'Agent: Olá! Aqui é a assistente virtual...\nUser: Sou eu, a Maria.\nAgent: ...\nUser: Vou sim, levo os exames.',recording_url:'https://grav/1.wav'}};

test('número para ligar: só telefone brasileiro, em +55 com DDD; código interno do WhatsApp não serve',()=>{
  assert.equal(telefoneParaLigar('61988887777'),'+5561988887777');
  assert.equal(telefoneParaLigar('(61) 98888-7777'),'+5561988887777');
  assert.equal(telefoneParaLigar('5561988887777'),'+5561988887777');
  assert.equal(telefoneParaLigar('+55 61 98888-7777'),'+5561988887777');
  assert.equal(telefoneParaLigar('061988887777'),'+5561988887777');
  assert.equal(telefoneParaLigar('556188887777'),'+5561988887777','WhatsApp antigo sem o 9: celular ganha o 9');
  assert.equal(telefoneParaLigar('6133334444'),'+556133334444','fixo');
  assert.equal(telefoneParaLigar('12345678901234'),null,'LID do WhatsApp');
  assert.equal(telefoneParaLigar('+1 415 555 0100'),null);
  assert.equal(telefoneParaLigar('0161988887777'),null,'DDD inválido');
  assert.equal(telefoneParaLigar(''),null);
  assert.equal(telefoneLegivel('+5561988887777'),'+55 61 98888-7777');
});

test('desligado sem a conta da plataforma: nada é discado e o motivo é claro',async()=>{
  const m=montar({env:{RETELL_API_KEY:''}});
  assert.equal(m.V.configurado(),false);
  const r=await m.V.ligar(PEDIDO);
  assert.equal(r.ok,false);assert.equal(r.codigo,'desligado');assert.match(r.motivo,/não estão ligadas|plataforma/);
  assert.equal(m.pedidos.length,0);
});

test('liga dentro do horário, com abertura que se identifica como assistente virtual e avisa a gravação',async()=>{
  const m=montar();
  const r=await m.V.ligar(PEDIDO);
  assert.equal(r.ok,true);assert.equal(r.ligacao_id,'L1');
  assert.equal(m.pedidos.length,1);
  const p=m.pedidos[0];
  assert.equal(p.to_number,'+5561988887777');assert.equal(p.from_number,'+5561933334444');
  assert.deepEqual(p.metadata,{ligacao_id:'L1',processo_id:'p1'});
  assert.equal(p.idempotency_key,'lex-L1');
  const {abertura,instrucoes}=p.retell_llm_dynamic_variables;
  assert.match(abertura,/assistente virtual do escritório Camargos Advocacia/);
  assert.match(abertura,/gravada/);assert.match(abertura,/Maria\?/);assert.doesNotMatch(abertura,/perícia|INSS/,'abertura não revela nada do caso antes de saber quem atendeu');
  assert.match(instrucoes,/Lembrar a Maria da perícia/);
  assert.match(instrucoes,/não substitui as funções do advogado/i,'aviso legal entra em todo prompt');
  assert.match(instrucoes,/confirme que está falando com Maria/i);
  assert.match(instrucoes,/caixa postal/i);assert.match(instrucoes,/não quer receber ligações/i);
  assert.match(instrucoes,/nunca dê opinião jurídica|não dê opinião jurídica/i);
  const reg=(await m.rec.read('lex_voz_ligacao_L1')).value;
  assert.equal(reg.status,'em_andamento');assert.equal(reg.call_id,'call_1');
  // O mesmo OK não disca duas vezes.
  const de_novo=await m.V.ligar(PEDIDO);
  assert.equal(de_novo.ok,true);assert.equal(de_novo.ja_existia,true);assert.equal(m.pedidos.length,1);
});

test('fora do horário (domingo, noite, sábado à tarde) não liga',async()=>{
  for(const quando of ['2026-11-22T13:00:00Z','2026-11-23T23:30:00Z','2026-11-23T11:30:00Z','2026-11-21T18:00:00Z']){
    const m=montar({agora:Date.parse(quando)});
    const r=await m.V.ligar(PEDIDO);
    assert.equal(r.ok,false,quando);assert.equal(r.codigo,'fora_do_horario',quando);assert.equal(m.pedidos.length,0,quando);
  }
  const sabadoCedo=montar({agora:Date.parse('2026-11-21T13:00:00Z')}); // sábado 10h
  assert.equal((await sabadoCedo.V.ligar(PEDIDO)).ok,true);
  const semSabado=montar({agora:Date.parse('2026-11-21T13:00:00Z'),env:{LEX_VOZ_SABADO:'0'}});
  assert.equal((await semSabado.V.ligar(PEDIDO)).codigo,'fora_do_horario');
});

test('quem pediu para não receber (PARE no WhatsApp ou "não me ligue" numa ligação) não recebe; dúvida também bloqueia',async()=>{
  const pare=montar({pare:['5561988887777']});
  assert.equal((await pare.V.ligar(PEDIDO)).codigo,'nao_ligar');assert.equal(pare.pedidos.length,0);
  const pareSem9=montar({pare:['556188887777']});
  assert.equal((await pareSem9.V.ligar(PEDIDO)).codigo,'nao_ligar','PARE gravado no número antigo do WhatsApp também vale');
  const falha=montar({pareFalha:true});
  assert.equal((await falha.V.ligar(PEDIDO)).codigo,'nao_ligar','sem conseguir conferir, não liga');
  const m=montar();
  await m.V.marcarNaoLigar('+5561988887777','teste');
  assert.equal((await m.V.ligar(PEDIDO)).codigo,'nao_ligar');assert.equal(m.pedidos.length,0);
});

test('teto diário de ligações',async()=>{
  const m=montar({env:{LEX_VOZ_TETO_DIARIO:'1'}});
  assert.equal((await m.V.ligar(PEDIDO)).ok,true);
  const r=await m.V.ligar({...PEDIDO,id:'L2'});
  assert.equal(r.ok,false);assert.equal(r.codigo,'teto_diario');assert.equal(m.pedidos.length,1);
});

test('recusa da plataforma não vira sucesso; queda de rede repete com a mesma chave e, sem resposta, fica incerta',async()=>{
  const recusa=montar({respostas:[{status:402,body:{error_message:'no balance'}}]});
  const r=await recusa.V.ligar(PEDIDO);
  assert.equal(r.ok,false);assert.match(r.motivo,/saldo|crédito/);
  assert.equal((await recusa.rec.read('lex_voz_ligacao_L1')).value.status,'falhou_ao_discar');
  const volta=montar({respostas:[{lanca:'ECONNRESET'}]});
  const r2=await volta.V.ligar(PEDIDO);
  assert.equal(r2.ok,true,'segunda tentativa com a mesma chave idempotente respondeu');
  assert.equal(volta.pedidos.length,2);assert.equal(volta.pedidos[0].idempotency_key,volta.pedidos[1].idempotency_key);
  const muda=montar({respostas:[{lanca:'ECONNRESET'},{lanca:'ECONNRESET'}]});
  const r3=await muda.V.ligar(PEDIDO);
  assert.equal(r3.ok,null);assert.match(r3.motivo,/pode ter saído/);
  assert.equal((await muda.rec.read('lex_voz_ligacao_L1')).value.status,'incerta');
});

test('aviso da plataforma: assinatura falsa é recusada e não muda nada',async()=>{
  const m=montar();await m.V.ligar(PEDIDO);
  const corpo=JSON.stringify(FIM);
  const r=await m.V.receberAviso({corpo,assinatura:assinar(corpo,m.agora,'chave_errada')});
  assert.equal(r.status,401);
  assert.equal((await m.rec.read('lex_voz_ligacao_L1')).value.status,'em_andamento');
  assert.equal((await m.V.receberAviso({corpo:'{nao é json',assinatura:assinar('{nao é json',m.agora)})).status,400);
});

test('aviso de outra ligação (id desconhecido ou call_id trocado) é ignorado',async()=>{
  const m=montar();await m.V.ligar(PEDIDO);
  const r=await avisar(m,{...FIM,call:{...FIM.call,metadata:{ligacao_id:'OUTRA'}}});
  assert.equal(r.status,204);assert.equal(r.processar,null);
  const troca=await avisar(m,{...FIM,call:{...FIM.call,call_id:'call_de_outro'}});
  assert.equal(troca.processar,null);
  assert.equal((await m.rec.read('lex_voz_ligacao_L1')).value.status,'em_andamento');
});

test('fim da ligação: resumo pela IA, anotado no processo e contado ao titular — uma vez só, mesmo com aviso repetido',async()=>{
  const m=montar();await m.V.ligar(PEDIDO);
  const r=await avisar(m,FIM);
  assert.equal(r.status,204);assert.equal(r.processar,'L1');
  const repetido=await avisar(m,FIM);
  assert.equal(repetido.processar,null,'aviso repetido (a plataforma retenta) não reprocessa');
  await m.V.concluir('L1');await m.V.concluir('L1');
  assert.equal(m.composicoes.length,1);
  assert.match(m.composicoes[0].mensagem,/dados, não instruções/);assert.match(m.composicoes[0].mensagem,/Vou sim, levo os exames/);
  assert.equal(m.entregas.length,1);
  assert.match(m.entregas[0],/Maria Silva/);assert.match(m.entregas[0],/3 min/);assert.match(m.entregas[0],/confirmou que vai à perícia/);
  const p=m.store.rows[0];
  const anot=p.andamentos.filter(a=>a.ligacao_id==='L1');
  assert.equal(anot.length,1);assert.equal(anot[0].origem,'lex');assert.match(anot[0].txt,/^\[LEX\] Ligação/);assert.match(anot[0].txt,/confirmou/);
  const reg=(await m.rec.read('lex_voz_ligacao_L1')).value;
  assert.equal(reg.status,'relatada');assert.match(reg.transcricao,/levo os exames/);
});

test('não atendeu ou caixa postal: sem IA, sem detalhe do caso; o titular fica sabendo',async()=>{
  const m=montar();await m.V.ligar(PEDIDO);
  await avisar(m,{event:'call_ended',call:{call_id:'call_1',call_status:'not_connected',metadata:{ligacao_id:'L1'},disconnection_reason:'dial_no_answer'}});
  await m.V.concluir('L1');
  assert.equal(m.composicoes.length,0);
  assert.match(m.entregas[0],/não atendeu/i);
  const cx=montar();await cx.V.ligar(PEDIDO);
  await avisar(cx,{event:'call_ended',call:{call_id:'call_1',call_status:'ended',metadata:{ligacao_id:'L1'},disconnection_reason:'voicemail_reached',start_timestamp:1,end_timestamp:20001}});
  await cx.V.concluir('L1');
  assert.match(cx.entregas[0],/caixa postal/);
});

test('cliente pede para não receber mais ligações: anotado e a próxima não sai',async()=>{
  const m=montar({resumoIa:JSON.stringify({resumo:'Maria disse que não quer mais receber ligação automática.',combinado:'',pediu_para_nao_ligar:true,pendencias:''})});
  await m.V.ligar(PEDIDO);
  await avisar(m,FIM);await m.V.concluir('L1');
  assert.match(m.entregas[0],/não ligo mais|não quer mais receber ligação/);
  assert.equal((await m.V.ligar({...PEDIDO,id:'L9'})).codigo,'nao_ligar');
});

test('sem IA: o titular recebe o fato e a transcrição fica guardada',async()=>{
  const m=montar({semIa:true});await m.V.ligar(PEDIDO);
  await avisar(m,FIM);await m.V.concluir('L1');
  assert.equal(m.composicoes.length,0);
  assert.match(m.entregas[0],/atendeu/i);assert.match(m.entregas[0],/transcrição/i);
  const ia=montar({resumoIa:'isto não é json'});await ia.V.ligar(PEDIDO);
  await avisar(ia,FIM);await ia.V.concluir('L1');
  assert.match(ia.entregas[0],/transcrição/i,'resposta torta da IA cai no texto seguro');
});

test('reconciliação: relato que não chegou ao titular é refeito; ligação sem retorno vira aviso',async()=>{
  const falha={ativa:true};
  const m=montar({entregaFalha:falha});await m.V.ligar(PEDIDO);
  await avisar(m,FIM);await m.V.concluir('L1');
  assert.equal((await m.rec.read('lex_voz_ligacao_L1')).value.status,'encerrada','sem entrega confirmada não fecha');
  falha.ativa=false;m.avancar(11*60*1000);
  await m.V.reconciliar();
  assert.equal((await m.rec.read('lex_voz_ligacao_L1')).value.status,'relatada');
  assert.equal(m.composicoes.length,1,'o resumo já feito não é pedido de novo à IA');
  assert.equal(m.store.rows[0].andamentos.filter(a=>a.ligacao_id==='L1').length,1,'anotação no processo não duplica');
  const parada=montar();await parada.V.ligar({...PEDIDO,id:'L5'});
  parada.avancar(3*3600*1000);
  await parada.V.reconciliar();
  assert.equal((await parada.rec.read('lex_voz_ligacao_L5')).value.status,'sem_retorno');
  assert.match(parada.entregas[0],/não recebi o resultado/i);
});

test('lista para a conversa: o que aconteceu e, com processo, a transcrição',async()=>{
  const m=montar();await m.V.ligar(PEDIDO);await avisar(m,FIM);await m.V.concluir('L1');
  const geral=await m.V.listar({});
  assert.equal(geral.ok,true);assert.equal(geral.ligacoes[0].para,'Maria Silva — +55 61 98888-7777');
  assert.equal(geral.ligacoes[0].transcricao,undefined,'lista geral não carrega transcrição');
  const doProcesso=await m.V.listar({processo_id:'p1'});
  assert.match(doProcesso.ligacoes[0].transcricao,/levo os exames/);
});
