// LEX ASSESSOR JURÍDICO IA — Agente com Memória Persistente + Supabase
// Memória por conversa, custas, processos não distribuídos, todos os documentos jurídicos
// node bot.js

const https = require('https');
const http = require('http');

const TK = '8319651078:AAEMGKWSs67Q_8eRinbpVUs0OpHHtx9xwqM';
const CHAT_ID = '696337324';
const AK = process.env.ANTHROPIC_KEY || '';

// Supabase
const SB_URL = process.env.SUPABASE_URL || '';
const SB_KEY = process.env.SUPABASE_KEY || '';

// Usuários autorizados para documentos restritos
const AUTORIZADOS = { '696337324': { nome:'Kleuber', perfil:'admin', ok:true } };

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
    const row = await carregarConversa(chatId, tId);
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

function sysAssessor(mem) {
  const hoje=new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  const procs=processos.length
    ? processos.map(p=>`- ${p.nome} | ${p.tribunal} | ${p.status}${p.prazo?' | Prazo:'+p.prazo:''}${p.proxacao?' | '+p.proxacao:''}${p.status==='EM_PREP'?' [NÃO DISTRIBUÍDO'+( p.prevDist?' — Prev:'+p.prevDist:'')+']':''}`)
        .join('\n')
    : 'Nenhum processo carregado.';

  const contexto = mem.casoAtual
    ? `\nCASO EM ATENDIMENTO: ${mem.casoAtual}\nDADOS COLETADOS: ${JSON.stringify(mem.dadosColetados)}\nAGUARDANDO: ${mem.aguardando||'nada'}`
    : '';

  return `Você é o Assessor Jurídico IA do escritório Camargos Advocacia & Consultoria Previdenciária, Unaí/MG.
Ghostwriter: Kleuber Melchior de Souza, OAB/MG nº 118.237.
Peças assinadas por: Wanderson Farias de Camargos (ou profissional informado pelo advogado).
Data: ${hoje}
${contexto}

PROCESSOS NO LEX:
${procs}

CONDUTA OBRIGATÓRIA:
1. MEMÓRIA: você lembra TUDO desta conversa — nunca perde o fio nem repete perguntas já respondidas
2. ASSESSOR REAL: debate estratégia, contesta sugestões inviáveis COM FUNDAMENTOS, não vende ilusões
3. JURISPRUDÊNCIA: cita apenas real e válida; analisa se favorável ou desfavorável ao caso específico; descarta a desfavorável
4. PRAZOS < 3 dias: destaca em MAIÚSCULAS com URGÊNCIA, conta dias exatos
5. CUSTAS: pergunta se foram pagas quando for protocolar; pergunta o TJ para orientar valores
6. PETIÇÃO INICIAL: coleta qualificação completa — nome, CPF, RG, endereço, estado civil, profissão
7. PETIÇÃO DE ANDAMENTO: usa "já qualificado nos autos do processo em epígrafe nº [número]"
8. PROFISSIONAL: pergunta nome e OAB/CRC quando não souber; nunca inventa dados
9. ADVOGADO DO PROCESSO: pergunta se continua ativo antes de assinar nova peça
10. PROCESSOS NÃO DISTRIBUÍDOS: pergunta o que falta, previsão de distribuição, lembra na data
11. TRIAGEM DE CLIENTE: quando descrever caso novo, pergunte: fatos, provas disponíveis, o que o cliente quer, urgência, valores envolvidos
12. DOCUMENTOS NECESSÁRIOS: liste quais documentos o cliente precisa trazer para cada tipo de ação
13. ATUALIZAÇÃO DO LEX: após cada movimentação relevante, lembre o advogado de atualizar o sistema
14. SUCUMBÊNCIA: não precisa mencionar salvo se perguntado
15. DEBATA: se o advogado sugerir estratégia equivocada, diga claramente por quê não funciona e proponha alternativa`;
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
    : `Wanderson Farias de Camargos, Advogado, [OAB/MG nº], Camargos Advocacia & Consultoria Previdenciária, Unaí/MG`;

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

  console.log('MSG ['+chatId+']:', txt||'[arquivo]');
  // Log de atividade
  logAtividade('juridico', chatId, txt?'mensagem':'arquivo', txt.substring(0,100));

  // ── ARQUIVO ──
  if(msg.document) {
    const doc=msg.document;
    const nome=doc.file_name||'documento';
    const isPdf=doc.mime_type==='application/pdf'||nome.toLowerCase().endsWith('.pdf');
    const isOk=isPdf||nome.toLowerCase().match(/\.(docx?|txt)$/);
    if(!isOk){await env('Formato não suportado. Envie PDF, DOCX ou TXT.',tId,chatId);return;}
    if(doc.file_size>20971520){await env('Arquivo muito grande ('+Math.round(doc.file_size/1048576)+'MB). Máx: 20MB.',tId,chatId);return;}

    await env('Analisando '+nome+'... aguarde.',tId,chatId);
    try {
      const buf=await baixar(doc.file_id);
      const analise=await analisarDoc(buf,isPdf,nome);

      // Adiciona ao histórico da memória
      mem.hist.push({role:'user',content:'[Documento enviado: '+nome+']'});

      let resp='ANÁLISE: '+nome+'\n\n'+(analise.resumo||'Documento analisado.');

      // Prazo em destaque
      if(analise.prazo) {
        const dias=calcDias(analise.prazo);
        if(dias!==null) {
          if(dias<0)       resp+='\n\n🔴 PRAZO VENCIDO em '+analise.prazo;
          else if(dias===0) resp+='\n\n🚨 PRAZO VENCE HOJE ('+analise.prazo+')';
          else if(dias<=3)  resp+='\n\n⚠️ PRAZO URGENTE: '+analise.prazo+' — FALTAM '+dias+' DIA(S)';
          else              resp+='\n\nPrazo: '+analise.prazo+' ('+dias+' dias)';
        }
      }

      // Custas
      if(analise.custas_necessarias) resp+='\n\n💰 ATENÇÃO: Esta peça pode exigir recolhimento de custas. As custas foram pagas?';

      // Jurisprudência
      if(analise.jurisprudencia) resp+='\n\nJurisprudência identificada:\n'+analise.jurisprudencia;

      // Processo existente
      const procEx=processos.find(p=>{
        const n1=(analise.numero_processo||'').replace(/[\s.\-\/]/g,'').toLowerCase();
        const n2=(p.numero||'').replace(/[\s.\-\/]/g,'').toLowerCase();
        return n1&&n2&&n1===n2;
      });
      if(procEx) resp+='\n\nProcesso no Lex: '+procEx.nome;

      // Documentos necessários para resposta
      if(analise.documentos_necessarios) resp+='\n\nDocumentos para resposta:\n'+analise.documentos_necessarios;

      await env(resp, tId, chatId);

      // Sugere resposta + lembra de atualizar Lex
      if(analise.eh_decisao&&analise.resposta_sugerida) {
        await env('Ação recomendada: '+analise.proxima_acao+'\nPeça sugerida: '+analise.resposta_sugerida+'\n\nPara gerar: "Gera '+analise.resposta_sugerida+(analise.nome_caso?' para '+analise.nome_caso:'')+'"', tId, chatId);
      }

      // Salva no contexto
      mem.casoAtual=analise.nome_caso||analise.numero_processo||nome;
      mem.hist.push({role:'assistant',content:'[Análise concluída: '+nome+'. Prazo: '+(analise.prazo||'nenhum')+']'});

      // Lembra de atualizar o Lex se for andamento relevante
      if(['decisao','sentenca','despacho','intimacao'].includes(analise.tipo)) {
        setTimeout(()=>env('📋 Lembre de atualizar este andamento no Lex para manter o histórico do processo.', tId, chatId), 3000);
      }

    } catch(e) {
      await env('Erro ao analisar: '+e.message, tId, chatId);
    }
    return;
  }

  if(!txt) return;

  // ── ADMIN: liberar/bloquear ──
  if(low.startsWith('/liberar ')&&chatId===CHAT_ID) {
    const id=txt.slice(9).trim();
    AUTORIZADOS[id]={nome:id,perfil:'advogado',ok:true};
    await env('✅ '+id+' autorizado para documentos restritos.',tId,chatId);
    return;
  }
  if(low.startsWith('/bloquear ')&&chatId===CHAT_ID) {
    const id=txt.slice(10).trim();
    if(AUTORIZADOS[id]) AUTORIZADOS[id].ok=false;
    await env('🔒 '+id+' bloqueado.',tId,chatId);
    return;
  }

  // ── COMANDOS SIMPLES ──
  if(low==='/start'||low==='oi'||low==='olá'||low==='ola') {
    const urg=getPrazos(3).filter(a=>a.dias<=3);
    const prep=getProcPrep();
    let m='Lex Assessor Jurídico IA\nCamargos Advocacia, Unaí/MG\n\n';
    if(urg.length) {
      m+='⚠️ PRAZOS URGENTES:\n';
      urg.forEach(a=>m+=(a.dias<=0?'🔴 VENCIDO':'⚠️ '+a.dias+' dia(s)')+': '+a.nome+' ('+a.prazo+')\n');
      m+='\n';
    }
    if(prep.length) {
      m+='📋 DISTRIBUIÇÃO PREVISTA:\n';
      prep.forEach(a=>m+=(a.dias===0?'🔔 HOJE':'📅 '+a.dias+' dia(s)')+': '+a.nome+' ('+a.prevDist+')\n');
      m+='\n';
    }
    m+='Envie documento ou descreva o caso.\n/prazos /processos /prep /ajuda';
    await env(m,tId,chatId);
    return;
  }

  if(low==='/prazos') {await env(formatPrazos(getPrazos(15)),tId,chatId);return;}

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

  if(low==='/status') {
    await env('Lex Bot ativo\nIA: OK\nProcessos: '+processos.length+'\nMemória: '+Object.keys(MEMORIA).length+' sessões\n'+new Date().toLocaleString('pt-BR')+'\nServidor: Render 24h',tId,chatId);
    return;
  }

  if(low==='/ajuda'||low==='/help') {
    const ok=AUTORIZADOS[chatId]?.ok;
    let m='COMANDOS\n\nEnviar PDF/DOCX — análise automática\n/prazos — prazos críticos\n/processos — lista\n/prep — processos em preparação\n/processo [nome] — detalhes\n/limpar — resetar memória desta conversa\n/status — status do bot';
    if(ok) m+='\n\nDOCUMENTOS:\n"Preciso de [tipo] para [caso]"\n"Gera petição inicial para [cliente]"\n"Faz perícia contábil do [caso]"\n"Elabora parecer sobre [tema]"\n"Contrato de honorários para [cliente]"\n"Procuração para [cliente]"';
    m+='\n\nOu converse livremente — sou seu assessor.';
    await env(m,tId,chatId);
    return;
  }

  // ── CONVERSA COM MEMÓRIA PERSISTENTE ──
  mem.hist.push({role:'user',content:txt});
  if(mem.hist.length>30) mem.hist=mem.hist.slice(-30); // mantém últimas 30 trocas

  try {
    await env('Pensando...',tId,chatId);
    const resposta=await ia(mem.hist, sysAssessor(mem), 2500);
    mem.hist.push({role:'assistant',content:resposta});
    // Salva memória no Supabase em background
    salvarMemoria(chatId, tId);

    // Envia resposta em partes se necessário
    if(resposta.length<=3800) {
      await env(resposta,tId,chatId);
    } else {
      const partes=Math.ceil(resposta.length/3800);
      for(let i=0;i<partes;i++){
        await env((partes>1?'('+( i+1)+'/'+partes+') ':'')+resposta.slice(i*3800,(i+1)*3800),tId,chatId);
        if(i<partes-1) await new Promise(r=>setTimeout(r,700));
      }
    }

    // Detecta pedido de geração de documento
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
    const data=await httpsGet('https://api.telegram.org/bot'+TK+'/getUpdates?offset='+(lastUpdateId+1)+'&timeout=30');
    if(data.ok&&data.result?.length) {
      for(const u of data.result){
        lastUpdateId=u.update_id;
        if(u.message) await processar(u.message).catch(e=>console.error('Erro:',e.message));
      }
    }
  } catch(e){console.error('Poll:',e.message);}
  setTimeout(poll,3000);
}

// ══ HTTP KEEPALIVE ══
http.createServer((_,res)=>{
  res.writeHead(200,{'Content-Type':'text/plain'});
  res.end('Lex OK|Processos:'+processos.length+'|Sessoes:'+Object.keys(MEMORIA).length+'|Up:'+Math.floor(process.uptime())+'s');
}).listen(process.env.PORT||3000,()=>console.log('HTTP porta',process.env.PORT||3000));

// ══ ALERTAS AUTOMÁTICOS ══
async function alertaAutomatico() {
  const urg=getPrazos(3).filter(a=>a.dias<=3);
  const prep=getProcPrep();
  let msgs=[];
  if(urg.length) msgs.push('⚠️ ALERTA PRAZO\n\n'+formatPrazos(urg));
  if(prep.length) {
    let m='📋 ALERTA DISTRIBUIÇÃO\n\n';
    prep.forEach(p=>m+=(p.dias===0?'🔔 HOJE':'📅 '+p.dias+' dia(s)')+': '+p.nome+(p.prevDist?' ('+p.prevDist+')':'')+'\nFaltando: '+(p.docsFaltantes||'verificar')+'\n\n');
    msgs.push(m);
  }
  for(const m of msgs) await env(m);
  setTimeout(alertaAutomatico, 6*60*60*1000);
}
setTimeout(alertaAutomatico, 3*60*1000);

// ══ INIT ══
console.log('\nLEX ASSESSOR JURÍDICO IA');
console.log('Memória persistente: RAM + Supabase');
console.log('Supabase URL:', SB_URL);
console.log('Documentos: Petições, Perícias, Pareceres, Contratos, Procurações');
console.log('Porta:', process.env.PORT||3000,'\n');

env('Lex Assessor Jurídico IA\nCamargos Advocacia, Unaí/MG\n\nMemória persistente ativa — lembro de toda a conversa mesmo após reiniciar.\n\nEnvie PDF/DOCX para análise\nDescreva qualquer caso ou problema\n/prazos /processos /prep /ajuda').then(()=>poll());
