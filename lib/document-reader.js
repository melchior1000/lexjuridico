'use strict';

const https=require('node:https');

const CRITICAL_TYPES=new Set(['extrato_bancario','holerite','cnis','contrato','rg','cpf','cnh','rg_cpf_unificado','fgts','trct','ctps']);
const FINANCIAL_TYPES=new Set(['extrato_bancario','holerite','cnis','fgts','trct']);

function normalizeConfidence(value){
  const v=String(value||'').trim().toLowerCase();
  return ['alta','media','baixa'].includes(v)?v:'baixa';
}
function cleanText(value){return String(value||'').replace(/\u0000/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();}
function assessTextQuality(text,{pages=1}={}){
  const t=cleanText(text);
  const chars=t.length;
  const words=(t.match(/[A-Za-zÀ-ÿ0-9]{2,}/g)||[]).length;
  const dates=(t.match(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g)||[]).length;
  const money=(t.match(/R\$\s*[\d.]+,\d{2}|\b\d{1,3}(?:\.\d{3})*,\d{2}\b/g)||[]).length;
  const perPage=chars/Math.max(1,Number(pages)||1);
  const ok=chars>=180 && words>=30 && perPage>=80;
  return {ok,confidence:ok?'alta':chars>=80?'media':'baixa',chars,words,dates,money,reason:ok?'texto_pdf_legivel':'texto_pdf_insuficiente'};
}

async function extractPdfText(buffer,{parser}={}){
  if(!Buffer.isBuffer(buffer)||!buffer.length) return {ok:false,text:'',pages:0,confidence:'baixa',reason:'pdf_vazio'};
  let parse=parser;
  if(!parse){try{parse=require('pdf-parse');}catch{return {ok:false,text:'',pages:0,confidence:'baixa',reason:'parser_pdf_indisponivel'};}}
  try{
    const out=await parse(buffer);
    const text=cleanText(out?.text||'');
    const pages=Number(out?.numpages||out?.numPages||1);
    const q=assessTextQuality(text,{pages});
    return {ok:q.ok,text,pages,confidence:q.confidence,reason:q.reason,metrics:q,source:'pdf_text'};
  }catch(e){return {ok:false,text:'',pages:0,confidence:'baixa',reason:'falha_extracao_pdf',error:String(e.message||e).slice(0,160)};}
}

function extractResponseText(json){
  if(typeof json?.output_text==='string'&&json.output_text.trim()) return json.output_text.trim();
  for(const item of Array.isArray(json?.output)?json.output:[]){for(const c of Array.isArray(item?.content)?item.content:[]){if(typeof c?.text==='string'&&c.text.trim()) return c.text.trim();}}
  return '';
}

function requestOpenAI(body,{apiKey,transport=https,timeoutMs=60000}={}){
  return new Promise(resolve=>{
    if(!apiKey) return resolve({ok:false,error:'OPENAI_API_KEY_ausente'});
    const raw=Buffer.from(JSON.stringify(body)); let settled=false;
    const done=x=>{if(!settled){settled=true;resolve(x);}};
    const req=transport.request({hostname:'api.openai.com',path:'/v1/responses',method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Content-Length':raw.length}},res=>{
      const chunks=[];let size=0;
      res.on('data',c=>{size+=c.length;if(size>2*1024*1024){req.destroy();done({ok:false,error:'resposta_excessiva'});return;}chunks.push(Buffer.from(c));});
      res.on('end',()=>{if(settled)return;const txt=Buffer.concat(chunks).toString('utf8');if(res.statusCode<200||res.statusCode>=300)return done({ok:false,error:'openai_http_'+res.statusCode});try{done({ok:true,json:JSON.parse(txt)});}catch{done({ok:false,error:'openai_json_invalido'});}});
      res.on('error',()=>done({ok:false,error:'openai_resposta_interrompida'}));
    });
    req.on('error',()=>done({ok:false,error:'openai_rede'}));
    req.setTimeout(timeoutMs,()=>{req.destroy();done({ok:false,error:'openai_timeout'});});
    req.write(raw);req.end();
  });
}

async function readWithVision(buffer,{mimeType='image/jpeg',filename='documento',apiKey=process.env.OPENAI_API_KEY,model=process.env.OPENAI_VISION_MODEL||'gpt-5',request=requestOpenAI}={}){
  if(!Buffer.isBuffer(buffer)||!buffer.length) return {ok:false,confidence:'baixa',reason:'arquivo_vazio'};
  if(buffer.length>20*1024*1024) return {ok:false,confidence:'baixa',reason:'arquivo_grande_demais'};
  const isPdf=/pdf/i.test(mimeType)||/\.pdf$/i.test(filename);
  const data=buffer.toString('base64');
  const filePart=isPdf?{type:'input_file',filename:String(filename||'documento.pdf').slice(0,100),file_data:data}:{type:'input_image',detail:'high',image_url:`data:${mimeType};base64,${data}`};
  const instruction=`Leia este documento brasileiro com rigor de perícia. Se estiver cortado, escuro, borrado ou ambíguo, NÃO complete. Responda somente JSON válido no formato:
{"tipo_documento":"extrato_bancario|holerite|cnis|contrato|rg|cpf|cnh|rg_cpf_unificado|comprovante_residencia|fgts|trct|ctps|outro","confianca":"alta|media|baixa","texto_legivel":"transcrição fiel do que é possível ler","extraido":{"nome":"","cpf":"","rg":"","data_nascimento":"","nacionalidade":"","naturalidade":"","filiacao_pai":"","filiacao_mae":"","estado_civil":"","profissao":"","endereco_rua":"","endereco_numero":"","endereco_bairro":"","endereco_cidade":"","endereco_uf":"","endereco_cep":"","telefone":"","email":"","outros_dados":""},"evidencias":[{"pagina":null,"data":"","linha":"","campo":"","valor":""}],"observacoes":""}.
REGRAS: nenhum campo pode ser inferido. Para qualquer valor monetário, só inclua quando houver leitura visual clara e registre a origem em evidencias. Em extrato/holerite/CNIS/FGTS/TRCT, se não conseguir identificar a origem do valor por página, data ou linha, a confiança NÃO pode ser alta. Se não conseguir ler com segurança, use confianca baixa e deixe o campo vazio.`;
  const r=await request({model,input:[{role:'user',content:[{type:'input_text',text:instruction},filePart]}]},{apiKey});
  if(!r?.ok) return {ok:false,confidence:'baixa',reason:r?.error||'visao_indisponivel'};
  const raw=extractResponseText(r.json).replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  let obj;try{obj=JSON.parse(raw);}catch{return {ok:false,confidence:'baixa',reason:'visao_json_invalido'};}
  const confidence=normalizeConfidence(obj?.confianca);
  const text=cleanText(obj?.texto_legivel||'');
  const type=String(obj?.tipo_documento||'outro').toLowerCase();
  const evidences=Array.isArray(obj?.evidencias)?obj.evidencias.filter(e=>e&&typeof e==='object'):[];
  const financial=FINANCIAL_TYPES.has(type);
  const valueEvidence=evidences.filter(e=>String(e?.valor||'').match(/\d/));
  const originsOk=valueEvidence.length>0 && valueEvidence.every(e=>e?.pagina!=null||String(e?.data||'').trim()||String(e?.linha||'').trim());
  const ok=confidence==='alta'&&text.length>=20&&(!financial||originsOk);
  return {ok,confidence,reason:ok?'visao_confirmada':confidence!=='alta'?'confianca_insuficiente':!text?'texto_vazio':financial&&!originsOk?'evidencia_financeira_insuficiente':'evidencia_insuficiente',source:'openai_vision',type,text,evidences,extraido:obj?.extraido&&typeof obj.extraido==='object'?obj.extraido:{},observations:String(obj?.observacoes||'').slice(0,1000),raw:obj};
}

async function readDocument(buffer,{mimeType='',filename='',pdfParser,vision=readWithVision,apiKey}={}){
  const isPdf=/pdf/i.test(mimeType)||/\.pdf$/i.test(filename);
  if(isPdf){
    const pdf=await extractPdfText(buffer,{parser:pdfParser});
    if(pdf.ok) return {...pdf,method:'pdf_text'};
    const visual=await vision(buffer,{mimeType:mimeType||'application/pdf',filename:filename||'documento.pdf',apiKey});
    return {...visual,method:'vision_fallback',pdfAttempt:{confidence:pdf.confidence,reason:pdf.reason,metrics:pdf.metrics||null}};
  }
  return {...await vision(buffer,{mimeType:mimeType||'image/jpeg',filename:filename||'imagem',apiKey}),method:'vision'};
}

function mustBlockReading(result,{critical=true}={}){return !!critical && (!result||result.ok!==true||normalizeConfidence(result.confidence)!=='alta');}
function unreadMessage(){return 'Não deu para ler esse documento com segurança. Envie outro arquivo nítido, reto e com boa luz, ou o PDF original do banco/órgão.';}

module.exports={CRITICAL_TYPES,FINANCIAL_TYPES,normalizeConfidence,assessTextQuality,extractPdfText,readWithVision,readDocument,mustBlockReading,unreadMessage,extractResponseText};
