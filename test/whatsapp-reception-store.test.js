const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createReceptionStore,categoryFor}=require('../lib/whatsapp-reception-store');

test('classifica urgencia sem abrir motor juridico',()=>{
  assert.deepEqual(categoryFor('Tenho audiência amanhã e é urgente'),{classe:'urgente',urgente:true});
  assert.deepEqual(categoryFor('Quero saber do meu processo'),{classe:'juridico',urgente:false});
  assert.deepEqual(categoryFor('Cobrança da Vivo'),{classe:'administrativo',urgente:false});
});

test('persiste upsert, lista e arquiva no Supabase',async()=>{
  let row=null;
  const calls=[];
  const request=async(method,table,data,query,headers)=>{
    calls.push({method,table,data,query,headers});
    if(method==='GET' && query.numero) return {ok:true,status:200,body:row?[{numero:row.numero,contador:row.contador,urgente:row.urgente}]:[]};
    if(method==='POST') { row={...data}; return {ok:true,status:201,body:[row]}; }
    if(method==='GET') return {ok:true,status:200,body:row&&row.status===query.status?.replace('eq.','')?[row]:[]};
    if(method==='PATCH') { row={...row,...data}; return {ok:true,status:200,body:[row]}; }
    return {ok:false,status:500,body:null};
  };
  const store=createReceptionStore({request});
  const saved=await store.upsert('5561988888888','Pessoa','Preciso falar sobre processo');
  assert.equal(saved.numero,'5561988888888');
  assert.equal(saved.classe,'juridico');
  assert.equal(saved.status,'aguardando_advogado');
  assert.equal((await store.list())[0].numero,'5561988888888');
  assert.equal(await store.archive('5561988888888'),true);
  assert.equal(row.status,'arquivado');
  assert.ok(calls.some(c=>c.method==='POST'&&c.query.on_conflict==='numero'));
});

test('fallback em memoria preserva recepcao quando banco falha',async()=>{
  global._whatsappPublicInbox=[];
  const store=createReceptionStore({request:async()=>({ok:false,status:503,body:null})});
  const saved=await store.upsert('5561977777777','Contato','urgente: prazo amanhã');
  assert.equal(saved.numero,'5561977777777');
  assert.equal(saved.urgente,true);
  const rows=await store.list();
  assert.equal(rows.length,1);
  assert.equal(rows[0].numero,'5561977777777');
  assert.equal(await store.archive('5561977777777'),true);
  assert.equal((await store.list()).length,0);
});

test('busca por nome encontra contato unico apos mais de 100 registros',async()=>{
  const rows=Array.from({length:151},(_,i)=>({numero:String(5561981000000+i),nome:'Contato '+i}));
  rows[150].nome='  Ána   Maria  ';
  let calls=0;
  const store=createReceptionStore({request:async(method,table,data,query)=>{
    calls++;
    assert.equal(method,'GET');
    assert.equal(table,'whatsapp_recepcao_publica');
    assert.equal(query.status,'eq.aguardando_advogado');
    assert.equal(query.order,'numero.asc');
    const after=query.numero?.slice(3)||'';
    return {ok:true,status:200,body:rows.filter(row=>row.numero>after).slice(0,Number(query.limit))};
  }});
  assert.deepEqual(await store.findWaitingByName('Ana Maria'),[rows[150]]);
  assert.equal(calls,3);
});

test('busca por nome nao usa cache parcial quando banco falha',async()=>{
  global._whatsappPublicInbox=[{numero:'5561981111111',nome:'Ana',status:'aguardando_advogado'}];
  const store=createReceptionStore({request:async()=>({ok:false,status:503,body:null})});
  await assert.rejects(store.findWaitingByName('Ana'),/banco indisponivel/);
});

test('busca rejeita pagina repetida sem concluir unicidade ou entrar em loop',async()=>{
  let calls=0;
  const store=createReceptionStore({request:async()=>{
    calls++;
    return {ok:true,status:200,body:[{numero:'5561981111111',nome:'Ana'}]};
  }});
  await assert.rejects(store.findWaitingByName('Ana'),/sem progresso/);
  assert.equal(calls,2);
});

test('busca encerra assim que comprova dois candidatos',async()=>{
  let calls=0;
  const store=createReceptionStore({request:async()=>{
    calls++;
    return {ok:true,status:200,body:[
      {numero:'5561981111111',nome:'Ana Maria'},
      {numero:'5561982222222',nome:'Ana Souza'}
    ]};
  }});
  assert.equal((await store.findWaitingByName('Ana')).length,2);
  assert.equal(calls,1);
});
