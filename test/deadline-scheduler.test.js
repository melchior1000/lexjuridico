'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDeadlineScheduler}=require('../lib/deadline-scheduler');

function records(){
  const map=new Map();
  return{async read(k){return map.has(k)?{value:structuredClone(map.get(k))}:null},async change(k,fn){const next=await fn(map.has(k)?structuredClone(map.get(k)):null);if(next!==undefined)map.set(k,structuredClone(next));return map.get(k)},get:k=>map.get(k)};
}
test('scheduler não repete um dia já concluído',async()=>{
  const rec=records();let runs=0;
  const s=createDeadlineScheduler({records:rec,now:()=>new Date('2026-09-20T12:00:00-03:00'),run:async()=>{runs++;return{ok:true,djen:{enabled:true,ok:true,cunhar_total:0},alerts:{novos:0},exceptions:[]}}});
  await s.tick();await s.tick();
  assert.equal(runs,1);assert.equal(rec.get('lex_deadline_daily_job').status,'ok');s.stop();
});
test('falha DJEN fica em retry e pode tentar de novo',async()=>{
  const rec=records();let runs=0;
  const s=createDeadlineScheduler({records:rec,now:()=>new Date('2026-09-20T12:00:00-03:00'),run:async()=>{runs++;return{ok:false,djen:{enabled:true,ok:false,error:'403',cunhar_total:0},alerts:{novos:0},exceptions:[]}}});
  await s.tick();await s.tick();
  assert.equal(runs,2);assert.equal(rec.get('lex_deadline_daily_job').status,'retry');s.stop();
});


test('DJEN sem OAB fica bloqueado e não é registrado como dia concluído',async()=>{
  const rec=records();let runs=0;const notices=[];
  const s=createDeadlineScheduler({
    records:rec,now:()=>new Date('2026-09-20T12:00:00-03:00'),
    notify:async text=>notices.push(text),
    run:async()=>{runs++;return{ok:true,djen:{enabled:false,ok:true,cunhar_total:0},alerts:{novos:0},exceptions:[]}}
  });
  await s.tick();await s.tick();
  assert.equal(runs,2);
  assert.equal(rec.get('lex_deadline_daily_job').status,'blocked');
  assert.equal(rec.get('lex_deadline_daily_job').djen_status,'not_configured');
  assert.ok(notices.some(x=>/não tem OAB configurada/i.test(x)));
  s.stop();
});

test('rotina do dia deixa registro para os Recibos: consultados, novos, erros — e diz quando o Datajud está desligado',async()=>{
  const rec=records();
  const on=createDeadlineScheduler({records:rec,now:()=>new Date('2026-09-26T06:30:00-03:00'),run:async()=>({ok:true,djen:{enabled:true,ok:true,cunhar_total:0,consultadas:9},datajud:{enabled:true,total:120,novos:7,falhas:1},alerts:{novos:0},exceptions:[]})});
  await on.tick();on.stop();
  const log=rec.get('lex_rotina_noturna_2026-09-26');
  assert.equal(log.consultados,120);assert.equal(log.novos,7);assert.equal(log.erros,1);assert.equal(log.datajud_ativo,true);assert.equal(log.djen_consultadas,9);
  assert.ok(log.iniciou_em&&log.terminou_em);
  const rec2=records();
  const off=createDeadlineScheduler({records:rec2,now:()=>new Date('2026-09-26T06:30:00-03:00'),run:async()=>({ok:true,djen:{enabled:true,ok:true,cunhar_total:0},datajud:{enabled:false,total:0,skipped:true,reason:'DATAJUD_API_KEY_NOT_CONFIGURED'},alerts:{novos:0},exceptions:[]})});
  await off.tick();off.stop();
  const log2=rec2.get('lex_rotina_noturna_2026-09-26');
  assert.equal(log2.datajud_ativo,false);assert.equal(log2.consultados,0);assert.equal(log2.motivo,'DATAJUD_API_KEY_NOT_CONFIGURED');
});


test('retry no mesmo dia soma atividade anterior em vez de apagar',async()=>{
  const rec=records();let run=0;
  const s=createDeadlineScheduler({records:rec,now:()=>new Date('2026-09-26T06:30:00-03:00'),run:async()=>{
    run++;
    return run===1
      ?{ok:false,djen:{enabled:true,ok:false,consultadas:2,cunhar_total:1},datajud:{enabled:true,total:10,novos:3,falhas:1},alerts:{novos:0},exceptions:[]}
      :{ok:true,djen:{enabled:true,ok:true,consultadas:4,cunhar_total:0},datajud:{enabled:true,total:10,novos:0,falhas:0},alerts:{novos:0},exceptions:[]};
  }});
  await s.tick();await s.tick();s.stop();
  const log=rec.get('lex_rotina_noturna_2026-09-26');
  assert.equal(log.consultados,20);assert.equal(log.novos,3);assert.equal(log.erros,1);
  assert.equal(log.djen_consultadas,6);assert.equal(log.djen_cunhar,1);
});

// Auditoria de 13/10/2026: nova tentativa no mesmo dia repete só o que falta — sem reler a
// carteira no Datajud, sem repetir o mesmo aviso a cada 30 minutos, sem inflar os Recibos.
test('nova tentativa no mesmo dia pula o Datajud já lido e não infla os Recibos',async()=>{
  const rec=records();const opcoes=[];
  const s=createDeadlineScheduler({records:rec,now:()=>new Date('2026-09-26T08:00:00-03:00'),run:async(now,o)=>{
    opcoes.push(o);
    return o?.pularDatajud
      ?{ok:false,djen:{enabled:true,ok:false,cunhar_total:0},datajud:{enabled:true,total:0,novos:0,falhas:0,skipped:true,reason:'DATAJUD_JA_LIDO_HOJE'},alerts:{novos:0},exceptions:[]}
      :{ok:false,djen:{enabled:true,ok:false,cunhar_total:0},datajud:{enabled:true,total:50,novos:4,falhas:0,nao_encontrados:2},alerts:{novos:0},exceptions:[]};
  }});
  await s.tick();await s.tick();await s.tick();s.stop();
  assert.deepEqual(opcoes.map(o=>o.pularDatajud),[false,true,true]);
  const log=rec.get('lex_rotina_noturna_2026-09-26');
  assert.equal(log.consultados,50,'a carteira foi lida uma vez');assert.equal(log.novos,4);assert.equal(log.nao_encontrados,2);
  assert.equal(log.motivo,null,'pular o Datajud já lido não vira "motivo" de desligado');
  assert.equal(rec.get('lex_deadline_daily_job').datajud_date,'2026-09-26');
});

test('aviso de falha do Diário e de OAB faltando sai uma vez por dia; fila de comunicações só volta se crescer',async()=>{
  const rec=records();const avisos=[];let fila=2;
  const s=createDeadlineScheduler({records:rec,now:()=>new Date('2026-09-26T08:00:00-03:00'),notify:async t=>avisos.push(t),
    run:async()=>({ok:false,djen:{enabled:true,ok:false,cunhar_total:fila},datajud:{enabled:false},alerts:{novos:0},exceptions:[]})});
  await s.tick();await s.tick();fila=3;await s.tick();await s.tick();s.stop();
  assert.equal(avisos.filter(t=>/leitura do DJEN falhou/.test(t)).length,1);
  assert.deepEqual(avisos.filter(t=>/aguardam leitura/.test(t)),['PRAZOS: 2 comunicação(ões) do DJEN aguardam leitura e confirmação humana.','PRAZOS: 3 comunicação(ões) do DJEN aguardam leitura e confirmação humana.']);
  const rec2=records();const avisos2=[];
  const b=createDeadlineScheduler({records:rec2,now:()=>new Date('2026-09-26T08:00:00-03:00'),notify:async t=>avisos2.push(t),
    run:async()=>({ok:true,djen:{enabled:false,ok:true,cunhar_total:0},alerts:{novos:0},exceptions:[]})});
  await b.tick();await b.tick();await b.tick();b.stop();
  assert.equal(avisos2.filter(t=>/não tem OAB configurada/.test(t)).length,1);
  // Dia seguinte: avisa de novo.
  const c=createDeadlineScheduler({records:rec2,now:()=>new Date('2026-09-27T08:00:00-03:00'),notify:async t=>avisos2.push(t),
    run:async()=>({ok:true,djen:{enabled:false,ok:true,cunhar_total:0},alerts:{novos:0},exceptions:[]})});
  await c.tick();c.stop();
  assert.equal(avisos2.filter(t=>/não tem OAB configurada/.test(t)).length,2);
});

test('rotina que quebra no meio avisa uma vez e guarda que o Datajud já foi lido',async()=>{
  const rec=records();const avisos=[];let n=0;
  const s=createDeadlineScheduler({records:rec,now:()=>new Date('2026-09-26T08:00:00-03:00'),notify:async t=>avisos.push(t),run:async(now,o)=>{
    n++;if(n===1)return{ok:false,djen:{enabled:true,ok:false,cunhar_total:0},datajud:{enabled:true,total:10,novos:0,falhas:0},alerts:{novos:0},exceptions:[]};
    throw new Error('banco fora do ar');
  }});
  await s.tick();await s.tick();await s.tick();s.stop();
  assert.equal(avisos.filter(t=>/rotina de vigilância falhou/.test(t)).length,1);
  const job=rec.get('lex_deadline_daily_job');
  assert.equal(job.status,'retry');assert.equal(job.datajud_date,'2026-09-26','não relê a carteira só porque a rotina quebrou depois');
});
