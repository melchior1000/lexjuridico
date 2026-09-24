'use strict';
// "Cadastre o processo X": confere no tribunal e no Diário antes de gravar; nunca duplica.
const test=require('node:test');
const assert=require('node:assert/strict');
const {registerProcess,registerMessage}=require('../lib/process-register');
const {executeNaturalOfficeCommand}=require('../lib/office-routes');

const TJMG='5004158-61.2024.8.13.0704',TRF6='6002060-50.2025.4.06.3818';
const NOW=new Date('2026-09-24T12:00:00Z');
function store(rows=[]){let d=structuredClone(rows);return{async read(){return{processes:structuredClone(d)}},async mutate(fn){const ps=structuredClone(d);const value=fn(ps);d=ps;return{value}},get rows(){return d}}}
function pje(result){return{config:{configurado:true},client:{tribunais:()=>['TJMG'],async consultarProcesso(s,c){if(result instanceof Error)throw result;return{numero:c,...result}}}}}
const tribunal={classe:'Execução de Título Extrajudicial',orgao:'Vara Cível de Unaí',polos:[{polo:'AT',partes:['COFCO INTERNATIONAL']},{polo:'PA',partes:['FAZENDA SANTA LUZIA']}],movimentos:[{id:'1',data:'2026-09-20T10:00:00',descricao:'Juntada de petição'},{id:'2',data:'2026-08-01T10:00:00',descricao:'Citação'}]};
const djen=rows=>async()=>({ok:true,status:200,body:rows});

test('número com dígito errado nem consulta o tribunal',async()=>{
  await assert.rejects(registerProcess({cnj:'5004158-62.2024.8.13.0704',processStore:store()}),/dígito verificador deveria ser 61/);
});

test('cadastra com dados do tribunal e publicações do Diário, último andamento primeiro',async()=>{
  const s=store(),marks=[];
  const r=await registerProcess({cnj:TJMG,processStore:s,pje:pje(tribunal),now:NOW,dbReq:djen([{djen_id:'d1',cnj:'50041586120248130704',tipo:'Intimação',texto:'Intime-se a parte autora',data_disponibilizacao:'2026-09-22',status:'orfa'}]),markCommunication:async(db,id,patch)=>marks.push([id,patch.status])});
  assert.equal(r.cadastrado,true);
  const p=s.rows[0];
  assert.equal(p.numero,TJMG);assert.equal(p.tribunal,'TJMG');assert.equal(p.nome,'COFCO INTERNATIONAL x FAZENDA SANTA LUZIA');
  assert.equal(p.vara,'Vara Cível de Unaí');assert.match(p.partes,/Autor: COFCO/);
  assert.match(p.andamentos[0].txt,/\[DJEN\] Intimação/);assert.equal(p.andamentos[0].data,'2026-09-22');
  assert.equal(p.cadastro_conferido,'tribunal');
  assert.deepEqual(marks,[['d1','casada']],'publicação passa a pertencer ao processo');
  const msg=registerMessage(r,TJMG);
  assert.match(msg,/Cadastrei 5004158-61\.2024\.8\.13\.0704 \(TJMG\): COFCO INTERNATIONAL x FAZENDA SANTA LUZIA/);
  assert.match(msg,/Último andamento: 22\/09\/2026 — Intimação/);
  assert.match(msg,/Fonte: tribunal \(TJMG\) e 1 publicação/);
});

test('não duplica processo já cadastrado',async()=>{
  const s=store([{id:1,nome:'COFCO — Execução',numero:TJMG}]);
  const r=await registerProcess({cnj:TJMG,processStore:s,pje:pje(tribunal)});
  assert.equal(r.existente,true);assert.equal(s.rows.length,1);
  assert.match(registerMessage(r,TJMG),/já está no LEX/);
});

test('sem tribunal nem Diário confirmando, não cadastra; "mesmo assim" cadastra marcado sem conferência',async()=>{
  const s=store();
  const r=await registerProcess({cnj:TRF6,processStore:s,pje:pje(tribunal),dbReq:djen([])});
  assert.equal(r.cadastrado,false);assert.equal(r.fonteTribunal,'eproc');assert.equal(s.rows.length,0);
  assert.match(registerMessage(r,TRF6),/TRF6 usa eproc[\s\S]*mesmo assim/);
  const f=await registerProcess({cnj:TRF6,processStore:s,pje:pje(tribunal),dbReq:djen([]),forcar:true});
  assert.equal(f.cadastrado,true);assert.equal(s.rows[0].cadastro_conferido,'sem_conferencia');
  assert.match(registerMessage(f,TRF6),/sem conferência/);
});

test('eproc com publicação no Diário: cadastra pelo Diário e pede conferir partes',async()=>{
  const s=store();
  const r=await registerProcess({cnj:TRF6,processStore:s,dbReq:djen([{djen_id:'d9',cnj:'60020605020254063818',tipo:'Intimação',texto:'Prazo para impugnar',data_disponibilizacao:'2026-09-10',payload:{destinatarios:[{nome:'CAIXA ECONOMICA FEDERAL'},{nome:'KLEUBER'}]}}])});
  assert.equal(r.cadastrado,true);assert.equal(s.rows[0].nome,'CAIXA ECONOMICA FEDERAL x KLEUBER');assert.equal(s.rows[0].cadastro_conferido,'diario');
  assert.match(registerMessage(r,TRF6),/TRF6 usa eproc[\s\S]*Confira as partes/);
});

test('pelo WhatsApp: "cadastre o processo …"',async()=>{
  const s=store();
  const deps={processStore:s,pje:pje(tribunal),engine:{async list(){return[]}},receptionStore:{async list(){return[]}},records:{list:async()=>[],request:djen([])},log:()=>{}};
  const out=await executeNaturalOfficeCommand(deps,{text:'Lex, cadastre o processo '+TJMG+' do TJMG',profile:'advogado'});
  assert.equal(out.command.action,'process_register');
  assert.match(out.message,/Cadastrei/);assert.equal(s.rows.length,1);
});
