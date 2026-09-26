'use strict';
// =====================================================================
// POLÍTICA CENTRAL DE LICENÇA DO LEX (assinatura do escritório pelo software)
// ---------------------------------------------------------------------
// Uma única política decide o que cada estado permite. Nenhum módulo do LEX
// consulta o provedor de cobrança nem espalha if(status...): todos perguntam
// aqui. Estados: trialing · active · past_due · suspended · canceled.
//
// Regras que não mudam:
// - Inadimplência NUNCA apaga autos, documentos, histórico ou prazos.
// - Leitura e exportação dos dados do escritório sempre permitidas (o dado é dele).
// - O que se bloqueia progressivamente é o que custa dinheiro ao produto: nova IA,
//   consultas pagas e, por fim, escrita. Sempre com tolerância explícita.
// - O gate só entra em vigor com LEX_LICENSE_GATE=1 (depois do tenant real);
//   antes disso, allows() responde sempre true e registra o motivo.
// =====================================================================
const STATES=Object.freeze(['trialing','active','past_due','suspended','canceled']);
const KEY_PREFIX='lex_licenca_';
const DEFAULTS=Object.freeze({
  trial_days:14,          // teste grátis
  grace_days:7,           // past_due: tolerância total (nada bloqueia)
  ai_block_after_days:7,  // past_due há mais de N dias: bloqueia IA nova e ações que custam
  write_block_after_days:30 // past_due há mais de N dias: vira suspended (só leitura/exportação)
});
// Ações que o produto reconhece (o resto é leitura).
const ACTIONS=Object.freeze({
  read:'read',export:'export',write:'write',ai:'ai',paid_lookup:'paid_lookup',channel_send:'channel_send'
});

function keyFor(escritorioId){return KEY_PREFIX+String(escritorioId||'default')}
function daysBetween(a,b){const x=Date.parse(a),y=Date.parse(b);if(!Number.isFinite(x)||!Number.isFinite(y))return 0;return Math.floor((y-x)/86400000)}

// Licença nova (trial) para um escritório recém-cadastrado.
function newTrial(escritorioId,now=new Date(),opts={}){
  const days=Number(opts.trial_days??DEFAULTS.trial_days);
  const start=new Date(now).toISOString(),end=new Date(new Date(now).getTime()+days*86400000).toISOString();
  return{escritorio_id:String(escritorioId),status:'trialing',trial_ate:end,atualizado_em:start,criado_em:start,provedor:null,provedor_ref:null,ultimo_evento:null,historico:[{em:start,de:null,para:'trialing',motivo:'cadastro'}]};
}

// Estado efetivo considerando o tempo (trial vencido → past_due; past_due longo → suspended).
function effectiveStatus(lic,now=new Date(),opts={}){
  if(!lic)return{status:'trialing',reason:'sem licença registrada'};
  const o={...DEFAULTS,...opts};const nowIso=new Date(now).toISOString();
  if(lic.status==='trialing'&&lic.trial_ate&&Date.parse(lic.trial_ate)<Date.parse(nowIso))return{status:'past_due',reason:'teste grátis terminou em '+lic.trial_ate.slice(0,10),since:lic.trial_ate};
  if(lic.status==='past_due'){
    const since=lic.past_due_desde||lic.atualizado_em;const d=daysBetween(since,nowIso);
    if(d>o.write_block_after_days)return{status:'suspended',reason:'pagamento em atraso há '+d+' dias',since};
    return{status:'past_due',reason:'pagamento em atraso há '+d+' dias',since,days:d};
  }
  return{status:lic.status,reason:null,since:lic.atualizado_em};
}

// A decisão: o estado permite a ação?
function decide(lic,action,now=new Date(),opts={}){
  const o={...DEFAULTS,...opts};
  const eff=effectiveStatus(lic,now,o);
  const st=eff.status;
  const allow=(ok,why)=>({allowed:ok,status:st,reason:why||eff.reason||null,license:lic||null});
  if(action===ACTIONS.read||action===ACTIONS.export)return allow(true,'leitura e exportação nunca bloqueiam');
  if(st==='trialing'||st==='active')return allow(true);
  if(st==='past_due'){
    const d=Number(eff.days||0);
    if(d<=o.grace_days)return allow(true,'tolerância de '+o.grace_days+' dias');
    if(action===ACTIONS.ai||action===ACTIONS.paid_lookup)return allow(d<=o.ai_block_after_days,'IA e consultas pagas bloqueadas após '+o.ai_block_after_days+' dias em atraso');
    return allow(true,'escrita segue permitida até '+o.write_block_after_days+' dias');
  }
  if(st==='suspended')return allow(false,'licença suspensa por inadimplência: só leitura e exportação');
  if(st==='canceled')return allow(false,'assinatura cancelada: só leitura e exportação; os dados continuam íntegros');
  return allow(false,'estado desconhecido: '+st);
}

// Transição de estado registrada (auditável), a partir de um evento de cobrança já validado.
function transition(lic,to,motivo,now=new Date(),extra={}){
  if(!STATES.includes(to))throw new Error('Estado de licença inválido: '+to);
  const em=new Date(now).toISOString();
  const next={...(lic||{}),status:to,atualizado_em:em,...extra};
  if(to==='past_due'&&lic?.status!=='past_due')next.past_due_desde=em;
  if(to!=='past_due')delete next.past_due_desde;
  next.historico=[...(Array.isArray(lic?.historico)?lic.historico:[]),{em,de:lic?.status||null,para:to,motivo:String(motivo||'').slice(0,200)}].slice(-50);
  return next;
}

// Serviço com persistência (records: read/change), gate desligado por padrão.
function createLicensePolicy({records,env=process.env,now=()=>new Date(),opts={}}={}){
  if(!records?.read||!records?.change)throw new Error('Política de licença sem repositório.');
  const gateOn=()=>String(env.LEX_LICENSE_GATE||'0')==='1';
  async function get(escritorioId){return (await records.read(keyFor(escritorioId)))?.value||null}
  async function ensure(escritorioId){
    let lic=await get(escritorioId);
    if(!lic){lic=await records.change(keyFor(escritorioId),old=>old||newTrial(escritorioId,now(),opts))}
    return lic;
  }
  async function allows(escritorioId,action){
    const lic=await get(escritorioId);
    const d=decide(lic,action,now(),opts);
    if(!gateOn())return{...d,allowed:true,gate:'off',would_allow:d.allowed};
    return{...d,gate:'on'};
  }
  async function apply(escritorioId,to,motivo,extra){
    return records.change(keyFor(escritorioId),old=>transition(old||newTrial(escritorioId,now(),opts),to,motivo,now(),extra));
  }
  return{get,ensure,allows,apply,decide:(lic,action)=>decide(lic,action,now(),opts),effectiveStatus:lic=>effectiveStatus(lic,now(),opts),gateOn,keyFor};
}

module.exports={STATES,ACTIONS,DEFAULTS,keyFor,newTrial,effectiveStatus,decide,transition,createLicensePolicy};
