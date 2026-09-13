'use strict';
const fs=require('node:fs');
let s=fs.readFileSync('lib/integration-status.js','utf8');
const importOld="const {transcribeAudio,audioPayloadFromEvolution} = require('./audio-transcription');";
const importNew=importOld+"\nconst {createReceptionTurnBuffer} = require('./reception-turn-buffer');";
if(!s.includes(importOld)||s.includes("require('./reception-turn-buffer')")) throw new Error('Import esperado não encontrado ou já aplicado.');
s=s.replace(importOld,importNew);

const marker='function webhookAuthStatus(secret,supplied){';
const idx=s.indexOf(marker);
if(idx<0) throw new Error('Marcador webhookAuthStatus não encontrado.');
const bufferDecl="const publicReceptionTurnBuffer=createReceptionTurnBuffer({dispatch:(body,instance)=>publicWhatsappReception(body,instance),delayMs:1200});\n\n";
s=s.slice(0,idx)+bufferDecl+s.slice(idx);

const oldBranch="if(mode==='public'){queueMicrotask(()=>publicWhatsappReception(body,instance).catch(()=>{}));return false;}";
const newBranch="if(mode==='public'){queueMicrotask(()=>publicReceptionTurnBuffer.enqueue(body,instance).catch(()=>{}));return false;}";
if((s.split(oldBranch).length-1)!==1) throw new Error('Trecho público esperado não encontrado exatamente uma vez.');
s=s.replace(oldBranch,newBranch);
fs.writeFileSync('lib/integration-status.js',s);
console.log('buffer de turno aplicado');
