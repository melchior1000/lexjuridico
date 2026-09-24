'use strict';

// Extrai somente texto que o operador declarou como mensagem exata.
// Sem IA, o LEX não tenta interpretar intenção livre nem inventa resposta.
function directReplyFromCommand(command){
  const raw=String(command||'').trim();
  if(!raw)return null;
  const colon=raw.match(/^(?:responda|responder|diga|mande|envie|enviar|fale)\b(?:\s+(?:a|ao|à)\s+\S+)?(?:\s+(?:exatamente|literalmente))?\s*:\s*([\s\S]+)$/i);
  if(colon?.[1]?.trim())return colon[1].trim();
  const quoted=raw.match(/^(?:responda|responder|diga|mande|envie|enviar|fale)\b[\s\S]{0,180}?[“"]([\s\S]+?)[”"]\s*$/i);
  if(quoted?.[1]?.trim())return quoted[1].trim();
  return null;
}

function noCreditMessage(){
  return 'IA jurídica sem crédito. As rotinas operacionais do LEX continuam funcionando. Para responder este contato sem IA, escreva por exemplo: responda exatamente: recebi os documentos e retorno em seguida.';
}

module.exports={directReplyFromCommand,noCreditMessage};
