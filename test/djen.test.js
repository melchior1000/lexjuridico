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

// Falha FECHADA (13/10/2026): o DJEN informa quantas comunicações há (count). Se devolver menos —
// página vazia, página menor que a pedida, página repetida —, a leitura dá erro em vez de
// passar como "lida" com menos (seria intimação perdida em silêncio).
test('página menor que a pedida: continua até o total informado pelo DJEN',async()=>{
  const fetchImpl=async url=>{
    const u=new URL(url),oab=u.searchParams.get('numeroOab'),page=Number(u.searchParams.get('pagina'));
    if(oab!=='123456')return response({count:0,items:[]});
    const todos=Array.from({length:12},(_,i)=>({id:'x'+i}));
    return response({count:12,items:todos.slice((page-1)*5,page*5)}); // o DJEN devolve 5 por página
  };
  const out=await Djen.porOab('123456','MG',{inicio:'2026-10-13',fim:'2026-10-13'},{fetchImpl,interRequestDelayMs:0});
  assert.equal(out.items.length,12);
});
test('DJEN informa comunicações e não devolve: leitura marcada incompleta, nunca "nenhuma intimação"',async()=>{
  const janela={inicio:'2026-10-13',fim:'2026-10-13'};
  const vazio=async url=>new URL(url).searchParams.get('numeroOab')==='123456'?response({count:3,items:[]}):response({count:0,items:[]});
  const r1=await Djen.porOab('123456','MG',janela,{fetchImpl:vazio,interRequestDelayMs:0});
  assert.equal(r1.items.length,0);
  assert.equal(r1.incompletas.length,1);
  assert.match(r1.incompletas[0].erro,/leitura incompleta[\s\S]*3 informada\(s\), 0 recebida\(s\)/);
  // O DJEN ignora a página pedida e devolve sempre a mesma: guarda as 50 que vieram (são intimações
  // reais) e marca a leitura como incompleta — nada é jogado fora, e nada é dado como lido.
  const repetida=async url=>new URL(url).searchParams.get('numeroOab')==='123456'?response({count:80,items:Array.from({length:50},(_,i)=>({id:'r'+i}))}):response({count:0,items:[]});
  const r2=await Djen.porOab('123456','MG',janela,{fetchImpl:repetida,interRequestDelayMs:0});
  assert.equal(r2.items.length,50);
  assert.match(r2.incompletas[0].erro,/80 informada\(s\), 50 recebida\(s\)/);
});
test('linha repetida dentro da contagem do DJEN não vira falso alarme de leitura incompleta',async()=>{
  // 51 linhas informadas; a 51ª repete uma comunicação da página 1 (mesmo id): tudo foi recebido.
  const fetchImpl=async url=>{
    const u=new URL(url),page=Number(u.searchParams.get('pagina'));
    if(u.searchParams.get('numeroOab')!=='123456')return response({count:0,items:[]});
    return page===1?response({count:51,items:Array.from({length:50},(_,i)=>({id:'d'+i}))}):response({count:51,items:[{id:'d7'}]});
  };
  const r=await Djen.porOab('123456','MG',{inicio:'2026-10-13',fim:'2026-10-13'},{fetchImpl,interRequestDelayMs:0});
  assert.equal(r.items.length,50);
  assert.deepEqual(r.incompletas,[]);
});
test('resposta sem "count": lê até a página vir menor que a pedida (antes parava na 1ª página cheia)',async()=>{
  const fetchImpl=async url=>{
    const u=new URL(url),page=Number(u.searchParams.get('pagina'));
    if(u.searchParams.get('numeroOab')!=='123456')return response({items:[]});
    return response({items:page===1?Array.from({length:50},(_,i)=>({id:'s'+i})):[{id:'s50'},{id:'s51'}]});
  };
  const r=await Djen.porOab('123456','MG',{inicio:'2026-10-13',fim:'2026-10-13'},{fetchImpl,interRequestDelayMs:0});
  assert.equal(r.items.length,52);
  assert.deepEqual(r.incompletas,[]);
});
test('busca pelo nome do advogado: parâmetro nomeAdvogado, nome completo obrigatório',async()=>{
  let url=null;
  const out=await Djen.porNome('Fulano de Tal Advogado',{inicio:'2026-10-13',fim:'2026-10-13'},{fetchImpl:async u=>{url=new URL(u);return response({count:1,items:[{id:'n1',destinatarioadvogados:[{advogado:{nome:'FULANO DE TAL ADVOGADO',numero_oab:'999999',uf_oab:'SP'}}]}]})},interRequestDelayMs:0});
  assert.equal(url.searchParams.get('nomeAdvogado'),'Fulano de Tal Advogado');assert.equal(url.searchParams.get('numeroOab'),null);
  assert.equal(out.items.length,1);
  assert.deepEqual(Djen.advogadosDoItem(out.items[0]),[{nome:'FULANO DE TAL ADVOGADO',oab:'999999',uf:'SP'}]);
  await assert.rejects(Djen.porNome('Fulano',{inicio:'2026-10-13',fim:'2026-10-13'},{fetchImpl:async()=>response({count:0,items:[]})}),/nome e sobrenome/);
});
