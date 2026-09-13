'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {whatsappStatus}=require('../lib/integration-status');

const cfg={url:'https://evolution.example.test',key:'fake',instance:'LEX-JURIDICO',number:'5561999333672'};
const open={instance:{instanceName:'LEX-JURIDICO',state:'open'}};

test('aceita ownerJid brasileiro legado sem o nono digito',async()=>{
  let n=0;
  const result=await whatsappStatus(cfg,async()=>++n===1?open:[{name:'LEX-JURIDICO',ownerJid:'556199333672@s.whatsapp.net'}]);
  assert.equal(result.conectado,true);
  assert.equal(result.estado,'conectado');
});

test('continua recusando ownerJid de outro numero',async()=>{
  let n=0;
  const result=await whatsappStatus(cfg,async()=>++n===1?open:[{name:'LEX-JURIDICO',ownerJid:'556199917171@s.whatsapp.net'}]);
  assert.equal(result.conectado,false);
  assert.equal(result.estado,'numero_divergente');
});
