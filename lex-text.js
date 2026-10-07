/* Conserto de exibição para textos gravados com codificação errada.
   O caractere U+FFFD ("�") indica bytes perdidos. Recupera só os padrões
   inequívocos do português e remove o resto; não altera texto íntegro. */
(function(root){
  // Palavras frequentes nos processos cuja letra acentuada se perdeu. Cada letra fora do
  // ASCII vira "um ou mais �"; letras ASCII nunca se perdem, então o esqueleto ASCII da
  // palavra identifica qual era. Nomes de cidade e de pessoas NÃO ficam aqui (produto
  // vendido a qualquer escritório): são aprendidos dos próprios dados do escritório, onde
  // aparecem escritos corretamente (lexFixText.aprender).
  const PALAVRAS=['Brasília','João','São','Cível','Pública','Público',
    'Família','Ministério','Justiça','Previdenciário','Previdência','Órfãos','Sucessões','Fazendária','Execução','Petição','Ação',
    'Alimentícia','Cobrança','Herança','Fiança','Sentença','Audiência','Assistência','Acórdão','Médico','Crédito','Indébito','Tributário','Bancário','Agrário'];
  const ASCII=/^[\x00-\x7F]$/;
  const escapar=c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const esqueleto=w=>[...w].map(c=>ASCII.test(c)?c:'?').join('');
  const regra=w=>[new RegExp('(^|[^\\p{L}])'+[...w].map(c=>ASCII.test(c)?escapar(c):'�+').join('')+'(?=$|[^\\p{L}])','gu'),w];
  const variantes=w=>[...new Set([w,w.toUpperCase(),w.toLowerCase()])];
  const DICIONARIO=PALAVRAS.flatMap(variantes).map(regra);
  const fixos=new Set(DICIONARIO.map(([,w])=>esqueleto(w)));
  let aprendidas=[];
  // Aprende palavras acentuadas íntegras dos dados do escritório (nomes de cidade, de vara,
  // de pessoas). Duas palavras com o mesmo esqueleto (ex.: "Simões"/"Simães") são
  // ambíguas: nenhuma é usada — na dúvida, o LEX não adivinha.
  function aprender(fonte){
    const texto=typeof fonte==='string'?fonte:JSON.stringify(fonte??'');
    const porEsqueleto=new Map();
    for(const w of texto.match(/[\p{L}]{3,40}/gu)||[]){
      if(!/[^\x00-\x7F]/.test(w))continue;
      if(w.includes('�'))continue;
      const k=esqueleto(w);
      if(fixos.has(k))continue;
      const atual=porEsqueleto.get(k);
      porEsqueleto.set(k,atual===undefined||atual===w?w:null);
      if(porEsqueleto.size>3000)break;
    }
    aprendidas=[...porEsqueleto.values()].filter(Boolean).flatMap(variantes).map(regra);
    return aprendidas.length;
  }
  // Ordinal antes do órgão: "2�� Vara" -> "2ª Vara"; "1�� Juizado" -> "1º Juizado".
  const FEM='Vara|Câmara|C�+mara|Turma|Região|Regi�+o|Seção|Se�+�+o|Instância|Inst�+ncia|Zona|Junta|Promotoria|Defensoria|Delegacia|Vice-Presidência';
  const MASC='Juizado|Ofício|Of�+cio|Tabelionato|Grau|Distrito|Registro|Cartório|Cart�+rio';
  function lexFixText(value){
    let s=String(value??'');
    if(s.indexOf('�')<0)return s;
    for(const [re,w] of DICIONARIO)s=s.replace(re,'$1'+w);
    for(const [re,w] of aprendidas)s=s.replace(re,'$1'+w);
    s=s.replace(new RegExp('(\\d)�+\\s*(?=(?:'+FEM+')(?![\\p{L}]))','gu'),'$1ª ')
      .replace(new RegExp('(\\d)�+\\s*(?=(?:'+MASC+')(?![\\p{L}]))','gu'),'$1º ')
      .replace(/\s+�+\s+/g,' — ')          // travessão perdido entre palavras
      .replace(/ç�+o/g,'ção').replace(/Ç�+O/g,'ÇÃO')
      .replace(/ç�+es/g,'ções')
      .replace(/(?![çÇ])(\p{L})�+ão/gu,'$1ção').replace(/(?![çÇ])(\p{L})�+ões/gu,'$1ções') // "ç" perdido, "ão"/"ões" intactos
      .replace(/(^|[^\p{L}])n�+o(?=$|[^\p{L}])/gu,'$1não')
      .replace(/(?![ÇÃ])(\p{Lu})�+(ÃO|ÕES)/gu,(m,l,f)=>l+'Ç'+f)
      // "ã" perdido depois de s/t/d no fim da palavra: Pensão, Questão, Certidão (não há "-sço", "-tço", "-dço").
      .replace(/(\p{L})([std])�+o(?![\p{L}])/gu,'$1$2ão').replace(/(\p{Lu})([STD])�+O(?![\p{L}])/gu,'$1$2ÃO')
      .replace(/�+/g,'');
    return s;
  }
  lexFixText.aprender=aprender;
  root.lexFixText=lexFixText;
  if(typeof module==='object'&&module.exports)module.exports={lexFixText};
})(typeof globalThis!=='undefined'?globalThis:this);
