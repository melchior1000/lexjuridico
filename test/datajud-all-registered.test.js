'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Datajud=require('../lib/datajud');

function store(initial){
  let processes=structuredClone(initial);
  return {
    async read(){return {processes:structuredClone(processes),version:1}},
    async mutate(fn){const next=structuredClone(processes);const value=await fn(next);processes=next;return {value,processes:structuredClone(processes),version:2}}
  };
}

test('sincronização da carteira usa o tribunal de cada CNJ e pula casos sem número',async()=>{
  const db=store([
    {id:'go',numero:'5001234-56.2026.8.09.0001',andamentos:[]},
    {id:'sp',numero:'1001234-56.2026.8.26.0001',andamentos:[]},
    {id:'sem',numero:'',andamentos:[]}
  ]);
  const urls=[];
  const fetchImpl=async url=>{urls.push(url);return{ok:true,status:200,json:async()=>({hits:{hits:[]}})}};
  const result=await Datajud.syncRegistered(db,{apiKey:'public-key',fetchImpl});
  assert.equal(result.total,2);
  assert.equal(urls.length,2);
  assert.ok(urls.some(x=>x.includes('api_publica_tjgo')));
  assert.ok(urls.some(x=>x.includes('api_publica_tjsp')));
});

test('carteira grande é consultada com no máximo 4 chamadas simultâneas, mantendo a ordem e contando novos/erros',async()=>{
  const rows=[];for(let i=0;i<12;i++)rows.push({id:'p'+i,numero:'500'+String(1000+i).slice(1)+'-56.2026.8.09.0001',andamentos:[]});
  // Recalcula os dígitos verificadores para o Datajud aceitar o número.
  const {cnjCheckDigits,formatCnj}=require('../lib/carteira-audit');
  for(const [i,p] of rows.entries()){const seq=String(1000000+i);p.numero=formatCnj(seq+cnjCheckDigits(seq+'00'+'20268090001')+'20268090001')}
  const db=store(rows);
  let inFlight=0,peak=0,calls=0;
  const fetchImpl=async url=>{calls++;inFlight++;peak=Math.max(peak,inFlight);await new Promise(r=>setTimeout(r,5));inFlight--;
    if(url.includes('_search')&&calls===5)return{ok:false,status:500,json:async()=>({})};
    return{ok:true,status:200,json:async()=>({hits:{hits:[{_source:{numeroProcesso:'x',movimentos:[{nome:'Juntada',dataHora:'2026-09-26T10:00:00Z',codigo:1}]}}]}})}};
  const result=await Datajud.syncRegistered(db,{apiKey:'public-key',fetchImpl,integrityKey:'chave-de-teste-com-tamanho-suficiente-1234567890'});
  assert.equal(result.total,12);
  assert.ok(peak<=4&&peak>=2,'concorrência limitada a 4 (pico '+peak+')');
  assert.equal(result.resultados.map(r=>r.processo_id).join(','),rows.map(r=>r.id).join(','),'ordem da carteira preservada');
  assert.equal(result.erros,1);assert.equal(result.ok,false);
  assert.ok(result.novos>=10,'andamentos novos contados: '+result.novos);
});
