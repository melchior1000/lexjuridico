const {test}=require('node:test');
const assert=require('node:assert/strict');
const {applyPjeMovement}=require('../lib/pje-sync');
const cnj='0001234-56.2026.8.13.0001';
function setup(response){
 const processos=[{id:42, numero:cnj, nome:'Caso sintético', prazo:'12/10/2026', status:'ATIVO', andamentos:[]}];
 let writes=0;
 const deps={processos,sbReq:async()=>{writes++;return response||{ok:true,body:[{id:42}]};}};
 return {deps,processos,writes:()=>writes};
}
const evento={cnj,data:'08/09/2026',andamento_texto:'Juntada de documento'};
test('PJe preserva prazo e status e guarda origem do andamento confirmado',async()=>{
 const {deps,processos}=setup();await applyPjeMovement(deps,evento);
 assert.equal(processos[0].prazo,'12/10/2026');assert.equal(processos[0].status,'ATIVO');
 assert.equal(processos[0].andamentos[0].origem,'pje');
});
for(const response of [{ok:false,status:503},{ok:true,body:[]},{ok:true,body:[{id:99}]}]){
 test('PJe não altera memória quando a gravação não é confirmada: '+JSON.stringify(response),async()=>{
  const {deps,processos}=setup(response);const before=JSON.stringify(processos);
  await assert.rejects(applyPjeMovement(deps,evento));assert.equal(JSON.stringify(processos),before);
 });
}
test('PJe rejeita CNJ diferente mesmo com nome ou partes iguais',async()=>{
 const {deps,writes}=setup();await assert.rejects(applyPjeMovement(deps,{...evento,cnj:'0001234-56.2026.8.13.0002',partes:'Caso sintético'}));assert.equal(writes(),0);
});
test('PJe bloqueia cadastro duplicado do mesmo CNJ',async()=>{
 const {deps,processos,writes}=setup();processos.push({...processos[0],id:43});
 await assert.rejects(applyPjeMovement(deps,evento),/duplicado/);assert.equal(writes(),0);
});
test('PJe reenvio simultâneo do mesmo evento grava uma vez',async()=>{
 const {deps,processos,writes}=setup();const r=await Promise.all([applyPjeMovement(deps,evento),applyPjeMovement(deps,evento)]);
 assert.equal(writes(),1);assert.equal(processos[0].andamentos.length,1);assert.equal(r[1].duplicado,true);
});
test('PJe movimentos diferentes concorrentes são preservados sem truncar texto',async()=>{
 const {deps,processos}=setup();await Promise.all([applyPjeMovement(deps,evento),applyPjeMovement(deps,{...evento,andamento_texto:evento.andamento_texto+' complementar'})]);
 assert.equal(processos[0].andamentos.length,2);
});
const {setup:serverSetup}=require('./runtime');
for(const route of ['/api/pje/andamento','/api/agentes/status']){
 test(route+' exige autenticação e perfil administrador',async()=>{
  const app=serverSetup();const method=route.endsWith('andamento')?'POST':'GET';
  assert.equal((await app.request(route,null,evento,method)).status,401);
  assert.equal((await app.request(route,app.token('secretaria'),evento,method)).status,403);
 });
}
test('endpoint PJe não confirma sucesso quando persistência falha',async()=>{
 const app=serverSetup({Lex:{obter:()=>({receberAndamento:async()=>{throw new Error('gravação recusada');}})}});
 const r=await app.request('/api/pje/andamento',app.token('admin'),evento,'POST');
 assert.equal(r.status,422);assert.equal(JSON.parse(r.body).sucesso,false);
});
const vm=require('node:vm');
const {source}=require('./runtime');
// A leitura avulsa do servidor usa a mesma consulta da rotina diária (lib/datajud.js), pelo fetch.
const Datajud=require('../lib/datajud');
const {primaryCnj}=require('../lib/pje-sync');
const corpo=obj=>({ok:true,status:200,text:async()=>JSON.stringify(obj)});
function datajud(extra={}){
 const start=source.indexOf('async function _buscarAndamentosDatajud(');
 const end=source.indexOf('async function _varrerAndamentosPjeAgora()',start);
 const context=vm.createContext({process:{env:{DATAJUD_API_KEY:'test-public-key'}},Datajud,primaryCnj,fetch:async()=>{throw new Error('Não chamar');},...extra});
 vm.runInContext(source.slice(start,end),context);return context;
}
test('Datajud sem configuração não faz rede nem afirma consulta concluída',async()=>{
 let chamadas=0;
 const ctx=datajud({process:{env:{}},fetch:async()=>{chamadas++;throw new Error('Não chamar');}});
 assert.equal((await ctx._buscarAndamentosDatajud(cnj)).ok,false);assert.equal(chamadas,0);
});
test('Datajud erro de API não vira resultado vazio bem-sucedido',async()=>{
 const erroNoCorpo=datajud({fetch:async()=>corpo({error:{type:'security_exception'}})});
 const a=await erroNoCorpo._buscarAndamentosDatajud(cnj);
 assert.equal(a.ok,false);assert.notEqual(a.nao_encontrado,true,'erro da base não é "processo não encontrado"');
 const recusado=datajud({fetch:async()=>({ok:false,status:403,text:async()=>'{}'})});
 assert.equal((await recusado._buscarAndamentosDatajud(cnj)).ok,false);
});
test('Datajud inclui autorização e seleciona o movimento mais recente',async()=>{
 let headers,url;
 const ctx=datajud({fetch:async(u,o)=>{url=u;headers=o.headers;return corpo({hits:{hits:[{_source:{movimentos:[{dataHora:'2026-01-01',nome:'Antigo'},{dataHora:'2026-09-08',nome:'Novo'}]}}]}});}});
 const r=await ctx._buscarAndamentosDatajud(cnj);
 assert.equal(headers.Authorization,'APIKey test-public-key');assert.equal(r.movimentacoes[0].texto,'Novo');
 assert.match(url,/api_publica_tjmg\/_search$/,'tribunal pelo número (8.13 = TJMG)');
});
test('Datajud: número que a base não acha não vira "sem movimentação"',async()=>{
 const ctx=datajud({fetch:async()=>corpo({hits:{hits:[]}})});
 const r=await ctx._buscarAndamentosDatajud(cnj);
 assert.equal(r.ok,false);assert.equal(r.nao_encontrado,true);assert.match(r.erro,/não encontrou este número/);
});
