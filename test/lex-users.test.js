'use strict';
// Contas individuais: cada advogado com login próprio; desativar corta o acesso.
const test=require('node:test');
const assert=require('node:assert/strict');
const U=require('../lib/lex-users');

function store(){let saved={lista:[]};const s=U.createUserStore({load:async()=>structuredClone(saved),save:async v=>{saved=structuredClone(v)}});return{s,get saved(){return saved}}}

test('cria conta com senha forte, sem guardar a senha em texto',async()=>{
  const {s,saved}=(()=>{const x=store();return{s:x.s,get saved(){return x.saved}}})();
  await assert.rejects(s.criar({nome:'Ana',email:'ana@x.com',papel:'admin',senha:'123'}),/8 caracteres/);
  await assert.rejects(s.criar({nome:'Ana',email:'errado',papel:'admin',senha:'senha1234'}),/E-mail inválido/);
  await assert.rejects(s.criar({nome:'Ana',email:'ana@x.com',papel:'dono',senha:'senha1234'}),/Papel inválido/);
  const c=await s.criar({nome:'Ana',email:'Ana@X.com',papel:'admin',senha:'senha1234',oab:'123456/mg'});
  assert.equal(c.email,'ana@x.com');assert.equal(c.oab,'123456/MG');assert.equal(c.senha_hash,undefined);
  assert.doesNotMatch(JSON.stringify(saved),/senha1234/);
  await assert.rejects(s.criar({nome:'Outra',email:'ana@x.com',papel:'secretaria',senha:'senha1234'}),/Já existe/);
});

test('login pela conta; desativada não entra e perde o acesso',async()=>{
  const {s}=store();
  const c=await s.criar({nome:'Bruno',email:'bruno@x.com',papel:'admin',senha:'senha1234'});
  assert.equal((await s.autenticar('BRUNO@x.com','senha1234')).id,c.id);
  assert.equal(await s.autenticar('bruno@x.com','errada123'),null);
  assert.equal(s.ativo(c.id),true);
  await s.desativar(c.id);
  assert.equal(s.ativo(c.id),false,'token dele deixa de valer');
  assert.equal(await s.autenticar('bruno@x.com','senha1234'),null);
  const lista=await s.listar();assert.equal(lista[0].ativo,false);assert.ok(lista[0].desativado_em);
});

test('troca de senha e releitura não derrubam quem está ativo',async()=>{
  const {s}=store();
  const c=await s.criar({nome:'Carla',email:'carla@x.com',papel:'secretaria',senha:'senha1234'});
  await s.trocarSenha(c.id,'novaSenha99');
  assert.equal(await s.autenticar('carla@x.com','senha1234'),null);
  assert.ok(await s.autenticar('carla@x.com','novaSenha99'));
  await s.carregar();assert.equal(s.ativo(c.id),true);
});

test('servidor: token de conta desativada é recusado e login por e-mail existe',()=>{
  const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','bot.js'),'utf8');
  assert.match(src,/if\(u && !equipeLex\.ativo\(u\)\) return null;/);
  assert.match(src,/equipeLex\.autenticar\(b\.email, b\.senha\)/);
  assert.match(src,/if\(!podeGerir\)/);
  assert.match(src,/Você não pode desativar a própria conta/);
});

test('só o advogado sênior gerencia a equipe; os demais não',async()=>{
  const x=U.createUserStore({load:async()=>({lista:[]}),save:async()=>{}});
  const senior=await x.criar({nome:'Sênior',email:'s@x.com',papel:'admin',senha:'senha1234',senior:true});
  const adv=await x.criar({nome:'Advogado',email:'a@x.com',papel:'admin',senha:'senha1234'});
  await assert.rejects(x.criar({nome:'Sec',email:'c@x.com',papel:'secretaria',senha:'senha1234',senior:true}),/Só advogado/);
  assert.equal(x.senior(senior.id),true);
  assert.equal(x.senior(adv.id),false);
  await x.desativar(senior.id);assert.equal(x.senior(senior.id),false,'desativado perde o poder');
  const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','bot.js'),'utf8');
  assert.match(src,/const podeGerir = perfilEq === 'admin' && \(!contaEq \|\| equipeLex\.senior\(contaEq\)\);/);
  assert.match(src,/Só o advogado sênior gerencia a equipe/);
});

test('login compartilhado só desliga com um sênior ativo; troca da própria senha confere a atual',async()=>{
  let saved={lista:[]};
  const x=U.createUserStore({load:async()=>structuredClone(saved),save:async v=>{saved=structuredClone(v)}});
  await assert.rejects(x.desligarLoginCompartilhado(true),/Crie antes uma conta de advogado sênior/);
  const s1=await x.criar({nome:'S',email:'s@x.com',papel:'admin',senha:'senha1234',senior:true});
  assert.equal(await x.desligarLoginCompartilhado(true),true);
  assert.equal(saved.opcoes.login_compartilhado_desligado,true,'fica gravado');
  await x.carregar();assert.equal(x.perfilDesligado(),true);
  await assert.rejects(x.trocarPropriaSenha(s1.id,'errada99','outra1234'),/Senha atual incorreta/);
  await x.trocarPropriaSenha(s1.id,'senha1234','outra1234');
  assert.ok(await x.autenticar('s@x.com','outra1234'));
});

test('servidor: senha compartilhada, login compartilhado e leitura da equipe',()=>{
  const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','bot.js'),'utf8');
  assert.match(src,/if\(contaTs && !equipeLex\.senior\(contaTs\)\)/,'advogado comum não troca senha do perfil');
  assert.match(src,/Login compartilhado desligado neste escritório/);
  assert.match(src,/if\(!u && typeof equipeLex!=='undefined' && equipeLex\.perfilDesligado\(\)\) return null;/,'sessões antigas caem');
  const get=src.indexOf("if(url==='/api/equipe' && req.method==='GET')"),bloq=src.indexOf("if(!podeGerir) { res.writeHead(403");
  assert.ok(get>0&&bloq>get,'lista vem antes do bloqueio de escrita');
});
