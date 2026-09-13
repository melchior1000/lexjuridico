'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createReceptionStore}=require('../lib/whatsapp-reception-store');
const {publicWhatsappReception,handleWhatsappOperatorCommand}=require('../lib/integration-status');

test('store persiste entrada, resposta do LEX e consulta por numero',async()=>{
  const events=[];
  const request=async(method,table,data,query)=>{
    if(table==='whatsapp_recepcao_eventos'){
      if(method==='POST'){const row={id:'e'+(events.length+1),...data};events.push(row);return {ok:true,status:201,body:[row]};}
      if(method==='GET') return {ok:true,status:200,body:events.filter(x=>x.numero===String(query.numero||'').replace('eq.','')).slice().reverse()};
    }
    if(table==='whatsapp_recepcao_publica' && method==='GET') return {ok:true,status:200,body:[]};
    return {ok:true,status:200,body:[]};
  };
  const store=createReceptionStore({request});
  await store.appendEvent({numero:'5561988888888',nome:'Maria',direcao:'entrada',texto:'Oi',classe:'geral',nivel:'ciencia'});
  await store.appendEvent({numero:'5561988888888',nome:'Maria',direcao:'saida_lex',texto:'Como posso ajudar?',classe:'geral',nivel:'ciencia'});
  const rows=await store.history('5561988888888');
  assert.equal(rows.length,2);
  assert.equal(rows[0].direcao,'saida_lex');
  assert.equal(rows[1].direcao,'entrada');
});

test('recepcao registra entrada e resposta confirmada no historico',async()=>{
  const events=[];const calls=[];
  const store={
    upsert:async()=>({numero:'5561988888888',nome:'Maria',classe:'geral',urgente:false,status:'aguardando_advogado'}),
    archive:async()=>true,
    appendEvent:async e=>{events.push(e);return e;},
    history:async()=>events,
    list:async()=>[]
  };
  const request=async(url,opts)=>{calls.push(opts.data);return {key:{id:'ok-'+calls.length}};};
  const body={data:{pushName:'Maria',key:{id:'m1',fromMe:false,remoteJid:'5561988888888@s.whatsapp.net'},message:{conversation:'Oi'}}};
  await publicWhatsappReception(body,'LEX-JURIDICO',{operator:'5561999171717',url:'https://evo.example.test',key:'fake',request,store});
  assert.equal(events.length,2);
  assert.equal(events[0].direcao,'entrada');
  assert.equal(events[1].direcao,'saida_lex');
});

test('/historico envia as ultimas mensagens ao operador sem abrir motor juridico',async()=>{
  const sent=[];
  const store={history:async()=>[
    {direcao:'saida_lex',texto:'Como posso ajudar?',criado_em:'2026-09-13T17:00:00Z'},
    {direcao:'entrada',texto:'Oi',criado_em:'2026-09-13T16:59:00Z'}
  ],list:async()=>[],archive:async()=>false};
  const request=async(url,opts)=>{sent.push(opts.data);return {key:{id:'ok'}};};
  const body={data:{key:{id:'op1',fromMe:false,remoteJid:'5561999171717@s.whatsapp.net'},message:{conversation:'/historico 5561988888888'}}};
  assert.equal(await handleWhatsappOperatorCommand(body,'LEX-JURIDICO',{operator:'5561999171717',url:'https://evo.example.test',key:'fake',request,store}),true);
  assert.equal(sent.length,1);
  assert.equal(sent[0].number,'5561999171717');
  assert.match(sent[0].text,/Histórico 5561988888888/);
  assert.match(sent[0].text,/LEX: Como posso ajudar/);
  assert.match(sent[0].text,/Contato: Oi/);
});
