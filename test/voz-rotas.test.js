'use strict';
// Rota pública do aviso da plataforma de voz: só com assinatura, resposta rápida, relato depois.
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createVozRotas}=require('../lib/voz-rotas');

function req(method,body,headers={}){const r=Readable.from(body==null?[]:[Buffer.from(body)]);r.method=method;r.headers=headers;r.destroy=()=>{};return r}
function res(){return{code:null,body:'',writeHead(c){this.code=c},end(b){this.body=b||''}}}

function vozFalsa(over={}){
  const vistos=[],concluidos=[];
  return{vistos,concluidos,
    async receberAviso({corpo,assinatura}){vistos.push({corpo,assinatura});if(over.lanca)throw new Error('banco fora');return over.resposta||{status:204,processar:'L1'}},
    async concluir(id){concluidos.push(id)},
    async listar(){return{ok:true,configurado:true,ligacoes:[{ligacao_id:'L1',transcricao:'segredo do cliente'}]}}};
}

test('aviso com assinatura certa: 204 na hora, com o corpo cru, e o relato roda depois',async()=>{
  const V=vozFalsa();const agendados=[];
  const R=createVozRotas({voz:V,agendar:fn=>agendados.push(fn)});
  const corpo='{"event":"call_ended",  "call":{"call_id":"c1"}}';
  const r=res();
  assert.equal(await R.handle(req('POST',corpo,{'x-retell-signature':'v=1,d=ab'}),r,'/api/voz/aviso'),true);
  assert.equal(r.code,204);
  assert.equal(V.vistos[0].corpo,corpo,'assinatura conferida sobre o corpo exatamente como chegou');
  assert.equal(V.vistos[0].assinatura,'v=1,d=ab');
  assert.equal(V.concluidos.length,0,'relato não segura a resposta');
  await agendados[0]();
  assert.deepEqual(V.concluidos,['L1']);
});

test('assinatura recusada vira 401; falha ao gravar vira 500 (a plataforma repete); GET é 405; sem módulo, 503',async()=>{
  const r1=res();await createVozRotas({voz:vozFalsa({resposta:{status:401,erro:'assinatura inválida'}})}).handle(req('POST','{}'),r1,'/api/voz/aviso');
  assert.equal(r1.code,401);
  const r2=res();await createVozRotas({voz:vozFalsa({lanca:true})}).handle(req('POST','{}'),r2,'/api/voz/aviso');
  assert.equal(r2.code,500);
  const r3=res();await createVozRotas({voz:vozFalsa()}).handle(req('GET',null),r3,'/api/voz/aviso');
  assert.equal(r3.code,405);
  const r4=res();await createVozRotas({voz:()=>null}).handle(req('POST','{}'),r4,'/api/voz/aviso');
  assert.equal(r4.code,503);
});

test('estado das ligações: só advogado ou administrador, e nunca com transcrição',async()=>{
  const R=perfil=>createVozRotas({voz:vozFalsa(),authenticate:()=>perfil});
  const sem=res();await R(null).handle(req('GET'),sem,'/api/voz/estado');assert.equal(sem.code,401);
  const sec=res();await R('secretaria').handle(req('GET'),sec,'/api/voz/estado');assert.equal(sec.code,403);
  const adm=res();await R('admin').handle(req('GET'),adm,'/api/voz/estado');
  assert.equal(adm.code,200);
  const j=JSON.parse(adm.body);
  assert.equal(j.ligacoes[0].ligacao_id,'L1');assert.equal(j.ligacoes[0].transcricao,undefined);
  assert.doesNotMatch(adm.body,/segredo do cliente/);
});

test('outras rotas não são desta peça',async()=>{
  assert.equal(await createVozRotas({voz:vozFalsa()}).handle(req('GET'),res(),'/api/processos'),false);
});
