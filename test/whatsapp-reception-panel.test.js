'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {officeRoutes}=require('../lib/office-routes');

function response(){
  let status=0,body='';
  return {res:{writeHead:s=>{status=s;},end:b=>{body=String(b||'');}},get:()=>({status,body:body?JSON.parse(body):null})};
}
function deps(profile,body={}){
  return {headers:{},authenticate:()=>profile,body:async()=>body,records:{read:async()=>({value:{}})},
    processStore:{read:async()=>({processes:[]}),mutate:async()=>({})},engine:{list:async()=>[]},docx:()=>Buffer.from(''),
    aiAvailable:()=>false,setOffice:()=>{},log:()=>{}};
}
function req(url,method='GET'){return {url,method};}

function resetInbox(){global._whatsappPublicInbox=[];}
function put(row){global._whatsappPublicInbox.push(row);}

test('recepcao do painel exige administrador',async()=>{
  resetInbox();
  for(const profile of [null,'advogado','secretaria']){
    const r=response();
    await officeRoutes(req('/api/escritorio/recepcao?status=aguardando_advogado'),r.res,deps(profile));
    assert.equal(r.get().status,profile?403:401);
  }
});

test('painel separa urgente, aguardando e administrativo sem outra fila',async()=>{
  resetInbox();
  put({numero:'5561981111111',nome:'Urgente',status:'aguardando_advogado',urgente:true,urgent:true,classe:'urgente',category:'urgente',ultima_mensagem:'audiência amanhã',atualizado_em:new Date().toISOString(),contador:1});
  put({numero:'5561982222222',nome:'Pessoa',status:'aguardando_advogado',urgente:false,urgent:false,classe:'geral',category:'geral',ultima_mensagem:'quero falar com o responsável',atualizado_em:new Date().toISOString(),contador:1});
  put({numero:'5561983333333',nome:'Fornecedor',status:'aguardando_advogado',urgente:false,urgent:false,classe:'administrativo',category:'administrativo',ultima_mensagem:'fatura',atualizado_em:new Date().toISOString(),contador:1});
  for(const [filter,expected] of [['urgente','Urgente'],['aguardando_advogado','Pessoa'],['administrativo','Fornecedor']]){
    const r=response();
    await officeRoutes(req('/api/escritorio/recepcao?status='+filter),r.res,deps('admin'));
    assert.equal(r.get().status,200);assert.deepEqual(r.get().body.contatos.map(x=>x.nome),[expected]);
  }
});

test('arquivar no painel atualiza a mesma fila',async()=>{
  resetInbox();
  put({numero:'5561984444444',number:'5561984444444',nome:'Contato',name:'Contato',status:'aguardando_advogado',urgente:false,urgent:false,classe:'geral',category:'geral',ultima_mensagem:'oi',last_text:'oi',atualizado_em:new Date().toISOString(),last_at:new Date().toISOString(),contador:1,count:1});
  const r=response();
  await officeRoutes(req('/api/escritorio/recepcao/arquivar','POST'),r.res,deps('admin',{numero:'5561984444444'}));
  assert.equal(r.get().status,200);assert.equal(global._whatsappPublicInbox[0].status,'arquivado');
});

test('interface possui Recepcao, quatro colunas e nao envia resposta direta',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../office-ui-base.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../office-ui.js'),'utf8');
  assert.match(js,/renderRecepcaoLex/);
  for(const label of ['Urgentes','Aguardando você','Administrativos','Arquivados']) assert.match(js,new RegExp(label));
  assert.match(js,/\/api\/escritorio\/recepcao\/arquivar/);
  assert.doesNotMatch(js,/recepcao[^\n]{0,120}message\/sendText/i);
  assert.match(js,/use \/responder NUMERO mensagem no seu 7171/);
});
