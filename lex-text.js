/* Conserto de exibição para textos gravados com codificação errada.
   O caractere U+FFFD ("�") indica bytes perdidos. Recupera só os padrões
   inequívocos do português e remove o resto; não altera texto íntegro. */
(function(root){
  // Palavras frequentes nos processos cuja letra acentuada se perdeu. Letras ASCII nunca se
  // perdem; cada trecho de letras acentuadas e/ou "�" vira um "?" no esqueleto, que
  // identifica a palavra ("Execu��ão" e "Execução" têm o mesmo esqueleto "execu?o").
  // Nomes de cidade e de pessoas NÃO ficam aqui (produto vendido a qualquer escritório):
  // são aprendidos dos próprios dados do escritório, onde aparecem escritos corretamente.
  const PALAVRAS=['João','São','Cível','Pública','Público','Família','Ministério','Justiça','Previdenciário','Previdência',
    'Órfãos','Sucessões','Fazendária','Execução','Petição','Ação','Alimentícia','Cobrança','Herança','Fiança','Sentença',
    'Audiência','Assistência','Acórdão','Médico','Crédito','Indébito','Tributário','Bancário','Agrário'];
  const NAO_ASCII=/[^\x00-\x7F]/;
  const esqueleto=w=>String(w).toLowerCase().replace(/[^\x00-\x7F]+/g,'?');
  function montar(lista){
    const mapa=new Map();
    for(const w of lista){
      if(!NAO_ASCII.test(w)||w.includes('�'))continue;
      const k=esqueleto(w);
      if((k.match(/[a-z]/g)||[]).length<2)continue;
      const atual=mapa.get(k);
      // Mesmo esqueleto, palavras diferentes ("Simões"/"Simães"): ambíguo, não usa nenhuma.
      mapa.set(k,atual===undefined||(atual&&atual.toLowerCase()===w.toLowerCase())?(atual||w):null);
    }
    return mapa;
  }
  const FIXO=montar(PALAVRAS);
  const fontes=new Map(); // origem ("processos", "escritorio") -> Map de esqueletos
  let aprendido=new Map();
  function recompor(){
    const m=new Map();
    for(const f of fontes.values())for(const [k,w] of f){
      if(FIXO.has(k))continue;
      const atual=m.get(k);
      m.set(k,atual===undefined||(atual&&w&&atual.toLowerCase()===w.toLowerCase())?(atual===undefined?w:atual):null);
    }
    aprendido=m;
  }
  // Só campos curtos (nome, partes, vara, cidade, área...): andamentos e documentos ficam fora.
  const IGNORAR=/^(andamentos|documentos|docs|movimentos|movimentacoes|historico|anexos|texto|conteudo|resumo|minuta)$/i;
  function palavrasCurtas(fonte,saida=[],prof=0){
    if(fonte==null||prof>4||saida.length>20000)return saida;
    if(typeof fonte==='string'){if(fonte.length<=200)saida.push(...(fonte.match(/[\p{L}]{3,40}/gu)||[]));return saida}
    if(Array.isArray(fonte)){for(const v of fonte.slice(0,5000))palavrasCurtas(v,saida,prof+1);return saida}
    if(typeof fonte==='object')for(const [k,v] of Object.entries(fonte))if(!IGNORAR.test(k))palavrasCurtas(v,saida,prof+1);
    return saida;
  }
  // Aprende palavras acentuadas íntegras de uma origem (substitui só o que essa origem ensinou).
  function aprender(fonte,origem='processos'){
    const mapa=montar(palavrasCurtas(fonte));
    for(const k of [...mapa.keys()].slice(3000))mapa.delete(k);
    fontes.set(origem,mapa);
    recompor();
    return [...aprendido.values()].filter(Boolean).length;
  }
  // Versão adiada e agrupada: várias gravações seguidas viram um único aprendizado, fora da
  // hora de desenhar a tela.
  const pendentes=new Map();let agendado=null;
  function aprenderDepois(fonte,origem='processos'){
    pendentes.set(origem,fonte);
    if(agendado)return;
    const rodar=()=>{agendado=null;for(const [o,f] of pendentes){pendentes.delete(o);try{aprender(f,o)}catch{}}};
    agendado=setTimeout(()=>{typeof root.requestIdleCallback==='function'?root.requestIdleCallback(rodar,{timeout:3000}):rodar()},1500);
  }
  function caixa(modelo,w){
    const letras=modelo.replace(/[^A-Za-z]/g,'');
    if(letras.length>=2&&letras===letras.toUpperCase())return w.toUpperCase();
    if(/^[a-z]/.test(modelo))return w.toLowerCase();
    if(/^[A-Z]/.test(modelo))return w.charAt(0).toUpperCase()+w.slice(1);
    return w;
  }
  function trocarPalavra(token){
    if(!token.includes('�'))return token;
    const k=esqueleto(token);
    const w=FIXO.has(k)?FIXO.get(k):aprendido.get(k);
    return w?caixa(token,w):token;
  }
  // Ordinal antes do órgão: "2�� Vara" -> "2ª Vara"; "1�� Juizado" -> "1º Juizado".
  const FEM='Vara|Câmara|C�+mara|Turma|Região|Regi�+o|Seção|Se�+�+o|Instância|Inst�+ncia|Zona|Junta|Promotoria|Defensoria|Delegacia|Vice-Presidência';
  const MASC='Juizado|Ofício|Of�+cio|Tabelionato|Grau|Distrito|Registro|Cartório|Cart�+rio';
  const RE_FEM=new RegExp('(\\d)�+\\s*(?=(?:'+FEM+')(?![\\p{L}]))','gu');
  const RE_MASC=new RegExp('(\\d)�+\\s*(?=(?:'+MASC+')(?![\\p{L}]))','gu');
  function lexFixText(value){
    let s=String(value??'');
    if(s.indexOf('�')<0)return s;
    s=s.replace(RE_FEM,'$1ª ').replace(RE_MASC,'$1º ')
      .replace(/[\p{L}�]+/gu,trocarPalavra)   // palavra conhecida, numa passada só
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
  lexFixText.aprenderDepois=aprenderDepois;
  root.lexFixText=lexFixText;
  if(typeof module==='object'&&module.exports)module.exports={lexFixText};
})(typeof globalThis!=='undefined'?globalThis:this);
