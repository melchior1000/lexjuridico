'use strict';
// O aviso "assistente jurídico · não substitui as funções do advogado" é obrigatório
// embaixo da marca em toda tela, no login, nos prompts que governam a IA e na API de conversa.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {AVISO,AVISO_CURTO,AVISO_PROMPT}=require('../lib/lex-aviso');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

test('fonte única do aviso: fala em assistente jurídico e em não substituir o advogado',()=>{
  for(const t of [AVISO,AVISO_CURTO,AVISO_PROMPT]){assert.match(t,/assistente jurídico/i);assert.match(t,/não substitui/i);assert.match(t,/advogado/i)}
  assert.match(AVISO,/8\.906\/1994/);
});

test('toda tela com a marca LEX mostra o aviso embaixo dela; login também; nunca escondido no celular',()=>{
  assert.match(read('office-ui-base.js'),/function lexAvisoHtml\(\)[\s\S]*lex-aviso/);
  assert.ok(read('office-ui-base.js').includes(AVISO_CURTO),'base usa o mesmo texto do servidor');
  for(const f of ['office-ui-v2.js','lex2-coordinator-ui.js','lex2-interface-core.js','office-dossier-ui.js','lex-legacy-frame.js']){
    const src=read(f);const marcas=[...src.matchAll(/<strong>(?:LEX|'\+title\+')<\/strong>[^]*?<\/div>/g)];
    assert.ok(marcas.length>0,f+': marca não encontrada');
    for(const m of marcas)assert.match(m[0],/lexAvisoHtml/,f+': marca sem aviso');
  }
  assert.ok(read('index.html').includes(AVISO_CURTO),'tela de login');
  assert.match(read('office-ui-v2.css'),/\.lex-aviso\{display:block/);
  assert.doesNotMatch(read('office-ui-v2.css'),/\.lex-aviso\{[^}]*display:none/);
});

test('prompts do gestor e da recepção carregam o aviso; API de conversa devolve o campo aviso; AGENTS.md registra',()=>{
  assert.match(read('lex_agente_vivo_core.js'),/\$\{LEX_AVISO_PROMPT\}/);
  assert.match(read('lex_agente_vivo_core.js'),/aviso: LEX_AVISO/);
  const R=require('../lib/reception-ai');
  assert.ok(R.systemPrompt({assistente:'LEX'},{kind:'general'}).includes(AVISO_PROMPT));
  assert.match(read('AGENTS.md'),/não substitui as funções do advogado/);
});
