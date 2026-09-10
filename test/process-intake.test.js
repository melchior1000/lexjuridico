'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {inspectIncoming,applyInspection}=require('../lib/process-intake');
const proc={id:1,numero:'5007422-52.2025.8.13.0704',nome:'Caso',andamentos:[{data:'09/09/2026',txt:'Decisão anterior'}],entrada_processual:[]};
function input(extra={}){return {base64:Buffer.from('arquivo novo').toString('base64'),nome:'5007422-52.2025.8.13.0704.pdf',mimeType:'application/pdf',origem:'whatsapp',...extra};}
test('mede arquivo, calcula hash e identifica CNJ pelo nome',()=>{const r=inspectIncoming(input(),[proc]);assert.equal(r.tamanho,12);assert.match(r.sha256,/^[a-f0-9]{64}$/);assert.equal(r.processo.id,1);assert.equal(r.status,'precisa_conferencia');});
test('marca evento posterior como novo andamento',()=>{const r=inspectIncoming(input({evento_data:'10/09/2026',evento_texto:'Nova intimação'}),[proc]);assert.equal(r.status,'novo_andamento');assert.equal(r.novo_andamento,true);const p=applyInspection(proc,r);assert.equal(p.andamentos[0].data,'10/09/2026');assert.equal(p.andamentos[0].origem,'whatsapp');});
test('não cria andamento se data não é posterior',()=>{const r=inspectIncoming(input({evento_data:'08/09/2026',evento_texto:'Movimento velho'}),[proc]);assert.equal(r.status,'provavel_antigo');assert.equal(r.novo_andamento,false);});
test('hash igual prevalece como provável duplicado',()=>{const first=inspectIncoming(input(),[proc]);const p={...proc,entrada_processual:[{sha256:first.sha256,tamanho:first.tamanho}]};const second=inspectIncoming(input({evento_data:'10/09/2026',evento_texto:'Nova'}),[p]);assert.equal(second.status,'provavel_duplicado');assert.equal(second.motivo,'hash_igual');});
test('mesmo tamanho sem mesmo hash não é descartado',()=>{const a=inspectIncoming(input(),[proc]);const p={...proc,entrada_processual:[{sha256:'f'.repeat(64),tamanho:a.tamanho}]};const b=inspectIncoming(input(),[p]);assert.equal(b.status,'precisa_conferencia');assert.equal(b.motivo,'mesmo_tamanho_sem_hash_igual');});
