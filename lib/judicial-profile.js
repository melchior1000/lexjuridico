'use strict';
function officialUrl(value){
  try {const url=new URL(value);return url.protocol==='https:' && url.hostname.endsWith('.jus.br') && !url.username && !url.password && (!url.port || url.port==='443') ? url.href : null;}catch{return null;}
}
function normalText(value){return String(value||'').replace(/\s+/g,' ').trim();}
function collectJudicialSources(decisoes, webResponse){
  const sources=[];
  if(typeof decisoes==='string' && decisoes.trim()) sources.push({id:'T1',tipo:'texto_fornecido',titulo:'Decisões fornecidas pelo usuário',texto:decisoes.trim().slice(0,24000),url:null,autoria:'a_conferir'});
  for(const block of webResponse?.raw?.content||[]){
    if(block.type!=='text') continue;
    for(const citation of block.citations||[]){
      const url=officialUrl(citation.url), texto=normalText(citation.cited_text);
      if(!url || !texto || sources.some(s=>s.url===url && s.texto===texto)) continue;
      sources.push({id:'W'+(sources.length+1),tipo:'trecho_web',titulo:String(citation.title||'Decisão em fonte oficial').slice(0,240),texto:texto.slice(0,2000),url,autoria:'a_conferir'});
      if(sources.length>=20) return sources;
    }
  }
  return sources;
}
function evidenceProfile(input,{nome,tribunal,processoId,sources,limitations=[]}){
  const found=new Map(sources.map(s=>[s.id,s]));
  const categorias=new Set(['tese','prova','precedente','procedimento','redacao']);
  const achados=[];
  for(const a of Array.isArray(input?.achados)?input.achados:[]){
    const source=found.get(a.fonte_id),quote=normalText(a.trecho);
    // A conclusão deve ficar ligada a um trecho efetivamente recebido, não a URL inventada pelo modelo.
    if(!source || quote.length<12 || quote.length>500 || !normalText(source.texto).includes(quote) || !categorias.has(a.categoria)) continue;
    achados.push({categoria:a.categoria,observacao:String(a.observacao||'').slice(0,1000),fonte_id:source.id,trecho:quote,
      implicacao:String(a.implicacao||'').slice(0,1000),natureza:'inferência a revisar',autoria:'a_conferir'});
    if(achados.length>=15)break;
  }
  return {versao:'decisorio-v1',nome,tribunal,_processo_vinculado:processoId||null,_gerado_em:new Date().toISOString(),
    status:achados.length?'aguardando_revisao':'material_insuficiente',
    achados,fontes:sources.map(({texto,...meta})=>meta),
    advertencia:'A amostra não prevê resultado nem revela personalidade ou ideologia. Conferir autoria, inteiro teor, data e pertinência de cada decisão.',
    limitacoes:[...limitations,...(!achados.length?['Não há conclusões sustentadas pelos trechos disponíveis.']:[])],
    probabilidade_exito:null,material_suficiente:false};
}
module.exports={officialUrl,collectJudicialSources,evidenceProfile};
