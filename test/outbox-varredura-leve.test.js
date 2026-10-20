'use strict';
// Varredura da fila de ordens dos canais (lib/channel-command-outbox.js).
// Em 18/10/2026 o banco recusou o projeto com 402 (cota do plano grátis estourada). A fila
// varria o banco a cada 5 s trazendo até 100 ordens inteiras, com histórico de conversa, e
// continuava martelando o banco recusado. Estes testes travam: varredura a cada 60 s, só com
// id/status/data das ordens ativas, e espera crescente enquanto o banco recusar.
const test=require('node:test');
const assert=require('node:assert/strict');
const {createChannelCommandOutbox,PREFIX}=require('../lib/channel-command-outbox');
const {RecordStore}=require('../lib/record-store');

function dbError(status){
  return Object.assign(new Error('Listar tarefas: banco indisponivel ou operacao recusada ('+status+').'),{status:502,databaseStatus:status});
}
function records({listFields}={}){
  const map=new Map();
  const calls={list:0,listFields:0};
  const rec={
    async read(key){return map.has(key)?{value:structuredClone(map.get(key)),stamp:new Date().toISOString()}:null},
    async change(key,fn){
      const old=map.has(key)?structuredClone(map.get(key)):null;
      const next=await fn(old);
      if(next!==undefined)map.set(key,structuredClone(next));
      return next===undefined?old:structuredClone(next);
    },
    async list(prefix){calls.list++;return[...map.entries()].filter(([k])=>k.startsWith(prefix)).map(([,v])=>structuredClone(v))},
    map,calls
  };
  if(listFields==='banco'||listFields==='coluna-texto'){
    // Simula o PostgREST: filtra pelo status dentro do JSON e devolve só os campos pedidos.
    // 'coluna-texto' imita o PostgREST real com valor TEXTO: não recusa, devolve o campo
    // vazio e o filtro por status não encontra nada (conferido com PostgREST 12.2.3).
    const texto=listFields==='coluna-texto';
    rec.listFields=async(prefix,fields,{status,limit=100}={})=>{
      calls.listFields++;
      return[...map.entries()].filter(([k,v])=>k.startsWith(prefix)&&(!status||(!texto&&status.includes(v.status))))
        .slice(0,limit)
        .map(([k,v])=>Object.fromEntries([['chave',k],...fields.map(f=>[f,texto||v[f]===undefined?null:String(v[f])])]));
    };
  }else if(typeof listFields==='function'){
    rec.listFields=async(...args)=>{calls.listFields++;return listFields(...args);};
  }
  return rec;
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fakeTimers(){
  const q=[];
  return{q,set(fn,ms){const t={fn,ms,cancelled:false};q.push(t);return t},clear(t){if(t)t.cancelled=true}};
}
function outbox(rec,extra={}){
  return createChannelCommandOutbox({records:rec,compose:async()=> 'Pronto.',deliverDetailed:async()=>({ok:true,state:'confirmado'}),
    receptionStore:{appendEvent:async()=>{}},log:()=>{},...extra});
}

test('RecordStore.listFields pede ao banco só id/status/data das ordens ativas',async()=>{
  const seen=[];
  const request=async(method,table,data,query)=>{seen.push({method,table,data,query});return{ok:true,status:200,body:[{chave:PREFIX+'a',id:'a',status:'pendente'}]}};
  request.jsonFields=true;
  const store=new RecordStore(request,'configuracoes');
  const rows=await store.listFields(PREFIX,['id','status','atualizado_em'],{status:['pendente','confirmado']});
  assert.deepEqual(rows,[{chave:PREFIX+'a',id:'a',status:'pendente'}]);
  assert.equal(seen.length,1);
  const {method,table,query}=seen[0];
  assert.equal(method,'GET');assert.equal(table,'configuracoes');
  assert.equal(query.select,'chave,id:valor->>id,status:valor->>status,atualizado_em:valor->>atualizado_em');
  assert.equal(query['valor->>status'],'in.(pendente,confirmado)');
  assert.equal(query.chave,'like.'+PREFIX+'*');
  assert.equal(query.order,'atualizado_em.desc');
  assert.equal(query.limit,'100');
  // Prova de 1 linha: sem filtro de status.
  await store.listFields(PREFIX,['id','status'],{limit:1});
  assert.equal(seen[1].query.limit,'1');
  assert.equal(seen[1].query['valor->>status'],undefined);
  assert.equal(seen[1].query.select,'chave,id:valor->>id,status:valor->>status');
});

test('RecordStore.listFields recusa campo ou status fora do formato e devolve null em banco sem filtro JSON',async()=>{
  const request=async()=>{throw new Error('não deveria consultar')};
  request.jsonFields=true;
  const store=new RecordStore(request,'configuracoes');
  await assert.rejects(store.listFields(PREFIX,['id;drop']),/Campo inválido/);
  await assert.rejects(store.listFields(PREFIX,['id'],{status:['pendente)']}),/Status inválido/);
  await assert.rejects(store.listFields(PREFIX,['id'],{limit:0}),/Limite inválido/);
  await assert.rejects(store.listFields(PREFIX,['id'],{limit:'5;'}),/Limite inválido/);
  const semJson=new RecordStore(async()=>{throw new Error('não deveria consultar')},'configuracoes');
  assert.equal(await semJson.listFields(PREFIX,['id']),null,'modo PostgreSQL direto não entende valor->>campo');
});

test('recuperação usa a lista enxuta e não baixa as ordens inteiras',async()=>{
  const rec=records({listFields:'banco'}),deliveries=[];
  const out=outbox(rec,{deliverDetailed:async x=>{deliveries.push(x);return{ok:true,state:'confirmado'}},staleMs:1});
  await rec.change(PREFIX+'p1',()=>({id:'p1',origem:'whatsapp',contato_id:'5561999999999',comando:'x',status:'pendente',historico:[{texto:'longo'.repeat(500)}],atualizado_em:new Date().toISOString()}));
  await rec.change(PREFIX+'c1',()=>({id:'c1',origem:'telegram',contato_id:'123',status:'confirmado',texto_final:'Olá',atualizado_em:new Date().toISOString()}));
  await rec.change(PREFIX+'e1',()=>({id:'e1',origem:'whatsapp',contato_id:'5561988888888',status:'enviando',atualizado_em:'2020-01-01T00:00:00.000Z'}));
  await rec.change(PREFIX+'ok',()=>({id:'ok',origem:'whatsapp',contato_id:'5561977777777',status:'enviado',atualizado_em:'2020-01-01T00:00:00.000Z'}));
  await out.recover();
  await flush();await flush();await flush();
  assert.equal(rec.calls.listFields,2,'1ª varredura: prova de 1 linha + lista filtrada');
  assert.equal(rec.calls.list,0,'a varredura não pode baixar as 100 ordens inteiras');
  assert.equal((await out.read('p1')).status,'aguardando_confirmacao','ordem pendente retomada');
  assert.equal((await out.read('c1')).status,'enviado','ordem confirmada enviada');
  assert.equal((await out.read('e1')).status,'falhou','envio interrompido não é repetido às cegas');
  assert.equal((await out.read('ok')).status,'enviado','ordem já concluída fica como está');
  assert.deepEqual(deliveries,[{origem:'telegram',id:'123',texto:'Olá'}]);
  await out.recover();
  assert.equal(rec.calls.listFields,3,'depois de conferida, só a lista filtrada');
  assert.equal(rec.calls.list,0);
});

test('fila vazia não baixa nada; a prova só vale quando aparece a primeira ordem',async()=>{
  const rec=records({listFields:'banco'});
  const out=outbox(rec);
  await out.recover();await out.recover();
  assert.equal(rec.calls.listFields,2,'só a prova de 1 linha, que volta vazia');
  assert.equal(rec.calls.list,0);
  await rec.change(PREFIX+'p1',()=>({id:'p1',origem:'whatsapp',contato_id:'5561999999999',comando:'x',status:'pendente',atualizado_em:new Date().toISOString()}));
  await out.recover();await flush();await flush();await flush();
  assert.equal(rec.calls.listFields,4,'prova com a ordem + lista filtrada');
  assert.equal((await out.read('p1')).status,'aguardando_confirmacao');
});

test('coluna texto: o banco não recusa, devolve o campo vazio — a fila percebe e não para calada',async()=>{
  const logs=[];
  const rec=records({listFields:'coluna-texto'});
  const out=outbox(rec,{log:m=>logs.push(m)});
  await rec.change(PREFIX+'c1',()=>({id:'c1',origem:'telegram',contato_id:'123',status:'confirmado',texto_final:'Olá',atualizado_em:new Date().toISOString()}));
  await out.recover();await flush();await flush();await flush();
  assert.equal((await out.read('c1')).status,'enviado','a ordem confirmada não pode ficar parada');
  assert.equal(rec.calls.listFields,1);assert.equal(rec.calls.list,1);
  assert.equal(logs.filter(m=>/não lê id\/status.*lista completa/.test(m)).length,1);
});

test('banco sem filtro JSON (400/404, campo vazio ou modo PostgreSQL) volta à lista completa uma vez e avisa',async()=>{
  for(const resposta of [()=>{throw dbError(400)},()=>{throw dbError(404)},()=>null,()=>[{chave:PREFIX+'c1',id:null,status:null}]]){
    const logs=[];
    const rec=records({listFields:resposta});
    const out=outbox(rec,{log:m=>logs.push(m)});
    await rec.change(PREFIX+'c1',()=>({id:'c1',origem:'telegram',contato_id:'123',status:'confirmado',texto_final:'Olá',atualizado_em:new Date().toISOString()}));
    await out.recover();await out.recover();
    await flush();await flush();
    assert.equal(rec.calls.listFields,1,'não insiste na lista enxuta depois da recusa');
    assert.equal(rec.calls.list,2);
    assert.equal(logs.filter(m=>/lista completa/.test(m)).length,1);
  }
});

test('banco recusado (402, 5xx, sem resposta) não vira lista completa: a varredura falha e espera',async()=>{
  for(const status of [402,503,0]){
    const rec=records({listFields:()=>{throw dbError(status)}});
    const out=outbox(rec);
    await assert.rejects(out.recover(),new RegExp('\\('+status+'\\)'));
    assert.equal(rec.calls.list,0);
  }
});

test('varredura a cada 60 s; com o banco recusando, espera dobra até 15 min e volta ao normal quando ele responde',async()=>{
  const timers=fakeTimers(),logs=[];
  let recusar=true;
  const rec=records({listFields:()=>{if(recusar)throw dbError(402);return[]}});
  const out=outbox(rec,{setTimer:timers.set,clearTimer:timers.clear,log:m=>logs.push(m)});
  const handle=out.start();
  const esperas=[];
  for(let i=0;i<6;i++){
    await flush();await flush();
    const t=timers.q.at(-1);esperas.push(t.ms);
    if(i===4)recusar=false;
    t.fn();
  }
  await flush();await flush();
  esperas.push(timers.q.at(-1).ms);
  assert.deepEqual(esperas,[120000,240000,480000,900000,900000,60000,60000]);
  assert.equal(logs.filter(m=>/scan erro=.*\(402\).*próxima tentativa em/.test(m)).length,5,'um aviso por tentativa, não a cada 5 s');
  assert.equal(logs.filter(m=>/banco respondeu de novo/.test(m)).length,1);
  handle.stop();
  assert.equal(timers.q.at(-1).cancelled,true);
  const antes=timers.q.length;timers.q.at(-1).fn();await flush();await flush();
  assert.equal(timers.q.length,antes,'parada não reagenda');
});

test('padrão de produção: sem configuração, a varredura não volta a ser de 5 s',async()=>{
  const timers=fakeTimers();
  const rec=records({listFields:'banco'});
  const out=outbox(rec,{setTimer:timers.set,clearTimer:timers.clear});
  out.start();
  await flush();await flush();
  assert.ok(timers.q.at(-1).ms>=60000,'intervalo padrão de pelo menos 60 s');
});

// ---- Revisão do PR #167 (agente 01 do ECC, casos A e C, e revisão independente) ----

test('rodada que não termina no prazo conta como falha, avisa e não trava as próximas',async()=>{
  const timers=fakeTimers(),logs=[];
  let pendurar=true;
  const rec=records({listFields:()=>pendurar?new Promise(()=>{}):[]});
  const out=outbox(rec,{setTimer:timers.set,clearTimer:timers.clear,log:m=>logs.push(m),roundTimeoutMs:30000});
  const h=out.start();
  await flush();
  assert.equal(out.scanState().em_andamento,true);
  const prazo=timers.q.find(t=>t.ms===30000&&!t.cancelled);
  assert.ok(prazo,'toda rodada tem prazo');
  prazo.fn();await flush();await flush();
  assert.ok(logs.some(m=>/scan erro=varredura sem resposta em 30 s próxima tentativa em 120 s/.test(m)));
  assert.equal(out.scanState().em_andamento,false);
  const proxima=timers.q.at(-1);assert.equal(proxima.ms,120000,'a rodada presa não impede a próxima');
  pendurar=false;proxima.fn();await flush();await flush();
  assert.ok(logs.some(m=>/banco respondeu de novo/.test(m)));
  assert.equal(timers.q.at(-1).ms,60000);
  assert.equal(out.scanState().falhas,0);
  h.stop();
});

test('falha numa ordem não derruba a rodada nem vira espera de banco fora',async()=>{
  const logs=[];
  const rec=records({listFields:'banco'});
  const out=outbox(rec,{log:m=>logs.push(m),staleMs:1});
  for(const id of ['e1','e2'])await rec.change(PREFIX+id,()=>({id,origem:'whatsapp',contato_id:'55619888888'+id.slice(1).padStart(2,'0'),status:'enviando',atualizado_em:'2020-01-01T00:00:00.000Z'}));
  const change=rec.change;
  rec.change=async(key,fn)=>{if(key===PREFIX+'e1')throw new Error('Conflito ao salvar. Atualize e tente novamente.');return change(key,fn);};
  await out.recover();
  assert.equal((await out.read('e2')).status,'falhou','a segunda ordem é tratada na mesma rodada');
  assert.equal((await out.read('e1')).status,'enviando');
  assert.ok(logs.some(m=>/e1 recuperação falhou: Conflito ao salvar/.test(m)),'o registro diz qual ordem falhou');
});

test('400/404 passageiro: lista completa por um tempo e depois volta à enxuta',async()=>{
  let agora=Date.parse('2026-10-20T12:00:00Z'),falhar=true;
  const logs=[];
  const rec=records({listFields:'banco'});
  const real=rec.listFields;
  rec.listFields=async(...a)=>{if(falhar){falhar=false;throw dbError(404);}return real(...a);};
  const out=outbox(rec,{log:m=>logs.push(m),clock:()=>agora});
  await rec.change(PREFIX+'ok',()=>({id:'ok',origem:'whatsapp',contato_id:'5561977777777',status:'enviado',atualizado_em:'2020-01-01T00:00:00.000Z'}));
  await out.recover();
  assert.equal(rec.calls.list,1);
  assert.ok(logs.some(m=>/recusou a lista enxuta \(404\); varredura usa a lista completa e tenta a enxuta de novo em 60 min/.test(m)));
  await out.recover();
  assert.equal(rec.calls.list,2,'ainda dentro do prazo');
  agora+=61*60*1000;
  await out.recover();
  assert.equal(rec.calls.list,2,'passada 1 h, volta à enxuta');
  assert.equal(out.scanState().modo,'enxuta');
});

test('disparo imediato que falha tenta de novo em 5 s, sem esperar a varredura',async()=>{
  const timers=fakeTimers(),logs=[],deliveries=[];
  const rec=records();
  const out=outbox(rec,{setTimer:timers.set,clearTimer:timers.clear,log:m=>logs.push(m),deliverDetailed:async x=>{deliveries.push(x);return{ok:true,state:'confirmado'}}});
  const agoraIso=new Date().toISOString();
  await rec.change(PREFIX+'c1',()=>({id:'c1',origem:'telegram',contato_id:'123',status:'confirmado',texto_final:'Olá',confirmado_em:agoraIso,atualizado_em:agoraIso}));
  const read=rec.read;let falhas=1;
  rec.read=async k=>{if(falhas&&k===PREFIX+'c1'){falhas--;throw new Error('Ler registro: banco indisponivel ou operacao recusada (503).');}return read(k);};
  out.kick('c1');await flush();await flush();
  const t=timers.q.at(-1);assert.equal(t.ms,5000);
  assert.ok(logs.some(m=>/c1 erro=.*nova tentativa em 5 s/.test(m)));
  t.fn();await flush();await flush();await flush();
  assert.equal((await out.read('c1')).status,'enviado');
  assert.equal(deliveries.length,1);
});

test('aprovação de mais de 24 h não sai sozinha na recuperação; a recente sai',async()=>{
  const deliveries=[];
  const rec=records({listFields:'banco'});
  const out=outbox(rec,{deliverDetailed:async x=>{deliveries.push(x);return{ok:true,state:'confirmado'}}});
  const velho=new Date(Date.now()-3*24*3600*1000).toISOString(),novo=new Date(Date.now()-60*1000).toISOString();
  await rec.change(PREFIX+'velha',()=>({id:'velha',origem:'telegram',contato_id:'111',status:'confirmado',texto_final:'Audiência amanhã',confirmado_em:velho,atualizado_em:velho}));
  await rec.change(PREFIX+'nova',()=>({id:'nova',origem:'telegram',contato_id:'222',status:'confirmado',texto_final:'Recebi',confirmado_em:novo,atualizado_em:novo}));
  await out.recover();await flush();await flush();await flush();
  const v=await out.read('velha');
  assert.equal(v.status,'falhou');assert.match(v.last_error,/venceu sem envio/);
  assert.equal((await out.read('nova')).status,'enviado');
  assert.deepEqual(deliveries.map(d=>d.id),['222']);
});

test('o filtro da lista enxuta cobre exatamente os status que a recuperação trata',async()=>{
  let pedidos=null,campos=null;
  const rec=records({listFields:async(p,f,o)=>{if(o?.status){pedidos=o.status;campos=f;}return o?.limit===1?[{chave:PREFIX+'x',id:'x',status:'enviado'}]:[]}});
  await outbox(rec).recover();
  assert.deepEqual([...pedidos].sort(),['confirmado','enviando','interpretando','pendente'],'aguardando_confirmacao espera a pessoa; não é retomada');
  assert.ok(campos.includes('confirmado_em'),'a validade da aprovação precisa da data');
  assert.ok(!campos.includes('valor')&&!campos.includes('historico'),'a varredura periódica nunca baixa o corpo da ordem');
});

test('só o modo REST declara leitura de campo JSON; intervalo inválido não vira laço de 1 ms',async()=>{
  const {createSupabaseRequest}=require('../lib/supabase');
  const {createTenantPostgresRequest}=require('../lib/postgres-tenant');
  const rest=createSupabaseRequest({url:'https://x.supabase.co',key:'k',https:{request(){throw new Error('sem rede')}},tenantId:'',tenancyRequired:false});
  assert.equal(rest.jsonFields,true);
  const pg=createTenantPostgresRequest({pool:{connect(){throw new Error('sem banco')}},tenantId:'3369b6cc-39dc-466f-84a7-7b65e196dbea'});
  assert.notEqual(pg.jsonFields,true);
  const timers=fakeTimers();
  const out=outbox(records({listFields:'banco'}),{setTimer:timers.set,clearTimer:timers.clear,intervalMs:Number(''),maxBackoffMs:NaN});
  out.start();await flush();await flush();
  assert.equal(timers.q.at(-1).ms,60000);
});
