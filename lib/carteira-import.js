'use strict';
// =====================================================================
// IMPORTAR A CARTEIRA DE UMA PLANILHA (frente 3 — a "migração assistida" do EasyJur)
// ---------------------------------------------------------------------
// O escritório manda a planilha que já tem (Excel .xlsx ou .csv, do sistema antigo ou
// feita à mão). O LEX lê, acha as colunas pelo nome (ou pelo conteúdo, quando não há
// cabeçalho), confere cada número CNJ (dígito verificador e tribunal) e CONVERSA com o
// titular antes de gravar: quantos entram, quantos já existem, quais têm problema e por quê.
// Só grava com a ordem dele (a IA chama a ferramenta; sem IA, a frase "importar a planilha").
//
// Cintos:
// - número com dígito errado ou tribunal desconhecido não entra; número que o Excel
//   estragou (notação científica, dígitos perdidos) é apontado, nunca "consertado";
//   zeros à esquerda perdidos só voltam quando o dígito verificador confirma;
// - processo que já está na carteira não é duplicado (nem repetido dentro da planilha);
// - o processo entra "a conferir" (sem leitura oficial): partes, prazo e andamentos vêm
//   depois do tribunal — a rotina noturna do Datajud já cobre a carteira inteira;
// - a mesma planilha mandada de novo não vira duas importações, nem duas ordens ao mesmo tempo;
// - WhatsApp do cliente só entra se for celular brasileiro, marcado como vindo da planilha
//   (a prévia de mensagem ao cliente avisa para conferir);
// - desfazer remove só o que ficou exatamente como a planilha trouxe (mais a leitura do
//   Datajud, que volta sozinha): qualquer tarefa, documento, prazo, publicação, honorário,
//   anotação ou dado mexido mantém o processo.
// =====================================================================
const crypto=require('node:crypto');
const {cnjValid,cnjCheckDigits,formatCnj}=require('./carteira-audit');
const {processCnjs}=require('./pje-sync');
const {tribunalFromCnj}=require('./pje-process-sync');

const PREFIXO='lex_carteira_importacao_';
// Registro pequeno com a planilha que espera a ordem: a conversa da IA lê só ele a cada mensagem.
const PENDENTE='lex_carteira_pendente';
const MAX_LINHAS=3000;
const MAX_BYTES=8*1024*1024;
// Teto do tamanho ABERTO de cada parte do .xlsx e do conjunto: uma carteira de 3.000 linhas
// abre em poucos megabytes; acima disso é erro ou arquivo hostil.
const MAX_DESCOMPACTADO=12*1024*1024;
const PRAZO_ORDEM_MS=7*86400000; // planilha lida há mais de 7 dias: ler de novo
const IMPORTANDO_MS=10*60*1000;
const MAX_ABAS=20;
const PODE=new Set(['admin','advogado']);

const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[º°ª.:#()/\\_\-[\]]+/g,' ').replace(/\s+/g,' ').trim();
function erro(msg,status=400){return Object.assign(new Error(msg),{status})}
const grande=()=>erro('Planilha grande demais depois de aberta. Divida em partes e mande uma de cada vez.');
// Nome de arquivo ou de aba vira texto de conversa: sem quebras de linha nem caracteres de controle.
const nomeSeguro=(v,max=120)=>String(v||'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max);

// ---------------------------------------------------------------------
// Leitura: CSV e XLSX (zip + XML) com as dependências que o LEX já tem
// ---------------------------------------------------------------------
function decodificar(buffer){
  const utf=buffer.toString('utf8');
  return (utf.includes('\uFFFD')?buffer.toString('latin1'):utf).replace(/^\uFEFF/,'');
}
// Para de montar linhas logo depois do limite (o resumo avisa que cortou) e ignora colunas
// além da 200ª: um CSV de 8 MB não pode virar milhões de células na memória.
function parseCsv(texto,delim,{maxLinhas=MAX_LINHAS+50,maxColunas=201}={}){
  const rows=[];let row=[],campo='',dentro=false;
  const fecha=()=>{if(row.length<maxColunas)row.push(campo);campo=''};
  for(let i=0;i<texto.length;i++){
    const ch=texto[i];
    if(dentro){
      if(ch==='"'){if(texto[i+1]==='"'){campo+='"';i++}else dentro=false}
      else campo+=ch;
    }else if(ch==='"')dentro=true;
    else if(ch===delim)fecha();
    else if(ch==='\n'){fecha();rows.push(row);row=[];if(rows.length>=maxLinhas)break}
    else if(ch!=='\r')campo+=ch;
  }
  if(rows.length<maxLinhas&&(campo!==''||row.length)){fecha();rows.push(row)}
  return rows.map(r=>r.map(v=>({valor:String(v).trim(),numerico:false})));
}
function lerCsv(buffer){
  const texto=decodificar(buffer);
  const amostra=texto.slice(0,65536).split(/\r?\n/).slice(0,10);
  const delim=[';',',','\t'].map(d=>[d,amostra.reduce((n,l)=>n+(l.split(d).length-1),0)]).sort((a,b)=>b[1]-a[1])[0][0];
  return{formato:'csv',aba:null,linhas:parseCsv(texto,delim)};
}

// Texto de uma célula do Excel: <t>, ou pedaços <r><t> (formatação no meio do texto).
function textoDe(n){
  if(n==null)return'';
  if(typeof n==='string'||typeof n==='number')return String(n);
  if(Array.isArray(n))return n.map(textoDe).join('');
  if(n.t!=null||n.r!=null)return textoDe(n.t)+textoDe(n.r);
  return n['#text']!=null?String(n['#text']):'';
}
function colunaIndice(ref){
  const letras=String(ref||'').match(/^[A-Z]+/i);if(!letras)return null;
  let n=0;for(const ch of letras[0].toUpperCase())n=n*26+(ch.charCodeAt(0)-64);
  return n-1;
}
// Parte do arquivo compactado lida aos pedaços, com teto do tamanho aberto: um .xlsx pequeno
// pode abrir em gigabytes, e o tamanho que o próprio arquivo declara pode ser falso. Passou do
// teto (da parte ou do conjunto), a leitura para ali — nada é aberto inteiro na memória.
function lerComTeto(f,limite,orcamento){
  return new Promise((resolve,reject)=>{
    const partes=[];let total=0,fim=false;
    const s=f.nodeStream('nodebuffer');
    const parar=e=>{if(fim)return;fim=true;try{s.pause();if(typeof s.destroy==='function')s.destroy()}catch{/* já parado */}reject(e)};
    s.on('data',c=>{
      if(fim)return;
      total+=c.length;orcamento.usado+=c.length;
      if(total>limite||orcamento.usado>orcamento.max)return parar(grande());
      partes.push(c);
    });
    s.on('end',()=>{if(!fim){fim=true;resolve(Buffer.concat(partes).toString('utf8'))}});
    s.on('error',e=>parar(e));
  });
}
// Sem DOCTYPE/ENTITY, que planilha de verdade nunca tem.
async function parteDoZip(zip,caminho,limite,orcamento){
  const f=zip.file(caminho);if(!f)return null;
  const declarado=Number(f._data?.uncompressedSize);
  if(Number.isFinite(declarado)&&declarado>limite)throw grande();
  const s=await lerComTeto(f,limite,orcamento);
  if(/<!DOCTYPE|<!ENTITY/i.test(s))throw erro('Essa planilha tem uma estrutura que o Excel não gera. Salve de novo como .xlsx ou .csv e mande.');
  return s;
}

async function lerXlsx(buffer,{maxDescompactado=MAX_DESCOMPACTADO}={}){
  const JSZip=require('jszip');
  const {XMLParser}=require('fast-xml-parser');
  const zip=await JSZip.loadAsync(buffer);
  const orcamento={usado:0,max:maxDescompactado*2};
  const ler=caminho=>parteDoZip(zip,caminho,maxDescompactado,orcamento);
  // parseTagValue:false — número de processo não pode virar número do JavaScript (perde dígitos);
  // trimValues:false — "Maria " + "Rica" em pedaços formatados não pode virar "MariaRica".
  const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',parseTagValue:false,trimValues:false,
    isArray:nome=>['sheet','Relationship','si','r','row','c'].includes(nome)});
  const wbXml=await ler('xl/workbook.xml');
  if(!wbXml)throw erro('Essa planilha não tem pasta de trabalho legível. Salve como .xlsx ou .csv e mande de novo.');
  // Só as primeiras abas: carteira de verdade está numa das primeiras, e arquivo com milhares
  // de abas não pode prender o servidor.
  const sheets=(parser.parse(wbXml)?.workbook?.sheets?.sheet||[]).slice(0,MAX_ABAS);
  const relsXml=await ler('xl/_rels/workbook.xml.rels');
  const rels=new Map();
  for(const r of relsXml?(parser.parse(relsXml)?.Relationships?.Relationship||[]):[])if(r&&!rels.has(r['@_Id']))rels.set(r['@_Id'],r);
  const caminho=s=>{
    const rel=rels.get(s['@_r:id']);
    let t=String(rel?.['@_Target']||'');
    if(!t)return null;
    t=t.startsWith('/')?t.slice(1):'xl/'+t;
    return t.replace(/\/\.\//g,'/');
  };
  const sst=[];
  const ssXml=await ler('xl/sharedStrings.xml');
  if(ssXml)for(const si of parser.parse(ssXml)?.sst?.si||[])sst.push(textoDe(si));
  for(const s of sheets){
    const p=caminho(s);const xml=p?await ler(p):null;
    if(!xml)continue;
    const linhas=[];
    for(const row of parser.parse(xml)?.worksheet?.sheetData?.row||[]){
      const cells=[];
      for(const c of row.c||[]){
        const i=colunaIndice(c['@_r']);if(i==null||i>200)continue;
        const t=c['@_t'];let valor='',numerico=false;
        if(t==='s')valor=sst[Number(c.v)]??'';
        else if(t==='inlineStr')valor=textoDe(c.is);
        else if(t==='b')valor=String(c.v)==='1'?'VERDADEIRO':'FALSO';
        else if(t==='str'||t==='e')valor=textoDe(c.v);
        else{valor=textoDe(c.v);numerico=valor!==''}
        while(cells.length<i)cells.push({valor:'',numerico:false});
        cells[i]={valor:String(valor).trim(),numerico};
      }
      linhas.push(cells);
    }
    if(linhas.some(l=>l.some(c=>c.valor)))return{formato:'xlsx',aba:nomeSeguro(s['@_name'],60)||null,linhas};
  }
  return{formato:'xlsx',aba:null,linhas:[]};
}

async function lerPlanilha(buffer,nome='',opcoes={}){
  if(!Buffer.isBuffer(buffer)||!buffer.length)throw erro('O arquivo chegou vazio.');
  if(buffer.length>MAX_BYTES)throw erro('Planilha grande demais (máximo 8 MB). Divida em partes e mande uma de cada vez.');
  const ext=String(nome).toLowerCase().split('.').pop();
  const zip=buffer.slice(0,2).toString('latin1')==='PK';
  if(ext==='xls'&&!zip)throw erro('Esse é o formato antigo do Excel (.xls). No Excel, use "Salvar como" → .xlsx ou .csv e mande de novo.');
  if(ext==='ods')throw erro('Planilha do LibreOffice (.ods) ainda não. Salve como .xlsx ou .csv e mande de novo.');
  if(zip){
    try{return await lerXlsx(buffer,opcoes)}
    catch(e){if(e.status)throw e;throw erro('Não consegui abrir essa planilha. Salve de novo como .xlsx ou .csv e mande.')}
  }
  return lerCsv(buffer);
}
function ehPlanilha(nome='',mime=''){
  return /\.(csv|xlsx|xlsm|xls|ods)$/i.test(String(nome))||/spreadsheet|ms-excel|text\/csv/i.test(String(mime));
}

// ---------------------------------------------------------------------
// Colunas: pelo nome do cabeçalho; sem cabeçalho, pelo conteúdo
// ---------------------------------------------------------------------
// "=" na frente: só vale o nome exato (palavras genéricas que confundem).
// Ordem importa: "telefone do cliente" é telefone, não cliente; por isso "cliente" vem por último.
const CAMPOS=[
  ['cnj',['cnj','numero cnj','numero do processo','n do processo','no do processo','numero processo','n processo','=processo','=numero','=num','numero dos autos','n dos autos','=autos','numero unico','processo n','processo numero']],
  ['whatsapp',['whatsapp','celular','telefone','=fone','=tel','=contato','whats','contato do cliente']],
  ['responsavel',['responsavel','advogado','advogada','advogado responsavel','=adv','responsavel pelo caso']],
  ['partes',['partes','parte contraria','parte adversa','adverso','=reu','=autor','polo passivo','polo ativo','=contra','envolvidos','=titulo','acao entre']],
  ['area',['area','assunto','materia','tipo de acao','=tipo','=classe','natureza','=acao','classe processual']],
  ['tribunal',['tribunal','vara','comarca','orgao julgador','=orgao','juizo','=foro','instancia']],
  ['status',['status','situacao','=fase','situacao atual']],
  ['observacao',['observacao','observacoes','=obs','descricao','resumo','anotacoes','notas','comentarios']],
  ['cliente',['cliente','nome do cliente','nome cliente','constituinte','contratante','=nome','representado','outorgante']]
];
function campoDoCabecalho(h){
  const n=norm(h);if(!n)return null;
  for(const [campo,sins] of CAMPOS)for(const s of sins){
    if(s.startsWith('=')){if(n===s.slice(1))return campo;continue}
    if(n===s||(' '+n+' ').includes(' '+s+' '))return campo;
  }
  return null;
}
const pareceCnj=v=>String(v||'').replace(/\D/g,'').length>=15;
function mapear(linhas){
  for(let i=0;i<Math.min(10,linhas.length);i++){
    const mapa={},usadas=new Set();
    linhas[i].forEach((c,col)=>{const campo=campoDoCabecalho(c.valor);if(campo&&!(campo in mapa)&&!usadas.has(col)){mapa[campo]=col;usadas.add(col)}});
    if('cnj' in mapa)return{mapa,cabecalho:i,colunas:Object.fromEntries(Object.entries(mapa).map(([k,col])=>[k,linhas[i][col].valor]))};
  }
  // Sem cabeçalho reconhecível: a coluna em que a maioria parece número de processo.
  const larg=Math.max(0,...linhas.map(l=>l.length));let melhor=-1,qtd=0;
  for(let col=0;col<larg;col++){const n=linhas.filter(l=>pareceCnj(l[col]?.valor)).length;if(n>qtd){qtd=n;melhor=col}}
  if(melhor>=0&&qtd>=Math.max(1,Math.ceil(linhas.filter(l=>l.some(c=>c.valor)).length*0.5)))return{mapa:{cnj:melhor},cabecalho:-1,colunas:{cnj:'(sem cabeçalho)'}};
  return null;
}

// ---------------------------------------------------------------------
// Número CNJ: conferir, nunca adivinhar
// ---------------------------------------------------------------------
function lerCnj(celula){
  const bruto=String(celula?.valor||'').trim();
  if(!bruto)return{vazio:true};
  // Número guardado como número no Excel passa de 15 dígitos e perde precisão; em CSV aparece
  // como notação científica. Nos dois casos o número verdadeiro não está no arquivo.
  if(/\d[.,]\d+e\+?\d+/i.test(bruto)||(celula.numerico&&bruto.replace(/\D/g,'').length>15))
    return{bruto,problema:'o Excel guardou o número como número e perdeu dígitos — formate a coluna como texto e exporte de novo'};
  let d=bruto.replace(/\D/g,'');
  // Número escrito com pontos e traços, mas sem os zeros iniciais do sequencial: o formato
  // diz onde cada parte começa; o dígito verificador confirma logo abaixo.
  const m=bruto.match(/(\d{1,7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})/);
  if(m&&d.length<20)d=m[1].padStart(7,'0')+m[2]+m[3]+m[4]+m[5]+m[6];
  if(d.length!==20)return{bruto,problema:'não tem os 20 dígitos do número CNJ'};
  if(!cnjValid(d))return{bruto,problema:'dígito verificador não confere (deveria ser '+cnjCheckDigits(d)+')'};
  const sigla=tribunalFromCnj(d);
  if(!sigla)return{bruto,problema:'o número não aponta para um tribunal conhecido'};
  return{cnj:d,sigla};
}
// Números CNJ que aparecem no campo "número" de um processo, inclusive sem os zeros iniciais ou
// depois de um texto ("Proc. 0001234-…"). Serve só para NÃO duplicar: na dúvida, a linha da
// planilha fica de fora e o titular confere.
const CNJ_SOLTO=/(?<!\d)(\d{1,7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})(?!\d)/g;
function cnjsParecidos(valor){
  const out=new Set();
  for(const m of String(valor||'').matchAll(CNJ_SOLTO)){
    const d=m[1].padStart(7,'0')+m[2]+m[3]+m[4]+m[5]+m[6];
    if(cnjValid(d))out.add(d);
  }
  return out;
}
function statusDaPlanilha(v){return /arquiv|baixad|encerr|finaliz|extint|transitad/.test(norm(v))?'ARQUIVADO':'ATIVO'}

// Celular brasileiro (DDD + 9 + oito dígitos, com ou sem 55 ou 0 na frente). Na mesma célula
// com mais de um número, fica o primeiro celular. Fixo, número estrangeiro ou sequência sem
// formato de telefone não vira destino de mensagem.
function celularDaPlanilha(v){
  for(const parte of String(v||'').split(/[/;,|]|\s+e\s+|\s+ou\s+/i)){
    let d=parte.replace(/\D/g,'');
    if(/^55\d{11}$/.test(d))d=d.slice(2);
    else if(/^0\d{11}$/.test(d))d=d.slice(1);
    if(/^[1-9][1-9]9\d{8}$/.test(d))return'55'+d;
  }
  return null;
}

function analisar(leitura,processosAtuais=[]){
  const linhas=leitura.linhas||[];
  const m=mapear(linhas);
  if(!m)return{ok:false,motivo:'Não achei a coluna com o número dos processos. A planilha precisa ter uma coluna com o número CNJ (com ou sem pontos e traços).'};
  const existentes=new Map(),parecidos=new Map();
  for(const p of processosAtuais){
    for(const c of processCnjs(p?.numero))existentes.set(c,p);
    for(const c of cnjsParecidos(p?.numero))if(!parecidos.has(c))parecidos.set(c,p);
  }
  const novos=[],jaExistem=[],repetidos=[],problemas=[],semNumero=[],duvidas=[];
  const vistos=new Map(),whatsapp={ligados:0,descartados:0};
  let total=0;
  for(let i=m.cabecalho+1;i<linhas.length;i++){
    const l=linhas[i]||[];
    if(!l.some(c=>c?.valor))continue;
    total++;
    if(total>MAX_LINHAS)break;
    const linha=i+1;
    const get=campo=>m.mapa[campo]!=null?String(l[m.mapa[campo]]?.valor||'').trim().slice(0,300):'';
    const r=lerCnj(l[m.mapa.cnj]);
    if(r.vazio){semNumero.push({linha,cliente:get('cliente')||null});continue}
    if(r.problema){problemas.push({linha,valor:r.bruto.slice(0,40),motivo:r.problema});continue}
    if(existentes.has(r.cnj)){const p=existentes.get(r.cnj);jaExistem.push({linha,numero:formatCnj(r.cnj),processo:p.nome||p.numero||String(p.id)});continue}
    if(parecidos.has(r.cnj)){const p=parecidos.get(r.cnj);duvidas.push({linha,numero:formatCnj(r.cnj),processo:String(p.nome||p.numero||p.id).slice(0,120),numero_no_lex:String(p.numero||'').slice(0,80)});continue}
    if(vistos.has(r.cnj)){repetidos.push({linha,numero:formatCnj(r.cnj),primeira_linha:vistos.get(r.cnj)});continue}
    vistos.set(r.cnj,linha);
    const fone=get('whatsapp'),celular=fone?celularDaPlanilha(fone):null;
    if(celular)whatsapp.ligados++;else if(fone)whatsapp.descartados++;
    novos.push({linha,cnj:r.cnj,sigla:r.sigla,campos:{cliente:get('cliente'),partes:get('partes'),area:get('area'),responsavel:get('responsavel'),
      whatsapp:celular,tribunal:get('tribunal'),status:get('status'),observacao:get('observacao')}});
  }
  return{ok:true,colunas:m.colunas,total_linhas:Math.min(total,MAX_LINHAS),cortou:total>MAX_LINHAS,novos,ja_existem:jaExistem,repetidos,problemas,sem_numero:semNumero,
    possiveis_duplicados:duvidas,whatsapp:'whatsapp' in m.mapa?whatsapp:null};
}

// O que a importação grava em cada processo. A impressão digital (importacao_sha) desses campos
// deixa o "desfazer" saber, sem adivinhar, se alguém mexeu no processo depois.
const CHAVES_DA_IMPORTACAO=new Set(['id','numero','tribunal','vara','nome','cliente','partes','area','responsavel','cliente_whatsapp','cliente_whatsapp_fonte',
  'descricao','status','status_planilha','tipo','setor','andamentos','origem_cadastro','importacao_id','importacao_linha','cadastrado_em','cadastro_conferido','importacao_sha']);
function camposImportados(p){
  const o={};
  for(const k of CHAVES_DA_IMPORTACAO)if(k!=='andamentos'&&k!=='importacao_sha')o[k]=p?.[k]??null;
  return o;
}
function processoDaLinha(item,{importacaoId,agora}){
  const c=item.campos||{};
  const numero=formatCnj(item.cnj);
  const p={
    id:'imp-'+hash(item.cnj).slice(0,16),numero,tribunal:item.sigla,vara:c.tribunal||null,
    nome:c.partes||c.cliente||('Processo '+numero),cliente:c.cliente||null,partes:c.partes||null,area:c.area||null,
    responsavel:c.responsavel||null,cliente_whatsapp:c.whatsapp||null,descricao:c.observacao||null,
    status:statusDaPlanilha(c.status),status_planilha:c.status||null,tipo:'judicial',setor:'judicial',andamentos:[],
    origem_cadastro:'importacao',importacao_id:importacaoId,importacao_linha:item.linha,
    cadastrado_em:agora,cadastro_conferido:'sem_conferencia'
  };
  if(p.cliente_whatsapp)p.cliente_whatsapp_fonte='planilha';
  p.importacao_sha=hash(JSON.stringify(camposImportados(p)));
  return p;
}

// Leitura do Datajud volta sozinha na próxima consulta: não conta como trabalho. Publicação do
// Diário, leitura do PJe, prazo e qualquer anotação contam (podem ser a única cópia).
const LEITURA_DATAJUD=new Set(['court_readings','datajud_atualizado_em','last_court_sync_at','last_court_sync_source','datajud_alias','atualizado_em']);
function soDatajud(andamentos){
  return(Array.isArray(andamentos)?andamentos:[]).every(a=>String(a?.origem||'').toLowerCase()==='datajud'||/^\s*\[DATAJUD\]/i.test(String(a?.txt||a?.texto||'')));
}
function vazio(v){return v==null||v===''||(Array.isArray(v)&&!v.length)||(typeof v==='object'&&!Array.isArray(v)&&!Object.keys(v).length)}
function trabalhado(p){
  if(!p?.importacao_sha)return true; // sem impressão digital, não há como provar que ninguém mexeu
  if(!soDatajud(p.andamentos))return true;
  if(hash(JSON.stringify(camposImportados(p)))!==p.importacao_sha)return true;
  return Object.keys(p).some(k=>!CHAVES_DA_IMPORTACAO.has(k)&&!LEITURA_DATAJUD.has(k)&&!vazio(p[k]));
}

// ---------------------------------------------------------------------
// Fluxo: ler → conversar → importar → (desfazer)
// ---------------------------------------------------------------------
function createCarteiraImport({records,processStore,now=()=>Date.now(),log=()=>{},leituraAutomatica=null}={}){
  if(!records?.read||!records?.change||!records?.list)throw new Error('Importação de carteira exige RecordStore persistente.');
  if(!processStore?.read||!processStore?.mutate)throw new Error('Importação de carteira exige a carteira de processos.');
  const iso=()=>new Date(now()).toISOString();

  async function ler(id){return id?(await records.read(PREFIXO+id))?.value||null:null}
  // A mais recente pelo momento do fato: importada pela data da importação, as outras pela leitura.
  async function maisRecente(status){
    const rows=(await records.list(PREFIXO)||[]).filter(r=>r&&r.id&&(!status||r.status===status));
    const quando=r=>String(r.status==='importado'?(r.importado_em||r.criado_em):r.criado_em);
    return rows.sort((a,b)=>quando(b).localeCompare(quando(a)))[0]||null;
  }
  // Listas com nomes de clientes não ficam guardadas em planilha que não vai ser importada.
  const SEM_LISTAS={novos:undefined,ja_existem:[],repetidos:[],problemas:[],sem_numero:[],possiveis_duplicados:[]};
  async function pendente(){return (await records.read(PENDENTE))?.value||null}
  async function soltarPendente(id){await records.change(PENDENTE,x=>x&&x.id===id?null:undefined)}
  // Ordem de importar que caiu no meio (reinício do servidor): depois de 10 minutos pode ser retomada.
  const parada=r=>r?.status==='importando'&&now()-Date.parse(r.importando_desde||0)>IMPORTANDO_MS;

  async function receber({buffer,nome='planilha',perfil}={}){
    if(!PODE.has(String(perfil||'')))return{ok:false,erro:'Só advogado ou administrador importa carteira.'};
    const id=hash(buffer||Buffer.alloc(0)).slice(0,12);
    const anterior=await ler(id);
    if(anterior&&anterior.status==='importado')return{ok:true,id,ja_importada:true,resumo:anterior.resumo,texto:'Essa mesma planilha já foi importada em '+new Date(anterior.importado_em).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})+' ('+anterior.resumo.criados+' processos). Nada foi feito de novo.'};
    if(anterior&&anterior.status==='importando'&&!parada(anterior))return{ok:true,id,em_andamento:true,texto:'Essa planilha está sendo importada agora. Em instantes os processos aparecem na carteira.'};
    let leitura;
    try{leitura=await lerPlanilha(buffer,nome)}catch(e){return{ok:false,erro:e.message}}
    const atuais=(await processStore.read())?.processes||[];
    const a=analisar(leitura,atuais);
    if(!a.ok)return{ok:false,erro:a.motivo};
    const resumo={linhas:a.total_linhas,novos:a.novos.length,ja_existem:a.ja_existem.length,repetidos:a.repetidos.length,com_problema:a.problemas.length,sem_numero:a.sem_numero.length,
      possiveis_duplicados:a.possiveis_duplicados.length,cortou:a.cortou,whatsapp:a.whatsapp};
    // A mesma planilha mandada de novo depois de desfeita ou descartada: lê de novo, guardando o que houve antes.
    const historico=anterior?[...(anterior.historico||[]),{status:anterior.status,criado_em:anterior.criado_em||null,importado_em:anterior.importado_em||null,
      desfeito_em:anterior.desfeito_em||null,descartado_em:anterior.descartado_em||null,removidos:anterior.removidos??null}].slice(-10):[];
    const registro={id,nome:nomeSeguro(nome)||'planilha',formato:leitura.formato,aba:leitura.aba,colunas:a.colunas,status:'aguardando_ordem',criado_em:iso(),criado_por:String(perfil),
      resumo,novos:a.novos,ja_existem:a.ja_existem.slice(0,200),repetidos:a.repetidos.slice(0,200),problemas:a.problemas.slice(0,300),sem_numero:a.sem_numero.slice(0,300),
      possiveis_duplicados:a.possiveis_duplicados.slice(0,200),historico};
    await records.change(PREFIXO+id,()=>registro);
    if(resumo.novos){
      // A planilha nova substitui a que esperava a ordem: só a mais recente pode ser importada.
      const antes=await pendente();
      if(antes?.id&&antes.id!==id)await records.change(PREFIXO+antes.id,x=>x&&x.status==='aguardando_ordem'?{...x,...SEM_LISTAS,status:'substituida',substituida_por:id,substituida_em:iso()}:undefined);
      await records.change(PENDENTE,()=>({id,nome:registro.nome,criado_em:registro.criado_em,resumo}));
    }else await soltarPendente(id);
    return{ok:true,id,resumo,colunas:a.colunas,problemas:a.problemas.slice(0,8),ja_existem:a.ja_existem.slice(0,5),sem_numero:a.sem_numero.slice(0,5),texto:textoDoResumo(registro)};
  }

  // Só promete leitura automática no tribunal quando ela está ligada neste servidor.
  function linhaDaLeitura(){
    let auto=null;
    try{auto=typeof leituraAutomatica==='function'?leituraAutomatica()===true:null}catch{auto=null}
    if(auto===true)return'Os processos entram como "a conferir" e passam pela leitura diária do tribunal (Datajud), que traz os andamentos.';
    if(auto===false)return'Os processos entram como "a conferir". A leitura automática no tribunal depende da chave do Datajud, que não está configurada; até lá, ficam com o que a planilha trouxe.';
    return'Os processos entram como "a conferir" até a leitura no tribunal.';
  }
  function textoDoResumo(r){
    const s=r.resumo,L=[];
    L.push('Li a planilha "'+r.nome+'"'+(r.aba?' (aba '+r.aba+')':'')+': '+s.linhas+' linha'+(s.linhas===1?'':'s')+' com dados.');
    const partes=[s.novos+' processo'+(s.novos===1?' novo':'s novos')];
    if(s.ja_existem)partes.push(s.ja_existem+' já '+(s.ja_existem===1?'está':'estão')+' no LEX');
    if(s.repetidos)partes.push(s.repetidos+' repetido'+(s.repetidos===1?'':'s')+' na própria planilha');
    if(s.com_problema)partes.push(s.com_problema+' com número com problema');
    if(s.sem_numero)partes.push(s.sem_numero+' sem número de processo');
    L.push(partes.join(', ')+'.');
    if(s.possiveis_duplicados){
      const d=r.possiveis_duplicados||[];
      L.push((s.possiveis_duplicados===1?'1 parece já estar no LEX com o número escrito de outro jeito':s.possiveis_duplicados+' parecem já estar no LEX com o número escrito de outro jeito')+
        ' (não importo, para não duplicar; se for outro processo, cadastre pelo número): '+d.slice(0,3).map(x=>'linha '+x.linha+' → "'+x.processo+'"').join('; ')+(d.length>3?'; e mais '+(d.length-3):'')+'.');
    }
    if(s.com_problema){
      L.push('Com problema: '+r.problemas.slice(0,4).map(p=>'linha '+p.linha+' ('+p.motivo+')').join('; ')+(s.com_problema>4?'; e mais '+(s.com_problema-4):'')+'.');
    }
    const achadas=Object.keys(r.colunas||{}).filter(k=>k!=='cnj');
    L.push('Colunas que usei: número'+(achadas.length?', '+achadas.map(k=>({cliente:'cliente',whatsapp:'WhatsApp do cliente',partes:'partes',area:'área',responsavel:'responsável',tribunal:'vara/comarca',status:'situação',observacao:'observações'}[k]||k)).join(', '):'')+'.');
    const w=s.whatsapp;
    if(w&&(w.ligados||w.descartados)){
      const lig=w.ligados===0?'nenhum celular reconhecido':w.ligados===1?'1 celular ligado ao processo':w.ligados+' celulares ligados aos processos';
      const fora=!w.descartados?'':w.descartados===1?'; 1 número que não parece celular ficou de fora':'; '+w.descartados+' números que não parecem celular ficaram de fora';
      L.push('WhatsApp: '+lig+fora+'.');
    }
    if(s.cortou)L.push('A planilha passou de '+MAX_LINHAS+' linhas; li só as primeiras '+MAX_LINHAS+'. Mande o resto em outro arquivo.');
    if(s.novos){L.push(linhaDaLeitura());L.push('Posso importar os '+s.novos+'? (é só dizer "pode importar")')}
    else L.push('Não há processo novo para importar.');
    return L.join('\n');
  }

  async function importar({id,perfil}={}){
    if(!PODE.has(String(perfil||'')))return{ok:false,erro:'Só advogado ou administrador importa carteira.'};
    // Só a planilha que espera a ordem (ou uma indicada pelo código). Nunca uma antiga "por sobra".
    const alvo=id||(await pendente())?.id;
    if(!alvo){
      const ultima=await maisRecente('importado');
      if(ultima)return{ok:true,ja_importada:true,id:ultima.id,resumo:ultima.resumo,texto:'A última planilha ("'+ultima.nome+'") já foi importada ('+ultima.resumo.criados+' processos). Não há outra esperando.'};
      return{ok:false,erro:'Não há planilha esperando importação. Mande o arquivo primeiro.'};
    }
    // A ordem "pega" a planilha antes de gravar: duas ordens ao mesmo tempo não importam duas vezes.
    const agora=iso();let r=null,situacao=null;
    await records.change(PREFIXO+alvo,x=>{
      r=x;situacao=null;
      if(!x){situacao='sem';return undefined}
      if((x.status==='aguardando_ordem'||parada(x))&&now()-Date.parse(x.criado_em)>PRAZO_ORDEM_MS){situacao='velha';return undefined}
      if(x.status==='aguardando_ordem'||parada(x))return{...x,status:'importando',importando_desde:agora,importando_por:String(perfil)};
      situacao=x.status;return undefined;
    });
    if(situacao==='sem')return{ok:false,erro:'Não há planilha esperando importação. Mande o arquivo primeiro.'};
    if(situacao==='velha')return{ok:false,erro:'Essa planilha foi lida há mais de 7 dias e a carteira mudou desde então. Mande o arquivo de novo para eu conferir com a carteira de hoje.'};
    if(situacao==='importado')return{ok:true,ja_importada:true,id:r.id,resumo:r.resumo,texto:'Essa planilha já foi importada ('+r.resumo.criados+' processos).'};
    if(situacao==='importando')return{ok:true,em_andamento:true,id:r.id,texto:'Essa planilha já está sendo importada agora (a outra ordem chegou primeiro). Em instantes os processos aparecem na carteira.'};
    if(situacao)return{ok:false,erro:'Essa importação está como "'+situacao+'". Mande a planilha de novo se quiser importar.'};
    let criados=[],pulados=0;
    try{
      await processStore.mutate(ps=>{
        criados=[];pulados=0;
        const ja=new Set();for(const p of ps){for(const c of processCnjs(p?.numero))ja.add(c);for(const c of cnjsParecidos(p?.numero))ja.add(c)}
        const ids=new Set(ps.map(p=>String(p?.id)));
        for(const item of r.novos||[]){
          if(ja.has(item.cnj)){pulados++;continue} // entrou por outro caminho depois da leitura
          const p=processoDaLinha(item,{importacaoId:r.id,agora});
          if(ids.has(String(p.id))){pulados++;continue}
          ps.push(p);ja.add(item.cnj);ids.add(String(p.id));criados.push(p.id);
        }
        return criados.length;
      },perfil);
    }catch(e){
      // A carteira grava tudo ou nada: a planilha volta a esperar a ordem.
      await records.change(PREFIXO+r.id,x=>x&&x.status==='importando'?{...x,status:'aguardando_ordem',importando_desde:null,ultimo_erro:String(e?.message||e).slice(0,200)}:undefined);
      return{ok:false,erro:'Não consegui gravar a importação agora ('+String(e?.message||e).slice(0,120)+'). Nada foi gravado; pode pedir de novo.'};
    }
    const resumo={...r.resumo,criados:criados.length,pulados_na_hora:pulados};
    await records.change(PREFIXO+r.id,x=>x?{...x,status:'importado',importado_em:agora,importado_por:String(perfil),importando_desde:null,criados,resumo,novos:undefined}:undefined);
    await soltarPendente(r.id);
    log('[Carteira] importação '+r.id+': '+criados.length+' processos criados');
    return{ok:true,id:r.id,resumo,texto:'Importei '+criados.length+' processo'+(criados.length===1?'':'s')+' da planilha "'+r.nome+'"'+(pulados?' ('+pulados+' já tinha'+(pulados===1?'':'m')+' entrado por outro caminho)':'')+'. Eles aparecem como "a conferir" até a leitura no tribunal. Se precisar, eu desfaço a importação: sai só o que ninguém mexeu.'};
  }

  // tarefas: a lista do Task Engine (as mais recentes, até 100). Sem ela, ou se ela pode ter
  // deixado de fora tarefa criada depois da importação, não se apaga nada.
  async function desfazer({id,perfil,tarefas}={}){
    if(!PODE.has(String(perfil||'')))return{ok:false,erro:'Só advogado ou administrador desfaz importação.'};
    const r=id?await ler(id):await maisRecente('importado');
    if(!r||r.status!=='importado')return{ok:false,erro:'Não achei importação feita para desfazer.'};
    if(!Array.isArray(tarefas))return{ok:false,erro:'Não consegui conferir as tarefas do escritório agora, então não desfiz nada. Tente de novo em instantes.'};
    const desde=Date.parse(r.importado_em||r.criado_em);
    // Toda gravação do Task Engine deixa um destes carimbos (criar, iniciar, terminar, revisar,
    // devolver, recuperar, retomar): a tarefa mais "velha" da lista mostra até onde ela alcança.
    const quando=t=>Math.max(...['criada_em','iniciada_em','atualizada_em','revisado_em','devolvido_em','recuperada_em','retomada_em'].map(k=>Date.parse(t?.[k])||0));
    if(tarefas.length>=100&&!tarefas.some(t=>quando(t)<desde))
      return{ok:false,erro:'Desde a importação já houve muitas tarefas no escritório e eu não consigo conferir todas de uma vez; para não apagar processo com trabalho, não desfiz nada. Posso listar os processos dessa importação para você decidir.'};
    const comTarefa=new Set(tarefas.map(t=>String(t?.processo_id)));
    let removidos=0,mantidos=[];
    await processStore.mutate(ps=>{
      removidos=0;mantidos=[];
      for(let i=ps.length-1;i>=0;i--){
        const p=ps[i];
        if(p?.importacao_id!==r.id)continue;
        if(trabalhado(p)||comTarefa.has(String(p.id))){mantidos.push(p.nome||p.numero);continue}
        ps.splice(i,1);removidos++;
      }
      return removidos;
    },perfil);
    await records.change(PREFIXO+r.id,x=>x?{...x,status:'desfeito',desfeito_em:iso(),desfeito_por:String(perfil),removidos,mantidos:mantidos.slice(0,100)}:undefined);
    return{ok:true,id:r.id,removidos,mantidos:mantidos.length,
      texto:'Desfiz a importação de "'+r.nome+'": removi '+removidos+' processo'+(removidos===1?'':'s')+'.'+(mantidos.length?' Mantive '+mantidos.length+' em que já houve trabalho ou informação nova (tarefa, documento, prazo, publicação, honorário, anotação ou dado alterado): '+mantidos.slice(0,5).join('; ')+(mantidos.length>5?'…':'')+'.':'')};
  }

  async function descartar({id,perfil}={}){
    if(!PODE.has(String(perfil||'')))return{ok:false,erro:'Só advogado ou administrador decide sobre importação.'};
    const alvo=id||(await pendente())?.id||(await maisRecente('aguardando_ordem'))?.id;
    const r=alvo?await ler(alvo):null;
    if(!r||r.status!=='aguardando_ordem')return{ok:false,erro:'Não há planilha esperando importação.'};
    await records.change(PREFIXO+r.id,x=>x&&x.status==='aguardando_ordem'?{...x,...SEM_LISTAS,status:'descartado',descartado_em:iso()}:undefined);
    await soltarPendente(r.id);
    return{ok:true,texto:'Combinado: não importei a planilha "'+r.nome+'".'};
  }

  // "Cancela a importação": com planilha esperando, é não importar; depois de importada, é
  // ambíguo (desfazer apaga processos) — então pergunta, em vez de escolher.
  async function cancelar({perfil}={}){
    if(!PODE.has(String(perfil||'')))return{ok:false,erro:'Só advogado ou administrador decide sobre importação.'};
    const p=await pendente();
    if(p?.id)return descartar({id:p.id,perfil});
    const ultima=await maisRecente('importado');
    if(ultima)return{ok:true,pergunta:true,texto:'Não há planilha esperando. Quer desfazer a importação de "'+ultima.nome+'" ('+ultima.resumo.criados+' processos, em '+new Date(ultima.importado_em).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})+')? Se sim, diga "desfazer a importação": sai só o que ninguém mexeu.'};
    return{ok:false,erro:'Não há planilha esperando nem importação feita.'};
  }

  async function ver({id}={}){
    const alvo=id||(await pendente())?.id;
    const r=alvo?await ler(alvo):await maisRecente();
    if(!r)return{ok:false,erro:'Nenhuma planilha recebida.'};
    return{ok:true,id:r.id,nome:r.nome,status:r.status,resumo:r.resumo,colunas:r.colunas,problemas:(r.problemas||[]).slice(0,30),ja_existem:(r.ja_existem||[]).slice(0,30),
      possiveis_duplicados:(r.possiveis_duplicados||[]).slice(0,30),
      repetidos:(r.repetidos||[]).slice(0,30),sem_numero:(r.sem_numero||[]).slice(0,30),novos_amostra:(r.novos||[]).slice(0,10).map(n=>({linha:n.linha,numero:formatCnj(n.cnj),cliente:n.campos?.cliente||null}))};
  }

  // Lê só o registro pequeno da planilha pendente (a conversa chama isto a cada mensagem).
  async function contextoParaIA(){
    const p=await pendente();
    if(!p?.id)return null;
    if(now()-Date.parse(p.criado_em)>7*86400000)return null;
    const s=p.resumo||{};
    return 'PLANILHA ESPERANDO A ORDEM DO TITULAR: "'+p.nome+'" (importação '+p.id+') — '+Number(s.novos||0)+' processos novos, '+Number(s.ja_existem||0)+' já no LEX, '+Number(s.com_problema||0)+' com problema. Se ele mandar importar respondendo ao resumo da planilha, chame importacao_de_carteira com acao "importar" (um "pode" solto só vale se a última pergunta foi a da planilha; na dúvida, pergunte); para detalhes, acao "ver"; se ele não quiser, acao "descartar".';
  }

  return{receber,importar,desfazer,descartar,cancelar,ver,contextoParaIA};
}

let atual=null;
function configureCarteiraImport(deps){atual=createCarteiraImport(deps);return atual}
function current(){return atual}

module.exports={createCarteiraImport,configureCarteiraImport,current,lerPlanilha,analisar,ehPlanilha,lerCnj,mapear,campoDoCabecalho,PREFIXO};
