'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {modelsFor,channelModelsFor,legalModelFor}=require('../lib/ai-runtime');
const src=fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8');

test('canais usam modelos econômicos por padrão e aceitam troca por configuração',()=>{
  assert.deepEqual(channelModelsFor('anthropic',{}),{canal:'claude-sonnet-5',rapido:'claude-haiku-4-5'});
  assert.deepEqual(channelModelsFor('anthropic',{LEX_ANTHROPIC_MODEL_CANAL:'claude-opus-5',LEX_ANTHROPIC_MODEL_RAPIDO:'claude-sonnet-5'}),{canal:'claude-opus-5',rapido:'claude-sonnet-5'});
  assert.deepEqual(channelModelsFor('openai',{}),{canal:'gpt-4.1-mini',rapido:'gpt-4.1-nano'});
});

test('modelo de canal não rebaixa o trabalho jurídico',()=>{
  const env={LEX_ANTHROPIC_MODEL_CANAL:'claude-haiku-4-5'};
  assert.deepEqual(modelsFor('anthropic',env),{top:'claude-opus-5',mid:'claude-opus-5',eco:'claude-opus-5'});
  assert.equal(legalModelFor(env),'claude-fable-5-1');
});

test('só as conversas de canal usam MODELO_CANAL/MODELO_RAPIDO',()=>{
  assert.match(src,/ia\(mem\.hist, sys, 2500, MODELO_CANAL\)/,'chat principal dos canais');
  assert.match(src,/sys, 200, MODELO_RAPIDO\)/,'cumprimento curto');
  assert.match(src,/system, MODELO_CANAL_ANTHROPIC\); \/\/ Intake/,'secretário/recepção');
  const uses=(src.match(/MODELO_(CANAL|RAPIDO)(_ANTHROPIC)?\b/g)||[]).length;
  assert.ok(uses<=16,'uso do modelo econômico se espalhou: revise antes de rebaixar outra rota ('+uses+')');
  // Rotas jurídicas seguem no modelo forte.
  for(const marker of ['Assessor diagnóstico','Assessor estratégia','Red team peça','Perícia análise','Prognóstico JSON']){
    const line=src.split('\n').find(l=>l.includes(marker));
    assert.ok(line&&/MODELO_MID/.test(line)&&!/MODELO_CANAL|MODELO_RAPIDO/.test(line),marker+' deve seguir no nível forte');
  }
});

test('secretário lê os blocos de texto, não só o primeiro bloco',()=>{
  const start=src.indexOf('async function _chamarAnthropicSecretario');
  const body=src.slice(start,start+1200);
  assert.match(body,/model: modelo \|\| MODELOS_POR_PROVIDER\.anthropic\.top/);
  assert.match(body,/filter\(block=>block\?\.type==='text'\)/);
  assert.doesNotMatch(body,/content\?\.\[0\]\?\.text/);
});
