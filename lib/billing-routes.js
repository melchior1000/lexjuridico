'use strict';
// Rotas de cobrança da licença (Mercado Pago) e consulta da licença do escritório.
// Webhook é público, mas só passa com assinatura HMAC válida; o resto é admin.
const {createMercadoPagoBilling}=require('./billing-mercadopago');
const {createLicensePolicy,ACTIONS}=require('./license-policy');

function createBillingRoutes({records,env=process.env,authenticate,headers={},body,fetchImpl,log=()=>{},now=()=>new Date()}={}){
  const policy=createLicensePolicy({records,env,now});
  const billing=createMercadoPagoBilling({records,policy,env,fetchImpl,now,log});
  const escritorioId=()=>String(env.LEX_ESCRITORIO_ID||'default');
  const json=(res,code,data)=>{res.writeHead(code,{...headers,'Content-Type':'application/json'});res.end(JSON.stringify(data))};

  async function handle(req,res,url){
    const path=String(url||'').split('?')[0];
    if(path==='/api/webhook-mercadopago'){
      if(req.method!=='POST'){json(res,405,{error:'Método não permitido'});return true}
      let b={};try{b=typeof body==='function'?await body(req):{}}catch(e){json(res,400,{error:'corpo inválido'});return true}
      const q=new URL(String(url||''),'http://lex').searchParams;
      const out=await billing.webhook({headers:req.headers||{},body:b,rawDataId:q.get('data.id')||q.get('id')||undefined});
      // 401 para assinatura inválida; 200 para o resto (o provedor retenta em 5xx).
      json(res,out.ok?200:(out.status||400),out);return true;
    }
    if(path==='/api/billing/licenca'||path==='/api/billing/mercadopago/assinar'||path==='/api/billing/mercadopago/reconciliar'){
      const perfil=typeof authenticate==='function'?authenticate(req):null;
      if(!perfil){json(res,401,{error:'Nao autenticado'});return true}
      if(perfil!=='admin'){json(res,403,{error:'Somente administrador'});return true}
      if(path==='/api/billing/licenca'){
        if(req.method!=='GET'){json(res,405,{error:'Método não permitido'});return true}
        const lic=await policy.ensure(escritorioId());
        const eff=policy.effectiveStatus(lic);
        const gates={};for(const a of Object.values(ACTIONS))gates[a]=(await policy.allows(escritorioId(),a)).allowed;
        json(res,200,{ok:true,escritorio_id:escritorioId(),licenca:{...lic,historico:undefined},estado_efetivo:eff,gate_ativo:policy.gateOn(),permite:gates,provedor_configurado:billing.configured()});return true;
      }
      if(req.method!=='POST'){json(res,405,{error:'Método não permitido'});return true}
      let b={};try{b=typeof body==='function'?await body(req):{}}catch(e){json(res,400,{error:'corpo inválido'});return true}
      try{
        if(path==='/api/billing/mercadopago/assinar'){
          const valor=Number(b.valor||env.LEX_LICENCA_VALOR_MENSAL);
          const out=await billing.assinar({escritorioId:escritorioId(),email:b.email,valor,descricao:b.descricao||env.LEX_LICENCA_DESCRICAO||'Licença LEX Jurídico',backUrl:b.back_url||env.LEX_LICENCA_BACK_URL});
          json(res,200,out);return true;
        }
        const out=await billing.reconciliar(escritorioId());json(res,200,out);return true;
      }catch(e){json(res,e.status||500,{error:e.message});return true}
    }
    return false;
  }
  return{handle,policy,billing};
}
module.exports={createBillingRoutes};
