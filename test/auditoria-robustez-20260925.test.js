'use strict';
// Travas da auditoria de 25/09/2026 — grupo ROBUSTEZ (backend).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {setup,source}=require('./runtime');

const RAIZ=path.join(__dirname,'..');
const envExample=fs.readFileSync(path.join(RAIZ,'config','lex.env.example'),'utf8');

// ── 10. e.status respeitado nos handlers; LEX_MAX_BODY_MB alinhado ──
test('_statusErroLex respeita e.status válido e cai em 500 para o resto',()=>{
  const c=setup().context;
  assert.equal(c._statusErroLex({status:413}),413);
  assert.equal(c._statusErroLex({status:404}),404);
  assert.equal(c._statusErroLex({status:502}),502);
  for(const e of [{},{status:200},{status:'x'},{status:999},{status:0},null,undefined,new Error('x')])assert.equal(c._statusErroLex(e),500,JSON.stringify(e));
  assert.equal(c._statusErroLex({},503),503);
});

test('handlers não engolem mais e.status em 500 genérico',async()=>{
  const app=setup({recuperarTodaMemoria:async()=>{throw Object.assign(new Error('Não encontrado'),{status:404});}});
  assert.equal((await app.request('/api/memoria',app.token('admin'))).status,404);
  const app2=setup({recuperarTodaMemoria:async()=>{throw new Error('boom');}});
  assert.equal((await app2.request('/api/memoria',app2.token('admin'))).status,500);
  const restantes=(source.match(/catch\(e\) \{ res\.writeHead\(500,corsHeaders\(req\)\); res\.end\(JSON\.stringify\(\{error:e\.message\}\)\); \}/g)||[]).length;
  assert.equal(restantes,0,'catch(e){500} uniforme deve usar _statusErroLex');
});

test('LEX_MAX_BODY_MB padrão do bot.js é o mesmo do lex.env.example',()=>{
  const exemplo=envExample.match(/^LEX_MAX_BODY_MB=(\d+)/m);
  const bot=source.match(/process\.env\.LEX_MAX_BODY_MB \|\| '(\d+)'/);
  assert.ok(exemplo&&bot,'ambos devem declarar o limite');
  assert.equal(bot[1],exemplo[1]);
});

// ── 11. tempo de uso: memória entra no relatório; array limitado a 5.000 ──
test('/api/tempo/logins soma logins da tabela e da memória; memória limitada a 5.000',async()=>{
  const mem=[];
  const app=setup({
    hojeBrasil:()=>'2026-09-25',horaBrasilia:()=>new Date(2026,8,25,12,0,0),
    global:{_tokensRevogados:new Set(),_sessaoAtividade:new Map(),_tempoUsoRegistros:mem},
    sbRows:async()=>[{data:'2026-09-24',hora_inicio:'09:00'},{data:'2026-09-25',hora_inicio:'08:00'}]
  });
  for(let i=0;i<3;i++)assert.equal((await app.request('/api/tempo-uso/login',app.token('admin'),{},'POST')).status,200);
  assert.equal((await app.request('/api/tempo-uso/login',app.token('secretaria'),{},'POST')).status,200);
  const r=await app.request('/api/tempo/logins?perfil=admin&dias=30',app.token('admin'));
  assert.equal(r.status,200);
  const body=JSON.parse(r.body);
  assert.equal(body.tabela,2);assert.equal(body.memoria,3);assert.equal(body.total,5);
  const hoje=body.logins.find(l=>l.data==='2026-09-25');
  assert.equal(hoje.logins,4,'1 da tabela + 3 da memória');
  assert.equal(body.logins.find(l=>l.data==='2026-09-24').logins,1);
  // sem tabela (erro), a memória ainda conta
  const app2=setup({hojeBrasil:()=>'2026-09-25',horaBrasilia:()=>new Date(2026,8,25,12,0,0),
    global:{_tokensRevogados:new Set(),_sessaoAtividade:new Map(),_tempoUsoRegistros:mem},sbRows:async()=>{throw new Error('tabela inexistente');}});
  const r2=JSON.parse((await app2.request('/api/tempo/logins?perfil=admin',app2.token('admin'))).body);
  assert.equal(r2.total,3);
  // poda: nunca passa de 5.000, e o mais antigo sai primeiro
  const c=app.context;
  for(let i=0;i<5200;i++)c._registrarTempoUsoMem({perfil:'admin',tipo:'heartbeat',ts:i,data:'2026-09-25',minutos:1});
  assert.equal(mem.length,5000);
  assert.equal(mem[0].ts,200,'os 200 mais antigos (e os 4 logins iniciais) saíram');
  assert.equal(mem[mem.length-1].ts,5199);
});

// ── 13. prognóstico aceita id de processo como texto (UUID ou numérico legado) ──
test('/api/prognostico encontra processo por id UUID e por id numérico legado',async()=>{
  const processos=[{id:'3f1c2a4e-1111-4222-8333-444455556666',nome:'A'},{id:1758000000000,nome:'B'}];
  const app=setup({processos,_gerarPrognosticoRealista:async p=>({probabilidade_exito:70,nome:p.nome})});
  const a=await app.request('/api/prognostico',app.token('admin'),{processo_id:'3f1c2a4e-1111-4222-8333-444455556666'},'POST');
  assert.equal(a.status,200);assert.equal(JSON.parse(a.body).prognostico.nome,'A');
  const b=await app.request('/api/prognostico',app.token('admin'),{processo_id:'1758000000000'},'POST');
  assert.equal(b.status,200);assert.equal(JSON.parse(b.body).prognostico.nome,'B');
  assert.equal((await app.request('/api/prognostico',app.token('admin'),{processo_id:'nao-existe'},'POST')).status,404);
  assert.equal((await app.request('/api/prognostico',app.token('admin'),{},'POST')).status,400);
});
