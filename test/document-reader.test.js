'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessTextQuality,extractPdfText,readDocument,readWithVision,mustBlockReading,unreadMessage}=require('../lib/document-reader');

const goodText=('BANCO EXEMPLO EXTRATO CONTA 1234 Data 03/09/2026 Saldo R$ 1.234,56 Movimento pagamento R$ 100,00. ').repeat(8);

test('texto PDF suficiente é confiança alta',()=>{
  const q=assessTextQuality(goodText,{pages:2});
  assert.equal(q.ok,true);assert.equal(q.confidence,'alta');
});

test('PDF com camada de texto boa não chama visão',async()=>{
  let vision=0;
  const r=await readDocument(Buffer.from('pdf'),{mimeType:'application/pdf',filename:'extrato.pdf',pdfParser:async()=>({text:goodText,numpages:2}),vision:async()=>{vision++;throw new Error('não chamar');}});
  assert.equal(r.ok,true);assert.equal(r.method,'pdf_text');assert.equal(vision,0);
});

test('PDF sem texto cai para visão',async()=>{
  let vision=0;
  const r=await readDocument(Buffer.from('pdf'),{mimeType:'application/pdf',filename:'scan.pdf',pdfParser:async()=>({text:'',numpages:2}),vision:async()=>{vision++;return {ok:true,confidence:'alta',source:'openai_vision',text:'DOCUMENTO LEGÍVEL COM DADOS CONFIRMADOS',evidences:[{pagina:1,linha:'3'}]};}});
  assert.equal(vision,1);assert.equal(r.ok,true);assert.equal(r.method,'vision_fallback');
});

test('visão baixa bloqueia documento crítico',async()=>{
  const r=await readDocument(Buffer.from('foto'),{mimeType:'image/jpeg',filename:'extrato.jpg',vision:async()=>({ok:false,confidence:'baixa',reason:'confianca_insuficiente'})});
  assert.equal(mustBlockReading(r,{critical:true}),true);
  assert.match(unreadMessage(),/não deu para ler/i);
});

test('visão sem chave falha fechada',async()=>{
  const r=await readWithVision(Buffer.from('foto'),{mimeType:'image/jpeg',filename:'doc.jpg',apiKey:'',request:async()=>({ok:false,error:'OPENAI_API_KEY_ausente'})});
  assert.equal(r.ok,false);assert.equal(r.confidence,'baixa');
});

test('extrato com valor mas sem origem verificável não é aceito',async()=>{
  const response={output:[{content:[{text:JSON.stringify({tipo_documento:'extrato_bancario',confianca:'alta',texto_legivel:'03/09 saldo R$ 1.234,56',evidencias:[{pagina:null,data:'',linha:'',campo:'saldo',valor:'R$ 1.234,56'}],observacoes:''})}]}]};
  const r=await readWithVision(Buffer.from('foto'),{mimeType:'image/jpeg',filename:'extrato.jpg',apiKey:'x',request:async()=>({ok:true,json:response})});
  assert.equal(r.ok,false);assert.equal(r.reason,'evidencia_insuficiente');
});

test('extrato com origem e confiança alta pode prosseguir',async()=>{
  const response={output:[{content:[{text:JSON.stringify({tipo_documento:'extrato_bancario',confianca:'alta',texto_legivel:'03/09 saldo R$ 1.234,56 confirmado no documento',evidencias:[{pagina:2,data:'03/09/2026',linha:'saldo final',campo:'saldo',valor:'R$ 1.234,56'}],observacoes:''})}]}]};
  const r=await readWithVision(Buffer.from('foto'),{mimeType:'image/jpeg',filename:'extrato.jpg',apiKey:'x',request:async()=>({ok:true,json:response})});
  assert.equal(r.ok,true);assert.equal(r.confidence,'alta');
});
