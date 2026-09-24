#!/usr/bin/env node
'use strict';
// Cadastro de um escritório novo no LEX comercial.
// Não acessa banco nem rede: imprime o SQL (rodar como administrador) e a
// configuração da instalação dedicada desse escritório (um processo por
// escritório). Uso:
//   node scripts/provision-office.js --nome "Silva Advogados" --slug silva --oab 123456:MG [--oab 654321:SP]
const crypto=require('node:crypto');

function args(argv){
  const out={oab:[]};
  for(let i=0;i<argv.length;i++){
    const k=argv[i];
    if(k==='--nome')out.nome=argv[++i];
    else if(k==='--slug')out.slug=argv[++i];
    else if(k==='--oab')out.oab.push(argv[++i]);
    else if(k==='--id')out.id=argv[++i];
  }
  return out;
}
const sqlText=v=>"'"+String(v).replace(/'/g,"''")+"'";

function provision({nome,slug,oab=[],id=crypto.randomUUID()}){
  if(!nome||!String(nome).trim())throw new Error('Informe --nome.');
  if(!/^[a-z0-9][a-z0-9-]{1,40}$/.test(String(slug||'')))throw new Error('Informe --slug com letras minúsculas, números e hífen.');
  for(const o of oab)if(!/^\d+\s*:\s*[A-Za-z]{2}$/.test(o))throw new Error('OAB inválida: '+o+' (use 123456:MG).');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))throw new Error('ID inválido.');
  const sql=[
    '-- Rodar como administrador do banco.',
    'begin;',
    `insert into public.escritorios(id,nome,slug,status) values (${sqlText(id)},${sqlText(nome.trim())},${sqlText(slug)},'active');`,
    '-- Idempotente: na primeira vez remove o padrão "primeiro escritório" e as chaves globais.',
    'select * from lex_security.ativar_multi_escritorio();',
    'commit;'
  ].join('\n');
  const env=[
    `# Instalação dedicada: ${nome.trim()} (${slug})`,
    'LEX_COMERCIAL=1',
    `LEX_ESCRITORIO_ID=${id}`,
    'LEX_TENANCY_REQUIRED=1',
    'LEX_DB_MODE=postgres',
    'LEX_DATABASE_URL=postgresql://lex_runtime:SENHA@HOST:5432/postgres',
    `DJEN_OABS=${oab.map(o=>o.replace(/\s/g,'').toUpperCase()).join(',')}`,
    '# Canais e credenciais próprios deste escritório (nunca reutilizar de outro):',
    `EVOLUTION_INSTANCE=lex-${slug}`,
    'LEX_WHATSAPP_NUMBER=',
    'LEX_OPERATOR_WHATSAPP=',
    'TELEGRAM_TOKEN=',
    'TELEGRAM_ADMIN_CHAT_ID=',
    'PJE_MNI_TRIBUNAIS=',
    'PJE_MNI_CPF=',
    'PJE_MNI_SENHA=',
    'COURT_READING_INTEGRITY_KEY='+crypto.randomBytes(32).toString('hex'),
    'WHATSAPP_WEBHOOK_SECRET='+crypto.randomBytes(24).toString('hex')
  ].join('\n');
  return{id,sql,env};
}

if(require.main===module){
  try{
    const out=provision(args(process.argv.slice(2)));
    console.log('==== SQL ====\n'+out.sql+'\n\n==== CONFIGURAÇÃO DA INSTALAÇÃO ====\n'+out.env);
  }catch(e){console.error(e.message);process.exitCode=1}
}
module.exports={provision};
