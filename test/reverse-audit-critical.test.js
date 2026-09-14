'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'../bot.js'),'utf8');

function extractFunction(name,nextMarker){
  const start=source.indexOf('async function '+name+'(');
  assert.ok(start>=0,'função '+name+' não encontrada');
  const end=source.indexOf(nextMarker,start);
  assert.ok(end>start,'marcador final de '+name+' não encontrado');
  return source.slice(start,end);
}

test('cadastro legado só confirma sucesso quando o Supabase confirma escrita',async()=>{
  const code=extractFunction('_salvarPerfilCliente','// Extrai dados estruturados');
  for(const [result,expected] of [[{ok:false,status:503},false],[{ok:true,status:200,body:[{chat_id:'x'}]},true]]){
    const context=vm.createContext({
      sbUpsert:async()=>result,
      console:{warn:()=>{}},
      Date
    });
    vm.runInContext(code,context);
    const ok=await context._salvarPerfilCliente({chat_id:'x'});
    assert.equal(ok,expected);
  }
});

test('fallback do operador não fixa nome pessoal no código',()=>{
  const start=source.indexOf('function _isOperadorWhatsApp(');
  const end=source.indexOf('\n}',start)+2;
  assert.ok(start>=0&&end>start);
  const snippet=source.slice(start,end);
  assert.doesNotMatch(snippet,/nome:\s*['\"]kleuber['\"]/i);
  assert.match(snippet,/LEX_OPERATOR_NAME/);
});
