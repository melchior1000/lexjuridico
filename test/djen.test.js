'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Djen=require('../lib/djen');

function response(body,status=200,requestId='req'){
  return{ok:status>=200&&status<300,status,headers:{get:n=>n==='x-request-id'?requestId:'application/json'},text:async()=>JSON.stringify(body)};
}

test('porOab pagina cada variante sem usar contagem acumulada de outra variante',async()=>{
  const calls=[];
  const fetchImpl=async url=>{
    const u=new URL(url),oab=u.searchParams.get('numeroOab'),page=Number(u.searchParams.get('pagina'));
    calls.push(oab+':'+page);
    if((oab==='123456'||oab==='123456-O')&&page===1){
      return response({count:51,items:Array.from({length:50},(_,i)=>({id:oab+'-'+i,texto:'item'}))},200,'req-'+oab+'-1');
    }
    if((oab==='123456'||oab==='123456-O')&&page===2){
      return response({count:51,items:[{id:oab+'-50',texto:'fim'}]},200,'req-'+oab+'-2');
    }
    return response({count:0,items:[]},200,'req-empty');
  };
  const out=await Djen.porOab('123456','DF',{inicio:'2026-09-19',fim:'2026-09-20'},{fetchImpl,interRequestDelayMs:0,maxPages:3});
  assert.equal(out.items.length,102);
  assert.ok(calls.includes('123456:2'));
  assert.ok(calls.includes('123456-O:2'));
});

test('cada item mantém a proveniência da página que efetivamente o trouxe',async()=>{
  const fetchImpl=async url=>{
    const u=new URL(url),oab=u.searchParams.get('numeroOab'),page=Number(u.searchParams.get('pagina'));
    if(oab==='123456'&&page===1)return response({count:51,items:Array.from({length:50},(_,i)=>({id:'a'+i}))},200,'page-1');
    if(oab==='123456'&&page===2)return response({count:51,items:[{id:'last'}]},200,'page-2');
    return response({count:0,items:[]},200,'empty');
  };
  const out=await Djen.porOab('123456','MG',{inicio:'2026-09-19',fim:'2026-09-20'},{fetchImpl,interRequestDelayMs:0,maxPages:3});
  assert.equal(out.itemAudits[Djen.itemKey({id:'a0'})].request_id,'page-1');
  assert.equal(out.itemAudits[Djen.itemKey({id:'last'})].request_id,'page-2');
});
