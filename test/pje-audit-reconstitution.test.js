const {test}=require('node:test');
const assert=require('node:assert/strict');
const {captureMovement}=require('../lib/connector');
const {applyPjeMovement}=require('../lib/pje-sync');
const {verifyReadingLogEntry,createReadingLogEntry}=require('../lib/reading-log-schema');
const {reconstructCourtSyncEvidences}=require('../lib/office-daily-jobs');
const {isCourtSyncEvidence}=require('../lib/court-sync-evidence');

const cnj='0001234-56.2026.8.13.0001';
function memoryStore(processes){return {async mutate(fn){return {value:await fn(processes)};}};}

test('captura assistida PJe persiste readingLog auditável sem afirmar prazo',async()=>{
 const p={id:42,numero:cnj,prazo:'12/10/2026',status:'ATIVO',andamentos:[],court_readings:[]};
 const now=new Date('2026-09-16T10:00:00.000Z');
 const r=await captureMovement(memoryStore([p]),{cnj,data:'2026-09-16',andamento_texto:'Intimação publicada',fonte_url:'https://pje.tjmg.jus.br/processo?session=segredo'},{now,requestId:'req-1',connectorVersion:'test'});
 assert.equal(r.value.duplicado,false);assert.equal(p.prazo,'12/10/2026');assert.equal(p.status,'ATIVO');
 assert.equal(p.court_readings.length,1);assert.equal(p.court_readings[0].source,'pje');assert.equal(p.court_readings[0].proveniencia.endpoint,'https://pje.tjmg.jus.br/processo');
 assert.equal(p.court_readings[0].proveniencia.conector,'lib/connector');assert.equal(verifyReadingLogEntry(p.court_readings[0]),true);
 const receipt=JSON.parse(p.court_readings[0].recibo.raw_receipt);assert.equal(receipt.texto_integral,'Intimação publicada');assert.equal(receipt.tipo,'captura_manual_autenticada');
});

test('captura assistida rejeita URL não oficial',async()=>{
 const p={id:42,numero:cnj,andamentos:[]};
 await assert.rejects(captureMovement(memoryStore([p]),{cnj,data:'2026-09-16',andamento_texto:'texto',fonte_url:'https://evil.example/processo'}),/fonte deve ser/);
});

test('alterar texto do recibo depois da captura invalida integridade',async()=>{
 const p={id:42,numero:cnj,andamentos:[],court_readings:[]};
 await captureMovement(memoryStore([p]),{cnj,data:'2026-09-16',andamento_texto:'texto original',fonte_url:'https://pje.tjmg.jus.br/processo'});
 const original=p.court_readings[0];
 const forged={...original,recibo:{...original.recibo,raw_receipt:original.recibo.raw_receipt.replace('texto original','texto alterado')}};
 assert.equal(verifyReadingLogEntry(forged),false);
});

test('applyPjeMovement falha fechado sem proveniência autenticada do servidor',async()=>{
 const processos=[{id:42,numero:cnj,andamentos:[]}];let writes=0;
 await assert.rejects(applyPjeMovement({processos,sbReq:async()=>{writes++;return {ok:true,body:[{id:42}]};}},{cnj,data:'2026-09-16',andamento_texto:'movimento'}),/proveniência autenticada/);
 assert.equal(writes,0);assert.equal(processos[0].andamentos.length,0);
});

test('applyPjeMovement persiste movimento e readingLog quando proveniência é confiável',async()=>{
 const processos=[{id:42,numero:cnj,andamentos:[],court_readings:[]}];let patch;
 const trustedProvenance={authenticated:true,endpoint:'https://pje.tjmg.jus.br/api/real',request_id:'req-pje',timestamp_requisicao:'2026-09-16T10:00:00.000Z',timestamp_resposta:'2026-09-16T10:00:01.000Z',raw_receipt:'{"movimento":"original"}',content_type:'application/json',tipo_operacao:'pje_authenticated_import'};
 await applyPjeMovement({processos,trustedProvenance,sbReq:async(m,t,b)=>{patch=b;return {ok:true,body:[{id:42}]};}},{cnj,data:'2026-09-16',andamento_texto:'movimento'});
 assert.ok(patch.court_readings);assert.equal(processos[0].court_readings.length,1);assert.equal(verifyReadingLogEntry(processos[0].court_readings[0]),true);
});

test('reading persistida é reconstituída em CourtSyncEvidence após restart',()=>{
 const now=new Date('2026-09-16T10:00:00.000Z');
 const reading=createReadingLogEntry({processo:cnj,process_id:42,source:'pje',observed_at:now.toISOString(),ok:true,proveniencia:{conector:'lib/connector',endpoint:'https://pje.tjmg.jus.br/processo',request_id:'restart-1',authenticated:true,timestamp_requisicao:now.toISOString(),timestamp_resposta:now.toISOString()},query_context:{cnj},raw_receipt:'{"captura":"persistida"}',content_type:'application/json',movement_received:true,sincronizado:true});
 const persisted=JSON.parse(JSON.stringify({id:42,numero:cnj,court_readings:[reading]}));
 const evidences=reconstructCourtSyncEvidences([persisted],now);
 assert.equal(evidences.length,1);assert.equal(isCourtSyncEvidence(evidences[0]),true);assert.equal(evidences[0].process_id,'42');
});

test('reading adulterada persistida não é reconstituída como evidência',()=>{
 const now=new Date('2026-09-16T10:00:00.000Z');
 const reading=createReadingLogEntry({processo:cnj,process_id:42,source:'pje',observed_at:now.toISOString(),ok:true,proveniencia:{conector:'lib/connector',endpoint:'https://pje.tjmg.jus.br/processo',request_id:'restart-2',authenticated:true,timestamp_requisicao:now.toISOString(),timestamp_resposta:now.toISOString()},query_context:{cnj},raw_receipt:'original',movement_received:true});
 const forged=JSON.parse(JSON.stringify(reading));forged.recibo.raw_receipt='adulterado';
 assert.deepEqual(reconstructCourtSyncEvidences([{id:42,numero:cnj,court_readings:[forged]}],now),[]);
});
