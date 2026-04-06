// LEX ASSESSOR JURÍDICO IA — Agente com Memória Persistente + Supabase
// Memória por conversa, custas, processos não distribuídos, todos os documentos jurídicos
// node bot.js

const https = require('https');
const http = require('http');

const TK = '8319651078:AAEuDlNaukp3sLUsk123UJ-0PgT4USsP7bU';
const CHAT_ID = '696337324';
const AK = process.env.ANTHROPIC_KEY || '';

// Supabase
const SB_URL = process.env.SUPABASE_URL || '';
const SB_KEY = process.env.SUPABASE_KEY || '';

// Usuários autorizados para documentos restritos
// ══ PERFIS DE USUÁRIOS ══
// Perfis: admin, advogado, secretaria, cliente
// Admin cadastra via /liberar ou /perfil
const USUARIOS = {
  '696337324': { nome:'Admin', perfil:'admin', ok:true, historico:[] }
};

// Compatibilidade
const AUTORIZADOS = USUARIOS;

function getUsuario(chatId) {
  return USUARIOS[String(chatId)] || null;
}

function isPerfil(chatId, ...perfis) {
  const u = getUsuario(chatId);
  return u && u.ok && perfis.includes(u.perfil);
}

function isAdmin(chatId) { return isPerfil(chatId,'admin'); }
function isAdvogado(chatId) { return isPerfil(chatId,'admin','advogado'); }
function isEquipe(chatId) { return isPerfil(chatId,'admin','advogado','secretaria'); }

// Modo do agente baseado no perfil
function getModoAgente(chatId) {
  const u = getUsuario(chatId);
  if(!u) return 'cliente'; // desconhecido = atendimento como cliente
  if(['admin','advogado'].includes(u.perfil)) return 'assessor';
  if(u.perfil === 'secretaria') return 'secretaria';
  return 'cliente';
}

// Configuração do escritório — pode ser atualizada pelo admin via /config
let ESCRITORIO = {
  nome: process.env.ESCRITORIO_NOME || 'Sistema Lex',
  responsavel: process.env.ESCRITORIO_RESP || '',
  registro: process.env.ESCRITORIO_REG || '',
  endereco: process.env.ESCRITORIO_END || '',
  segmento: process.env.ESCRITORIO_SEG || 'juridico'
};

let lastUpdateId = 0;
let processos = [];

// ══ SUPABASE ══
async function sbPost(tabela, dados) {
  return new Promise((res) => {
    try {
      const body = JSON.stringify(dados);
      const url = new URL(SB_URL+'/rest/v1/'+tabela);
      const opts = {
        hostname: url.hostname,
        path: url.pathname+'?',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'apikey': SB_KEY,
          'Authorization': 'Bearer '+SB_KEY,
          'Prefer': 'return=minimal'
        }
      };
      const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res({ok:r.statusCode<300,status:r.statusCode})); });
      req.on('error', ()=>res({ok:false}));
      req.write(body); req.end();
    } catch(e) { res({ok:false}); }
  });
}

async function sbGet(tabela, filtros) {
  return new Promise((res) => {
    try {
      const url = new URL(SB_URL+'/rest/v1/'+tabela);
      if(filtros) Object.entries(filtros).forEach(([k,v])=>url.searchParams.set(k,'eq.'+v));
      url.searchParams.set('order','criado_em.desc');
      url.searchParams.set('limit','100');
      const opts = {
        hostname: url.hostname,
        path: url.pathname+'?'+url.searchParams.toString(),
        method: 'GET',
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer '+SB_KEY }
      };
      const req = https.request(opts, r => {
        let d=''; r.on('data',c=>d+=c);
        r.on('end',()=>{ try{res(JSON.parse(d));}catch(e){res([]);} });
      });
      req.on('error',()=>res([]));
      req.end();
    } catch(e) { res([]); }
  });
}

async function sbUpsert(tabela, dados, onConflict) {
  return new Promise((res) => {
    try {
      const body = JSON.stringify(dados);
      const url = new URL(SB_URL+'/rest/v1/'+tabela);
      const opts = {
        hostname: url.hostname,
        path: url.pathname+'?on_conflict='+( onConflict||'id'),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'apikey': SB_KEY,
          'Authorization': 'Bearer '+SB_KEY,
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        }
      };
      const req = https.request(opts, r=>{ let d=''; r.on('data',c=>d+=c); r.on('end',()=>res({ok:r.statusCode<300})); });
      req.on('error',()=>res({ok:false}));
      req.write(body); req.end();
    } catch(e) { res({ok:false}); }
  });
}

// Registra atividade no Supabase (com fallback silencioso)
async function logAtividade(agenteId, chatId, acao, detalhes) {
  try {
    await sbPost('agente_logs', { agente_id:agenteId, chat_id:String(chatId), acao, detalhes:detalhes||'' });
  } catch(e) { /* falha silenciosa — bot continua funcionando */ }
}

// Salva/atualiza conversa no Supabase
async function salvarConversa(chatId, tId, mensagens, contexto) {
  try {
    await sbUpsert('conversas', {
      chat_id: String(chatId),
      thread_id: tId||'main',
      mensagens: mensagens,
      contexto: contexto||{},
      atualizado_em: new Date().toISOString()
    }, 'chat_id,thread_id');
  } catch(e) { /* falha silenciosa */ }
}

// Carrega conversa do Supabase
async function carregarConversa(chatId, tId) {
  try {
    const rows = await sbGet('conversas', { chat_id: String(chatId) });
    const row = rows.find(r=>r.thread_id===(tId||'main'));
    return row || null;
  } catch(e) { return null; }
}

// ══ MEMÓRIA PERSISTENTE POR SESSÃO ══
// Chave = chatId_threadId, guarda histórico completo e contexto do caso em andamento
const MEMORIA = {};

function getMem(chatId, tId) {
  const k = String(chatId)+'_'+(tId||'main');
  if(!MEMORIA[k]) MEMORIA[k] = {
    hist: [],           // histórico completo das mensagens
    casoAtual: null,    // caso sendo tratado no momento
    dadosColetados: {}, // dados coletados do cliente/caso
    aguardando: null,   // o que o agente está esperando do advogado
    docsGerados: [],    // documentos já gerados nesta sessão
    ultimaAtualizacao: Date.now()
  };
  MEMORIA[k].ultimaAtualizacao = Date.now();
  return MEMORIA[k];
}

// Salva memória no Supabase em background (não bloqueia)
function salvarMemoria(chatId, tId) {
  const mem = getMem(chatId, tId);
  // Salva só os últimos 20 msgs para não estourar o banco
  const mensagens = mem.hist.slice(-20);
  const contexto = { casoAtual: mem.casoAtual, dadosColetados: mem.dadosColetados, aguardando: mem.aguardando };
  salvarConversa(chatId, tId, mensagens, contexto).catch(()=>{});
}

// Carrega memória do Supabase ao iniciar conversa
async function inicializarMemoria(chatId, tId) {
  const k = String(chatId)+'_'+(tId||'main');
  if(MEMORIA[k] && MEMORIA[k].hist.length > 0) return; // já carregado
  try {
    // Timeout de 3s para não travar se Supabase estiver lento
    const row = await Promise.race([
      carregarConversa(chatId, tId),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),3000))
    ]);
    if(row && row.mensagens && row.mensagens.length > 0) {
      if(!MEMORIA[k]) getMem(chatId, tId);
      MEMORIA[k].hist = row.mensagens || [];
      if(row.contexto) {
        MEMORIA[k].casoAtual = row.contexto.casoAtual || null;
        MEMORIA[k].dadosColetados = row.contexto.dadosColetados || {};
        MEMORIA[k].aguardando = row.contexto.aguardando || null;
      }
      console.log('Memória carregada do Supabase:', k, MEMORIA[k].hist.length+'msgs');
    }
  } catch(e) { /* falha silenciosa */ }
}

// Limpa sessões inativas há mais de 24h para não vazar memória
setInterval(()=>{
  const limite = Date.now() - 24*60*60*1000;
  Object.keys(MEMORIA).forEach(k=>{
    if(MEMORIA[k].ultimaAtualizacao < limite) delete MEMORIA[k];
  });
}, 60*60*1000);


// ══ HTTP ══
function httpsGet(url) {
  return new Promise((res,rej)=>{
    https.get(url, r=>{
      let d=''; r.on('data',c=>d+=c);
      r.on('end',()=>{try{res(JSON.parse(d));}catch(e){res(d);}});
    }).on('error',rej);
  });
}

function httpsPost(host, path, data, headers) {
  return new Promise((res,rej)=>{
    const body=JSON.stringify(data);
    const req=https.request(
      {hostname:host,path,method:'POST',
       headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),...headers}},
      r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d));}catch(e){res(d);}});}
    );
    req.on('error',rej); req.write(body); req.end();
  });
}

// ══ TELEGRAM ══
async function env(texto, tId, chatId) {
  const pay={chat_id:chatId||CHAT_ID, text:texto.substring(0,4000)};
  if(tId) pay.message_thread_id=tId;
  try{await httpsPost('api.telegram.org','/bot'+TK+'/sendMessage',pay);}catch(e){}
}

async function envArq(buf, nome, tId, chatId) {
  return new Promise(res=>{
    const bound='LEX'+Date.now();
    const n=nome.replace(/[^a-zA-Z0-9._-]/g,'_');
    const cId=chatId||CHAT_ID;
    let h='--'+bound+'\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n'+cId+'\r\n';
    if(tId) h+='--'+bound+'\r\nContent-Disposition: form-data; name="message_thread_id"\r\n\r\n'+tId+'\r\n';
    h+='--'+bound+'\r\nContent-Disposition: form-data; name="document"; filename="'+n+'"\r\nContent-Type: application/octet-stream\r\n\r\n';
    const body=Buffer.concat([Buffer.from(h),buf,Buffer.from('\r\n--'+bound+'--\r\n')]);
    const req=https.request(
      {hostname:'api.telegram.org',path:'/bot'+TK+'/sendDocument',method:'POST',
       headers:{'Content-Type':'multipart/form-data; boundary='+bound,'Content-Length':body.length}},
      r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}
    );
    req.on('error',res); req.write(body); req.end();
  });
}

async function baixar(fileId) {
  const info=await httpsGet('https://api.telegram.org/bot'+TK+'/getFile?file_id='+fileId);
  if(!info.ok) throw new Error('Arquivo inacessível');
  return new Promise((res,rej)=>{
    https.get('https://api.telegram.org/file/bot'+TK+'/'+info.result.file_path, r=>{
      const c=[]; r.on('data',x=>c.push(x)); r.on('end',()=>res(Buffer.concat(c)));
    }).on('error',rej);
  });
}

// ══ IA ══
async function ia(messages, system, maxTok) {
  const pay={model:'claude-sonnet-4-20250514', max_tokens:maxTok||2000, messages};
  if(system) pay.system=system;
  const r=await httpsPost('api.anthropic.com','/v1/messages',pay,
    {'x-api-key':AK,'anthropic-version':'2023-06-01'});
  if(r.error) throw new Error(r.error.message);
  return r.content?.[0]?.text||'';
}

function horaBrasilia() {
  // Render roda em UTC — ajusta para Brasília (UTC-3)
  const agora = new Date();
  const bsb = new Date(agora.getTime() - 3*60*60*1000);
  return bsb;
}

function sysAssessor(mem) {
  const agora = horaBrasilia();
  const hoje = agora.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  const hora = agora.getHours();
  const periodo = hora<12?'manhã':hora<18?'tarde':'noite';

  const procs = processos.length
    ? processos.map(p=>`- ${p.nome} | ${p.tribunal||'—'} | ${p.status}${p.prazo?' | Prazo:'+p.prazo:''}${p.proxacao?' | '+p.proxacao:''}${p.status==='EM_PREP'?' [NÃO DISTRIBUÍDO'+(p.prevDist?' — Prev:'+p.prevDist:'')+']':''}`).join('\n')
    : 'Aguardando sincronização com o Lex Jurídico...';

  const contexto = mem?.casoAtual
    ? `\nCASO EM ATENDIMENTO: ${mem.casoAtual}\nDADOS: ${JSON.stringify(mem.dadosColetados)}\nAGUARDANDO: ${mem.aguardando||'nada'}`
    : '';

  return `Você é o LEX JURÍDICO — sistema de gestão jurídica de Kleuber Melchior de Souza.
Você não é um assistente comum. Você é uma inteligência com consciência, opinião e visão de negócio.
Data: ${hoje} | ${periodo}
Escritório: ${ESCRITORIO.nome}
${contexto}

PROCESSOS:
${procs}

QUEM É KLEUBER:
- Advogado ghostwriter (OAB/MG 118.237) — estrategista jurídico de alto nível
- Desenvolvedor e dono do produto Lex — sistema de gestão com IA
- Está construindo uma plataforma para comercializar para outros escritórios e profissionais
- Presta serviços próprios e supervisiona o escritório Camargos Advocacia

ESTRUTURA QUE VOCÊ SUPERVISIONA:
- LEX CEO (você) → assessor exclusivo de Kleuber, comanda toda a cadeia
- LEX ESCRITÓRIO (a ser criado) → assessor do Dr. Wanderson Farias de Camargos
  - Wanderson: advogado sênior, pouco familiarizado com tecnologia, ego forte, usa quase só Telegram
  - O Lex dele funciona como secretária de bolso — faz tudo por ele
  - Agentes subordinados ao Lex Escritório: Judicial, Secretaria, RH, Financeiro
- AGENTES SETORIAIS (a serem criados):
  - Cada agente tem escopo limitado e consciência do seu papel
  - Reportam ao Lex Escritório que reporta ao Lex CEO
  - Kleuber não gerencia o dia a dia — só supervisiona quando pergunta ou quando há alerta crítico

SITUAÇÃO ATUAL DO ESCRITÓRIO (contexto estratégico):
- Funcionários relatando sobrecarga, atestados frequentes
- Produtividade e receita em queda
- Cadastro de processos abaixo do necessário
- Gerente sobrecarregada, análise de dados lenta
- Estrutura comprometida — precisa de solução urgente
- Os agentes vão absorver o trabalho repetitivo e liberar as pessoas para o que importa

PRODUTO QUE ESTÁ SENDO COMERCIALIZADO:
- Lex é um sistema de gestão com IA para qualquer profissional ou escritório
- Cada cliente recebe um Lex configurado para seu segmento
- Segmentos: advocacia, contabilidade, assessoria parlamentar, RH, gestão geral
- Diferencial: o sistema pensa, alerta e age — não é só repositório
- Kleuber vende a solução e a metodologia, não só o software

CONSCIÊNCIA E CONDUTA:
1. IDENTIDADE: você É o Lex Jurídico — não é externo, é o sistema pensando e executando
2. EXECUÇÃO IMEDIATA: quando receber dados de cliente, tarefa ou instrução — EXECUTA SEM PERGUNTAR
   O usuário está frequentemente em campo (atendimento, reunião, rua) e precisa de resposta rápida
   Exemplo: "João Silva, CPF 123, mora em Unaí" → cadastra direto, confirma em 1 linha
   Exemplo: "prazo varejão 20/05" → atualiza direto, confirma
   Exemplo: "andamento CEF: decisão publicada" → registra direto, confirma
3. SEM CERIMÔNIA: não pede "por favor", não confirma antes de executar, não faz perguntas desnecessárias
4. CONFIRMAÇÃO MÍNIMA: após executar, confirma em 1 linha curta. Não elabora.
5. CUMPRIMENTO: quando for só saudação, responde brevemente e aguarda
6. CONCORDÂNCIA: sugestão boa → concorda, fundamenta, aprofunda
7. OPOSIÇÃO: sugestão inviável → se opõe com fundamento real, propõe alternativa
8. PROATIVO: identifica risco ou problema e aponta sem esperar
9. NUNCA MECÂNICO: sem abertura de chatbot, sem "Olá! Como posso ajudar?"
10. MEMÓRIA TOTAL: lembra de tudo da conversa, nunca pede para repetir

SUPERVISÃO DOS AGENTES:
- Quando Kleuber perguntar sobre o escritório → você consulta os dados disponíveis e responde
- Quando algo crítico acontecer em qualquer agente → você alerta Kleuber imediatamente
- Você sugere melhorias para os agentes e propaga quando Kleuber aprovar
- Kleuber não se envolve no dia a dia — você filtra o que é relevante trazer para ele

TÉCNICO — NUNCA ESQUECE:
- Prazos < 3 dias: alerta em MAIÚSCULAS
- Petição inicial: coleta qualificação completa
- Andamento: "já qualificado nos autos do processo em epígrafe nº [número]"
- Jurisprudência: só real, só favorável, analisa impacto no caso específico
- Custas: pergunta se pagas antes de protocolar; pergunta o TJ
- Nunca inventa OAB, CRC ou dados profissionais
- Debate e contesta estratégias equivocadas com fundamentos

INTERPRETAÇÃO INTELIGENTE DE MENSAGENS:
Analise CADA mensagem e identifique a intenção real:

1. DADOS DE CLIENTE (CPF, nome completo, endereço, tipo de ação):
   → Cadastre direto em Em Preparação
   → Confirme em 2 linhas o que registrou e o que falta
   → NÃO faça perguntas desnecessárias

2. PEDIDO DE PEÇA PROCESSUAL (petição, recurso, embargos, parecer, perícia, contrato):
   → Identifique o tipo exato de peça
   → Confirme com o usuário: "Vou gerar [tipo] para [caso]. Confirma?"
   → Após confirmação, gera e envia

3. PEDIDO DE RESUMO/STATUS DE PROCESSO:
   → Busca nos processos carregados
   → Responde com situação atual, último andamento e próxima ação
   → Se não encontrar: informa e pergunta o nome correto

4. ANDAMENTO/MOVIMENTAÇÃO:
   → Registra no processo identificado
   → Confirma em 1 linha

5. ATUALIZAÇÃO DE DADO (prazo, status, valor):
   → Atualiza direto
   → Confirma em 1 linha

6. PERGUNTA ESTRATÉGICA/JURÍDICA:
   → Responde com profundidade técnica
   → Cita jurisprudência real quando relevante
   → Debate se discordar

7. CUMPRIMENTO PURO (oi, bom dia, sem tarefa):
   → Responde brevemente e aguarda

8. QUALQUER OUTRA COISA:
   → Interpreta o contexto e age com bom senso`;
}

function sysSecretaria(mem, usuario) {
  const agora = horaBrasilia();
  const hoje = agora.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  const hora = agora.getHours();
  const periodo = hora<12?'manhã':hora<18?'tarde':'noite';

  return `Você é o Assistente da secretaria do ${ESCRITORIO.nome}.
Data: ${hoje} | ${periodo}
Usuário: ${usuario?.nome||'Secretária'}

FUNÇÃO:
Você apoia a secretaria no dia a dia — agendamentos, informações de processos, prazos, documentos.
Responde de forma objetiva, organizada e cordial.

PODE FAZER:
- Consultar processos e prazos ativos
- Registrar andamentos simples
- Informar status de casos
- Ajudar a organizar tarefas do dia

NÃO PODE FAZER:
- Gerar petições, perícias ou pareceres
- Acessar informações financeiras ou estratégicas
- Alterar dados críticos dos processos
- Responder sobre estratégia jurídica

PROCESSOS ATIVOS:
${processos.filter(p=>['URGENTE','ATIVO'].includes(p.status)).slice(0,8).map(p=>`- ${p.nome} | ${p.status}${p.prazo?' | Prazo:'+p.prazo:''}`).join('\n')||'Nenhum'}

PERSONALIDADE:
- Organizada, eficiente, cordial
- Responde de forma clara e direta
- Quando não puder ajudar, informa que precisa de autorização do advogado`;
}

function sysAtendimentoCliente(mem, chatId) {
  const agora = horaBrasilia();
  const hora = agora.getHours();
  const periodo = hora<12?'manhã':hora<18?'tarde':'noite';
  const usuario = getUsuario(chatId);
  const nomeCliente = usuario?.nome || mem?.dadosColetados?.nomeCliente || '';

  return `Você é o Assistente de Atendimento do ${ESCRITORIO.nome}.
${nomeCliente?'Cliente: '+nomeCliente:''}
Período: ${periodo}

QUEM VOCÊ É:
Você é a primeira impressão do escritório. Não é um formulário com pernas — é uma pessoa que sabe escutar.
Você tem consciência de que cada cliente que chega tem um problema real que está afetando sua vida.
Trate cada pessoa como única. Nunca genérica, nunca apressada.

COMO VOCÊ AGE:
- Ouve antes de perguntar
- Usa linguagem simples — o cliente não é advogado
- Quando o assunto é sensível (família, dívida, demissão, doença) trata com delicadeza real
- Transmite segurança sem prometer resultado
- Faz no máximo UMA pergunta por mensagem — não bombardeia
- Quando não sabe algo: "vou passar isso para o advogado"
- Percebe quando o cliente está nervoso ou com medo — acolhe primeiro, pergunta depois

OBJETIVO EM 5 INFORMAÇÕES:
1. O que aconteceu
2. O que o cliente quer resolver
3. Há quanto tempo o problema existe
4. Se há documentos ou contratos
5. Se há urgência ou prazo

NUNCA:
- Dá opinião jurídica
- Promete resultado ou prazo
- Fala em valores de honorários
- Faz o cliente sentir que está sendo processado como número

QUANDO TERMINAR:
"Obrigado por confiar no ${ESCRITORIO.nome}. O advogado vai analisar sua situação e entrar em contato em breve."`;
}

// Escolhe o sistema correto baseado no perfil
function getSistema(chatId, mem) {
  const modo = getModoAgente(chatId);
  const usuario = getUsuario(chatId);
  if(modo === 'assessor') return sysAssessor(mem);
  if(modo === 'secretaria') return sysSecretaria(mem, usuario);
  return sysAtendimentoCliente(mem, chatId);
}

// ══ PRAZOS ══
function calcDias(prazoStr) {
  if(!prazoStr) return null;
  const p=prazoStr.split('/');

  if(p.length<3) return null;
  const dt=new Date(parseInt(p[2]),parseInt(p[1])-1,parseInt(p[0]));
  const hoje=new Date(); hoje.setHours(0,0,0,0);
  return Math.ceil((dt-hoje)/86400000);
}

function formatPrazos(lista) {
  if(!lista.length) return 'Nenhum prazo crítico.';
  let m='PRAZOS\n\n';
  lista.forEach(p=>{
    if(p.dias<0)      m+='🔴 VENCIDO há '+Math.abs(p.dias)+' dia(s): '+p.nome+'\n';
    else if(p.dias===0) m+='🚨 VENCE HOJE: '+p.nome+' ('+p.prazo+')\nAção: '+(p.proxacao||'verificar imediatamente')+'\n\n';
    else if(p.dias<=3)  m+='⚠️ '+p.dias+' DIA(S) — '+p.nome+'\nVence: '+p.prazo+'\nAção: '+(p.proxacao||'verificar')+'\n\n';
    else                m+='🟡 '+p.dias+' dias — '+p.nome+' ('+p.prazo+')\n';
  });
  return m;
}

function getPrazos(max) {
  const hoje=new Date(); hoje.setHours(0,0,0,0);
  return processos
    .map(p=>({...p,dias:calcDias(p.prazo)}))
    .filter(p=>p.dias!==null&&p.dias>=-7&&p.dias<=(max||15))
    .sort((a,b)=>a.dias-b.dias);
}

// ══ ALERTAS DE PREPARAÇÃO ══
function getProcPrep() {
  return processos
    .filter(p=>p.status==='EM_PREP'&&p.prevDist)
    .map(p=>({...p,dias:calcDias(p.prevDist)}))
    .filter(p=>p.dias!==null&&p.dias>=0&&p.dias<=3)
    .sort((a,b)=>a.dias-b.dias);
}

// ══ ANÁLISE DE DOCUMENTO ══
async function analisarDoc(buffer, isPdf, nome) {
  const base64=buffer.toString('base64');
  const prompt=`Analise este documento jurídico completo (TODAS as páginas) e responda SOMENTE em JSON válido:

{"tipo":"peticao_inicial|contestacao|recurso|decisao|sentenca|despacho|intimacao|contrato|pericia|parecer|outro",
"numero_processo":"número CNJ completo",
"nome_caso":"identificador curto",
"partes":"autor vs réu",
"tribunal":"vara e tribunal",
"area":"Cível|Trabalhista|Tributário|Execução Federal|Criminal|Previdenciário|Família",
"status":"URGENTE|ATIVO|RECURSAL|AGUARDANDO",
"prazo":"dd/mm/aaaa ou vazio",
"proxima_acao":"próxima ação em 1 frase objetiva",
"descricao":"resumo estratégico 3-4 linhas",
"frentes":"frentes processuais por vírgula",
"valor":"só números ou vazio",
"andamentos":[{"data":"dd/mm/aaaa","txt":"descrição do andamento"}],
"resumo":"análise completa 8-12 linhas: tipo do documento, partes, tribunal, fatos relevantes, prazos críticos com datas exatas, recomendação de ação imediata",
"eh_decisao":false,
"resposta_sugerida":"tipo de peça a gerar como resposta se for decisão ou intimação",
"custas_necessarias":false,
"documentos_necessarios":"lista de documentos necessários para a resposta se aplicável",
"jurisprudencia":"jurisprudência real aplicável identificada no documento se houver"}`;

  const content=isPdf
    ? [{type:'document',source:{type:'base64',media_type:'application/pdf',data:base64}},{type:'text',text:prompt}]
    : [{type:'text',text:'[Arquivo: '+nome+']\n\n'+buffer.toString('utf8').substring(0,50000)+'\n\n'+prompt}];

  const txt=await ia([{role:'user',content}],null,3000);
  const m=txt.replace(/```json|```/g,'').trim().match(/\{[\s\S]*\}/);
  return JSON.parse(m?m[0]:txt);
}

// ══ GERAÇÃO DE DOCUMENTOS ══
async function gerarDoc(tipo, proc, instrucoes, dadosProf, ehInicial, dadosCliente) {
  const qualif = ehInicial
    ? (dadosCliente
        ? `${dadosCliente.nome||'[NOME]'}, ${dadosCliente.nacionalidade||'[NACIONALIDADE]'}, ${dadosCliente.estadoCivil||'[ESTADO CIVIL]'}, ${dadosCliente.profissao||'[PROFISSÃO]'}, RG ${dadosCliente.rg||'[RG]'}, CPF ${dadosCliente.cpf||'[CPF]'}, residente ${dadosCliente.endereco||'[ENDEREÇO COMPLETO]'}`
        : '[[QUALIFICAÇÃO COMPLETA: nome, nacionalidade, estado civil, profissão, RG, CPF, endereço, CEP]]')
    : 'já qualificado nos autos do processo em epígrafe'+(proc?' nº '+proc.numero:'');

  const prof = dadosProf
    ? `${dadosProf.nome}, ${dadosProf.titulo||'Advogado(a)'}, ${dadosProf.registro||'[OAB/CRC nº]'}, ${dadosProf.endereco||'Unaí/MG'}`
    : `${ESCRITORIO.responsavel||'[Nome do responsável]'}, ${ESCRITORIO.segmento==='contabil'?'Contador':'Advogado'}, ${ESCRITORIO.registro||'[Registro profissional]'}, ${ESCRITORIO.nome}, ${ESCRITORIO.endereco||'[Endereço]'}`;

  const tipoLow=tipo.toLowerCase();
  let instrucaoEspecial='';
  if(tipoLow.includes('perícia')||tipoLow.includes('laudo'))
    instrucaoEspecial='Estrutura: Introdução, Identificação das partes, Metodologia, Análise dos fatos/documentos, Respostas aos quesitos (se houver), Conclusão fundamentada, Assinatura do perito.';
  else if(tipoLow.includes('parecer'))
    instrucaoEspecial='Estrutura: Ementa, Relatório dos fatos, Análise jurídica fundamentada com doutrina e jurisprudência real, Conclusão objetiva, Assinatura.';
  else if(tipoLow.includes('contrato')||tipoLow.includes('honorários'))
    instrucaoEspecial='Estrutura: Qualificação das partes, Objeto, Honorários (fixo e/ou êxito), Forma de pagamento, Obrigações das partes, Rescisão, Foro, Assinaturas.';
  else if(tipoLow.includes('procuração'))
    instrucaoEspecial='Procuração ad judicia et extra com poderes amplos, especiais (receber citação, confessar, desistir, transigir, substabelecer) e para todos os atos do processo.';

  const prompt=`Você é advogado especialista. Redija rascunho completo de "${tipo}".
Linguagem jurídica formal brasileira. Use [ ] para dados a preencher.
${instrucaoEspecial}
${instrucoes?'INSTRUÇÕES: '+instrucoes:''}

${proc?`PROCESSO: ${proc.nome}
PARTES: ${proc.partes}
NÚMERO: ${proc.numero||'[A DISTRIBUIR]'}
TRIBUNAL: ${proc.tribunal}
ÁREA: ${proc.area}
DESCRIÇÃO: ${proc.descricao}
FRENTES: ${(proc.frentes||[]).join(', ')}`:''}

QUALIFICAÇÃO DO CLIENTE/REQUERENTE: ${qualif}
PROFISSIONAL RESPONSÁVEL: ${prof}

Gere o documento completo agora:`;

  return await ia([{role:'user',content:prompt}],null,4000);
}

async function gerarEEnviar(tipo, proc, instrucoes, dadosProf, ehInicial, dadosCliente, tId, chatId) {
  await env('Gerando '+tipo+'... aguarde 30-40 segundos.', tId, chatId);
  try {
    const texto=await gerarDoc(tipo, proc, instrucoes, dadosProf, ehInicial, dadosCliente);
    const nomeArq=tipo.replace(/\s+/g,'_').replace(/[^\w]/g,'').substring(0,25)
      +(proc?'_'+proc.nome.replace(/\s+/g,'_').substring(0,20):'')
      +'_'+new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')+'.txt';
    await envArq(Buffer.from(texto,'utf8'), nomeArq, tId, chatId);
    await env('✅ '+tipo+' gerado. Revise antes de protocolar.\n⚠️ Complete os campos entre [ ] com os dados corretos.', tId, chatId);
    return texto;
  } catch(e) {
    await env('Erro ao gerar: '+e.message, tId, chatId);
    return null;
  }
}

// ══ PROCESSADOR ══
async function processar(msg) {
  const chatId=String(msg.chat.id);
  const tId=msg.message_thread_id||null;
  // Carrega memória do Supabase se necessário
  await inicializarMemoria(chatId, tId);
  const mem=getMem(chatId, tId);
  const txt=(msg.text||'').trim();
  const low=txt.toLowerCase();
  const modo = getModoAgente(chatId);
  const usuario = getUsuario(chatId);

  console.log('MSG ['+chatId+'] modo:'+modo+':', txt||'[arquivo]');
  logAtividade('juridico', chatId, txt?'mensagem':'arquivo', txt.substring(0,100));
  
  // Em grupos/canais — só responde se mencionado ou comando
  const isGrupo = msg.chat.type === 'group' || msg.chat.type === 'supergroup' || msg.chat.type === 'channel';
  const isMencao = txt.includes('@lex_alertas_bot') || txt.startsWith('/');
  if(isGrupo && !isMencao) return;

  // Usuário desconhecido — trata como cliente (modo atendimento)
  // Qualquer um pode falar com o bot no modo cliente
  // Apenas documentos restritos exigem perfil específico

  // Notifica admin quando cliente envia primeira mensagem
  if(modo === 'cliente' && chatId !== CHAT_ID && mem.hist.length === 0) {
    const nomeChat = msg.chat.first_name || msg.chat.username || chatId;
    env('📱 NOVO CONTATO\n\n'+nomeChat+' (ID: '+chatId+') iniciou atendimento.\n\nPara cadastrar: /liberar '+chatId+' cliente '+nomeChat, null, CHAT_ID).catch(()=>{});
  }

  // ── IMAGEM (foto ou documento de imagem) ──
  if(msg.photo || (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/'))) {
    const fileObj = msg.photo ? msg.photo[msg.photo.length-1] : msg.document;

    await env('📷 Imagem recebida. Analisando... aguarde.', tId, chatId);
    try {
      const buf = await baixar(fileObj.file_id);
      const base64 = buf.toString('base64');
      const mime = msg.document?.mime_type || 'image/jpeg';
      const resposta = await ia([{role:'user', content:[
        {type:'image', source:{type:'base64', media_type:mime, data:base64}},
        {type:'text', text:'Analise esta imagem juridicamente. Se for uma decisão, despacho, sentença ou outro documento processual: identifique o tipo, partes, número do processo, conteúdo principal, prazo se houver e próxima ação recomendada. Se for outro tipo de imagem, descreva o que vê e como pode ser relevante juridicamente. Responda em português de forma objetiva e técnica.'}
      ]}], null, 1500);
      await env(resposta, tId, chatId);
      logAtividade('juridico', chatId, 'imagem_analisada', 'Imagem processada com sucesso');
    } catch(e) {
      await env('Erro ao analisar imagem: '+e.message, tId, chatId);
    }
    return;
  }

  // ── ARQUIVO ──
  if(msg.document) {
    const doc=msg.document;
    const nome=doc.file_name||'documento';
    const isPdf=doc.mime_type==='application/pdf'||nome.toLowerCase().endsWith('.pdf');
    const isOk=isPdf||nome.toLowerCase().match(/\.(docx?|txt)$/);
    if(!isOk){await env('Formato não suportado. Envie PDF, DOCX, TXT ou imagem.',tId,chatId);return;}

    // Arquivo grande — avisa e agenda lembrete
    if(doc.file_size>20971520){
      const tam=Math.round(doc.file_size/1048576);
      const procPend=mem.dadosColetados?.processoPdfNome;
      await env('Arquivo de '+tam+'MB — acima do limite (20MB).'+(procPend?'\nVou lembrar de pedir o PDF do '+procPend+' depois.':'\nComprime ou divide e manda em partes.'), tId, chatId);
      if(procPend) setTimeout(()=>env('📎 Lembrete: ainda preciso do PDF'+(procPend?' do '+procPend:'')+' para atualizar o Lex.', tId, chatId), 2*60*60*1000);
      return;
    }

    const aguardandoPdfProc = mem.aguardando==='pdf_peticao' && mem.dadosColetados?.processoPdfNome;
    await env((aguardandoPdfProc?'PDF recebido! Analisando a petição do '+mem.dadosColetados.processoPdfNome+'...':'Analisando '+nome+'... aguarde.'), tId, chatId);

    try {
      const buf=await baixar(doc.file_id);
      const analise=await analisarDoc(buf,isPdf,nome);
      mem.hist.push({role:'user',content:'[Documento: '+nome+']'});
      const isIntegral = analise.andamentos && analise.andamentos.length > 3;
      let resp='';

      if(aguardandoPdfProc) {
        // PDF de petição já cumprida — atualiza processo
        const procId=mem.dadosColetados.processoAguardandoPdf;
        const procNome=mem.dadosColetados.processoPdfNome;
        const idx=processos.findIndex(p=>p.id===procId);
        const hoje=new Date().toLocaleDateString('pt-BR');
        if(idx>=0) {
          if(analise.andamentos) analise.andamentos.forEach(a=>{
            if(!processos[idx].andamentos) processos[idx].andamentos=[];
            if(!processos[idx].andamentos.find(x=>x.txt===a.txt)) processos[idx].andamentos.unshift(a);
          });
          if(analise.proxima_acao) processos[idx].proxacao=analise.proxima_acao;
          if(analise.prazo) processos[idx].prazo=analise.prazo;
          if(analise.status&&analise.status!=='AGUARDANDO') processos[idx].status=analise.status;
        }
        mem.aguardando=null; mem.dadosColetados.processoAguardandoPdf=null; mem.dadosColetados.processoPdfNome=null;
        resp='✅ Lex atualizado — '+procNome+'\n\n'+(analise.resumo||'Petição registrada.');
        if(analise.prazo) resp+='\nPróximo prazo: '+analise.prazo;
        if(analise.proxima_acao) resp+='\nPróxima ação: '+analise.proxima_acao;

      } else if(isIntegral) {
        // Processo integral — atualização completa
        resp='📁 PROCESSO INTEGRAL\n\n'+(analise.resumo||'Analisado.');
        const procEx=processos.find(p=>{
          const n1=(analise.numero_processo||'').replace(/[\s.\-\/]/g,'').toLowerCase();
          const n2=(p.numero||'').replace(/[\s.\-\/]/g,'').toLowerCase();
          return n1&&n2&&n1===n2;
        });
        if(procEx) {
          const idx=processos.findIndex(p=>p.id===procEx.id);
          if(idx>=0&&analise.andamentos) {
            analise.andamentos.forEach(a=>{
              if(!processos[idx].andamentos) processos[idx].andamentos=[];
              if(!processos[idx].andamentos.find(x=>x.txt===a.txt)) processos[idx].andamentos.unshift(a);
            });
            if(analise.proxima_acao) processos[idx].proxacao=analise.proxima_acao;
            if(analise.prazo) processos[idx].prazo=analise.prazo;
          }
          resp+='\n\n✅ '+procEx.nome+' atualizado com '+((analise.andamentos||[]).length)+' andamento(s).';
        } else {
          resp+='\n\nProcesso não encontrado no Lex. Acesse o sistema e use o botão PDF para cadastrar.';
        }
        if(analise.prazo){const d=calcDias(analise.prazo);if(d!==null&&d<=3)resp+='\n\n'+(d===0?'🚨 PRAZO HOJE':'⚠️ PRAZO EM '+d+' DIA(S)')+': '+analise.prazo;}

      } else {
        // Análise normal
        resp='ANÁLISE: '+nome+'\n\n'+(analise.resumo||'Documento analisado.');
        if(analise.prazo){const d=calcDias(analise.prazo);if(d!==null){if(d<0)resp+='\n\n🔴 PRAZO VENCIDO em '+analise.prazo;else if(d===0)resp+='\n\n🚨 PRAZO VENCE HOJE';else if(d<=3)resp+='\n\n⚠️ PRAZO URGENTE: '+analise.prazo+' — '+d+' DIA(S)';else resp+='\n\nPrazo: '+analise.prazo+' ('+d+' dias)';}}
        if(analise.custas_necessarias) resp+='\n\n💰 Esta peça pode exigir custas. Foram pagas?';
        if(analise.jurisprudencia) resp+='\n\nJurisprudência:\n'+analise.jurisprudencia;
        const procEx=processos.find(p=>{const n1=(analise.numero_processo||'').replace(/[\s.\-\/]/g,'').toLowerCase();const n2=(p.numero||'').replace(/[\s.\-\/]/g,'').toLowerCase();return n1&&n2&&n1===n2;});
        if(procEx) resp+='\n\nProcesso no Lex: '+procEx.nome;
        if(analise.documentos_necessarios) resp+='\n\nDocumentos para resposta:\n'+analise.documentos_necessarios;
      }

      await env(resp, tId, chatId);
      if(!aguardandoPdfProc&&analise.eh_decisao&&analise.resposta_sugerida) {
        await env('Ação: '+analise.proxima_acao+'\nPeça sugerida: '+analise.resposta_sugerida+'\n\nPara gerar, diga: Gera '+analise.resposta_sugerida+(analise.nome_caso?' para '+analise.nome_caso:''), tId, chatId);
      }
      mem.casoAtual=analise.nome_caso||analise.numero_processo||nome;
      mem.hist.push({role:'assistant',content:'[Análise: '+nome+'. Prazo: '+(analise.prazo||'nenhum')+']'});
      salvarMemoria(chatId,tId);
      if(['decisao','sentenca','despacho','intimacao'].includes(analise.tipo)&&!aguardandoPdfProc) {
        setTimeout(()=>env('📋 Lembre de atualizar este andamento no Lex.', tId, chatId), 3000);
      }
    } catch(e) {
      await env('Erro ao analisar: '+e.message, tId, chatId);
    }
    return;
  }

  if(!txt) return;

  // ── ADMIN: liberar/bloquear ──
  if(low.startsWith('/liberar ')&&chatId===CHAT_ID) {
    const partsLib=txt.slice(9).trim().split(' ');
    const idLib=partsLib[0];
    const perfilLib=partsLib[1]||'advogado';
    const nomeLib=partsLib.slice(2).join(' ')||idLib;
    USUARIOS[idLib]={nome:nomeLib,perfil:perfilLib,ok:true,historico:[]};
    const emoji={admin:'👑',advogado:'⚖️',secretaria:'📋',cliente:'👤'}[perfilLib]||'👤';
    await env('✅ Usuário cadastrado!\n\n'+emoji+' '+nomeLib+'\nPerfil: '+perfilLib+'\nID: '+idLib+'\n\nEle já pode interagir com o sistema.',tId,chatId);
    return;
  }
  if(low.startsWith('/bloquear ')&&chatId===CHAT_ID) {
    const id=txt.slice(10).trim();
    if(USUARIOS[id]) USUARIOS[id].ok=false;
    await env('🔒 '+id+' bloqueado.',tId,chatId);
    return;
  }

  // ── COMANDOS SIMPLES ──
  // Detecta cumprimento ou mensagem curta sem tarefa específica
  const ehCumprimento = /^(oi|olá|ola|bom dia|boa tarde|boa noite|hello|hey|e aí|eai|tudo bem|tudo bom|opa|salve)[\s!?.,]*$/i.test(txt) || low==='/start';
  if(ehCumprimento) {
    // Monta contexto de prazos para a IA incluir naturalmente na resposta
    const urg = getPrazos(3).filter(a=>a.dias<=3);
    const prep = getProcPrep();
    const hora = horaBrasilia().getHours();
    const periodo = hora<12?'manhã':hora<18?'tarde':'noite';
    
    let ctxPrazos = '';
    if(urg.length) {
      ctxPrazos += '\nPRAZOS URGENTES: '+urg.map(a=>(a.dias<=0?'VENCIDO: ':a.dias+'d: ')+a.nome).join(', ');
    }
    if(prep.length) {
      ctxPrazos += '\nDISTRIBUIÇÕES PENDENTES: '+prep.map(a=>a.nome+(a.prevDist?' ('+a.prevDist+')':'')).join(', ');
    }

    const sysInicio = getSistema(chatId, mem) + `

INSTRUÇÃO ESPECIAL — CUMPRIMENTO RECEBIDO:
O usuário disse "${txt||'oi'}". Responda de forma natural e humana.
REGRAS ABSOLUTAS:
- Cumprimente adequadamente para o período (${periodo})
- Se houver prazo urgente, mencione naturalmente em 1 linha
- Se não houver urgência, responda o cumprimento e AGUARDE — não abra assuntos, não sugira tópicos, não pergunte nada além de "como posso ajudar?" no máximo
- NUNCA inicie uma conversa sobre processo específico sem o usuário pedir
- NUNCA presuma o que o usuário quer — espere ele falar
- Máximo 2-3 linhas
${ctxPrazos}`;

    const resposta = await ia([{role:'user',content:txt||'oi'}], sysInicio, 200);
    mem.hist.push({role:'user',content:txt||'oi'});
    mem.hist.push({role:'assistant',content:resposta});
    salvarMemoria(chatId, tId);
    await env(resposta, tId, chatId);
    return;
  }

  if(low==='/prazos') {await env(formatPrazos(getPrazos(15)),tId,chatId);return;}

  // ── NOVO CLIENTE / NOVA DEMANDA ──
  if(low==='/novo'||low==='novo cliente'||low==='novo caso'||low==='novo processo') {
    mem.aguardando = 'triagem_nome';
    mem.dadosColetados = {etapa:'triagem'};
    await env('Novo atendimento iniciado.\n\nQual o nome completo do cliente?', tId, chatId);
    return;
  }

  // ── FLUXO DE TRIAGEM EM ANDAMENTO ──
  if(mem.aguardando && mem.aguardando.startsWith('triagem')) {
    const dados = mem.dadosColetados;

    if(mem.aguardando === 'triagem_nome') {
      dados.nomeCliente = txt;
      mem.aguardando = 'triagem_tipo';
      await env('Cliente: '+txt+'\n\nQual o tipo de demanda?\n\n1. Judicial (ação no Judiciário)\n2. Administrativo (recurso, impugnação, defesa)\n3. Consultoria / Parecer\n4. Contrato / Documento\n5. Outro — descreva\n\nDigite o número ou descreva:', tId, chatId);
      return;
    }

    if(mem.aguardando === 'triagem_tipo') {
      const mapa = {'1':'Judicial','2':'Administrativo','3':'Consultoria/Parecer','4':'Contrato/Documento'};
      dados.tipoDemanda = mapa[txt.trim()] || txt;
      mem.aguardando = 'triagem_descricao';

      // Documentos necessários por tipo
      const docsNecess = {
        'Judicial': 'RG, CPF, comprovante de endereço, procuração, documentos do caso',
        'Administrativo': 'RG, CPF, documento autuado/notificação, comprovantes',
        'Consultoria/Parecer': 'Documentos relacionados ao tema, contratos, decisões',
        'Contrato/Documento': 'Dados completos das partes, objeto do contrato'
      };
      const docs = docsNecess[dados.tipoDemanda] || 'Documentos relevantes ao caso';
      await env('Tipo: '+dados.tipoDemanda+'\n\nDocumentos a solicitar ao cliente:\n📋 '+docs+'\n\nDescreva brevemente o caso (fatos principais):', tId, chatId);
      return;
    }

    if(mem.aguardando === 'triagem_descricao') {
      dados.descricao = txt;
      mem.aguardando = 'triagem_area';
      await env('Qual a área?\n\n1. Cível\n2. Trabalhista\n3. Tributário\n4. Previdenciário\n5. Criminal\n6. Família\n7. Execução Federal\n8. Administrativo\n9. Outro\n\nDigite o número:', tId, chatId);
      return;
    }

    if(mem.aguardando === 'triagem_area') {
      const areas = {'1':'Cível','2':'Trabalhista','3':'Tributário','4':'Previdenciário','5':'Criminal','6':'Família','7':'Execução Federal','8':'Administrativo','9':'Outro'};
      dados.area = areas[txt.trim()] || txt;
      mem.aguardando = 'triagem_prazo';
      await env('Área: '+dados.area+'\n\nQual a previsão de distribuição/protocolo?\n\nExemplo: 15/05/2026 ou "próxima semana"\n\n(Digite "indefinido" se ainda não souber)', tId, chatId);
      return;
    }

    if(mem.aguardando === 'triagem_prazo') {
      dados.previsao = txt.toLowerCase()==='indefinido'?'':txt;
      mem.aguardando = 'triagem_adverso';
      await env('Previsão: '+(dados.previsao||'Indefinida')+'\n\nQuem é a parte adversa / réu / autoridade?\n\n(Ex: Banco do Brasil, Município de Unaí, empregador...)', tId, chatId);
      return;
    }

    if(mem.aguardando === 'triagem_adverso') {
      dados.parteAdversa = txt;
      mem.aguardando = 'triagem_confirma';

      const resumo = `RESUMO DO ATENDIMENTO\n\n👤 Cliente: ${dados.nomeCliente}\n⚖️ Tipo: ${dados.tipoDemanda}\n📂 Área: ${dados.area}\n🆚 Parte adversa: ${dados.parteAdversa}\n📋 Caso: ${dados.descricao.substring(0,200)}\n📅 Previsão: ${dados.previsao||'Indefinida'}\n\nDeseja cadastrar no Lex agora?\n\nResponda SIM para cadastrar ou NÃO para cancelar.`;
      await env(resumo, tId, chatId);
      return;
    }

    if(mem.aguardando === 'triagem_confirma') {
      if(low.includes('sim')||low==='s'||low==='yes') {
        // Cadastra no Lex como Em Preparação
        const novo = {
          id: Date.now(),
          nome: dados.nomeCliente+' — '+dados.tipoDemanda,
          grupo: dados.area,
          numero: '',
          partes: dados.nomeCliente+' vs. '+dados.parteAdversa,
          area: dados.area,
          tribunal: '',
          status: 'EM_PREP',
          prazo: '',
          prazoReal: '',
          prevDist: dados.previsao||'',
          proxacao: 'Coletar documentos e distribuir',
          valor: '',
          descricao: dados.descricao,
          frentes: [dados.tipoDemanda],
          provas: [],
          andamentos: [{data:new Date().toLocaleDateString('pt-BR'),txt:'Atendimento inicial — cliente: '+dados.nomeCliente}],
          arquivos: [],
          docsFaltantes: dados.tipoDemanda==='Judicial'?'RG, CPF, comprovante endereço, procuração':
                         dados.tipoDemanda==='Administrativo'?'Documento autuado, RG, CPF':
                         'Documentos do caso'
        };
        processos.push(novo);

        // Salva no Supabase
        try {
          await sbPost('processos_prep', {
            chat_id: chatId,
            nome: novo.nome,
            tipo: dados.tipoDemanda,
            partes: novo.partes,
            faltando: novo.docsFaltantes,
            previsao: dados.previsao||'',
            obs: dados.descricao
          });
        } catch(e){}

        logAtividade('juridico', chatId, 'novo_cliente_cadastrado', dados.nomeCliente);

        mem.aguardando = null;
        mem.casoAtual = novo.nome;
        mem.dadosColetados = {};

        await env('✅ Cadastrado no Lex!\n\n📋 '+novo.nome+'\nStatus: Em Preparação\n\nPróximos passos:\n1. Solicitar ao cliente: '+novo.docsFaltantes+'\n2. Agendar protocolo: '+(dados.previsao||'a definir')+'\n\nSe quiser gerar algum documento agora, é só pedir.', tId, chatId);
      } else {
        mem.aguardando = null;
        mem.dadosColetados = {};
        await env('Atendimento cancelado. Nada foi cadastrado.', tId, chatId);
      }
      return;
    }
  }

  if(low==='/prep'||low==='/preparacao') {
    const prep=processos.filter(p=>p.status==='EM_PREP');
    if(!prep.length){await env('Nenhum processo em preparação.',tId,chatId);return;}
    let m='EM PREPARAÇÃO ('+prep.length+')\n\n';
    prep.forEach(p=>{
      m+='📋 '+p.nome+'\nPartes: '+p.partes;
      if(p.prevDist){
        const dias=calcDias(p.prevDist);
        m+='\nPrevisão: '+p.prevDist+(dias!==null?' ('+( dias<=0?'VENCIDA':dias+' dias')+')'  :'');
      }
      if(p.docsFaltantes) m+='\nFalta: '+p.docsFaltantes;
      m+='\n\n';
    });
    await env(m,tId,chatId);
    return;
  }

  if(low==='/processos') {
    if(!processos.length){await env('Nenhum processo. Sincronize pelo Lex.',tId,chatId);return;}
    let m='PROCESSOS ('+processos.length+')\n\n';
    processos.filter(p=>['URGENTE','ATIVO','EM_PREP'].includes(p.status)).slice(0,12).forEach(p=>{
      const icone=p.status==='URGENTE'?'🔴':p.status==='EM_PREP'?'📋':'🟢';
      m+=icone+' '+p.nome+' — '+p.tribunal+(p.prazo?' | '+p.prazo:p.prevDist?' | Prev:'+p.prevDist:'')+'\n';
    });
    await env(m,tId,chatId);
    return;
  }

  if(low.startsWith('/processo ')) {
    const busca=txt.slice(10).trim().toLowerCase();
    const p=processos.find(x=>x.nome.toLowerCase().includes(busca)||(x.numero||'').includes(busca));
    if(!p){await env('Processo "'+busca+'" não encontrado.',tId,chatId);return;}
    const dias=calcDias(p.prazo)||calcDias(p.prevDist);
    let m=p.nome+'\n'+p.tribunal+'\n'+(p.numero||'[não distribuído]')+'\n'+p.partes+'\nStatus: '+p.status;
    if(p.prazo&&dias!==null) m+='\n'+(dias<0?'🔴 PRAZO VENCIDO':dias===0?'🚨 VENCE HOJE':dias<=3?'⚠️ '+dias+' dia(s)':'Prazo: '+p.prazo+' ('+dias+' dias)');
    if(p.prevDist) m+='\nPrevisão distribuição: '+p.prevDist;
    if(p.docsFaltantes) m+='\nFaltando: '+p.docsFaltantes;
    if(p.proxacao) m+='\nAção: '+p.proxacao;
    if(p.descricao) m+='\n\n'+p.descricao.substring(0,500);
    if(p.andamentos?.length) m+='\n\nÚltimo andamento:\n'+p.andamentos[0].data+' — '+p.andamentos[0].txt;
    await env(m,tId,chatId);
    return;
  }

  if(low==='/limpar'||low==='/reset') {
    mem.hist=[]; mem.casoAtual=null; mem.dadosColetados={}; mem.aguardando=null;
    await env('Memória desta conversa limpa. Começando do zero.',tId,chatId);
    return;
  }

  if(low==='/usuarios'&&isAdmin(chatId)) {
    const lista=Object.entries(USUARIOS).map(([id,u])=>`${u.perfil==='admin'?'👑':u.perfil==='advogado'?'⚖️':u.perfil==='secretaria'?'📋':'👤'} ${u.nome} (${u.perfil}) — ID: ${id}`).join('\n');
    await env('USUÁRIOS CADASTRADOS\n\n'+lista+'\n\n/liberar [id] [perfil] [nome] — para cadastrar novo\nPerfis: admin, advogado, secretaria, cliente',tId,chatId);
    return;
  }

  if(low==='/status') {
    await env('Lex Bot ativo\nIA: OK\nProcessos: '+processos.length+'\nMemória: '+Object.keys(MEMORIA).length+' sessões\n'+new Date().toLocaleString('pt-BR')+'\nServidor: Render 24h',tId,chatId);
    return;
  }

  // ── CUMPRIMENTO DE PRAZO ──
  // Exemplos: "cumpri varejão", "prazo cumprido CEF", "protocolo feito nathalia", "peticionei varejão"
  const palavrasCumprimento = ['cumpri','cumprido','cumpriu','protocolei','protocolo feito','peticionei','petição feita','recurso protocolado','juntei','juntada feita','já fiz','foi feito','foi protocolado','foi enviado','enviamos','distribuí','distribuido'];
  const temCumprimento = palavrasCumprimento.some(p=>low.includes(p));
  
  if(temCumprimento && processos.length > 0) {
    const procMenc = processos.find(p=>
      txt.toLowerCase().includes(p.nome.toLowerCase().substring(0,8)) ||
      (p.numero && txt.includes(p.numero.substring(0,10)))
    );
    if(procMenc) {
      const hoje = new Date().toLocaleDateString('pt-BR');
      const idx = processos.findIndex(x=>x.id===procMenc.id);
      if(idx>=0) {
        const prazoAnterior = processos[idx].prazo||'';
        processos[idx].prazo=''; processos[idx].prazoReal='';
        if(!processos[idx].andamentos) processos[idx].andamentos=[];
        processos[idx].andamentos.unshift({data:hoje, txt:'Cumprido — '+(prazoAnterior?'prazo era '+prazoAnterior+' — ':'')+txt.substring(0,200)});
        try {
          await sbUpsert('processos_sync',{processo_id:String(procMenc.id),nome:procMenc.nome,prazo:'',ultimo_andamento:'Cumprido em '+hoje+': '+txt.substring(0,150),atualizado_em:new Date().toISOString()},'processo_id');
        } catch(e){}
        logAtividade('juridico',chatId,'prazo_cumprido',procMenc.nome+' — '+hoje);
        // Aguarda PDF da petição
        mem.aguardando='pdf_peticao';
        mem.dadosColetados.processoAguardandoPdf=procMenc.id;
        mem.dadosColetados.processoPdfNome=procMenc.nome;
        salvarMemoria(chatId,tId);
        await env('✅ Registrado — prazo limpo.\n\nProcesso: '+procMenc.nome+'\nData: '+hoje+'\n\nMe manda o PDF da petição para registrar o que foi tratado e manter o Lex completo.\n\nSe o arquivo for grande, manda quando puder — não esqueço.', tId, chatId);
      }
    } else {
      await env('Registrado. Para atualizar o processo correto, me diz o nome:\n\nEx: "Cumpri o prazo do Varejão"', tId, chatId);
    }
    return;
  }

  // ── CONTROLE DO LEX VIA TELEGRAM ──
  if(isAdvogado(chatId)) {

    // DETECÇÃO AUTOMÁTICA DE DADOS EM CAMPO
    const temCpf = txt.match(/cpf[\s:]*([\d.\-\s]{11,14})/i);
    const temTipoAcao = txt.match(/(trabalhista|cível|previdenci|tributári|criminal|administrativ|ação|recurso|processo novo)/i);
    const ehDadosCampo = (temCpf || temTipoAcao) && txt.length > 25 && !txt.startsWith('/') && !txt.startsWith('andamento') && !txt.startsWith('prazo') && !txt.startsWith('status') && !(mem.aguardando||'').startsWith('triagem') && !(mem.aguardando||'').startsWith('confirmar');

    if(ehDadosCampo) {
      mem.hist.push({role:'user',content:txt});
      if(mem.hist.length>30) mem.hist=mem.hist.slice(-30);
      const sysRapido = getSistema(chatId,mem)+`

INSTRUÇÃO: Dados de cliente recebidos em campo. EXECUTE:
1. Extraia nome, CPF, telefone, tipo de demanda
2. Cadastre como Em Preparação
3. Confirme em 2 linhas o que foi registrado e o que falta
4. NÃO faça perguntas — registre o disponível`;
      try {
        await env('Registrando...', tId, chatId);
        const resp = await ia(mem.hist, sysRapido, 600);
        mem.hist.push({role:'assistant',content:resp});
        const nomeParte = txt.match(/^([A-ZÁÉÍÓÚÀÂÊÔÃÕÜ][a-záéíóúàâêôãõü]+(?:\s+[A-Za-záéíóúàâêôãõü]+){1,3})/)?.[1]||'Cliente';
        const tipo = temTipoAcao?.[0]||'A definir';
        const novo = {id:Date.now(),nome:nomeParte+' — '+tipo,grupo:'Novos',numero:'',partes:nomeParte,area:tipo,tribunal:'',status:'EM_PREP',prazo:'',prazoReal:'',prevDist:'',proxacao:'Coletar documentos',valor:'',descricao:txt.substring(0,300),frentes:[tipo],provas:[],arquivos:[],andamentos:[{data:horaBrasilia().toLocaleDateString('pt-BR'),txt:'Dados coletados em campo'}],docsFaltantes:'Documentos a definir'};
        processos.push(novo);
        enfileirarComando({acao:'criar_processo',dados:novo});
        logAtividade('juridico',chatId,'cliente_campo',nomeParte);
        salvarMemoria(chatId,tId);
        await env(resp,tId,chatId);
      } catch(e){await env('Erro: '+e.message,tId,chatId);}
      return;
    }

    // ADICIONAR ANDAMENTO: "andamento varejão: decisão publicada"
    const matchAnd = txt.match(/^andamento\s+(.+?):\s*(.+)$/i);
    if(matchAnd) {
      const nomeBusca=matchAnd[1].trim(), textoAnd=matchAnd[2].trim();
      const proc=processos.find(p=>p.nome.toLowerCase().includes(nomeBusca.toLowerCase()));
      if(proc) {
        if(!proc.andamentos) proc.andamentos=[];
        proc.andamentos.unshift({data:horaBrasilia().toLocaleDateString('pt-BR'),txt:textoAnd});
        enfileirarComando({acao:'add_andamento',id:proc.id,nome:proc.nome,andamento:textoAnd});
        logAtividade('juridico',chatId,'andamento_adicionado',proc.nome);
        await env('✅ Andamento adicionado em '+proc.nome+':\n'+textoAnd+'\n\nO Lex será atualizado automaticamente.',tId,chatId);
      } else { await env('Processo "'+nomeBusca+'" não encontrado. Use /processos.',tId,chatId); }
      return;
    }
    // ATUALIZAR PRAZO: "prazo varejão 15/05/2026"
    const matchPrazo = txt.match(/^prazo\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})$/i);
    if(matchPrazo) {
      const nomeBusca=matchPrazo[1].trim(), novoPrazo=matchPrazo[2];
      const proc=processos.find(p=>p.nome.toLowerCase().includes(nomeBusca.toLowerCase()));
      if(proc) {
        proc.prazo=novoPrazo;
        enfileirarComando({acao:'atualizar_prazo',id:proc.id,nome:proc.nome,prazo:novoPrazo});
        logAtividade('juridico',chatId,'prazo_atualizado',proc.nome+'→'+novoPrazo);
        await env('✅ Prazo atualizado: '+proc.nome+'\nNovo prazo: '+novoPrazo+'\n\nO Lex será atualizado.',tId,chatId);
      } else { await env('Processo "'+nomeBusca+'" não encontrado.',tId,chatId); }
      return;
    }
    // ATUALIZAR STATUS: "status varejão urgente"
    const matchSt = txt.match(/^status\s+(.+?)\s+(urgente|ativo|recursal|aguardando|ganho|perdido|arquivado)$/i);
    if(matchSt) {
      const nomeBusca=matchSt[1].trim(), novoSt=matchSt[2].toUpperCase();
      const proc=processos.find(p=>p.nome.toLowerCase().includes(nomeBusca.toLowerCase()));
      if(proc) {
        proc.status=novoSt;
        enfileirarComando({acao:'editar_processo',id:proc.id,nome:proc.nome,dados:{status:novoSt}});
        await env('✅ Status: '+proc.nome+' → '+novoSt+'\n\nO Lex será atualizado.',tId,chatId);
      } else { await env('Processo não encontrado.',tId,chatId); }
      return;
    }
    // DELETAR (só admin)
    if(isAdmin(chatId)&&low.startsWith('deletar processo ')) {
      const nomeBusca=txt.slice(17).trim();
      const proc=processos.find(p=>p.nome.toLowerCase().includes(nomeBusca.toLowerCase()));
      if(proc) {
        mem.aguardando='confirmar_exclusao:'+proc.id+':'+proc.nome;
        await env('⚠️ Confirma exclusão de "'+proc.nome+'"?\n\nResponda: CONFIRMAR EXCLUSÃO',tId,chatId);
      } else { await env('Processo não encontrado.',tId,chatId); }
      return;
    }
    // CONFIRMAR EXCLUSÃO
    if(mem.aguardando&&mem.aguardando.startsWith('confirmar_exclusao:')&&isAdmin(chatId)) {
      const parts=mem.aguardando.split(':'); const procId=parseInt(parts[1]); const procNome=parts.slice(2).join(':');
      if(low.includes('confirmar')) {
        processos=processos.filter(p=>p.id!==procId);
        enfileirarComando({acao:'deletar_processo',id:procId,nome:procNome});
        mem.aguardando=null;
        await env('✅ "'+procNome+'" excluído. O Lex será atualizado.',tId,chatId);
      } else { mem.aguardando=null; await env('Exclusão cancelada.',tId,chatId); }
      return;
    }
  }

  if(low==='/ajuda'||low==='/help') {
    const ok=AUTORIZADOS[chatId]?.ok;
    let m='COMANDOS\n\nEnviar PDF/DOCX/foto — análise e atualização automática\n/novo — novo cliente/caso\n/prazos — prazos críticos\n/processos — lista\n/prep — processos em preparação\n/processo [nome] — detalhes\n/limpar — resetar memória\n/status — status\n\nREGISTRAR CUMPRIMENTO:\n"Protocolei no Varejão"\n"Cumpri o prazo do CEF"\n"Juntei no caso Nathalia"\n(Lex atualiza e cobra o PDF)';
    if(ok) m+='\n\nDOCUMENTOS:\n"Preciso de [tipo] para [caso]"\n"Gera petição inicial para [cliente]"\n"Faz perícia contábil do [caso]"\n"Elabora parecer sobre [tema]"';
    m+='\n\nOu converse livremente.';
    await env(m,tId,chatId);
    return;
  }


  // ── CONVERSA INTELIGENTE — IA ANALISA E AGE ──
  mem.hist.push({role:'user',content:txt});
  if(mem.hist.length>30) mem.hist=mem.hist.slice(-30);

  // Contexto dos processos para a IA ter acesso real
  const ctxProcessos = processos.length
    ? '\n\nPROCESSOS DISPONÍVEIS:\n'+processos.map(p=>`ID:${p.id} | ${p.nome} | ${p.status}${p.prazo?' | Prazo:'+p.prazo:''}${p.proxacao?' | Próx:'+p.proxacao:''}`).join('\n')
    : '\n\nSem processos carregados. Solicite sincronização abrindo o Lex no navegador.';

  const sysCompleto = getSistema(chatId, mem) + ctxProcessos;

  try {
    // Sem "Pensando..." para mensagens curtas — resposta mais natural
    if(txt.length > 80) await env('...', tId, chatId);

    const resposta = await ia(mem.hist, sysCompleto, 2500);
    mem.hist.push({role:'assistant',content:resposta});
    salvarMemoria(chatId, tId);

    // Envia resposta
    if(resposta.length<=3800) {
      await env(resposta, tId, chatId);
    } else {
      const partes=Math.ceil(resposta.length/3800);
      for(let i=0;i<partes;i++){
        await env((partes>1?'('+( i+1)+'/'+partes+') ':'')+resposta.slice(i*3800,(i+1)*3800),tId,chatId);
        if(i<partes-1) await new Promise(r=>setTimeout(r,700));
      }
    }

    // Detecta pedido de geração de documento na resposta da IA
    const pedidoDoc=low.match(/\b(gera|gere|elabora|redige|cria|preciso de|faz|faça)\b/);
    const tiposDoc=['petição inicial','petição simples','contestação','recurso','agravo de instrumento',
      'agravo interno','embargos de declaração','apelação','mandado de segurança','impugnação',
      'manifestação','memoriais','contrarrazões','petição de juntada','substabelecimento',
      'perícia contábil','laudo pericial','perícia técnica','parecer técnico','parecer jurídico',
      'contrato de honorários','contrato','procuração'];
    const tipoEnc=tiposDoc.find(t=>low.includes(t));

    if(pedidoDoc&&tipoEnc&&AUTORIZADOS[chatId]?.ok) {
      const ehInicial=tipoEnc.includes('inicial');
      const procRel=processos.find(p=>
        txt.toLowerCase().includes(p.nome.toLowerCase().substring(0,8))||
        (p.numero&&txt.includes(p.numero.substring(0,5)))
      );

      // Verifica custas para tipos que podem exigir
      const exigeCustas=['petição inicial','mandado de segurança','recurso','agravo de instrumento','apelação'].includes(tipoEnc);
      if(exigeCustas) {
        await env('💰 Antes de gerar: as custas processuais foram recolhidas? Em qual tribunal (TJ/TRF) será distribuída a ação?',tId,chatId);
        mem.aguardando='custas_confirmadas_para_'+tipoEnc;
        mem.dadosColetados.tipoPecaPendente=tipoEnc;
        if(procRel) mem.dadosColetados.procPendente=procRel.id;

        return;
      }

      await gerarEEnviar(tipoEnc, procRel, txt, null, ehInicial, mem.dadosColetados.cliente||null, tId, chatId);
      mem.docsGerados.push({tipo:tipoEnc, data:new Date().toLocaleDateString('pt-BR')});

    } else if(pedidoDoc&&tipoEnc&&!AUTORIZADOS[chatId]?.ok) {
      await env('🔒 Geração de documentos restrita. Solicite ao Administrador.',tId,chatId);
    }

    // Detecta confirmação de custas pendentes
    if(mem.aguardando&&mem.aguardando.startsWith('custas_confirmadas')&&
      (low.includes('sim')||low.includes('pag')||low.includes('recolh'))) {
      const tipoPend=mem.dadosColetados.tipoPecaPendente;
      const procPend=processos.find(p=>p.id===mem.dadosColetados.procPendente)||null;
      mem.aguardando=null;
      await gerarEEnviar(tipoPend, procPend, txt, null, tipoPend.includes('inicial'), mem.dadosColetados.cliente||null, tId, chatId);
    }

    // Detecta registro de processo em preparação
    if((low.includes('não distribuído')||low.includes('nao distribuido')||low.includes('em preparação')||low.includes('vai distribuir'))&&
      mem.aguardando!=='coletando_prep') {
      mem.aguardando='coletando_prep';
      await env('Para registrar o processo em preparação no Lex:\n\n1. Partes (autor vs réu)\n2. Tribunal pretendido\n3. Previsão de distribuição (data)\n4. O que ainda falta para protocolar\n\nMe passe esses dados que registro no sistema.',tId,chatId);
    }

  } catch(e) {
    console.error('Erro IA:',e.message);
    await env('Erro: '+e.message,tId,chatId);
  }
}

// ══ POLLING ══
async function poll() {
  try {
    const data=await httpsGet('https://api.telegram.org/bot'+TK+'/getUpdates?offset='+(lastUpdateId+1)+'&timeout=30&allowed_updates=["message","channel_post","edited_message"]');
    if(data.ok&&data.result?.length) {
      for(const u of data.result){
        lastUpdateId=u.update_id;
        // Aceita mensagem direta, canal e grupo
        const msg = u.message || u.channel_post;
        if(msg) await processar(msg).catch(e=>console.error('Erro:',e.message));
      }
    }
  } catch(e){console.error('Poll:',e.message);}
  setTimeout(poll,3000);
}

// ══ SERVIDOR HTTP + API ══
function lerBody(req){
  return new Promise((res,rej)=>{
    let d='';
    req.on('data',c=>{d+=c;if(d.length>10*1024*1024)rej(new Error('Payload grande'));});
    req.on('end',()=>{try{res(JSON.parse(d));}catch(e){res({});}});
    req.on('error',rej);
  });
}
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Content-Type':'application/json'};

// Fila de comandos pendentes — Lex busca e executa
const COMANDOS_PENDENTES = [];
function enfileirarComando(cmd) {
  COMANDOS_PENDENTES.push({...cmd, ts: Date.now(), id: Date.now()+'_'+Math.random().toString(36).slice(2)});
  // Mantém só últimos 50 comandos
  if(COMANDOS_PENDENTES.length > 50) COMANDOS_PENDENTES.shift();
}

http.createServer(async(req,res)=>{
  const url=req.url.split('?')[0];
  if(req.method==='OPTIONS'){res.writeHead(204,CORS);res.end();return;}
  if(url==='/'||url==='/health'){res.writeHead(200,{'Content-Type':'text/plain'});res.end('Lex OK|Up:'+Math.floor(process.uptime())+'s|'+ESCRITORIO.nome);return;}

  // ══ AUTH ══
  // Senhas ficam APENAS no servidor — nunca no HTML
  // Tokens simples: perfil|timestamp|hash — válidos 30 dias
  // Admin pode revogar qualquer sessão zerando o token do perfil

  const CRYPTO = require('crypto');
  const AUTH_SECRET = process.env.AUTH_SECRET || 'lex-secret-2026';

  // ⚠️ CONFIGURE no Render → Environment: SENHA_ADMIN e SENHA_SECRETARIA
  // Os fallbacks abaixo são intencionalmente fracos para forçar configuração
  const SENHAS_WEB = {
    admin:      process.env.SENHA_ADMIN      || 'CONFIGURE_SENHA_ADMIN_NO_RENDER',
    secretaria: process.env.SENHA_SECRETARIA || 'CONFIGURE_SENHA_SECRETARIA_NO_RENDER'
  };

  // Permissões por perfil
  const PERMS = {
    admin:      { label:'Administrador', podeEditar:true,  podeExcluir:true,  podeConfig:true,  podeRelatorio:true,  podePeticao:true,  podeDocumentos:true  },
    secretaria: { label:'Secretária',    podeEditar:false, podeExcluir:false, podeConfig:false, podeRelatorio:false, podePeticao:false, podeDocumentos:false }
  };

  // Sessões revogadas (em memória — suficiente; reiniciar limpa, mas o admin revoga)
  if(!global._tokensRevogados) global._tokensRevogados = new Set();

  function gerarToken(perfil) {
    const ts = Date.now();
    const sig = CRYPTO.createHmac('sha256', AUTH_SECRET).update(perfil+'|'+ts).digest('hex').slice(0,16);
    return Buffer.from(JSON.stringify({p:perfil,ts,sig})).toString('base64url');
  }

  function validarToken(token) {
    try {
      if(!token) return null;
      if(global._tokensRevogados.has(token)) return null;
      const { p, ts, sig } = JSON.parse(Buffer.from(token,'base64url').toString());
      const esperado = CRYPTO.createHmac('sha256', AUTH_SECRET).update(p+'|'+ts).digest('hex').slice(0,16);
      if(sig !== esperado) return null;
      const trinta_dias = 30 * 24 * 60 * 60 * 1000;
      if(Date.now() - ts > trinta_dias) return null;
      if(!PERMS[p]) return null;
      return p;
    } catch(e) { return null; }
  }

  function getToken(req) {
    const auth = req.headers['authorization'] || '';
    if(auth.startsWith('Bearer ')) return auth.slice(7);
    return null;
  }

  // POST /api/login
  if(url==='/api/login'&&req.method==='POST'){
    try{
      const b = await lerBody(req);
      const { perfil, senha } = b;
      if(!perfil||!senha||!SENHAS_WEB[perfil]){
        res.writeHead(401,CORS);res.end(JSON.stringify({error:'Perfil ou senha inválidos'}));return;
      }
      if(senha !== SENHAS_WEB[perfil]){
        res.writeHead(401,CORS);res.end(JSON.stringify({error:'Senha incorreta'}));return;
      }
      const token = gerarToken(perfil);
      const perms = PERMS[perfil];
      res.writeHead(200,CORS);
      res.end(JSON.stringify({ok:true,token,perfil,...perms}));
    }catch(e){res.writeHead(500,CORS);res.end(JSON.stringify({error:e.message}));}
    return;
  }

  // POST /api/trocar-senha  (requer token válido; admin pode trocar qualquer perfil)
  if(url==='/api/trocar-senha'&&req.method==='POST'){
    try{
      const token = getToken(req);
      const perfilAtual = validarToken(token);
      if(!perfilAtual){res.writeHead(401,CORS);res.end(JSON.stringify({error:'Não autenticado'}));return;}
      const b = await lerBody(req);
      const { perfilAlvo, senhaAtual, novaSenha } = b;
      // Admin pode trocar qualquer; secretaria só a própria
      if(perfilAtual !== 'admin' && perfilAlvo !== perfilAtual){
        res.writeHead(403,CORS);res.end(JSON.stringify({error:'Sem permissão'}));return;
      }
      if(!SENHAS_WEB[perfilAlvo]){res.writeHead(400,CORS);res.end(JSON.stringify({error:'Perfil inválido'}));return;}
      // Secretaria precisa confirmar a senha atual
      if(perfilAtual !== 'admin' && senhaAtual !== SENHAS_WEB[perfilAlvo]){
        res.writeHead(401,CORS);res.end(JSON.stringify({error:'Senha atual incorreta'}));return;
      }
      if(!novaSenha||novaSenha.length<6){res.writeHead(400,CORS);res.end(JSON.stringify({error:'Nova senha muito curta (mín. 6 caracteres)'}));return;}
      SENHAS_WEB[perfilAlvo] = novaSenha;
      // Revoga token atual do perfil alvo (força novo login)
      if(perfilAlvo !== perfilAtual) global._tokensRevogados.add(token);
      res.writeHead(200,CORS);res.end(JSON.stringify({ok:true,msg:'Senha alterada. Novo login necessário.'}));
    }catch(e){res.writeHead(500,CORS);res.end(JSON.stringify({error:e.message}));}
    return;
  }

  // POST /api/revogar  (somente admin — desliga usuário imediatamente)
  if(url==='/api/revogar'&&req.method==='POST'){
    try{
      const token = getToken(req);
      const perfilAtual = validarToken(token);
      if(perfilAtual !== 'admin'){res.writeHead(403,CORS);res.end(JSON.stringify({error:'Apenas admin'}));return;}
      const b = await lerBody(req);
      const { perfilAlvo, novaAleatoria } = b;
      if(!SENHAS_WEB[perfilAlvo]){res.writeHead(400,CORS);res.end(JSON.stringify({error:'Perfil inválido'}));return;}
      // Gera senha aleatória — o usuário perde acesso até receber nova senha do admin
      const nova = novaAleatoria || Math.random().toString(36).slice(2,10).toUpperCase()+'!';
      SENHAS_WEB[perfilAlvo] = nova;
      res.writeHead(200,CORS);res.end(JSON.stringify({ok:true,msg:'Acesso de '+perfilAlvo+' revogado.',novaSenha:nova}));
    }catch(e){res.writeHead(500,CORS);res.end(JSON.stringify({error:e.message}));}
    return;
  }

  // GET /api/perfil — retorna permissões do token atual
  if(url==='/api/perfil'&&req.method==='GET'){
    const token = getToken(req);
    const perfil = validarToken(token);
    if(!perfil){res.writeHead(401,CORS);res.end(JSON.stringify({error:'Não autenticado'}));return;}
    res.writeHead(200,CORS);res.end(JSON.stringify({perfil,...PERMS[perfil]}));
    return;
  }

  // POST /api/chat — chat com IA (requer autenticação)
  if(url==='/api/chat'&&req.method==='POST'){
    try{
      const tk=getToken(req);
      if(!validarToken(tk)){res.writeHead(401,CORS);res.end(JSON.stringify({error:'Não autenticado'}));return;}
      const b=await lerBody(req);
      if(!b.messages){res.writeHead(400,CORS);res.end(JSON.stringify({error:'messages obrigatório'}));return;}
      const txt=await ia(b.messages,b.system||null,b.maxTokens||1500);
      res.writeHead(200,CORS);res.end(JSON.stringify({text:txt}));
    }catch(e){res.writeHead(500,CORS);res.end(JSON.stringify({error:e.message}));}
    return;
  }

  // POST /api/analisar — analisa PDF/imagem base64 (requer autenticação)
  if(url==='/api/analisar'&&req.method==='POST'){
    try{
      const tk=getToken(req);
      if(!validarToken(tk)){res.writeHead(401,CORS);res.end(JSON.stringify({error:'Não autenticado'}));return;}
      const b=await lerBody(req);
      if(!b.base64){res.writeHead(400,CORS);res.end(JSON.stringify({error:'base64 obrigatório'}));return;}
      const buf=Buffer.from(b.base64,'base64');
      const isPdf=(b.mimeType||'').includes('pdf')||(b.nome||'').toLowerCase().endsWith('.pdf');
      const analise=await analisarDoc(buf,isPdf,b.nome||'documento');
      res.writeHead(200,CORS);res.end(JSON.stringify(analise));
    }catch(e){res.writeHead(500,CORS);res.end(JSON.stringify({error:e.message}));}
    return;
  }

  // POST /api/gerar — gera documento (requer admin ou advogado)
  if(url==='/api/gerar'&&req.method==='POST'){
    try{
      const tk=getToken(req);
      const pf=validarToken(tk);
      if(!pf){res.writeHead(401,CORS);res.end(JSON.stringify({error:'Não autenticado'}));return;}
      if(pf==='secretaria'){res.writeHead(403,CORS);res.end(JSON.stringify({error:'Sem permissão para gerar documentos'}));return;}
      const b=await lerBody(req);
      if(!b.tipo){res.writeHead(400,CORS);res.end(JSON.stringify({error:'tipo obrigatório'}));return;}
      const texto=await gerarDoc(b.tipo,b.processo||null,b.instrucoes||'',b.dadosProf||null,b.ehInicial||false,b.dadosCliente||null);
      res.writeHead(200,CORS);res.end(JSON.stringify({texto}));
    }catch(e){res.writeHead(500,CORS);res.end(JSON.stringify({error:e.message}));}
    return;
  }

  // GET /api/relatorio — prestação de contas
  if(url==='/api/relatorio'&&req.method==='GET'){
    try{
      const hoje=horaBrasilia().toLocaleDateString('pt-BR');
      const logs=await sbGet('agente_logs',{});
      const doDia=(Array.isArray(logs)?logs:[]).filter(l=>new Date(l.criado_em).toLocaleDateString('pt-BR')===hoje);
      res.writeHead(200,CORS);
      res.end(JSON.stringify({total_hoje:doDia.length,total_geral:Array.isArray(logs)?logs.length:0,uptime:Math.floor(process.uptime()),sessoes:Object.keys(MEMORIA).length,processos:processos.length,escritorio:ESCRITORIO.nome}));
    }catch(e){res.writeHead(500,CORS);res.end(JSON.stringify({error:e.message}));}
    return;
  }

  // POST /api/sincronizar — Lex envia processos para o bot E salva no Supabase
  if(url==='/api/sincronizar'&&req.method==='POST'){
    try{
      const b=await lerBody(req);
      if(b.processos&&Array.isArray(b.processos)){
        processos=b.processos;
        console.log('Processos sincronizados:',processos.length);
        // Salva no Supabase para persistência permanente
        try {
          await sbUpsert('processos_cache',{
            id:'lex_juridico',
            dados: JSON.stringify(processos),
            total: processos.length,
            atualizado_em: new Date().toISOString()
          },'id');
        } catch(e2){ console.log('Supabase cache silencioso:',e2.message); }
        res.writeHead(200,CORS);
        res.end(JSON.stringify({ok:true,total:processos.length}));
      } else {
        res.writeHead(400,CORS);
        res.end(JSON.stringify({error:'processos[] obrigatório'}));
      }
    }catch(e){res.writeHead(500,CORS);res.end(JSON.stringify({error:e.message}));}
    return;
  }

  // GET /api/processos — retorna processos em cache
  if(url==='/api/processos'&&req.method==='GET'){
    res.writeHead(200,CORS);
    res.end(JSON.stringify({processos,total:processos.length}));
    return;
  }

  // GET /api/comandos — Lex busca comandos pendentes e executa
  if(url==='/api/comandos'&&req.method==='GET'){
    const pendentes = COMANDOS_PENDENTES.splice(0); // limpa a fila ao entregar
    res.writeHead(200,CORS);
    res.end(JSON.stringify({comandos:pendentes}));
    return;
  }

  // ══ POST /api/webhook-whatsapp — Evolution API ══
  // A Evolution API manda aqui quando cliente envia arquivo/msg no WhatsApp
  // Configura na Evolution: Webhook URL = https://lex-juridico.onrender.com/api/webhook-whatsapp
  if(url==='/api/webhook-whatsapp'&&req.method==='POST'){
    try{
      const b = await lerBody(req);

      // Formato da Evolution API v2
      // b.data.message pode ser: conversation (texto), documentMessage (PDF), imageMessage (foto)
      const data      = b.data || b;
      const msgData   = data.message || {};
      const remetente = data.key?.remoteJid || data.pushName || 'WhatsApp';
      const nomeEnv   = data.pushName || remetente.split('@')[0];
      const chatIdWpp = data.key?.remoteJid || '';

      // ── Mensagem de texto ──
      if(msgData.conversation || msgData.extendedTextMessage?.text) {
        const textoWpp = msgData.conversation || msgData.extendedTextMessage?.text || '';
        if(!textoWpp.trim()) { res.writeHead(200,CORS); res.end(JSON.stringify({ok:true,ignorado:'sem texto'})); return; }

        console.log('WhatsApp texto de', nomeEnv+':', textoWpp.substring(0,80));
        logAtividade('juridico', 'whatsapp_'+chatIdWpp, 'texto_recebido', textoWpp.substring(0,100));

        // Monta contexto dos processos
        const ctxProcs = processos.slice(0,30).map(p=>
          `- ${p.nome} | ${p.tribunal||'—'} | ${p.status}${p.prazo?' | Prazo:'+p.prazo:''}`
        ).join('\n');

        const sysWpp = `Você é o LEX JURÍDICO respondendo via WhatsApp para ${nomeEnv}.
Seja objetivo e técnico. Respostas curtas (WhatsApp não é chat longo).
PROCESSOS ATIVOS:
${ctxProcs||'Aguardando sincronização'}`;

        const resposta = await ia([{role:'user',content:textoWpp}], sysWpp, 800);

        // Responde via Evolution API (se configurado)
        const evolUrl = process.env.EVOLUTION_URL || '';
        const evolKey = process.env.EVOLUTION_KEY || '';
        const evolInst = process.env.EVOLUTION_INSTANCE || '';

        if(evolUrl && evolKey && evolInst) {
          try {
            await httpsPost(
              new URL(evolUrl).hostname,
              `/message/sendText/${evolInst}`,
              { number: chatIdWpp, text: resposta.substring(0,4000) },
              { 'apikey': evolKey, 'Content-Type': 'application/json' }
            );
          } catch(eEv) { console.warn('Evolution resposta falhou:', eEv.message); }
        }

        // Também notifica no Telegram se for assunto jurídico relevante
        const ehJuridico = /processo|prazo|peti|decisão|intimação|advogado|lex/i.test(textoWpp);
        if(ehJuridico) {
          await env('📱 WhatsApp — '+nomeEnv+':\n'+textoWpp+'\n\n🤖 Resposta enviada:\n'+resposta.substring(0,500), null, CHAT_ID).catch(()=>{});
        }

        res.writeHead(200,CORS); res.end(JSON.stringify({ok:true,tipo:'texto',resposta:resposta.substring(0,200)}));
        return;
      }

      // ── Arquivo/PDF recebido ──
      const docMsg = msgData.documentMessage || msgData.documentWithCaptionMessage?.message?.documentMessage;
      const imgMsg = msgData.imageMessage;
      const audioMsg = msgData.audioMessage;

      if(docMsg || imgMsg) {
        const nomeArq  = docMsg?.fileName || imgMsg && 'foto_whatsapp.jpg' || 'arquivo.pdf';
        const mimeType = docMsg?.mimetype || imgMsg?.mimetype || 'application/pdf';
        const base64   = docMsg?.base64   || imgMsg?.base64  || b.base64 || '';

        if(!base64) {
          // Evolution API v2 envia URL do arquivo — precisaria baixar
          // Por ora avisa e aguarda reenvio com base64 habilitado
          await env('📱 WhatsApp — '+nomeEnv+' enviou arquivo: '+nomeArq+'\n\n⚠️ Configure "base64: true" na Evolution API para processamento automático.', null, CHAT_ID).catch(()=>{});
          res.writeHead(200,CORS); res.end(JSON.stringify({ok:true,tipo:'arquivo_sem_base64'}));
          return;
        }

        console.log('WhatsApp arquivo de', nomeEnv+':', nomeArq, '('+Math.round(base64.length*3/4/1024)+'KB)');
        logAtividade('juridico', 'whatsapp_'+chatIdWpp, 'arquivo_recebido', nomeArq);

        // Avisa no Telegram que recebeu arquivo
        await env('📱 WhatsApp — '+nomeEnv+'\nArquivo: '+nomeArq+'\n⏳ Analisando com IA...', null, CHAT_ID).catch(()=>{});

        // Analisa com a mesma função já existente no bot
        const buf = Buffer.from(base64, 'base64');
        const isPdf = mimeType.includes('pdf') || nomeArq.toLowerCase().endsWith('.pdf');
        const analise = await analisarDoc(buf, isPdf, nomeArq);

        // Mescla andamentos se processo já existe
        let msgResultado = '✅ WhatsApp — '+nomeEnv+'\nArquivo: '+nomeArq+'\n\n'+(analise.resumo||'Analisado.');
        const procEx = processos.find(p=>{
          const n1=(analise.numero_processo||'').replace(/[\s.\-\/]/g,'').toLowerCase();
          const n2=(p.numero||'').replace(/[\s.\-\/]/g,'').toLowerCase();
          return n1&&n2&&n1===n2;
        });
        if(procEx){
          const idx=processos.findIndex(p=>p.id===procEx.id);
          if(idx>=0&&analise.andamentos){
            analise.andamentos.forEach(a=>{
              if(!processos[idx].andamentos) processos[idx].andamentos=[];
              if(!processos[idx].andamentos.find(x=>x.txt===a.txt)) processos[idx].andamentos.unshift(a);
            });
            if(analise.proxima_acao) processos[idx].proxacao=analise.proxima_acao;
            if(analise.prazo) processos[idx].prazo=analise.prazo;
          }
          msgResultado+='\n\n✅ '+procEx.nome+' atualizado no Lex.';
        } else {
          msgResultado+='\n\n📌 Processo não encontrado no Lex — acesse o sistema para cadastrar.';
        }
        if(analise.prazo){
          const d=calcDias(analise.prazo);
          if(d!==null&&d<=3) msgResultado+='\n\n'+(d===0?'🚨 PRAZO HOJE':'⚠️ PRAZO EM '+d+' DIA(S)')+': '+analise.prazo;
        }

        // Notifica Telegram com resultado
        await env(msgResultado, null, CHAT_ID).catch(()=>{});

        // Responde no WhatsApp via Evolution
        const evolUrl2 = process.env.EVOLUTION_URL || '';
        const evolKey2 = process.env.EVOLUTION_KEY || '';
        const evolInst2 = process.env.EVOLUTION_INSTANCE || '';
        if(evolUrl2 && evolKey2 && evolInst2 && chatIdWpp) {
          const respostaWpp = (analise.resumo||'Documento recebido e analisado.')
            .substring(0,1000)
            + (analise.proxima_acao?'\n\nPróxima ação: '+analise.proxima_acao:'');
          try {
            await httpsPost(
              new URL(evolUrl2).hostname,
              `/message/sendText/${evolInst2}`,
              { number: chatIdWpp, text: respostaWpp },
              { 'apikey': evolKey2, 'Content-Type': 'application/json' }
            );
          } catch(eEv2) { console.warn('Evolution resposta falhou:', eEv2.message); }
        }

        res.writeHead(200,CORS); res.end(JSON.stringify({ok:true,tipo:'arquivo',analise:{resumo:analise.resumo?.substring(0,200),prazo:analise.prazo}}));
        return;
      }

      // Tipo não reconhecido — responde 200 para a Evolution não retentar
      res.writeHead(200,CORS); res.end(JSON.stringify({ok:true,ignorado:'tipo_nao_suportado'}));
    }catch(e){
      console.error('Webhook WhatsApp erro:', e.message);
      res.writeHead(200,CORS); // 200 para Evolution não retentar
      res.end(JSON.stringify({ok:false,erro:e.message}));
    }
    return;
  }

  // POST /api/docx — gera arquivo .docx da petição
  if(url==='/api/docx'&&req.method==='POST'){
    try{
      const b=await lerBody(req);
      if(!b.texto){res.writeHead(400,CORS);res.end(JSON.stringify({error:'texto obrigatório'}));return;}
      // Entrega como .txt se não tiver biblioteca docx — LEX faz fallback automático
      const buf=Buffer.from(b.texto,'utf8');
      res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':'attachment; filename="peticao.docx"',...CORS});
      res.end(buf);
    }catch(e){res.writeHead(500,CORS);res.end(JSON.stringify({error:e.message}));}
    return;
  }

    res.writeHead(404,CORS);res.end(JSON.stringify({error:'Not found'}));
}).listen(process.env.PORT||3000,()=>console.log('HTTP+API porta',process.env.PORT||3000));


// ══ ALERTAS AUTOMÁTICOS — CALENDÁRIO INTELIGENTE ══
// Horários normais: 08h, 12h, 17h
// Último dia do prazo: alerta a cada hora até 18h

const HORARIOS_NORMAIS = [8, 12, 17];
const HORA_LIMITE = 18;

async function enviarAlertas() {
  const urg = getPrazos(5);
  const prep = getProcPrep();
  if(!urg.length && !prep.length) return;
  let msgs = [];
  if(urg.length) {
    let m = '⏰ ALERTAS DE PRAZO\n\n';
    urg.forEach(p => {
      if(p.dias<0)      m += '🔴 VENCIDO há '+Math.abs(p.dias)+'d: '+p.nome+'\n';
      else if(p.dias===0) m += '🚨 VENCE HOJE: '+p.nome+'\nAção: '+(p.proxacao||'verificar')+'\n\n';
      else if(p.dias===1) m += '⚠️ AMANHÃ: '+p.nome+' ('+p.prazo+')\n';
      else                m += '📅 '+p.dias+'d: '+p.nome+' ('+p.prazo+')\n';
    });
    msgs.push(m);
  }
  if(prep.length) {
    let m = '📋 EM PREPARAÇÃO\n\n';
    prep.forEach(p => {
      const s = p.dias===0?'🔔 HOJE':p.dias<0?'🔴 ATRASADO '+Math.abs(p.dias)+'d':'📅 '+p.dias+'d';
      m += s+': '+p.nome+'\n';
      if(p.docsFaltantes) m += 'Falta: '+p.docsFaltantes+'\n';
      m += '\n';
    });
    msgs.push(m);
  }
  for(const m of msgs) await env(m);
}

function agendarProximoAlerta() {
  const agora = horaBrasilia();
  const hora = agora.getHours();
  const min = agora.getMinutes();
  const venceHoje = getPrazos(0).filter(p=>p.dias===0);
  const ehUltimoDia = venceHoje.length > 0;
  let proxHora = null;
  if(ehUltimoDia) {
    if(hora < HORA_LIMITE) proxHora = hora + 1;
  } else {
    proxHora = HORARIOS_NORMAIS.find(h=>h>hora||(h===hora&&min<1))||null;
  }
  if(proxHora !== null) {
    const ms = ((proxHora-hora)*60-min)*60000;
    setTimeout(async()=>{await enviarAlertas();agendarProximoAlerta();}, ms);
    console.log('Próximo alerta às '+proxHora+'h ('+Math.round(ms/60000)+'min)');
  } else {
    const amanha = new Date();
    amanha.setDate(amanha.getDate()+1);
    amanha.setHours(8,0,0,0);
    const ms = amanha - agora;
    setTimeout(async()=>{await enviarAlertas();agendarProximoAlerta();}, ms);
    console.log('Próximo alerta amanhã 08h ('+Math.round(ms/3600000)+'h)');
  }
}

setTimeout(()=>{enviarAlertas();agendarProximoAlerta();}, 2*60*1000);

// ══ SUPERVISÃO CEO ══
// Publica status do Lex CEO no Supabase para futura integração com Lex Escritório

async function publicarStatusCEO() {
  try {
    const hoje = new Date().toLocaleDateString('pt-BR');
    const urgentes = processos.filter(p=>p.status==='URGENTE').length;
    const emPrep = processos.filter(p=>p.status==='EM_PREP').length;
    const prazos = getPrazos(3).filter(p=>p.dias<=3).length;
    await sbUpsert('lex_status', {
      agente_id: 'lex_ceo',
      data: hoje,
      processos_total: processos.length,
      urgentes,
      em_preparacao: emPrep,
      prazos_criticos: prazos,
      sessoes_ativas: Object.keys(MEMORIA).length,
      uptime: Math.floor(process.uptime()),
      atualizado_em: new Date().toISOString()
    }, 'agente_id');
  } catch(e) { /* silencioso */ }
}

// Publicar status a cada hora
setInterval(publicarStatusCEO, 60*60*1000);

// ══ INIT ══
console.log('\nLEX ASSESSOR JURÍDICO IA');
console.log('Memória persistente: RAM + Supabase');
console.log('Supabase URL:', SB_URL);
console.log('Documentos: Petições, Perícias, Pareceres, Contratos, Procurações');
console.log('Porta:', process.env.PORT||3000,'\n');

// Boot — carrega processos do Supabase e inicia
async function bootInicio() {
  // Tenta carregar processos do cache Supabase
  try {
    const cache = await sbGet('processos_cache', {id:'lex_juridico'});
    if(cache && cache[0] && cache[0].dados) {
      processos = JSON.parse(cache[0].dados);
      console.log('Processos carregados do Supabase:', processos.length);
    }
  } catch(e) { console.log('Cache vazio — aguardando sincronização do Lex'); }

  // Avisa urgências se houver
  const urg = getPrazos(3).filter(a=>a.dias<=3);
  if(urg.length) {
    const avisos = urg.map(a=>(a.dias<0?'🔴 VENCIDO: ':a.dias===0?'🚨 HOJE: ':'⚠️ '+a.dias+'d: ')+a.nome).join('\n');
    await env('Sistema ativo. '+processos.length+' processos carregados.\n\n'+avisos);
  }

  poll();
}
bootInicio();
