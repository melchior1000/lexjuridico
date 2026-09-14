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
