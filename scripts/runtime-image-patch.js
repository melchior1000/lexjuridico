'use strict';
const fs=require('node:fs');
const path=require('node:path');

function patchSource(source){
  const marker="const nomeSafe = String(nome||'documento');";
  if(!source.includes(marker)) throw new Error('Ponto de análise de documento não encontrado.');
  if(source.includes('LEX_IMAGE_ANALYSIS_PATCH_V2')) return source;

  const before=`  const nomeSafe = String(nome||'documento');\n  const isDocx = (!isPdf) && nomeSafe.toLowerCase().endsWith('.docx');\n  const txtArq = isDocx ? _extrairTextoDocxBasico(buffer) : buffer.toString('utf8');\n  const content=isPdf\n    ? [{type:'document',source:{type:'base64',media_type:'application/pdf',data:base64}},{type:'text',text:prompt}]\n    : [{type:'text',text:'[Arquivo: '+nomeSafe+']\\\n\\\n'+String(txtArq||'').substring(0,50000)+'\\\n\\\n'+prompt}];`;

  const after=`  const nomeSafe = String(nome||'documento');\n  // LEX_IMAGE_ANALYSIS_PATCH_V2 — imagem/PDF visual não pode virar bytes UTF-8.\n  const lowerName = nomeSafe.toLowerCase();\n  const isDocx = (!isPdf) && lowerName.endsWith('.docx');\n  const imageMime = lowerName.endsWith('.png') ? 'image/png'\n    : (lowerName.endsWith('.webp') ? 'image/webp'\n    : (lowerName.endsWith('.gif') ? 'image/gif' : 'image/jpeg'));\n  const isImage = (!isPdf) && /\\.(png|jpe?g|webp|gif)$/i.test(lowerName);\n  const txtArq = isDocx ? _extrairTextoDocxBasico(buffer) : (isImage ? '' : buffer.toString('utf8'));\n  const visualRules = \\`\\nREGRAS ESPECIAIS PARA CONTEÚDO VISUAL/ESCANEADO:\\n- Não trate pixels como texto bruto e não complete informação ilegível.\\n- Se for EXTRATO ou COMPROVANTE BANCÁRIO: transcreva instituição, titular, período, data, descrição, valor, crédito/débito e saldo exatamente como aparecem. Preserve sinal, centavos e separadores.\\n- Quando houver saldo anterior, créditos, débitos e saldo final, confira a coerência aritmética. Se não fechar, informe a divergência; não altere valores para fazê-los fechar.\\n- Em tabelas financeiras, mantenha cada lançamento separado e não misture linhas, colunas ou páginas.\\n- Se for DOCUMENTO PERICIAL COM FOTOS: separe FATO VISÍVEL de INFERÊNCIA TÉCNICA. Identifique a página/foto sempre que possível.\\n- Descreva posição, conexão, dano, vegetação, estrutura, medidor, cabo, poste e marcações somente quando forem realmente visíveis.\\n- Não conclua que algo viola norma técnica apenas pela fotografia sem medida, projeto, documento ou norma suficiente.\\n- Para qualquer dado duvidoso use 'ilegível', 'parcialmente legível' ou 'não confirmado'; nunca adivinhe.\\n\\`;
  const content=isPdf\n    ? [{type:'document',source:{type:'base64',media_type:'application/pdf',data:base64}},{type:'text',text:prompt+visualRules}]\n    : isImage\n      ? [{type:'image',source:{type:'base64',media_type:imageMime,data:base64}},{type:'text',text:prompt+visualRules}]\n      : [{type:'text',text:'[Arquivo: '+nomeSafe+']\\\n\\\n'+String(txtArq||'').substring(0,50000)+'\\\n\\\n'+prompt}];`;

  if(!source.includes(before)) throw new Error('Trecho antigo do analisador mudou; patch recusado para não corromper bot.js.');
  return source.replace(before,after);
}

function main(){
  const file=path.resolve(__dirname,'..','bot.js');
  const src=fs.readFileSync(file,'utf8');
  const next=patchSource(src);
  if(next!==src){fs.writeFileSync(file,next,'utf8');console.log('[LEX] Patch de visão V2 aplicado ao analisador de documentos.');}
  else console.log('[LEX] Patch de visão V2 já estava aplicado.');
}

if(require.main===module) main();
module.exports={patchSource};
