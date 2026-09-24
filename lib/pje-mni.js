'use strict';
// Cliente do MNI 2.2.2 (Modelo Nacional de Interoperabilidade, CNJ) usado
// pelo PJe para sistemas de escritório.
//
// Regras que este módulo garante:
// - consultarAvisosPendentes e consultarProcesso (sem documentos) só leem:
//   NÃO dão ciência de intimação.
// - consultarTeorComunicacao REGISTRA A CIÊNCIA e inicia o prazo
//   (Lei 11.419/2006, art. 5º, §1º). Só roda com autorização humana explícita
//   vinculada ao aviso (ver assertTeorAuthorization).
// - Senha e certificado nunca aparecem em erro, log ou retorno.
// - Endpoint só HTTPS em domínio *.jus.br (a senha não sai para outro host).
// - Resposta ambígua, falha de rede ou sucesso=false falham fechado.
const https=require('node:https');
const {XMLParser}=require('fast-xml-parser');

const NS=Object.freeze({
  soap:'http://schemas.xmlsoap.org/soap/envelope/',
  // Namespaces publicados pelo CNJ para a versão 2.2.2; confirmar no WSDL do
  // tribunal na homologação (sobrescrevíveis por PJE_MNI_NS_SERVICO/PJE_MNI_NS_TIPOS).
  servico:'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
  tipos:'http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2'
});

const TIPO_COMUNICACAO=Object.freeze({CIT:'Citação',INT:'Intimação',NOT:'Notificação',VIS:'Vista',URG:'Intimação urgente',PTA:'Pauta'});

class MniError extends Error{
  constructor(code,message,meta){super(message);this.name='MniError';this.code=code;if(meta)this.meta=meta}
}

function xmlEscape(value){
  return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function digits(value){return String(value||'').replace(/\D/g,'')}

// PJE_MNI_TRIBUNAIS="TJMG=https://pje.tjmg.jus.br/pje/intercomunicacao;TRF1=https://..."
function parseTribunais(value){
  const out=[];
  for(const part of String(value||'').split(/[;\n]/).map(x=>x.trim()).filter(Boolean)){
    const m=part.match(/^([A-Za-z0-9_-]{2,20})\s*=\s*(\S+)$/);
    if(!m)throw new MniError('config_invalida','PJE_MNI_TRIBUNAIS inválido: use SIGLA=https://endereco.jus.br/...');
    let url;
    try{url=new URL(m[2])}catch{throw new MniError('config_invalida','Endereço MNI inválido para '+m[1]+'.')}
    if(url.protocol!=='https:'||!/(^|\.)jus\.br$/i.test(url.hostname)||url.username||url.password)
      throw new MniError('config_invalida','Endereço MNI de '+m[1]+' precisa ser HTTPS em domínio .jus.br.');
    url.search='';url.hash='';
    out.push({sigla:m[1].toUpperCase(),endpoint:url.toString()});
  }
  const seen=new Set();
  for(const t of out){if(seen.has(t.sigla))throw new MniError('config_invalida','Tribunal repetido em PJE_MNI_TRIBUNAIS: '+t.sigla);seen.add(t.sigla)}
  return out;
}

// Tribunais cujo sistema atual é o eproc, não o PJe. O MNI do PJe não serve
// para eles: ficam fora da consulta (e o LEX diz isso) até existir conector
// eproc próprio. PJE_MNI_LEGADO=TRF6 força o uso do PJe legado desse tribunal.
const EPROC=new Set(['TRF2','TRF4','TRF6','TJRS','TJSC','TJTO']);
function isEproc(sigla,env=process.env){
  const legado=new Set(String(env.PJE_MNI_LEGADO||'').toUpperCase().split(/[\s,;]+/).filter(Boolean));
  const s=String(sigla||'').toUpperCase().replace(/-/g,'');
  return EPROC.has(s)&&!legado.has(s);
}
function mniConfig(env=process.env){
  const cpf=digits(env.PJE_MNI_CPF);
  const senha=String(env.PJE_MNI_SENHA||'');
  let tribunais=[],erro=null;
  try{tribunais=parseTribunais(env.PJE_MNI_TRIBUNAIS)}catch(e){erro=e.message}
  const eproc=tribunais.filter(t=>isEproc(t.sigla,env)).map(t=>t.sigla);
  tribunais=tribunais.filter(t=>!isEproc(t.sigla,env));
  const pfx=env.PJE_MNI_PFX_BASE64?Buffer.from(String(env.PJE_MNI_PFX_BASE64),'base64'):null;
  const faltando=[];
  if(cpf.length!==11)faltando.push('PJE_MNI_CPF');
  if(!senha&&!pfx)faltando.push('PJE_MNI_SENHA');
  if(!tribunais.length&&!erro)faltando.push('PJE_MNI_TRIBUNAIS');
  const eprocAviso=eproc;
  return Object.freeze({
    configurado:!erro&&!faltando.length,erro,faltando,tribunais,eproc:Object.freeze(eprocAviso),
    credenciais:Object.freeze({cpf,senha,pfx,pfxSenha:String(env.PJE_MNI_PFX_SENHA||'')}),
    ns:Object.freeze({...NS,servico:env.PJE_MNI_NS_SERVICO||NS.servico,tipos:env.PJE_MNI_NS_TIPOS||NS.tipos}),
    timeoutMs:Math.min(120000,Math.max(5000,Number(env.PJE_MNI_TIMEOUT_MS)||45000))
  });
}

function envelope(operation,fields,ns=NS){
  const body=fields.filter(([,v])=>v!==undefined&&v!==null&&v!=='')
    .map(([k,v])=>'<tip:'+k+'>'+xmlEscape(v)+'</tip:'+k+'>').join('');
  return '<?xml version="1.0" encoding="UTF-8"?>'
    +'<soapenv:Envelope xmlns:soapenv="'+ns.soap+'" xmlns:ser="'+ns.servico+'" xmlns:tip="'+ns.tipos+'">'
    +'<soapenv:Header/><soapenv:Body><ser:'+operation+'>'+body+'</ser:'+operation+'></soapenv:Body></soapenv:Envelope>';
}

// Data MNI: AAAAMMDDHHMMSS (horário de Brasília).
function mniDate(date){
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const g=t=>p.find(x=>x.type===t)?.value||'00';
  return g('year')+g('month')+g('day')+g('hour')+g('minute')+g('second');
}
function parseMniDate(value){
  const m=String(value||'').match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/);
  if(!m)return null;
  // Brasília é UTC-3 (sem horário de verão desde 2019).
  const iso=m[1]+'-'+m[2]+'-'+m[3]+'T'+(m[4]||'00')+':'+(m[5]||'00')+':'+(m[6]||'00')+'-03:00';
  const ms=Date.parse(iso);
  return Number.isFinite(ms)?new Date(ms).toISOString():null;
}

const parser=new XMLParser({
  ignoreAttributes:false,attributeNamePrefix:'@',removeNSPrefix:true,
  parseTagValue:false,parseAttributeValue:false,trimValues:true,
  isArray:name=>['aviso','polo','parte','movimento','comunicacao','documento','assunto','complemento','advogado'].includes(name)
});

function findKey(node,name){
  if(!node||typeof node!=='object')return undefined;
  if(Object.hasOwn(node,name))return node[name];
  for(const value of Object.values(node)){
    if(value&&typeof value==='object'){const hit=findKey(value,name);if(hit!==undefined)return hit}
  }
  return undefined;
}
// Campo pode vir como atributo (@x) ou elemento filho (x), conforme o tribunal.
function field(node,name){
  if(!node||typeof node!=='object')return null;
  const v=node['@'+name]??node[name];
  if(v==null)return null;
  if(typeof v==='object')return v['#text']??null;
  return String(v);
}
function text(v){if(v==null)return'';if(typeof v==='object')return String(v['#text']??'');return String(v)}

function parseResponse(xml,responseName){
  let doc;
  try{doc=parser.parse(String(xml||''))}catch{throw new MniError('resposta_invalida','O tribunal devolveu uma resposta ilegível.')}
  const envelopeNode=doc?.Envelope;
  if(!envelopeNode)throw new MniError('resposta_invalida','O tribunal não devolveu um envelope SOAP.');
  const fault=findKey(envelopeNode,'Fault');
  if(fault){
    const msg=text(fault.faultstring||fault.Reason?.Text||'falha SOAP').slice(0,300);
    throw new MniError(/senha|autentic|credencia|usu[aá]rio|login|acesso negado|n[aã]o autorizado/i.test(msg)?'autenticacao':'falha_soap','Tribunal recusou a consulta: '+msg);
  }
  const resp=findKey(envelopeNode,responseName);
  if(!resp||typeof resp!=='object')throw new MniError('resposta_invalida','Resposta do tribunal sem '+responseName+'.');
  const sucesso=String(text(resp.sucesso)).toLowerCase()==='true';
  const mensagem=text(resp.mensagem).slice(0,500);
  if(!sucesso){
    throw new MniError(/senha|autentic|credencia|usu[aá]rio|login|n[aã]o autorizado/i.test(mensagem)?'autenticacao':'recusado','Tribunal recusou a consulta'+(mensagem?': '+mensagem:'.'));
  }
  return {resp,mensagem};
}

function parseCabecalho(cab){
  if(!cab)return{};
  const orgao=cab.orgaoJulgador||null;
  const polos=(cab.polo||[]).map(p=>{
    const out={polo:field(p,'polo'),partes:(p.parte||[]).map(x=>field(x.pessoa||x,'nome')||'').filter(Boolean)};
    const advogados=(p.parte||[]).flatMap(x=>x.advogado||[]).map(a=>({nome:field(a,'nome')||'',inscricao:String(field(a,'inscricao')||'')})).filter(a=>a.nome||a.inscricao);
    if(advogados.length)out.advogados=advogados;
    return out;
  });
  return{
    numero:digits(field(cab,'numero')),
    classe:field(cab,'classeProcessual'),
    orgao:field(orgao,'nomeOrgao'),
    localidade:field(cab,'codigoLocalidade'),
    sigilo:Number(field(cab,'nivelSigilo')||0),
    polos
  };
}

function parseAvisos(xml){
  const {resp,mensagem}=parseResponse(xml,'consultarAvisosPendentesResposta');
  const avisos=(resp.aviso||[]).map(a=>{
    const tipo=String(field(a,'tipoComunicacao')||'').toUpperCase();
    const cab=parseCabecalho(a.processo);
    return{
      id_aviso:String(field(a,'idAviso')||'').trim(),
      tipo,tipo_descricao:TIPO_COMUNICACAO[tipo]||tipo||'Comunicação',
      disponibilizado_em:parseMniDate(field(a,'dataDisponibilizacao')),
      destinatario:field(a.destinatario?.pessoa||a.destinatario,'nome'),
      cnj:cab.numero||'',classe:cab.classe,orgao:cab.orgao,sigilo:cab.sigilo,polos:cab.polos
    };
  });
  const invalid=avisos.filter(a=>!a.id_aviso);
  if(invalid.length)throw new MniError('resposta_invalida','Aviso do tribunal sem identificador; nada foi gravado.');
  return{mensagem,avisos};
}

function parseProcesso(xml){
  const {resp,mensagem}=parseResponse(xml,'consultarProcessoResposta');
  const proc=resp.processo;
  if(!proc)throw new MniError('resposta_invalida','Tribunal não devolveu o processo.');
  const cab=parseCabecalho(proc.dadosBasicos);
  const movimentos=(proc.movimento||[]).map(m=>({
    data:parseMniDate(field(m,'dataHora')),
    id:field(m,'identificadorMovimento'),
    codigo:field(m.movimentoNacional,'codigoNacional'),
    descricao:(field(m.movimentoLocal,'descricao')||text(m.movimentoNacional?.complemento?.[0])||'').trim()
      +((m.complemento||[]).length?' — '+(m.complemento||[]).map(text).filter(Boolean).join('; '):'')
  })).filter(m=>m.data).sort((a,b)=>b.data.localeCompare(a.data));
  return{mensagem,...cab,movimentos};
}

function parseTeor(xml){
  const {resp,mensagem}=parseResponse(xml,'consultarTeorComunicacaoResposta');
  const comunicacoes=(resp.comunicacao||[]).map(c=>({
    id:field(c,'id'),tipo:field(c,'tipoComunicacao'),
    teor:text(c.teor).slice(0,50000),
    documentos:(c.documento||[]).map(d=>({id:field(d,'idDocumento'),tipo:field(d,'tipoDocumento'),descricao:field(d,'descricao'),mimetype:field(d,'mimetype')}))
  }));
  return{mensagem,comunicacoes};
}

// Transporte SOAP 1.1 com certificado opcional (mTLS) quando o tribunal exigir.
function soapTransport({timeoutMs=45000,pfx=null,pfxSenha=''}={}){
  return(endpoint,xml)=>new Promise((resolve,reject)=>{
    const url=new URL(endpoint);
    const req=https.request({
      method:'POST',hostname:url.hostname,path:url.pathname,port:443,
      headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:'""','Content-Length':Buffer.byteLength(xml)},
      ...(pfx?{pfx,passphrase:pfxSenha}:{}),timeout:timeoutMs
    },res=>{
      const chunks=[];let size=0;
      res.on('data',c=>{size+=c.length;if(size>30*1024*1024){req.destroy(new MniError('resposta_grande','Resposta do tribunal grande demais.'));return}chunks.push(c)});
      res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('timeout',()=>req.destroy(new MniError('timeout','O tribunal não respondeu a tempo.')));
    req.on('error',e=>reject(e instanceof MniError?e:new MniError('rede','Sem conexão com o tribunal ('+(e.code||'erro de rede')+').')));
    req.end(xml);
  });
}

// Teste real da conexão: consulta os avisos pendentes (não dá ciência) em cada
// tribunal e explica em português o que falhou.
const CAUSA={
  autenticacao:'o tribunal recusou o CPF/senha. Confira PJE_MNI_CPF e PJE_MNI_SENHA (senha do PJe, não do certificado) ou se o tribunal exige certificado.',
  rede:'sem conexão com o endereço. Confira o endereço do MNI do tribunal ou se ele exige certificado (PJE_MNI_PFX_BASE64).',
  timeout:'o tribunal não respondeu a tempo. Pode estar fora do ar; tente de novo mais tarde.',
  http:'o endereço respondeu, mas não é o webservice MNI. Confira o endereço em PJE_MNI_TRIBUNAIS.',
  resposta_invalida:'o endereço não devolveu uma resposta do MNI. Confira o endereço em PJE_MNI_TRIBUNAIS.',
  falha_soap:'o tribunal recusou a consulta. Veja a mensagem do tribunal.',
  recusado:'o tribunal recusou a consulta. Veja a mensagem do tribunal.',
  nao_configurado:'faltam dados no Render.'
};
async function diagnoseMni(client,config){
  const eproc=[...(config?.eproc||[])];
  if(!config?.configurado)return{ok:false,configurado:false,faltando:config?.faltando||[],erro:config?.erro||null,tribunais:[],eproc};
  const tribunais=[];
  for(const sigla of client.tribunais()){
    const inicio=Date.now();
    try{const r=await client.consultarAvisosPendentes(sigla);tribunais.push({sigla,ok:true,avisos:Array.isArray(r)?r.length:Array.isArray(r?.avisos)?r.avisos.length:0,ms:Date.now()-inicio})}
    catch(e){tribunais.push({sigla,ok:false,codigo:e.code||'erro',erro:e.message,causa:CAUSA[e.code]||'erro inesperado: '+e.message,ms:Date.now()-inicio})}
  }
  return{ok:tribunais.length>0&&tribunais.every(t=>t.ok),configurado:true,tribunais,eproc};
}
function diagnoseMessage(d){
  const eprocLinha=(d.eproc||[]).length?'\n• '+d.eproc.join(', ')+': sistema eproc, não PJe — fora desta consulta. Publicações chegam pelo Diário (DJEN); o painel do eproc ainda não tem conector no LEX.':'';
  if(!d.configurado)return'O PJe não está ligado ao LEX: '+(d.erro||'faltam '+d.faltando.join(', '))+'. Coloque esses dados no Render e peça "teste o PJe" de novo.'+eprocLinha;
  const lines=[d.ok?'✅ PJe conectado em todos os tribunais.':'⚠️ PJe com problema em '+d.tribunais.filter(t=>!t.ok).length+' de '+d.tribunais.length+' tribunal(is).'];
  for(const t of d.tribunais)lines.push(t.ok?'• '+t.sigla+': conectado ('+t.avisos+' expediente(s) pendente(s)).':'• '+t.sigla+': não conectou — '+t.causa+(t.erro&&!t.causa.includes(t.erro)?' ('+t.erro+')':''));
  if(d.ok)lines.push('Nenhuma intimação foi aberta: a consulta não dá ciência.');
  return lines.join('\n')+eprocLinha;
}

function createMniClient(config=mniConfig(),{transport,now=()=>new Date()}={}){
  const send=transport||soapTransport({timeoutMs:config.timeoutMs,pfx:config.credenciais.pfx,pfxSenha:config.credenciais.pfxSenha});
  const auth=()=>[['idConsultante',config.credenciais.cpf],['senhaConsultante',config.credenciais.senha]];
  function tribunal(sigla){
    const t=config.tribunais.find(x=>x.sigla===String(sigla||'').toUpperCase());
    if(!t)throw new MniError('tribunal_desconhecido','Tribunal '+sigla+' não está configurado no LEX.');
    return t;
  }
  async function call(sigla,operation,fields,parse){
    if(!config.configurado)throw new MniError('nao_configurado','PJe (MNI) não configurado: '+(config.erro||'faltam '+config.faltando.join(', '))+'.');
    const t=tribunal(sigla);
    const {status,body}=await send(t.endpoint,envelope(operation,[...auth(),...fields],config.ns));
    // SOAP Fault costuma vir com HTTP 500; o parser distingue falha de sucesso.
    if(status>=400&&!/Fault/i.test(String(body)))throw new MniError('http','Tribunal respondeu HTTP '+status+'.');
    return parse(body);
  }
  return{
    tribunais:()=>config.tribunais.map(t=>t.sigla),
    // Só lista. Não dá ciência.
    consultarAvisosPendentes:(sigla,{dataReferencia}={})=>call(sigla,'consultarAvisosPendentes',[['dataReferencia',dataReferencia?mniDate(dataReferencia):undefined]],parseAvisos),
    // Cabeçalho e movimentos, nunca documentos: não abre teor de intimação.
    consultarProcesso:async(sigla,cnj)=>{
      const numero=digits(cnj);
      if(numero.length!==20)throw new MniError('cnj_invalido','Número CNJ inválido.');
      return call(sigla,'consultarProcesso',[['numeroProcesso',numero],['movimentos','true'],['incluirCabecalho','true'],['incluirDocumentos','false']],parseProcesso);
    },
    // REGISTRA CIÊNCIA. Exige autorização humana verificada antes.
    consultarTeorComunicacao:async(sigla,{cnj,idAviso},authorization)=>{
      assertTeorAuthorization(authorization,{sigla,idAviso},now().getTime());
      return call(sigla,'consultarTeorComunicacao',[['numeroProcesso',digits(cnj)||undefined],['identificadorAviso',String(idAviso)]],parseTeor);
    }
  };
}

// A abertura do teor é ato com efeito processual: só com autorização do
// advogado para aquele aviso específico, dada nos últimos 10 minutos.
function teorConfirmationPhrase(idAviso,sigla){return'CONFIRMO CIENCIA '+(sigla?String(sigla).toUpperCase()+' ':'')+String(idAviso).trim()}
function assertTeorAuthorization(authorization,{sigla,idAviso},now=Date.now()){
  const a=authorization||{};
  const ok=a.confirmado===true
    &&String(a.sigla||'').toUpperCase()===String(sigla||'').toUpperCase()
    &&String(a.id_aviso||'')===String(idAviso||'')
    &&['admin','advogado'].includes(a.perfil)
    &&Number.isFinite(Date.parse(a.em))&&now-Date.parse(a.em)<=10*60*1000&&Date.parse(a.em)<=now+60000;
  if(!ok)throw new MniError('sem_autorizacao','Abrir o teor dá ciência e inicia o prazo. É preciso autorização do advogado para este aviso.');
  return true;
}

module.exports={isEproc,EPROC,diagnoseMni,diagnoseMessage,NS,TIPO_COMUNICACAO,MniError,mniConfig,parseTribunais,envelope,mniDate,parseMniDate,parseAvisos,parseProcesso,parseTeor,createMniClient,soapTransport,teorConfirmationPhrase,assertTeorAuthorization,digits};
