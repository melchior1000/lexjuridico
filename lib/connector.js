'use strict';
const crypto=require('node:crypto');
const {cnjDigits}=require('./pje-sync');
const {date}=require('./workflow');
function issueToken(secret,nonce,now=Date.now()) {
  const data=Buffer.from(JSON.stringify({purpose:'lex_capture',nonce,exp:now+8*3600000})).toString('base64url');
  return data+'.'+crypto.createHmac('sha256',secret).update(data).digest('base64url');
}
function verifyToken(token,secret,nonce,now=Date.now()) {
  try {
    const [data,sig,extra]=String(token).split('.');if(extra) return false;
    const expected=crypto.createHmac('sha256',secret).update(data).digest();
    const actual=Buffer.from(sig,'base64url');
    if(expected.length!==actual.length||!crypto.timingSafeEqual(expected,actual))return false;
    const body=JSON.parse(Buffer.from(data,'base64url').toString());
    return body.purpose==='lex_capture'&&body.nonce===nonce&&body.exp>now;
  }catch{return false;}
}
function validateCapture(body) {
  const cnj=cnjDigits(body.cnj),day=date(body.data),text=String(body.andamento_texto||'').trim();
  const url=new URL(body.fonte_url);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.jus.br')||url.username||url.password||url.port)throw new Error('A fonte deve ser uma página HTTPS oficial do tribunal.');
  if(!cnj||!day||!text||text.length>20000)throw new Error('Confira CNJ, data e texto selecionado (até 20.000 caracteres).');
  // A URL não carrega parâmetros de sessão do tribunal.
  return {cnj,data:day,andamento_texto:text,fonte_url:url.origin+url.pathname};
}
async function captureMovement(store,body) {
  const capture=validateCapture(body);
  return store.mutate(ps=>{
    const found=ps.filter(p=>cnjDigits(p.numero)===capture.cnj);
    if(found.length!==1)throw new Error(found.length?'CNJ duplicado; confira o cadastro.':'Cadastre o processo no LEX antes da importação.');
    const p=found[0];const movements=require('./workflow').array(p.andamentos);
    const fingerprint=crypto.createHash('sha256').update(capture.cnj+'|'+capture.data+'|'+capture.andamento_texto).digest('hex');
    if(movements.some(a=>a.fingerprint===fingerprint))return {duplicado:true,processo_id:p.id};
    p.andamentos=[{data:capture.data,txt:capture.andamento_texto,origem:'tribunal_captura_assistida',fonte_url:capture.fonte_url,fingerprint,importado_em:new Date().toISOString()},...movements];
    p.ultima_consulta_fonte=new Date().toISOString();
    // Status e prazo só mudam em atos explícitos; a captura não faz essa inferência.
    return {duplicado:false,processo_id:p.id};
  },'conector_assistido');
}
module.exports={issueToken,verifyToken,validateCapture,captureMovement};
