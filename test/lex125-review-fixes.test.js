'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {officeRoutes}=require('../lib/office-routes');
const Djen=require('../lib/djen-monitor');
const Audit=require('../lib/carteira-audit');

function store(initial){
  let rows=structuredClone(initial);
  return{
    async read(){return{processes:structuredClone(rows),version:1}},
    async mutate(fn){const next=structuredClone(rows),value=await fn(next);rows=next;return{value,processes:structuredClone(rows),version:2}},
    snapshot(){return structuredClone(rows)}
  };
}
function response(){let status=0,body=null;return{res:{writeHead:s=>{status=s},end:b=>{body=b?JSON.parse(b):null}},get:()=>({status,body})}}
async function route(ps,body){
  const out=response();
  await officeRoutes({url:'/api/escritorio/prazos/cumprido',method:'POST'},out.res,{
    headers:{},authenticate:()=> 'admin',body:async()=>body,processStore:ps
  });
  return out.get();
}

test('baixa limpa todos os campos de prazo e Desfazer não apaga atualização concorrente',async()=>{
  const truth={legal_truth:true,due_at:'2026-09-20',source:'DJEN'};
  const ps=store([{id:'p1',nome:'Caso',status:'ATIVO',prazo:'2026-09-20',prazoReal:'2026-09-20',dataPrazo:'2026-09-20',
    next_action_due_at:'2026-09-20',deadline_truth:truth,andamentos:[{data:'2026-09-19',txt:'antigo'}]}]);
  const marked=await route(ps,{processo_id:'p1',acao:'marcar'});
  assert.equal(marked.status,200);
  let p=ps.snapshot()[0];
  assert.equal(p.prazo,'');assert.equal(p.prazoReal,'');assert.equal(p.dataPrazo,'');assert.equal(p.next_action_due_at,'');
  assert.equal(p.prazo_baixa.ativa,true);assert.equal(p.deadline_truth.due_at,'2026-09-20');assert.ok(p.deadline_truth_resolvido_em);
  await ps.mutate(rows=>{rows[0].juiz='Juiz atualizado depois da baixa';rows[0].andamentos.unshift({data:'2026-09-24',txt:'movimento concorrente'});return rows[0]});
  const undone=await route(ps,{processo_id:'p1',acao:'desfazer'});
  assert.equal(undone.status,200);
  p=ps.snapshot()[0];
  assert.equal(p.next_action_due_at,'2026-09-20');
  assert.equal(p.prazo,'2026-09-20');
  assert.equal(p.juiz,'Juiz atualizado depois da baixa','Desfazer não restaura snapshot inteiro');
  assert.ok(p.andamentos.some(a=>a.txt==='movimento concorrente'),'andamento concorrente é preservado');
  assert.equal(p.prazo_baixa.ativa,false);
});

test('leitura de publicações pagina além de 50 sem truncar silenciosamente',async()=>{
  const cnj='50041586120248130704';
  const rows=Array.from({length:461},(_,i)=>({djen_id:'d'+i,cnj,status:'orfa',data_disponibilizacao:'2026-09-01'}));
  const calls=[];
  const sbReq=async(method,table,data,query)=>{
    calls.push({...query});
    const offset=Number(query.offset||0),limit=Number(query.limit||200);
    return{ok:true,status:200,body:rows.slice(offset,offset+limit)};
  };
  const out=await Djen.readCommunicationsByCnj(sbReq,cnj,{status:'orfa',pageSize:200});
  assert.equal(out.length,461);
  assert.deepEqual(calls.map(x=>Number(x.offset)),[0,200,400]);
  assert.ok(calls.every(x=>Number(x.limit)===200));
});

test('falha do Diário após corrigir CNJ é devolvida ao usuário, nunca engolida',async()=>{
  const numero='5001234-41.2025.4.06.3818';
  const ps=store([{id:'w',nome:'Caso',numero:'',status:'ATIVO'}]);
  const out=await Audit.correctAndRefresh({processStore:ps,processId:'w',numero,dbReq:async()=>{throw new Error('DJEN indisponível')}});
  assert.equal(out.diario_ok,false);
  assert.match(out.diario_erro,/DJEN indisponível/);
  assert.match(Audit.correctionMessage(out),/⚠️ Diário: DJEN indisponível/);
  assert.equal(ps.snapshot()[0].numero,numero,'a correção do CNJ continua gravada');
});

test('folha de ação tem teclado: Escape, trap de Tab e restaura foco',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','lex2-interface-core.js'),'utf8');
  assert.match(src,/e\.key==='Escape'/);
  assert.match(src,/e\.key!=='Tab'/);
  assert.match(src,/querySelectorAll\?\.\('button:not\(\[disabled\]\)/);
  assert.match(src,/previous\?\.focus\?\.\(\)/);
  assert.match(src,/tabindex="-1"/);
});

test('prazo assinado em deadline_truth entra na folha e baixa não depende de boolean legado',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','lex2-interface-core.js'),'utf8');
  assert.match(src,/t&&typeof t==='object'&&t\.legal_truth===true&&t\.due_at/);
  assert.match(src,/deadlineTruthDue\(p\)/);
  assert.doesNotMatch(src,/p\.deadline_truth===true&&days\(p\)<0/);
});
