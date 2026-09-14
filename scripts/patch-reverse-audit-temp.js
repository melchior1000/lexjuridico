'use strict';
const fs=require('node:fs');
const file='bot.js';
let s=fs.readFileSync(file,'utf8');
const old=`async function _salvarPerfilCliente(perfil) {
  perfil.atualizado_em = new Date().toISOString();
  try {
    await sbUpsert('clientes_pendentes', perfil, 'chat_id');
    return true;
  } catch(e) { console.warn('salvarPerfilCliente erro:', e.message); return false; }
}`;
const replacement=`async function _salvarPerfilCliente(perfil) {
  perfil.atualizado_em = new Date().toISOString();
  try {
    const result = await sbUpsert('clientes_pendentes', perfil, 'chat_id');
    if(!result || result.ok !== true) throw new Error('Banco não confirmou o cadastro ('+Number(result?.status||0)+').');
    return true;
  } catch(e) { console.warn('salvarPerfilCliente erro:', e.message); return false; }
}`;
if(s.includes(old))s=s.replace(old,replacement);
s=s.replace("return {nome:'kleuber',perfil:'admin',pode_autorizar:true,pode_responder:true};","return {nome:process.env.LEX_OPERATOR_NAME||'Administrador',perfil:'admin',pode_autorizar:true,pode_responder:true};");
s=s.replace("return { nome: 'kleuber', perfil: 'admin', pode_autorizar: true, pode_responder: true };","return { nome: process.env.LEX_OPERATOR_NAME||'Administrador', perfil: 'admin', pode_autorizar: true, pode_responder: true };");
fs.writeFileSync(file,s);
