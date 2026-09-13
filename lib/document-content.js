'use strict';

const VISUAL_RULES = `
REGRAS PARA CONTEÚDO VISUAL/ESCANEADO:
- Não complete informação ilegível: use 'ilegível', 'parcialmente legível' ou 'não confirmado'.
- Em extratos e comprovantes, transcreva instituição, titular, período, data, descrição, crédito/débito, valor e saldo exatamente como aparecem. Preserve sinais e centavos.
- Confira saldo anterior + créditos - débitos = saldo final quando esses dados estiverem presentes. Informe divergências sem alterar valores.
- Mantenha cada lançamento separado, sem misturar linhas, colunas ou páginas.
- Em documentos periciais com fotos, separe fato visível de inferência técnica e identifique a página/foto.
- Descreva estruturas, conexões, danos e marcações apenas quando visíveis. Não conclua violação de norma pela foto sem medidas ou documentação suficiente.
`;

function documentContent({name, buffer, isPdf, prompt, extractDocx}) {
  const filename = String(name || 'documento');
  const extension = filename.toLowerCase().split('.').pop();
  const mime = {png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif'}[extension];
  if (isPdf || mime) {
    return [
      {type:isPdf ? 'document' : 'image', source:{type:'base64', media_type:isPdf ? 'application/pdf' : mime, data:buffer.toString('base64')}},
      {type:'text', text:prompt + VISUAL_RULES}
    ];
  }
  const text = extension === 'docx' ? extractDocx(buffer) : buffer.toString('utf8');
  return [{type:'text', text:'[Arquivo: ' + filename + ']\n\n' + String(text || '').slice(0,50000) + '\n\n' + prompt}];
}

module.exports = {documentContent};
