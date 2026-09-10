'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {cpfValid,cnpjValid,normalizePartyProfile}=require('../lib/party-profile');

test('valida CPF conhecido e rejeita repetição',()=>{
  assert.equal(cpfValid('529.982.247-25'),true);
  assert.equal(cpfValid('111.111.111-11'),false);
});

test('valida CNPJ conhecido e rejeita repetição',()=>{
  assert.equal(cnpjValid('04.252.011/0001-10'),true);
  assert.equal(cnpjValid('11.111.111/1111-11'),false);
});

test('normaliza pessoa física sem contaminar campos de PJ',()=>{
  const p=normalizePartyProfile({tipo_pessoa:'PF',nome:'João da Silva',cpf:'52998224725'});
  assert.equal(p.tipo_pessoa,'PF');
  assert.equal(p.documento,'529.982.247-25');
  assert.equal(p.nome_completo,'João da Silva');
  assert.equal(p.cnpj,null);
  assert.equal(p.razao_social,null);
});

test('normaliza pessoa jurídica e preserva filial válida',()=>{
  const p=normalizePartyProfile({tipo_pessoa:'PJ',nome:'Empresa Exemplo',cnpj:'04252011000110',nome_fantasia:'Exemplo',representante:'Maria',filiais:['04.252.011/0001-10']});
  assert.equal(p.tipo_pessoa,'PJ');
  assert.equal(p.documento,'04.252.011/0001-10');
  assert.equal(p.razao_social,'Empresa Exemplo');
  assert.equal(p.nome_fantasia,'Exemplo');
  assert.equal(p.representante,'Maria');
  assert.deepEqual(p.filiais,['04.252.011/0001-10']);
});

test('rejeita documento incompatível com tipo declarado',()=>{
  assert.throws(()=>normalizePartyProfile({tipo_pessoa:'PF',cnpj:'04252011000110'}),/PF não pode usar CNPJ/);
  assert.throws(()=>normalizePartyProfile({tipo_pessoa:'PJ',cpf:'52998224725'}),/PJ não pode usar CPF/);
});
