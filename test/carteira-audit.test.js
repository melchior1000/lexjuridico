'use strict';
// Conferência dos números CNJ: nenhum número errado passa calado e nada é
// corrigido sem o advogado confirmar.
const test=require('node:test');
const assert=require('node:assert/strict');
const A=require('../lib/carteira-audit');
const {executeNaturalOfficeCommand}=require('../lib/office-routes');

const NOW=new Date('2026-09-24T13:00:00Z');
const WANDERSON='5001234-41.2025.4.06.3818';   // válido
const TYPO='5001234-41.2025.4.06.3881';        // dois dígitos trocados no fim
const OUTRO='1004321-12.2024.8.13.0704';       // válido

function store(rows){
  let data=structuredClone(rows);
  return{async read(){return{processes:structuredClone(data),version:1}},
    async mutate(fn){const ps=structuredClone(data);const value=fn(ps);data=ps;return{value,version:2}},
    get rows(){return data}};
}
const orphans=[
  {djen_id:'d1',cnj:WANDERSON.replace(/\D/g,''),tribunal:'TRF6',data_disponibilizacao:'2026-09-12',status:'orfa',
    payload:{destinatarios:[{nome:'CAIXA ECONOMICA FEDERAL'},{nome:'WANDERSON PEREIRA LIMA'}]},texto:'Execução de título extrajudicial'},
  {djen_id:'d2',cnj:OUTRO.replace(/\D/g,''),tribunal:'TJMG',data_disponibilizacao:'2026-09-10',status:'orfa',payload:{destinatarios:[{nome:'FULANO DE TAL'}]}}
];
const carteira=[
  {id:'k',nome:'CEF — Execução vs. Kleuber',numero:'6002060-50.2025.4.06.3818 / Embargos 6002846-94.2025.4.06.3818',status:'ATIVO',last_court_sync_at:'2026-09-20T10:00:00Z'},
  {id:'w',nome:'CEF — Execução vs. Wanderson',numero:'',status:'ATIVO'},
  {id:'t',nome:'Caixa — Wanderson embargos',numero:TYPO,status:'ATIVO'},
  {id:'c',nome:'COFCO — Agravo (Fazenda Santa Luzia)',numero:'A confirmar — vinculado a 5004158-61.2024.8.13.0704',status:'ATIVO'},
  {id:'e',nome:'COFCO — Execução Principal',numero:'5004158-61.2024.8.13.0704',status:'ATIVO'},
  {id:'adm',nome:'Recurso administrativo INCRA',numero:'',tipo:'administrativo',status:'ATIVO'},
  {id:'arq',nome:'Encerrado',numero:'123',status:'ARQUIVADO'}
];

test('dígito verificador do CNJ (Res. CNJ 65/2008, mod 97)',()=>{
  for(const n of ['0020974-18.2024.8.26.0002','5004158-61.2024.8.13.0704','6002060-50.2025.4.06.3818','6002846-94.2025.4.06.3818'])assert.ok(A.cnjValid(n),n);
  assert.equal(A.cnjValid('5004158-62.2024.8.13.0704'),false);
  assert.equal(A.cnjValid(TYPO),false);
  assert.equal(A.cnjCheckDigits('5004158-00.2024.8.13.0704'),'61');
});

test('conferência separa válidos, sem número e número inexistente, e ignora administrativo e arquivado',()=>{
  const r=A.auditCarteira({processes:carteira,orphans});
  assert.equal(r.total,5);assert.equal(r.administrativos,1);
  assert.deepEqual(r.ok.map(x=>x.id).sort(),['e','k']);
  const byId=Object.fromEntries(r.problemas.map(p=>[p.id,p]));
  assert.equal(byId.w.tipo,'sem_cnj');
  assert.equal(byId.t.tipo,'cnj_invalido');
  assert.equal(byId.c.tipo,'sem_cnj');
  assert.match(byId.c.motivo,/não começa com um CNJ/);
});

test('sugere o número certo pela publicação do DJEN: partes em comum e erro de digitação',()=>{
  const r=A.auditCarteira({processes:carteira,orphans});
  const w=r.problemas.find(p=>p.id==='w'),t=r.problemas.find(p=>p.id==='t');
  assert.equal(w.sugestoes[0].numero,WANDERSON);assert.match(w.sugestoes[0].motivo,/wanderson/);
  assert.equal(t.sugestoes[0].numero,WANDERSON);assert.match(t.sugestoes[0].motivo,/difere 1 dígito/);
  assert.ok(!w.sugestoes.some(s=>s.numero===OUTRO),'publicação de outra parte não é sugerida');
  const msg=A.auditMessage(r);
  assert.match(msg,/3 precisam de correção/);
  assert.match(msg,new RegExp('corrigir número de CEF — Execução vs\\. Wanderson para '+WANDERSON.replace(/\./g,'\\.')));
});

test('correção só grava número válido, não duplica e registra o histórico',async()=>{
  const s=store(carteira);
  await assert.rejects(A.applyCnjCorrection({processStore:s,processId:'w',numero:TYPO}),/dígito verificador não confere/);
  await assert.rejects(A.applyCnjCorrection({processStore:s,processId:'w',numero:'5004158-61.2024.8.13.0704'}),/já está no processo "COFCO — Execução Principal"/);
  const out=await A.applyCnjCorrection({processStore:s,processId:'t',numero:WANDERSON,now:NOW});
  assert.equal(out.processo.numero,WANDERSON);assert.equal(out.anterior,TYPO);
  const saved=s.rows.find(p=>p.id==='t');
  assert.equal(saved.numero_anterior,TYPO);
  assert.match(saved.andamentos[0].txt,/Número corrigido de "5001234-41\.2025\.4\.06\.3881" para 5001234-41\.2025\.4\.06\.3818/);
});

test('pelo WhatsApp: "confira os números" e "corrigir número de … para …"',async()=>{
  const s=store(carteira);
  const deps={processStore:s,engine:{async list(){return[]},async submit(){throw new Error('x')}},receptionStore:{async list(){return[]}},records:{list:async()=>[],request:async()=>({ok:true,status:200,body:orphans})},log:()=>{}};
  const audit=await executeNaturalOfficeCommand(deps,{text:'Lex, confira os números dos meus processos',profile:'advogado',now:NOW});
  assert.equal(audit.command.action,'carteira_audit');assert.match(audit.message,/Conferi os 5 processos judiciais/);
  const sec=await executeNaturalOfficeCommand(deps,{text:'corrigir número de CEF — Execução vs. Wanderson para '+WANDERSON,profile:'secretaria',now:NOW});
  assert.match(sec.message,/não tem permissão/);
  const fix=await executeNaturalOfficeCommand(deps,{text:'corrigir número de CEF — Execução vs. Wanderson para '+WANDERSON,profile:'advogado',now:NOW});
  assert.equal(fix.command.action,'cnj_fix');assert.match(fix.message,/gravado: 5001234-41\.2025\.4\.06\.3818/);
  assert.equal(s.rows.find(p=>p.id==='w').numero,WANDERSON);
});

test('corrigir o número já traz as publicações órfãs do Diário e diz que o tribunal não está ligado',async()=>{
  const s=store([{id:'w',nome:'CEF — Execução vs. Wanderson',numero:'',status:'ATIVO',andamentos:[]}]);
  const calls=[];
  const sbReq=async(method,table,body,query)=>{calls.push({method,table,body,query});
    if(method==='GET')return{ok:true,body:[{djen_id:'d1',cnj:WANDERSON.replace(/\D/g,''),tribunal:'TRF6',tipo:'Intimação',texto:'Manifeste-se sobre a penhora.',data_disponibilizacao:'2026-09-12',status:'orfa'}]};
    return{ok:true,body:[{djen_id:'d1'}]}};
  const out=await A.correctAndRefresh({processStore:s,processId:'w',numero:WANDERSON,now:NOW,dbReq:sbReq,pje:null});
  assert.equal(out.publicacoes,1);
  assert.equal(out.tribunal,'nao_conectado');
  assert.equal(s.rows[0].numero,WANDERSON);
  assert.ok(s.rows[0].andamentos.some(a=>/penhora/.test(a.txt)),'publicação entrou no processo');
  const get=calls.find(c=>c.method==='GET');
  assert.equal(get.query.status,'eq.orfa');assert.equal(get.query.cnj,'eq.'+WANDERSON.replace(/\D/g,''));
  const patch=calls.find(c=>c.method==='PATCH');
  assert.equal(patch.body.status,'casada');assert.equal(patch.body.processo_id,'w');
  const msg=A.correctionMessage(out);
  assert.match(msg,/gravado: 5001234-41\.2025\.4\.06\.3818/);
  assert.match(msg,/Trouxe 1 publicação/);
  assert.match(msg,/TRF6 ainda não está ligado ao LEX: o acompanhamento segue pelo Diário/);
  assert.match(msg,/Último andamento: 12\/09\/2026/);
});

test('corrigir o número consulta o tribunal quando ele está ligado',async()=>{
  const s=store([{id:'w',nome:'CEF — Execução vs. Wanderson',numero:'',status:'ATIVO',andamentos:[]}]);
  const consultas=[];
  const pje={config:{configurado:true},client:{tribunais:()=>['TRF6'],consultarProcesso:async(sigla,cnj)=>{consultas.push([sigla,cnj]);return{classe:'Execução',polos:[{polo:'AT',partes:['CAIXA ECONOMICA FEDERAL']},{polo:'PA',partes:['WANDERSON PEREIRA LIMA']}],movimentos:[{data:'2026-09-20',descricao:'Juntada de petição'}]}}}};
  const out=await A.correctAndRefresh({processStore:s,processId:'w',numero:WANDERSON,now:NOW,dbReq:async()=>({ok:true,body:[]}),pje});
  assert.deepEqual(consultas,[['TRF6',WANDERSON.replace(/\D/g,'')]]);
  assert.equal(out.tribunal,'atualizado');
  assert.match(A.correctionMessage(out),/Tribunal \(TRF6\): andamentos e partes atualizados/);
});

test('corrigir o número segue mesmo se o Diário estiver fora',async()=>{
  const s=store([{id:'w',nome:'X',numero:'',status:'ATIVO'}]);
  const out=await A.correctAndRefresh({processStore:s,processId:'w',numero:WANDERSON,now:NOW,dbReq:async()=>{throw new Error('supabase fora')}});
  assert.equal(out.publicacoes,0);assert.equal(s.rows[0].numero,WANDERSON);
});
