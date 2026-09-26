'use strict';
// Travas da auditoria de 25/09/2026 — grupo SEGURANÇA.
// Cada teste aqui falharia antes da correção correspondente.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {setup,source}=require('./runtime');

const RAIZ=path.join(__dirname,'..');
const index=fs.readFileSync(path.join(RAIZ,'index.html'),'utf8');
const officeUi=fs.readFileSync(path.join(RAIZ,'office-ui.js'),'utf8');
const envExample=fs.readFileSync(path.join(RAIZ,'config','lex.env.example'),'utf8');

// ── 1. Senha nunca fica no navegador ──
test('index.html não guarda a senha no localStorage (lex_pwd_cache só na limpeza de resíduo)',()=>{
  const linhas=index.split('\n').map((l,i)=>[i+1,l]).filter(([,l])=>l.includes('lex_pwd_cache'));
  assert.ok(linhas.length>=1,'esperava a limpeza de resíduo no boot');
  for(const [n,l] of linhas){
    assert.ok(/removeItem\(\s*['"]lex_pwd_cache['"]\s*\)/.test(l),'index.html:'+n+' usa lex_pwd_cache fora do removeItem');
    assert.doesNotMatch(l,/setItem\(\s*['"]lex_pwd_cache/,'index.html:'+n+' grava a senha');
  }
  assert.doesNotMatch(index,/_tentarReloginSilencioso/,'re-login silencioso com senha salva deve ter sumido');
});

test('401 no fetchComTimeout limpa a sessão e mostra o login com aviso de sessão expirada',async()=>{
  const ini=index.indexOf('function fetchComTimeout(');
  const fim=index.indexOf('// ═══════════════════════════════════════════════════════════════════════════',ini);
  const trecho=index.slice(ini,fim);
  const els={'login-screen':{style:{display:'none'}},'login-erro':{style:{},textContent:''},'login-senha':{value:'segredo'}};
  let sessaoLimpa=false;
  const ctx=vm.createContext({
    console,setTimeout:()=>0,clearTimeout(){},AbortController:class{constructor(){this.signal={}}abort(){}},
    getAuthToken:()=>'tok',_clearSess:()=>{sessaoLimpa=true;},usuarioAtivo:'admin',_perms:{a:1},
    document:{getElementById:id=>els[id]||null},
    fetch:async()=>({status:401,ok:false})
  });
  vm.runInContext(trecho,ctx);
  const resp=await ctx.fetchComTimeout('https://x/api/qualquer',{});
  assert.equal(resp.status,401);
  assert.equal(sessaoLimpa,true);
  assert.equal(els['login-screen'].style.display,'flex');
  assert.match(els['login-erro'].textContent,/Sessão expirada/);
  assert.equal(els['login-senha'].value,'');
});

// ── 2. Token do bot do Telegram nunca sai do servidor ──
test('nenhum arquivo do navegador chama api.telegram.org nem pede token do bot',()=>{
  for(const [nome,txt] of [['index.html',index],['office-ui.js',officeUi]]){
    assert.doesNotMatch(txt,/api\.telegram\.org/,nome+' chama a API do Telegram direto');
    assert.doesNotMatch(txt,/id="tg-token"|id="tg-chatid"/,nome+' ainda pede token/chat id do bot');
    assert.doesNotMatch(txt,/cfg\.token/,nome+' ainda lê token do bot do localStorage');
  }
  for(const fn of ['testarTelegram','enviarAlertasPrazos','enviarResumoGeral'])assert.match(index,new RegExp('async function '+fn+'\\('));
  assert.match(index,/\/api\/telegram\/enviar/);
});

test('POST /api/telegram/enviar: admin só, token do servidor, prazos vindos da fila oficial',async()=>{
  const enviados=[];
  const base={
    TK:'token-do-servidor',CHAT_ID:'999',process:{env:{}},
    envTelegram:async(texto,_t,chat)=>{enviados.push({texto,chat});return true;},
    recordStore:{},taskEngine:{},processStore:{read:async()=>({processes:[]})},pjeMonitor:{},
    executeOfficeQuery:async(deps,command)=>({message:'MSG:'+command.action+':'+(command.janela||'')})
  };
  let app=setup(base);
  assert.equal((await app.request('/api/telegram/enviar',null,{tipo:'teste'},'POST')).status,401);
  assert.equal((await app.request('/api/telegram/enviar',app.token('secretaria'),{tipo:'teste'},'POST')).status,403);
  assert.equal((await app.request('/api/telegram/enviar',app.token('admin'),{tipo:'xpto'},'POST')).status,400);
  // token só no servidor: sem TK → 503, mesmo que o corpo mande um token
  app=setup({...base,TK:''});
  assert.equal((await app.request('/api/telegram/enviar',app.token('admin'),{tipo:'teste',token:'do-navegador'},'POST')).status,503);
  app=setup(base);
  const r=await app.request('/api/telegram/enviar',app.token('admin'),{tipo:'prazos'},'POST');
  assert.equal(r.status,200);
  assert.equal(enviados.length,1);
  assert.equal(enviados[0].chat,'999');
  assert.equal(enviados[0].texto,'MSG:deadlines:semana','prazos devem sair da fila oficial (DeadlineWatch), não de p.prazo');
  const r2=await app.request('/api/telegram/enviar',app.token('admin'),{tipo:'resumo'},'POST');
  assert.equal(r2.status,200);assert.equal(enviados[1].texto,'MSG:daily_brief:');
  app=setup({...base,envTelegram:async()=>false});
  assert.equal((await app.request('/api/telegram/enviar',app.token('admin'),{tipo:'teste'},'POST')).status,502);
});

test('rota do Telegram no bot.js usa a fila oficial de prazos (executeOfficeQuery), nunca p.prazo bruto',()=>{
  const ini=source.indexOf("if(url==='/api/telegram/enviar'");
  const fim=source.indexOf("// POST /api/notificar-telegram",ini);
  const trecho=source.slice(ini,fim);
  assert.match(trecho,/executeOfficeQuery\(/);
  assert.match(trecho,/action:'deadlines'/);
  assert.doesNotMatch(trecho,/\.prazo\b/);
});

// ── 3. CORS: igualdade exata, só Origin ──
function corsCtx(){
  const ini=source.indexOf('const ORIGENS_PERMITIDAS = [');
  const fim=source.indexOf('// Rate limit no login',ini);
  const ctx=vm.createContext({});
  vm.runInContext(source.slice(ini,fim),ctx);
  return ctx;
}
test('_corsOrigin só aceita origem exata da lista e ignora Referer',()=>{
  const c=corsCtx();
  assert.equal(c._corsOrigin({headers:{origin:'https://lexjuridico.vercel.app'}}),'https://lexjuridico.vercel.app');
  assert.equal(c._corsOrigin({headers:{origin:'http://localhost:3000'}}),'http://localhost:3000');
  for(const origin of ['http://localhost:30001','https://lexjuridico.vercel.app.atacante.com','https://lexjuridico.vercel.app/','http://lexjuridico.vercel.app','*',''])
    assert.equal(c._corsOrigin({headers:{origin}}),null,origin);
  assert.equal(c._corsOrigin({headers:{referer:'https://lexjuridico.vercel.app/index.html'}}),null,'referer não vale');
  assert.equal(c._corsOrigin({headers:{}}),null);
  const h=c.corsHeaders({headers:{origin:'http://localhost:30001'}});
  assert.equal(h['Access-Control-Allow-Origin'],undefined);
  assert.equal(h.Vary,'Origin');
  assert.equal(c.corsHeaders({headers:{origin:'http://localhost:5500'}})['Access-Control-Allow-Origin'],'http://localhost:5500');
});

// ── 4. AUTH_SECRET em produção ──
test('sem AUTH_SECRET em produção o boot avisa em vermelho apontando lex.env.example (sem derrubar)',()=>{
  const ini=source.indexOf('const AUTH_SECRET = ');
  const fim=source.indexOf('const AUTH_IDLE_MS',ini);
  const trecho=source.slice(ini,fim);
  const run=env=>{const erros=[];vm.runInNewContext(trecho,{process:{env},CRYPTO:crypto,console:{error:m=>erros.push(m),warn(){},log(){}}});return erros;};
  const e1=run({NODE_ENV:'production'});
  assert.equal(e1.length,1);assert.match(e1[0],/\x1b\[31m/);assert.match(e1[0],/AUTH_SECRET/);assert.match(e1[0],/lex\.env\.example/);
  assert.equal(run({RENDER:'true'}).length,1);
  assert.equal(run({NODE_ENV:'production',AUTH_SECRET:'x'.repeat(64)}).length,0);
  assert.equal(run({}).length,0,'em desenvolvimento não avisa');
  assert.match(envExample,/^AUTH_SECRET=/m);
});

// ── 5. Poda de sessões e tokens revogados ──
test('podarSessoesLex remove sessões inativas e revogados velhos, preserva os recentes',()=>{
  const app=setup();
  const c=app.context;
  const agora=Date.now();
  const velho=Buffer.from(JSON.stringify({p:'admin',ts:agora-c.AUTH_IDLE_MS-1000,sig:'x'})).toString('base64url');
  const novo=app.token('admin');
  c.global._sessaoAtividade.set('sess-velha',agora-c.AUTH_IDLE_MS-1);
  c.global._sessaoAtividade.set('sess-nova',agora-1000);
  c.global._tokensRevogados.add(velho);
  c.global._tokensRevogados.add(novo);
  const r=c.podarSessoesLex(agora);
  assert.equal(r.sessoes,1);assert.equal(r.revogados,1);
  assert.equal(c.global._sessaoAtividade.has('sess-velha'),false);
  assert.equal(c.global._sessaoAtividade.has('sess-nova'),true);
  assert.equal(c.global._tokensRevogados.has(velho),false);
  assert.equal(c.global._tokensRevogados.has(novo),true,'revogado recente continua bloqueado');
  assert.equal(c.validarToken(novo),null,'token revogado segue inválido após a poda');
  assert.match(source,/setInterval\(\(\) => \{ try \{ podarSessoesLex\(\); \}/,'poda periódica agendada');
});

// ── 6. Job de análise assíncrona pertence a quem criou ──
test('analisar-status só responde ao perfil/conta que criou o job',async()=>{
  const jobs={};
  const app=setup({_jobsAnalise:jobs,_analisarDocEmChunks:async()=>({ok:true}),setTimeout:()=>0});
  const criado=await app.request('/api/analisar-async',app.token('admin'),{base64:Buffer.from('x').toString('base64'),nome:'a.pdf'},'POST');
  assert.equal(criado.status,200);
  const {jobId}=JSON.parse(criado.body);
  assert.equal(jobs[jobId].criado_por,'perfil:admin');
  assert.equal((await app.request('/api/analisar-status/'+jobId,app.token('secretaria'))).status,404,'outro perfil não vê o job');
  assert.equal((await app.request('/api/analisar-status/'+jobId,null)).status,401);
  const ok=await app.request('/api/analisar-status/'+jobId,app.token('admin'));
  assert.equal(ok.status,200);
  assert.equal(JSON.parse(ok.body).nome,'a.pdf');
  // conta individual: dono é a conta, não o perfil
  const contaTk=app.context.gerarToken('admin','conta-1');
  app.context.equipeLex={ativo:()=>true,perfilDesligado:()=>false};
  const criado2=await app.request('/api/analisar-async',contaTk,{base64:Buffer.from('x').toString('base64'),nome:'b.pdf'},'POST');
  const id2=JSON.parse(criado2.body).jobId;
  assert.equal(jobs[id2].criado_por,'conta:conta-1');
  assert.equal((await app.request('/api/analisar-status/'+id2,app.token('admin'))).status,404,'perfil compartilhado não vê job da conta individual');
  assert.equal((await app.request('/api/analisar-status/'+id2,contaTk)).status,200);
});
