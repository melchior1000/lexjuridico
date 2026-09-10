'use strict';
const fs=require('node:fs');
const path=require('node:path');

function patchSource(source){
  const marker="const nomeSafe = String(nome||'documento');";
  if(!source.includes(marker)) throw new Error('Ponto de análise de documento não encontrado.');
  if(source.includes('LEX_IMAGE_ANALYSIS_PATCH_V1')) return source;

  const before=`  const nomeSafe = String(nome||'documento');\n  const isDocx = (!isPdf) && nomeSafe.toLowerCase().endsWith('.docx');\n  const txtArq = isDocx ? _extrairTextoDocxBasico(buffer) : buffer.toString('utf8');\n  const content=isPdf\n    ? [{type:'document',source:{type:'base64',media_type:'application/pdf',data:base64}},{type:'text',text:prompt}]\n    : [{type:'text',text:'[Arquivo: '+nomeSafe+']\\\n\\\n'+String(txtArq||'').substring(0,50000)+'\\\n\\\n'+prompt}];`;

  const after=`  const nomeSafe = String(nome||'documento');\n  // LEX_IMAGE_ANALYSIS_PATCH_V1 — imagens devem ir ao modelo como imagem, nunca como UTF-8.\n  const lowerName = nomeSafe.toLowerCase();\n  const isDocx = (!isPdf) && lowerName.endsWith('.docx');\n  const imageMime = lowerName.endsWith('.png') ? 'image/png'\n    : (lowerName.endsWith('.webp') ? 'image/webp'\n    : (lowerName.endsWith('.gif') ? 'image/gif' : 'image/jpeg'));\n  const isImage = (!isPdf) && /\\.(png|jpe?g|webp|gif)$/i.test(lowerName);\n  const txtArq = isDocx ? _extrairTextoDocxBasico(buffer) : (isImage ? '' : buffer.toString('utf8'));\n  const imageRules = \\`\\nREGRAS ESPECIAIS PARA IMAGEM:\\n- Se for extrato/comprovante bancário, transcreva exatamente instituição, titular, período, data, descrição, valor, natureza crédito/débito e saldo. Preserve sinais e separadores. Não complete números ilegíveis.\\n- Confira coerência aritmética quando houver saldo anterior, créditos, débitos e saldo final; se não fechar, sinalize divergência em vez de corrigir por conta própria.\\n- Se for fotografia pericial, separe claramente FATO VISÍVEL de INFERÊNCIA TÉCNICA. Descreva posição, conexão, dano, vegetação, estrutura, medidor, cabo, poste e marcações somente quando realmente visíveis.\\n- Nunca declare desconformidade normativa apenas pela foto sem medida/documento/norma suficiente.\\n- Para campo incerto, use 'ilegível' ou 'não confirmado'; nunca adivinhe.\\n\\`;
  const content=isPdf\n    ? [{type:'document',source:{type:'base64',media_type:'application/pdf',data:base64}},{type:'text',text:prompt}]\n    : isImage\n      ? [{type:'image',source:{type:'base64',media_type:imageMime,data:base64}},{type:'text',text:prompt+imageRules}]\n      : [{type:'text',text:'[Arquivo: '+nomeSafe+']\\\n\\\n'+String(txtArq||'').substring(0,50000)+'\\\n\\\n'+prompt}];`;

  if(!source.includes(before)) throw new Error('Trecho antigo do analisador mudou; patch recusado para não corromper bot.js.');
  return source.replace(before,after);
}

function main(){
  const file=path.resolve(__dirname,'..','bot.js');
  const src=fs.readFileSync(file,'utf8');
  const next=patchSource(src);
  if(next!==src){fs.writeFileSync(file,next,'utf8');console.log('[LEX] Patch de visão aplicado ao analisador de documentos.');}
  else console.log('[LEX] Patch de visão já estava aplicado.');
}

if(require.main===module) main();
module.exports={patchSource};
