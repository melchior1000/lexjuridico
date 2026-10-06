'use strict';
// 06/10/2026 — Radar da recepção. Antes, cliente esperando resposta do escritório só gerava
// aviso por temporizador na memória (perdido no reinício do Render) e num caminho sem uso.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {faixaDeEspera,textoEspera,esperandoDesde,radarDaRecepcao,createReceptionRadarAlerts}=require('../lib/reception-radar');

const t=(h,m=0)=>new Date(Date.UTC(2026,9,6,h,m)).toISOString();
function fakeRecords(){
  const rows=new Map();
  return {rows,async read(k){return rows.has(k)?{value:structuredClone(rows.get(k))}:null;},
    async change(k,fn){const v=await fn(rows.has(k)?structuredClone(rows.get(k)):null);if(v!==undefined)rows.set(k,v);return v;}};
}
function fakeStore(fila,historicos){
  return {async list({afterNumero=''}={}){return fila.filter(r=>r.numero>afterNumero);},
    async history(n){return [...(historicos[n]||[])].reverse();}};
}

test('faixas e texto da espera',()=>{
  assert.equal(faixaDeEspera(30),'em_dia');assert.equal(faixaDeEspera(60),'em_risco');assert.equal(faixaDeEspera(240),'critico');
  assert.equal(textoEspera(25),'há 25 min');assert.equal(textoEspera(185),'há 3 h');assert.equal(textoEspera(3000),'há 2 dias');
  assert.equal(textoEspera(NaN),'há tempo indeterminado');
});

test('espera conta da primeira mensagem sem resposta de pessoa; resposta automática do LEX não conta',()=>{
  assert.equal(esperandoDesde([
    {direcao:'entrada',criado_em:t(10)},{direcao:'saida_lex',criado_em:t(10,1)},{direcao:'entrada',criado_em:t(11)}
  ].reverse()),t(10));
  assert.equal(esperandoDesde([{direcao:'entrada',criado_em:t(10)},{direcao:'saida_operador',criado_em:t(12)}].reverse()),null);
  assert.equal(esperandoDesde([{direcao:'entrada',criado_em:t(10)},{direcao:'saida_operador',criado_em:t(12)},{direcao:'entrada',criado_em:t(13)}].reverse()),t(13));
});

test('radar ordena quem espera há mais tempo e ignora quem já foi respondido',async()=>{
  const store=fakeStore([{numero:'5561911111111',nome:'Ana'},{numero:'5561922222222',nome:'Bia'},{numero:'5561933333333',nome:'Caio'}],{
    '5561911111111':[{direcao:'entrada',criado_em:t(9)}],
    '5561922222222':[{direcao:'entrada',criado_em:t(13,30)}],
    '5561933333333':[{direcao:'entrada',criado_em:t(8)},{direcao:'saida_operador',criado_em:t(9)}]});
  const r=await radarDaRecepcao({store,now:new Date(t(14))});
  assert.deepEqual(r.map(i=>[i.nome,i.faixa]),[['Ana','critico'],['Bia','em_dia']]);
});

test('aviso ao titular: uma vez por espera, de novo só se o cliente voltar a esperar',async()=>{
  const records=fakeRecords();const avisos=[];
  const hist={'5561911111111':[{direcao:'entrada',criado_em:t(9)}]};
  const store=fakeStore([{numero:'5561911111111',nome:'Ana',ultima_mensagem:'e o meu processo?'}],hist);
  let agora=new Date(t(14));
  const radar=createReceptionRadarAlerts({records,store,notify:async x=>{avisos.push(x);return true;},now:()=>agora});
  assert.equal((await radar.executar()).avisados,1);
  assert.match(avisos[0],/Ana \(5561911111111\) — esperando há 5 h — "e o meu processo\?"/);
  agora=new Date(t(15));
  assert.equal((await radar.executar()).avisados,0,'não repete');
  hist['5561911111111'].push({direcao:'saida_operador',criado_em:t(15,10)},{direcao:'entrada',criado_em:t(15,20)});
  agora=new Date(t(19,30));
  assert.equal((await radar.executar()).avisados,1,'nova espera, novo aviso');
});

test('fora do horário ou aviso não confirmado: nada é marcado como avisado',async()=>{
  const records=fakeRecords();
  const store=fakeStore([{numero:'5561911111111',nome:'Ana'}],{'5561911111111':[{direcao:'entrada',criado_em:t(1)}]});
  const noite=createReceptionRadarAlerts({records,store,notify:async()=>{throw new Error('não deveria avisar');},now:()=>new Date(t(14)),dentroDoHorario:()=>false});
  assert.equal((await noite.executar()).motivo,'fora_do_horario');
  const falhou=createReceptionRadarAlerts({records,store,notify:async()=>false,now:()=>new Date(t(14))});
  assert.equal((await falhou.executar()).avisados,0,'aviso não confirmado não conta');
  assert.equal(records.rows.size,0);
});

test('servidor roda o radar a cada 30 min, avisando pelo titular e no horário de trabalho',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8');
  assert.match(src,/createReceptionRadarAlerts\(\{records:recordStore,/);
  assert.match(src,/canais:\(\)=>\(\{\.\.\.\(CHAT_ID\?\{telegram:text=>envTelegram\(text,null,CHAT_ID\)\}/,'um controle por canal do titular');
  assert.match(src,/dentroDoHorario:agora=>require\('\.\/lib\/whatsapp-pacing'\)\.dentroDaJanela\(/);
  assert.match(src,/setInterval\(\(\)=>\{ receptionRadar\.executar\(\)/);
});

// Revisão de código de 06/10/2026.
test('histórico longo e datas em formato diferente não geram aviso repetido da mesma espera',async()=>{
  const records=fakeRecords();const avisos=[];
  const hist=[];
  for(let i=0;i<10;i++) hist.push({direcao:'entrada',criado_em:t(8,i*5)},{direcao:'saida_lex',criado_em:t(8,i*5+1)});
  const store=fakeStore([{numero:'5561911111111',nome:'Ana'}],{'5561911111111':hist});
  store.history=async()=>[...hist].reverse().slice(0,20).map(e=>({...e,criado_em:e.criado_em.replace('.000Z','+00:00')}));
  let agora=new Date(t(13));
  const radar=createReceptionRadarAlerts({records,store,notify:async x=>{avisos.push(x);return true;},now:()=>agora});
  assert.equal((await radar.executar()).avisados,1);
  for(let k=0;k<5;k++){ hist.push({direcao:'entrada',criado_em:t(13,k*10+5)},{direcao:'saida_lex',criado_em:t(13,k*10+6)}); agora=new Date(t(13,k*10+30)); assert.equal((await radar.executar()).avisados,0,'mesma espera'); }
  assert.equal(avisos.length,1);
});

test('banco fora do ar: o radar não roda com a fila da memória',async()=>{
  const store=fakeStore([{numero:'5561911111111',nome:'Ana'}],{'5561911111111':[{direcao:'entrada',criado_em:t(1)}]});
  store.healthcheck=async()=>({ok:false});
  const radar=createReceptionRadarAlerts({records:fakeRecords(),store,notify:async()=>{throw new Error('não deveria avisar');},now:()=>new Date(t(14))});
  assert.equal((await radar.executar()).motivo,'banco_indisponivel');
});

test('falha ao gravar o aviso não faz repetir no mesmo servidor',async()=>{
  const avisos=[];
  const records={async read(){return null;},async change(){throw new Error('fora');}};
  const store=fakeStore([{numero:'5561911111111',nome:'Ana'}],{'5561911111111':[{direcao:'entrada',criado_em:t(9)}]});
  const radar=createReceptionRadarAlerts({records,store,notify:async x=>{avisos.push(x);return true;},now:()=>new Date(t(14)),log:()=>{}});
  await radar.executar();await radar.executar();
  assert.equal(avisos.length,1);
});

test('lista paginada pelo número desde a primeira página (ninguém fica de fora)',async()=>{
  const chamadas=[];
  const store={async list(q){chamadas.push(q.afterNumero);return [];},async history(){return [];}};
  await radarDaRecepcao({store,now:new Date(t(14))});
  assert.equal(chamadas[0],'0');
});

// CodeRabbit, PR #157.
test('um controle por canal: falha no WhatsApp não impede o Telegram nem repete nele',async()=>{
  const records=fakeRecords();const tg=[];let wpOk=false;const wp=[];
  const store=fakeStore([{numero:'5561911111111',nome:'Ana'}],{'5561911111111':[{direcao:'entrada',criado_em:t(9)}]});
  const radar=createReceptionRadarAlerts({records,store,now:()=>new Date(t(14)),log:()=>{},
    canais:()=>({telegram:async x=>{tg.push(x);return true;},whatsapp:async x=>{wp.push(x);return wpOk;}})});
  await radar.executar();
  wpOk=true;
  await radar.executar();
  assert.equal(tg.length,1,'Telegram avisado uma vez');
  assert.equal(wp.length,2,'WhatsApp tentado de novo até confirmar');
  await radar.executar();
  assert.equal(wp.length,2);
});

test('histórico com mais de 50 eventos: a espera conta da primeira mensagem sem resposta',async()=>{
  const eventos=[{direcao:'saida_operador',criado_em:t(6)},{direcao:'entrada',criado_em:t(8)}];
  for(let i=0;i<70;i++) eventos.push({direcao:'saida_lex',criado_em:new Date(Date.parse(t(8,1))+i*60000).toISOString()});
  const desc=[...eventos].sort((a,b)=>b.criado_em.localeCompare(a.criado_em));
  const store={async list({afterNumero}){return afterNumero==='0'?[{numero:'5561911111111',nome:'Ana'}]:[];},
    async history(n,{limit,before}){return desc.filter(e=>!before||e.criado_em<before).slice(0,limit);}};
  const [item]=await radarDaRecepcao({store,now:new Date(t(13))});
  assert.equal(item.esperando_desde,t(8),'buscou além dos 50 mais recentes');
  assert.equal(item.faixa,'critico');
});

test('banco falha no meio da varredura: rodada abandonada, nada avisado',async()=>{
  const store={async healthcheck(){return {ok:true};},async list(){return [{numero:'5561911111111',nome:'Ana'}];},
    async history(_,{strict}){if(strict)throw new Error('banco caiu');return [{direcao:'entrada',criado_em:t(1)}];}};
  const radar=createReceptionRadarAlerts({records:fakeRecords(),store,notify:async()=>{throw new Error('não deveria avisar');},now:()=>new Date(t(14)),log:()=>{}});
  assert.equal((await radar.executar()).motivo,'banco_indisponivel');
});

test('mais de 15 críticos: só os nomeados contam como avisados; o resto vai no próximo aviso',async()=>{
  const fila=[];const hist={};
  for(let i=0;i<20;i++){const n='55619'+String(10000000+i);fila.push({numero:n,nome:'C'+i});hist[n]=[{direcao:'entrada',criado_em:t(8)}];}
  const avisos=[];
  const radar=createReceptionRadarAlerts({records:fakeRecords(),store:fakeStore(fila,hist),notify:async x=>{avisos.push(x);return true;},now:()=>new Date(t(14))});
  assert.equal((await radar.executar()).avisados,15);
  assert.equal((await radar.executar()).avisados,5);
  assert.equal((await radar.executar()).avisados,0);
});

test('aviso novo guardado só na memória prevalece sobre o aviso antigo do banco',async()=>{
  const rows=new Map();let falharGravacao=false;
  const records={async read(k){return rows.has(k)?{value:structuredClone(rows.get(k))}:null;},
    async change(k,fn){if(falharGravacao)throw new Error('fora');const v=await fn(null);rows.set(k,v);return v;}};
  const hist={'5561911111111':[{direcao:'entrada',criado_em:t(8)}]};
  const store=fakeStore([{numero:'5561911111111',nome:'Ana'}],hist);
  let agora=new Date(t(13));const avisos=[];
  const radar=createReceptionRadarAlerts({records,store,notify:async x=>{avisos.push(x);return true;},now:()=>agora,log:()=>{}});
  await radar.executar();
  hist['5561911111111'].push({direcao:'saida_operador',criado_em:t(13,10)},{direcao:'entrada',criado_em:t(13,20)});
  falharGravacao=true;agora=new Date(t(17,30));
  await radar.executar();
  agora=new Date(t(18));
  await radar.executar();
  assert.equal(avisos.length,2,'nenhum aviso repetido da mesma espera');
});
