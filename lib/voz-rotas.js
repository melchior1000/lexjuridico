'use strict';
// Rotas das ligações por voz.
// - POST /api/voz/aviso  — aviso da plataforma de voz (início/fim/análise da ligação). Público,
//   mas só passa com a assinatura da plataforma conferida sobre o corpo CRU. Responde 204 logo
//   (a plataforma repete se demorar mais de 10 s) e o relato segue depois.
// - GET  /api/voz/estado — advogado ou administrador: se as ligações estão ligadas, o horário e
//   as últimas ligações (sem transcrição).
const MAX_CORPO=2*1024*1024;

function lerCorpoCru(req,max=MAX_CORPO){
  return new Promise((resolve,reject)=>{
    const partes=[];let tam=0,excedeu=false;
    req.on('data',c=>{if(excedeu)return;tam+=c.length;if(tam>max){excedeu=true;partes.length=0;const e=new Error('corpo grande demais');e.status=413;try{req.destroy()}catch{}reject(e);return}partes.push(c)});
    req.on('end',()=>{if(!excedeu)resolve(Buffer.concat(partes).toString('utf8'))});
    req.on('error',reject);
  });
}

function createVozRotas({voz,authenticate,headers={},agendar=fn=>setImmediate(fn),log=()=>{}}={}){
    // h: cabeçalhos da requisição (CORS do app) somados aos fixos.
  async function handle(req,res,url,h={}){
    const json=(res,code,data)=>{res.writeHead(code,{...headers,...h,'Content-Type':'application/json'});res.end(JSON.stringify(data))};
    const path=String(url||'').split('?')[0];
    if(path==='/api/voz/aviso'){
      if(req.method!=='POST'){json(res,405,{error:'Método não permitido'});return true}
      const V=typeof voz==='function'?voz():voz;
      if(!V){json(res,503,{error:'Ligações por voz não configuradas'});return true}
      let corpo;
      try{corpo=await lerCorpoCru(req)}catch(e){json(res,e.status||400,{error:'corpo inválido'});return true}
      let out;
      try{out=await V.receberAviso({corpo,assinatura:req.headers?.['x-retell-signature']})}
      catch(e){log('[Voz] aviso não gravado: '+String(e?.message||e).slice(0,200));json(res,500,{error:'falha ao gravar o aviso'});return true} // 5xx: a plataforma repete
      if(out.status!==204){json(res,out.status,{error:out.erro||'recusado'});return true}
      res.writeHead(204,{...headers,...h});res.end();
      if(out.processar)agendar(()=>Promise.resolve(V.concluir(out.processar)).catch(e=>log('[Voz] relato falhou: '+String(e?.message||e).slice(0,200))));
      return true;
    }
    if(path==='/api/voz/estado'){
      if(req.method!=='GET'){json(res,405,{error:'Método não permitido'});return true}
      const perfil=typeof authenticate==='function'?authenticate(req):null;
      if(!perfil){json(res,401,{error:'Nao autenticado'});return true}
      if(!['admin','advogado'].includes(String(perfil))){json(res,403,{error:'Somente advogado ou administrador'});return true}
      const V=typeof voz==='function'?voz():voz;
      if(!V){json(res,200,{ok:true,configurado:false,ligacoes:[]});return true}
      const r=await V.listar({});
      json(res,200,{...r,ligacoes:(r.ligacoes||[]).map(({transcricao,...x})=>x)});return true;
    }
    return false;
  }
  return{handle};
}
module.exports={createVozRotas,lerCorpoCru};
