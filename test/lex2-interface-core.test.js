'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const core=fs.readFileSync(path.join(__dirname,'..','lex2-interface-core.js'),'utf8');const loader=fs.readFileSync(path.join(__dirname,'..','office-ui.js'),'utf8');
test('HOJE é fila de exceções e não dashboard de KPI',()=>{assert.match(core,/assuntos precisam de você/);assert.match(core,/Prazo crítico|Prazo cadastrado/);assert.match(core,/Cliente aguardando/);assert.match(core,/Documento em quarentena/);assert.doesNotMatch(core,/lex-kpis|Setores do Escritório|Olá, Dr\./)});
test('mantém cinco destinos móveis congelados',()=>{for(const x of ['Início','LEX','Processos','Prazos','Mais'])assert.match(core,new RegExp('>'+x+'<'))});
test('prazo cadastrado não é tratado silenciosamente como verdade jurídica',()=>{assert.match(core,/Confira no tribunal se foi cumprido/);assert.match(core,/Confira no tribunal antes de agir/)});
test('núcleo novo carrega depois da interface e dossiê existentes',()=>{const dossier=loader.indexOf('office-dossier-ui.js');const corePos=loader.indexOf('lex2-interface-core.js');assert.ok(dossier>=0&&corePos>dossier)});
