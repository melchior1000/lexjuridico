'use strict';
// O advogado digita a OAB (tela ou WhatsApp) e o LEX liga o Diário na hora.
const test=require('node:test');
const assert=require('node:assert/strict');
const Djen=require('../lib/djen-monitor');
const {executeNaturalOfficeCommand}=require('../lib/office-routes');
const {parseOfficeQuery}=require('../lib/office-queries');

test('entende a OAB do jeito que o advogado escreve',()=>{
  assert.deepEqual(Djen.parseOabInput('minha OAB é 123456/MG'),[{oab:'123456',uf:'MG'}]);
  assert.deepEqual(Djen.parseOabInput('OAB/MG 123.456 e 98765 SP'),[{oab:'123456',uf:'MG'},{oab:'98765',uf:'SP'}]);
  assert.deepEqual(Djen.parseOabInput('oab 123456'),[],'sem UF não liga');
  assert.equal(parseOfficeQuery('qual a oab do dr joão?'),null);
});

test('OAB ligada pela tela vale quando o ambiente não tem DJEN_OABS',()=>{
  const old=process.env.DJEN_OABS;delete process.env.DJEN_OABS;
  try{
    Djen.setOabsProvider(()=>[{oab:'123456',uf:'MG'}]);
    assert.deepEqual(Djen.parseOabs(),[{oab:'123456',uf:'MG'}]);
    assert.deepEqual(Djen.parseOabs('999:SP'),[{oab:'999',uf:'SP'}],'ambiente tem prioridade');
  }finally{Djen.setOabsProvider(null);if(old!==undefined)process.env.DJEN_OABS=old}
});

test('pelo WhatsApp: advogado liga a OAB e recebe o resumo do Diário; secretaria não',async()=>{
  const calls=[];
  const deps={processStore:{async read(){return{processes:[]}}},engine:{async list(){return[]}},receptionStore:{async list(){return[]}},records:{list:async()=>[]},log:()=>{},
    oab:{get:()=>[],async set(oabs){calls.push(oabs);return{oabs,djen:{ok:true,consultadas:12,casadas:9,orfas:3,falhas:[]}}}}};
  const sec=await executeNaturalOfficeCommand(deps,{text:'minha OAB é 123456/MG',profile:'secretaria'});
  assert.match(sec.message,/não tem permissão/);assert.equal(calls.length,0);
  const out=await executeNaturalOfficeCommand(deps,{text:'minha OAB é 123456/MG',profile:'advogado'});
  assert.deepEqual(calls[0],[{oab:'123456',uf:'MG'}]);
  assert.match(out.message,/OAB 123456\/MG ligada ao LEX\. Li o DJEN agora: 12/);
  assert.match(out.message,/9 entraram nos seus processos/);
  assert.match(out.message,/3 são de processos que não estão no LEX/);
  assert.match(out.message,/só vale depois da sua confirmação/);
});

test('tela tem "Ligar ao tribunal" no menu Mais',()=>{
  const ui=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','office-ui-v2.js'),'utf8');
  assert.match(ui,/onclick="lexOab\(\)">⚖<span>Ligar ao tribunal \(OAB\)/);
  assert.match(ui,/lexApi\('\/api\/escritorio\/oab',\{method:'POST'/);
});
