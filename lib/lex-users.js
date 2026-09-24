'use strict';
// Contas individuais do escritório. Cada pessoa entra com o próprio e-mail e
// senha; desativar a conta derruba o acesso na hora (o token carrega o id da
// conta e só vale enquanto ela estiver ativa). O login antigo por perfil
// continua funcionando para quem ainda não migrou.
const crypto=require('node:crypto');

const PAPEIS=Object.freeze({admin:'Administrador / advogado',secretaria:'Secretária'});

function normEmail(v){return String(v||'').trim().toLowerCase()}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normEmail(v))}
function erro(msg,status=400){return Object.assign(new Error(msg),{status})}

// Mesma forma de hash das senhas de perfil (scrypt com sal), sem depender do bot.
function hashSenha(senha){
  const salt=crypto.randomBytes(16).toString('hex');
  return 'scrypt$'+salt+'$'+crypto.scryptSync(String(senha),salt,32).toString('hex');
}
function conferirSenha(senha,hash){
  const [tipo,salt,esperado]=String(hash||'').split('$');
  if(tipo!=='scrypt'||!salt||!esperado)return false;
  const calc=crypto.scryptSync(String(senha||''),salt,32);
  const alvo=Buffer.from(esperado,'hex');
  return alvo.length===calc.length&&crypto.timingSafeEqual(alvo,calc);
}
function senhaForte(senha){
  const s=String(senha||'');
  if(s.length<8)return'A senha precisa de pelo menos 8 caracteres.';
  if(!/\d/.test(s)||!/[A-Za-z]/.test(s))return'A senha precisa ter letras e números.';
  return null;
}
function publico(u){return u&&{id:u.id,nome:u.nome,email:u.email,papel:u.papel,oab:u.oab||null,senior:u.senior===true,ativo:u.ativo!==false,criado_em:u.criado_em||null,desativado_em:u.desativado_em||null}}

// Guarda a lista pela persistência de configuração do escritório.
function createUserStore({load,save,now=()=>new Date()}){
  let cache=null;
  async function lista(){if(!cache){const v=await load();cache=Array.isArray(v?.lista)?v.lista:[]}return cache}
  async function gravar(next){await save({lista:next});cache=next}
  return{
    async listar(){return(await lista()).map(publico)},
    ativo(id){return !!(cache||[]).find(u=>u.id===id&&u.ativo!==false)},
    // Advogado sênior: único (além do login do titular) que gerencia a equipe.
    senior(id){return !!(cache||[]).find(u=>u.id===id&&u.ativo!==false&&u.senior===true)},
    // Relê sem apagar a lista em uso: ninguém é derrubado durante a releitura.
    async carregar(){const v=await load();if(Array.isArray(v?.lista))cache=v.lista;else if(!cache)cache=[];return cache},
    async criar({nome,email,papel,senha,oab,senior}){
      const e=normEmail(email);
      if(!String(nome||'').trim())throw erro('Informe o nome.');
      if(!validEmail(e))throw erro('E-mail inválido.');
      if(!Object.hasOwn(PAPEIS,papel))throw erro('Papel inválido: use admin ou secretaria.');
      if(senior===true&&papel!=='admin')throw erro('Só advogado/administrador pode ser sênior.');
      const fraca=senhaForte(senha);if(fraca)throw erro(fraca);
      const atual=await lista();
      if(atual.some(u=>u.email===e&&u.ativo!==false))throw erro('Já existe uma conta ativa com este e-mail.',409);
      const u={id:crypto.randomUUID(),nome:String(nome).trim().slice(0,120),email:e,papel,oab:oab?String(oab).trim().toUpperCase():null,senior:senior===true,senha_hash:hashSenha(senha),ativo:true,criado_em:now().toISOString()};
      await gravar([...atual,u]);
      return publico(u);
    },
    async desativar(id){
      const atual=await lista();const i=atual.findIndex(u=>u.id===id);
      if(i<0)throw erro('Conta não encontrada.',404);
      const next=atual.slice();next[i]={...next[i],ativo:false,desativado_em:now().toISOString()};
      await gravar(next);return publico(next[i]);
    },
    async trocarSenha(id,senha){
      const fraca=senhaForte(senha);if(fraca)throw erro(fraca);
      const atual=await lista();const i=atual.findIndex(u=>u.id===id&&u.ativo!==false);
      if(i<0)throw erro('Conta ativa não encontrada.',404);
      const next=atual.slice();next[i]={...next[i],senha_hash:hashSenha(senha),senha_trocada_em:now().toISOString()};
      await gravar(next);return publico(next[i]);
    },
    async autenticar(email,senha){
      const e=normEmail(email);
      const u=(await lista()).find(x=>x.email===e&&x.ativo!==false);
      if(!u||!conferirSenha(senha,u.senha_hash))return null;
      return publico(u);
    }
  };
}

module.exports={PAPEIS,normEmail,validEmail,hashSenha,conferirSenha,senhaForte,createUserStore};
