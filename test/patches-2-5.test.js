'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {officeRoutes}=require('../lib/office-routes');
const {TaskEngine}=require('../lib/task-engine');
const Pipeline=require('../lib/office-pipeline');

function response(){let status=0,body=null;return{res:{writeHead:s=>status=s,end:b=>body=b?JSON.parse(b):null},get:()=>({status,body})}}
function records(initial={}){
  const map=new Map(Object.entries(initial));
  return {
    async read(k){return map.has(k)?{value:structuredClone(map.get(k))}:null},
    async list(prefix){return [...map.entries()].filter(([k])=>k.startsWith(prefix)).map(([,v])=>structuredClone(v))},
    async change(k,fn){const old=map.has(k)?structuredClone(map.get(k)):null;const next=await fn(old);if(next!==undefined)map.set(k,structuredClone(next));return structuredClone(map.get(k))},
    get:k=>map.get(k)
  };
}
function deps(rec,body={},delivery=async()=>true){
  return {headers:{},authenticate:()=> 'admin',body:async()=>body,records:rec,channelDelivery:delivery,
    processStore:{read:async()=>({processes:[]}),mutate:async()=>({})},
    engine:{list:async()=>[],recoverStale:async()=>[]},docx:()=>Buffer.from(''),aiAvailable:()=>false,setOffice:()=>{},log:()=>{}};
}
async function route(url,method,d){const out=response();await officeRoutes({url,method},out.res,d);return out.get()}

test('Patch 2: Recepção une WhatsApp e Telegram e preserva a origem',async()=>{
  global._whatsappPublicInbox=[{numero:'5561981111111',nome:'Whats',status:'aguardando_advogado',classe:'geral',urgente:false,ultima_mensagem:'oi',atualizado_em:'2026-09-19T20:00:00.000Z',contador:1}];
  const rec=records({'lex_recepcao_telegram_123':{id:'123',nome:'Tele',status:'aguardando_advogado',ultima_mensagem:'processo',atualizado_em:'2026-09-19T21:00:00.000Z',history:[{direcao:'entrada',texto:'processo'}]}});
  const r=await route('/api/escritorio/recepcao?status=aguardando_advogado','GET',deps(rec));
  assert.equal(r.status,200);assert.deepEqual(r.body.contatos.map(x=>x.origem),['telegram','whatsapp']);
  assert.equal(r.body.contatos[0].id,'123');assert.equal(r.body.contatos[1].id,'5561981111111');
});

test('Patch 3: resposta fica presa ao canal de origem e só registra depois da confirmação',async()=>{
  const rec=records({'lex_recepcao_telegram_123':{id:'123',status:'aguardando_advogado',history:[{direcao:'entrada',texto:'oi'}]}});
  const sent=[];let body={origem:'telegram',id:'123',texto:'Resposta exata'};
  let r=await route('/api/escritorio/recepcao/responder','POST',deps(rec,body,async x=>{sent.push(x);return true}));
  assert.equal(r.status,200);assert.deepEqual(sent,[body]);
  assert.equal(rec.get('lex_recepcao_telegram_123').history.at(-1).direcao,'saida_operador');
  const before=rec.get('lex_recepcao_telegram_123').history.length;
  body={origem:'telegram',id:'123',texto:'não entregue'};
  r=await route('/api/escritorio/recepcao/responder','POST',deps(rec,body,async()=>false));
  assert.equal(r.status,502);assert.equal(rec.get('lex_recepcao_telegram_123').history.length,before);
});

test('Patch 3: histórico Telegram e arquivamento usam o mesmo registro persistente',async()=>{
  const rec=records({'lex_recepcao_telegram_456':{id:'456',status:'aguardando_advogado',history:[{direcao:'entrada',texto:'doc'}]}});
  let r=await route('/api/escritorio/recepcao/historico?origem=telegram&id=456','GET',deps(rec));
  assert.equal(r.status,200);assert.equal(r.body.historico[0].texto,'doc');
  r=await route('/api/escritorio/recepcao/arquivar','POST',deps(rec,{origem:'telegram',id:'456'}));
  assert.equal(r.status,200);assert.equal(rec.get('lex_recepcao_telegram_456').status,'arquivado');
});

test('Patch 4: execução vencida é recuperada uma vez e worker antigo perde autoridade',async()=>{
  const id='a'.repeat(32),now=Date.parse('2026-09-19T22:00:00.000Z');
  const rec=records({['lex_task:'+id]:{id,tipo:'analise',instrucao:'Analise',processo_id:1,status:'executando',tentativas:1,execucao_id:'old',iniciada_em:'2026-09-19T20:00:00.000Z',lease_ate:'2026-09-19T20:30:00.000Z'}});
  const engine=new TaskEngine({store:rec,processes:async()=>[],now:()=>now,staleMs:30*60*1000,maxAttempts:3});
  const recovered=await engine.recoverStale();
  assert.equal(recovered.length,1);assert.equal(recovered[0].status,'na_fila');assert.equal(rec.get('lex_task:'+id).execucao_id,null);
  assert.equal((await engine.recoverStale()).length,0);
});

test('Patch 4: tarefa interrompida no limite de tentativas exige revisão humana',async()=>{
  const id='b'.repeat(32),now=Date.parse('2026-09-19T22:00:00.000Z');
  const rec=records({['lex_task:'+id]:{id,tipo:'analise',instrucao:'Analise',processo_id:1,status:'executando',tentativas:3,execucao_id:'old',lease_ate:'2026-09-19T20:30:00.000Z'}});
  const engine=new TaskEngine({store:rec,processes:async()=>[],now:()=>now,maxAttempts:3});
  assert.equal((await engine.recoverStale()).length,0);assert.equal(rec.get('lex_task:'+id).status,'falhou');
  assert.match(rec.get('lex_task:'+id).pendencia,/Revisão humana/i);
});

test('Patch 5: documento ilegível volta ao Cadastro e aparece como pendência humana na UI',()=>{
  assert.equal(Pipeline.taskResultStage({status:'aguardando_documento_nitido'}),'cadastro');
  const ui=fs.readFileSync(path.join(__dirname,'../office-ui-base.js'),'utf8');
  assert.match(ui,/aguardando_documento_nitido:'Documento legível necessário'/);
  assert.match(ui,/\['falhou','aguardando_dados','aguardando_documento_nitido','aguardando_configuracao'\]/);
});
