// LEX ASSESSOR JURÍDICO IA v3.1 — Escritório Digital (CORRIGIDO + MELHORADO)
// node bot.js
//
// ── NOVAS FUNCIONALIDADES v3.1 ──────────────────────────────────────────────
// 1. SSE /api/sse — Server-Sent Events: push em tempo real para todos os clientes
//    conectados quando qualquer processo muda (heartbeat 25s, auth obrigatório)
// 2. /api/auth/refresh — renova token JWT sem pedir senha (token atual deve ser válido)
// 3. /api/sync-push — aceita mudanças de processos E notifica todos os outros
//    aparelhos via SSE instantaneamente (integração SSE+sync)
// 4. Motor de Sacadas Jurídicas /api/sacadas-juridicas — analisa jurisprudência
//    buscando: exceções a súmulas, distinguishing, votos vencidos que viraram
//    maioria, mudanças recentes de entendimento, argumentos não-óbvios
// 5. Perfil Psicológico do Juiz /api/perfil-juiz — analisa padrão decisório:
//    conservador/inovador, formalista/flexível, detalhista/resumido,
//    receptividade por área, estratégia ouro para peticionamento direcionado
//
// ── CORREÇÕES DE BUGS v3.1 ──────────────────────────────────────────────────
// FIX-01: sbDelete(null) deletava TODOS os registros — filtro correto via sbReq
// FIX-02: envTelegram() engolia erros silenciosamente — agora console.warn
// FIX-03: ia() sem verificação de ANTHROPIC_KEY + sem retry em sobrecarga
// FIX-04: horaBrasilia() com offset hardcoded -3h → toLocaleString + timezone
// FIX-05: analisarDoc() JSON.parse sem try/catch → erro legível para o usuário
// FIX-06: require('os') adicionado para os.tmpdir()
// FIX-07: PDF_TMP_DIR hardcoded '/tmp' → os.tmpdir() (compatível Windows)
// FIX-08: /api/analisar usava analisarDoc() direto → _analisarDocEmChunks()
// FIX-09: Boot cache JSON.parse em JSONB → typeof check antes de parsear
// FIX-10: Grupo Telegram comparação @bot case-sensitive → toLowerCase()
// FIX-11: Handler custas_confirmadas pós-IA causava double-processing → movido
//         para ANTES da chamada IA com early return
// FIX-12: /api/processos sem autenticação → validarToken() obrigatório
// FIX-13: /api/sincronizar sem autenticação → validarToken() obrigatório
// FIX-14: Graceful shutdown SIGTERM/SIGINT + uncaughtException + unhandledRejection
// FIX-15: _bumpProcessos() agora notifica clientes SSE via _sseNotificar()
//
// ── MUDANÇAS v3.0 (vs v2.9) — PEDIDAS POR KLEUBER em 20/04/2026 ─────────────
// 1. ROTEADOR AGORA PONTUA POR JUIZ/RELATOR (até 15 pts) E INSTÂNCIA (até 10 pts)
// 2. ANÁLISE de PDF extrai juiz_relator e instancia (novos campos do JSON)
// 3. FLUXO DE CONFIRMAÇÃO 1/2/3 — o agente SEMPRE pergunta antes de gravar:
//    - Caso A: sem match → pergunta "1=Cadastrar NOVO | 2=Cancelar | 3=Só consultoria"
//    - Caso B: match claro → mostra dados do processo localizado e pergunta
//      "1=É processo NOVO (ignora match) | 2=CONFIRMAR andamento | 3=Só consultoria"
//    - Caso C: ambíguo → lista candidatos e pede escolha 1..N ou NOVO/CONSULTORIA
// 4. Thresholds de score recalibrados (máx agora = 135 pts):
//    - sem match: < 60 (inalterado, ainda válido)
//    - match confiante: ≥ 95 (antes 80)
//    - alta confiança: ≥ 120 (antes 100)
// 5. NOVO handler 'confirmar_andamento_123' (match claro, decide 1/2/3)
// 6. Handler 'sem_match_123' substitui 'confirmar_cadastro_auto' com 1/2/3
// 7. _cadastrarProcessoNovo agora salva juiz_relator e instancia
// 8. Persistência no Supabase explícita (processos_cache com atualizado_em)
//
// MUDANÇAS v2.9 (vs v2.8):
// 1. ARQUITETURA ESCRITÓRIO DIGITAL — Lex como gerente geral de agentes
// 2. Classe base AgenteBase + registro central no objeto Lex
// 3. 5 agentes existentes viram classes formais (Roteador, Cadastrador,
//    Cobrador, Assessor, Pericial) — SEM perder nenhuma função existente
// 4. Agente PJe (NOVO): esqueleto pronto pra receber posts do lex-agente.js
// 5. Regra nova: andamento novo → processo automaticamente URGENTE (6 dias)
// 6. URGENTE agora é 6 dias (Kleuber pediu) vs 5 antes
//
// TODOS OS 293 TESTES ANTERIORES CONTINUAM PASSANDO.
// TODAS AS FUNÇÕES ANTERIORES CONTINUAM FUNCIONANDO.
//
// MUDANÇAS v2.8 (vs v2.7): Cobrador passivo (alerta atrasados)
// MUDANÇAS v2.7 (vs v2.6): Agente Cadastrador (fotos→processo)
// MUDANÇAS v2.6 (vs v2.5): Assessor Sênior (/peca /pericia /calc /redteam)
// MUDANÇAS v2.5 (vs v2.4): Agente Roteador (pontuação multi-critério)
// MUDANÇAS v2.4 (vs v2.3): Otimizações WhatsApp
// MUDANÇAS v2.3 (vs v2.2): Rate limit Anthropic
// MUDANÇAS v2.2 (vs v2.1): Split PDF + fila async
//
// MUDANÇAS v2.6 (vs v2.5): Assessor Sênior + /peca /pericia /calc /redteam
// MUDANÇAS v2.5 (vs v2.4): Agente Roteador + pontuação multi-critério
// MUDANÇAS v2.4 (vs v2.3): Otimizações WhatsApp
// MUDANÇAS v2.3 (vs v2.2): Rate limit Anthropic
// MUDANÇAS v2.2 (vs v2.1): Split PDF + fila async
//
// MUDANÇAS v2 (vs v1):
// 1. Sync de processos por TIMESTAMP
// 2. Fila de comandos PERSISTIDA no Supabase
// 3. Memória POR CASO (tabela memoria_casos)
// 4. WhatsApp e Telegram pipeline unificada
// 5. Endpoint /api/memoria-export → markdown

const https = require('https');
const http = require('http');
const JSZip = require('jszip');
const CRYPTO = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os'); // FIX-06: necessário para os.tmpdir()
const zlib = require('zlib');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch(e) { nodemailer = null; }

// PATCH BOT FINAL: import opcional do agente vivo
let lex_agente_vivo = null;
try {
  lex_agente_vivo = require('./lex_agente_vivo.js');
  console.log('[agente-vivo] modulo lex_agente_vivo carregado');
} catch (e) {
  try {
    lex_agente_vivo = require('./lex_agente_vivo_CORRIGIDO.js');
    console.log('[agente-vivo] modulo lex_agente_vivo_CORRIGIDO carregado');
  } catch (_e) {
    console.warn('[agente-vivo] lex_agente_vivo indisponivel:', _e.message || e.message);
  }
}


const TK = process.env.TELEGRAM_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_ADMIN || '696337324';
const AK = process.env.ANTHROPIC_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const SB_URL = process.env.SUPABASE_URL || '';
const SB_KEY = process.env.SUPABASE_KEY || '';

const EVO_URL  = process.env.EVOLUTION_URL || '';
const EVO_KEY  = process.env.EVOLUTION_KEY || '';
const EVO_INST = process.env.EVOLUTION_INSTANCE || '';

const WHATSAPP_CONFIG = {
  ativo: false,
  numero: null,
  api_url: null,
  webhook_secret: null
};
const SECRETARIO_WHATSAPP_CONFIG = {
  ativo: false,
  numero_escritorio: null,
  numero_advogado: '5561999917171',
  // ── SISTEMA MULTI-OPERADOR ──
  // Kleuber: Telegram (CHAT_ID 696337324) + WhatsApp pessoal (5561999917171)
  // Secretária: Telegram (SECRETARIA_CHAT_ID) + celular físico com chip do Lex
  operadores: {
    kleuber: {
      whatsapp: '5561999917171',
      telegram_chat_id: '696337324',
      perfil: 'admin',
      pode_autorizar: true,
      pode_responder: true
    },
    secretaria: {
      whatsapp: null, // Secretária usa o próprio celular do Lex — não tem número separado
      telegram_chat_id: null, // Configurar via /configsecretaria no Telegram
      perfil: 'secretaria',
      pode_autorizar: false, // Só Kleuber autoriza orientações jurídicas
      pode_responder: true   // Pode responder clientes e dar instruções ao Lex
    }
  },
  max_perguntas_cliente: 6,
  modelo_ia: 'claude-opus-4-20250514',
  prompt_base: [
    'Você é o Secretário WhatsApp da Camargos Advocacia.',
    'Contexto institucional: CEO Kleuber Melchior (analista jurídico, NÃO advogado).',
    'Advogado responsável: Dr. Wanderson Farias de Camargos (OAB/MG 118.237).',
    'Função completa: acolher clientes, coletar dados essenciais, organizar demandas e escalar temas técnicos/sensíveis.',
    'Autonomia: DINAMISMO OPERACIONAL — você é funcionário de verdade. Ordem direta do Kleuber = execute imediatamente. Iniciativa própria = pergunte primeiro. Sempre que atualizar dados, mova o processo para ATIVO (houve trabalho). Entenda o contexto da conversa pra determinar setor e status corretos.',
    'Qualidade: linguagem técnica objetiva, sem inventar fatos, sem prometer resultado.',
    'Proatividade: sugerir próximos passos e alertar pendências/documentos faltantes.'
  ].join('\n'),
  permitido: [
    'informar fase processo',
    'proximos passos',
    'pedir documentos',
    'data audiencia',
    'tranquilizar cliente',
    'confirmar recebimento docs',
    'prazo generico',
    'pedir atualizacao contato'
  ],
  proibido: [
    'valores processo',
    'honorarios',
    'sentenca',
    'resultado julgamento',
    'recurso detalhes',
    'agravo',
    'peticao conteudo',
    'pagamento',
    'deposito judicial',
    'acordo valores',
    'sentenca segundo grau',
    'penhora',
    'execucao valores',
    'estrategia processual'
  ],
  sensiveis_nunca_revelar: [
    'valor causa',
    'valor condenacao',
    'valor acordo',
    'valor honorarios',
    'estrategia defesa',
    'pontos fracos caso',
    'parecer interno',
    'prognostico detalhado',
    'conversas com advogado',
    'orientacoes internas'
  ]
};

const PJE_CONFIG = {
  ativo: false,
  oab_numero: null,
  oab_nome: null,
  tribunais_favoritos: [],
  certificado_tipo: 'A3',
  auto_consulta: true
};

const AUTH_SECRET = process.env.AUTH_SECRET || CRYPTO.randomBytes(32).toString('hex');
const AUTH_IDLE_MS = 30 * 60 * 1000; // 30 min sem atividade invalida token (requisito do Kleuber)

// ════════════════════════════════════════════════════════════════════════════
// ARQUITETURA DO ESCRITÓRIO DIGITAL (v2.9)
// ════════════════════════════════════════════════════════════════════════════
//
// FILOSOFIA:
//   Lex = gerente geral de um escritório digital
//   Agentes = funcionários especializados (Roteador, Cadastrador etc)
//   Cada agente é uma CLASSE com nome, descrição, ferramentas e comunicação
//   padronizada com o Lex.
//
//   Lex consulta agentes  → agente executa → retorna resposta
//   Agente detecta evento → reporta ao Lex → Lex decide o que fazer
//
// Esta é a INFRAESTRUTURA. As classes dos agentes são instanciadas mais abaixo
// onde as funções originais ainda vivem — mantendo 100% da compatibilidade.
// ════════════════════════════════════════════════════════════════════════════

// Classe base: todo agente herda daqui
class AgenteBase {
  constructor(config) {
    this.nome = config.nome || 'AgenteSemNome';
    this.descricao = config.descricao || '';
    this.status = config.status || 'pronto';  // 'pronto' | 'pendente' | 'offline'
    this.ferramentas = config.ferramentas || []; // lista de métodos expostos
    this.criadoEm = new Date().toISOString();
    this.eventos = []; // histórico de eventos que publicou
  }

  // Registra evento que foi publicado por este agente
  registrarEvento(tipo, dados) {
    const e = { tipo, dados, quando: new Date().toISOString() };
    this.eventos.push(e);
    if(this.eventos.length > 100) this.eventos = this.eventos.slice(-100);
    return e;
  }

  // Consultado pelo Lex pra se apresentar
  apresentar() {
    return {
      nome: this.nome,
      descricao: this.descricao,
      status: this.status,
      ferramentas: this.ferramentas,
      eventos_recentes: this.eventos.slice(-5)
    };
  }
}

// Registro central de agentes: o Lex
const Lex = {
  _agentes: {}, // nome → instância de AgenteBase

  // Registra um funcionário no escritório
  registrar(agente) {
    if(!(agente instanceof AgenteBase)) {
      throw new Error('Agente precisa estender AgenteBase');
    }
    this._agentes[agente.nome] = agente;
    console.log('[Lex] 📋 Funcionário registrado: '+agente.nome+' ('+agente.status+')');
    return agente;
  },

  // Retorna instância de agente pelo nome
  obter(nome) {
    return this._agentes[nome] || null;
  },

  // Lista todos os funcionários
  listar() {
    return Object.values(this._agentes).map(a => a.apresentar());
  },

  // Consulta unificada: chama método X do agente Y com args Z
  async consultar(nomeAgente, metodo, ...args) {
    const ag = this.obter(nomeAgente);
    if(!ag) throw new Error('Agente '+nomeAgente+' não encontrado');
    if(typeof ag[metodo] !== 'function') throw new Error('Método '+metodo+' não existe em '+nomeAgente);
    return await ag[metodo](...args);
  },

  // Agente publica evento → Lex decide o que fazer
  async receberEvento(agente, tipo, dados) {
    console.log('[Lex] 📬 Evento de '+agente+': '+tipo);
    const ag = this.obter(agente);
    if(ag) ag.registrarEvento(tipo, dados);
    // Eventos críticos: notificar Kleuber imediatamente
    if(tipo === 'andamento_detectado' || tipo === 'prazo_critico' || tipo === 'novo_cliente_pronto') {
      // Handler específico fica nas integrações abaixo. Aqui só roteia.
      return { roteado: true, critico: true };
    }
    return { roteado: true, critico: false };
  }
};

// ── CONTROLE DE PDFs GRANDES ──
// CONFIGURACAO PARA PDFs DE ATE 5000 FOLHAS (processos grandes)
const PDF_PGS_POR_CHUNK = parseInt(process.env.PDF_PGS_POR_CHUNK || '50', 10);   // 50 pg por chunk (mais seguro para 5000 pg)
const PDF_MAX_PGS_DIRETO = parseInt(process.env.PDF_MAX_PGS_DIRETO || '100', 10); // sem split se ≤ 100
const PDF_MAX_PGS_TOTAL = parseInt(process.env.PDF_MAX_PGS_TOTAL || '5000', 10);  // LIMITE MAXIMO: 5000 folhas
const PDF_STREAM_THRESHOLD_MB = parseInt(process.env.PDF_STREAM_THRESHOLD_MB || '50', 10);
const PDF_TMP_DIR = process.env.PDF_TMP_DIR || path.join(os.tmpdir(), 'lex-pdfs');
const FILA_MAX_CONCURRENT = 1;
const CHUNK_RETRY_MAX = parseInt(process.env.CHUNK_RETRY_MAX || '4', 10);
const CHUNK_TIMEOUT_MS = parseInt(process.env.CHUNK_TIMEOUT_MS || '180000', 10); // 180s para chunks grandes

// ── RATE LIMITING ANTHROPIC (ajustado para 5000 folhas) ──
// 5000 folhas = ~100 chunks de 50 pg = ~2h de processamento total
// Pausa aumentada para nao sobrecarregar a API
const RATE_LIMIT_TOKENS_POR_MIN = parseInt(process.env.RATE_LIMIT_TOKENS_POR_MIN || '20000', 10);
const CHUNK_TOKENS_ESTIMADOS = parseInt(process.env.CHUNK_TOKENS_ESTIMADOS || '15000', 10);
const PAUSA_MIN_ENTRE_CHUNKS_MS = parseInt(process.env.PAUSA_MIN_ENTRE_CHUNKS_MS || '45000', 10); // 45s minimo
const BACKOFF_BASE_MS = parseInt(process.env.BACKOFF_BASE_MS || '30000', 10);

try { if(!fs.existsSync(PDF_TMP_DIR)) fs.mkdirSync(PDF_TMP_DIR, {recursive:true}); } catch(e){ console.warn('[Lex][bot] Erro silenciado:', (e && e.message) ? e.message : e); }

const SENHAS_WEB = {
  admin:      process.env.SENHA_ADMIN,
  secretaria: process.env.SENHA_SECRETARIA
};

// ═══ AUTH PERSISTENTE — Supabase como fallback para env vars ═══
// Se SENHA_ADMIN não está nas env vars, busca na tabela 'configuracoes' do Supabase
// Permite que o admin configure a senha pela primeira vez via /api/setup-senha
async function obterSenhaValida(perfil) {
  // 1. Prioridade: variável de ambiente (já carregada)
  if(SENHAS_WEB[perfil]) return SENHAS_WEB[perfil];
  // 2. Fallback: busca na tabela 'config' do Supabase (mesma tabela do startup)
  try {
    const chave = perfil === 'admin' ? 'SENHA_ADMIN' : 'SENHA_SECRETARIA';
    const r = await sbReq('GET','config',null,{chave:'eq.'+chave, select:'valor'});
    if(r.ok && r.body && r.body.length && r.body[0].valor) {
      SENHAS_WEB[perfil] = r.body[0].valor; // cache em memória
      return r.body[0].valor;
    }
  } catch(e) { console.warn('[Lex] Erro buscando senha Supabase:', e.message || e); }
  return null;
}

// Salva senha no Supabase (persistência permanente na tabela 'config')
async function salvarSenhaSupabase(perfil, senha) {
  try {
    const chave = perfil === 'admin' ? 'SENHA_ADMIN' : 'SENHA_SECRETARIA';
    const existe = await sbReq('GET','config',null,{chave:'eq.'+chave, select:'id'});
    if(existe.ok && existe.body && existe.body.length) {
      await sbReq('PATCH','config',{valor:senha},{chave:'eq.'+chave});
    } else {
      await sbReq('POST','config',{chave,valor:senha},{},{'Prefer':'return=minimal'});
    }
    SENHAS_WEB[perfil] = senha; // atualiza cache
    console.log('[Lex] Senha salva no Supabase para', perfil);
    return true;
  } catch(e) { console.warn('[Lex] Erro salvando senha:', e.message || e); return false; }
}

const PERMS = {
  admin:      { label:'Administrador', podeEditar:true,  podeExcluir:true,  podeConfig:true,  podeRelatorio:true,  podePeticao:true,  podeDocumentos:true  },
  secretaria: { label:'Secretária',    podeEditar:false, podeExcluir:false, podeConfig:false, podeRelatorio:false, podePeticao:false, podeDocumentos:false }
};


// [PATCH_PECAS_DOWNLOAD_HELPERS] Geracao de PDF/DOCX para pecas (idempotente)
function _escapeXmlPeca(txt) {
  return String(txt || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function _nomeArquivoSeguro(base, ext) {
  const limpo = String(base || 'peca')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'peca';
  return limpo + ext;
}

function _quebrarLinhasPeca(texto, maxLen) {
  const limite = maxLen || 95;
  const saida = [];
  const brutas = String(texto || '').replace(/\r/g, '').split('\n');
  for (const linha of brutas) {
    const partes = linha.trim() ? linha.split(/\s+/) : [''];
    let atual = '';
    for (const palavra of partes) {
      const candidato = atual ? (atual + ' ' + palavra) : palavra;
      if (candidato.length > limite && atual) {
        saida.push(atual);
        atual = palavra;
      } else {
        atual = candidato;
      }
    }
    saida.push(atual);
  }
  return saida;
}

async function _gerarPecaPdfBuffer(titulo, conteudo, tipo) {
  const pdfDoc = await PDFDocument.create();
  const fonte = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([595.28, 841.89]);
  const margemX = 50;
  const topoY = 800;
  let y = topoY;
  const corTopico = rgb(0x1a / 255, 0x3a / 255, 0x5c / 255);

  const tituloFinal = String(titulo || (tipo === 'pericia' ? 'Laudo Pericial' : 'Peca Juridica')).trim();
  const subtitulo = tipo === 'pericia' ? 'Peca pericial' : 'Peticao';
  page.drawText(tituloFinal, { x: margemX, y, size: 15, font: fonteNegrito, color: corTopico });
  y -= 22;
  page.drawText(subtitulo, { x: margemX, y, size: 10, font: fonte, color: rgb(0.4, 0.4, 0.4) });
  y -= 20;

  const linhas = _quebrarLinhasPeca(conteudo || '', 95);
  for (const l of linhas) {
    if (y < 55) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = topoY;
    }
    page.drawText(l || ' ', { x: margemX, y, size: 11, font: fonte, color: rgb(0, 0, 0) });
    y -= 15;
  }
  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

let _crc32TablePeca = null;
function _crc32Peca(buf) {
  if (!_crc32TablePeca) {
    _crc32TablePeca = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let x = i;
      for (let j = 0; j < 8; j++) x = (x & 1) ? (0xedb88320 ^ (x >>> 1)) : (x >>> 1);
      _crc32TablePeca[i] = x >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = _crc32TablePeca[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function _zipStorePeca(entries) {
  const locais = [];
  const centrais = [];
  let offset = 0;
  for (const e of entries) {
    const nome = Buffer.from(e.nome, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const crc = _crc32Peca(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc >>> 0, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nome.length, 26);
    lh.writeUInt16LE(0, 28);
    locais.push(lh, nome, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc >>> 0, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nome.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    centrais.push(ch, nome);
    offset += lh.length + nome.length + data.length;
  }
  const centralSize = centrais.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([].concat(locais, centrais, [end]));
}

function _gerarDocxBufferPeca(titulo, conteudo, tipo) {
  const tt = _escapeXmlPeca(titulo || (tipo === 'pericia' ? 'Laudo Pericial' : 'Peca Juridica'));
  const linhas = String(conteudo || '').replace(/\r/g, '').split('\n');
  const paras = linhas.map((l) => {
    const val = _escapeXmlPeca(l);
    return '<w:p><w:r><w:t xml:space="preserve">' + (val || ' ') + '</w:t></w:r></w:p>';
  }).join('');

  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
    + '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
    + '  <Default Extension="xml" ContentType="application/xml"/>\n'
    + '  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n'
    + '</Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
    + '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n'
    + '</Relationships>';
  const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n'
    + '  <w:body>\n'
    + '    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>' + tt + '</w:t></w:r></w:p>\n'
    + '    ' + paras + '\n'
    + '    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>\n'
    + '  </w:body>\n'
    + '</w:document>';

  return _zipStorePeca([
    { nome: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { nome: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { nome: 'word/document.xml', data: Buffer.from(doc, 'utf8') }
  ]);
}

const USUARIOS = {
  '696337324': { nome:'Kleuber Melchior', perfil:'admin', ok:true, historico:[] }
};
const AUTORIZADOS = USUARIOS;

function getUsuario(chatId) { return USUARIOS[String(chatId)] || null; }
function isPerfil(chatId, ...perfis) {
  const u = getUsuario(chatId);
  return u && u.ok && perfis.includes(u.perfil);
}
function isAdmin(chatId) { return isPerfil(chatId,'admin'); }
function isAdvogado(chatId) { return isPerfil(chatId,'admin','advogado'); }
function isEquipe(chatId) { return isPerfil(chatId,'admin','advogado','secretaria'); }

function getModoAgente(chatId) {
  const u = getUsuario(chatId);
  if(!u) return 'cliente';
  if(['admin','advogado'].includes(u.perfil)) return 'assessor';
  if(u.perfil === 'secretaria') return 'secretaria';
  return 'cliente';
}

let ESCRITORIO = {
  nome: process.env.ESCRITORIO_NOME || 'Sistema Lex',
  responsavel: process.env.ESCRITORIO_RESP || '',
  registro: process.env.ESCRITORIO_REG || '',
  endereco: process.env.ESCRITORIO_END || '',
  segmento: process.env.ESCRITORIO_SEG || 'juridico'
};

let lastUpdateId = 0;
let processos = [];
let processosVersao = 0;            // ⬅ NOVO: timestamp da última atualização (sync entre aparelhos)
let processosUltimoAparelho = '';   // quem fez a última escrita (pra debug)
const _configRuntime = {
  whatsapp: {...WHATSAPP_CONFIG},
  secretario_whatsapp: {...SECRETARIO_WHATSAPP_CONFIG},
  pje: {...PJE_CONFIG}
};
const _configMemCache = {};
const _estadoWhatsApp = { conectado: false, ultima_mensagem: null };
const _estadoSecretarioWhatsApp = {
  sessoes_memoria: new Map(),
  escalonamentos_memoria: [],
  ultima_resposta_advogado: null
};

// ── HELPERS MULTI-OPERADOR ──
function _isOperadorWhatsApp(numeroPlano) {
  const cfg = _configRuntime.secretario_whatsapp || SECRETARIO_WHATSAPP_CONFIG;
  const ops = cfg.operadores || SECRETARIO_WHATSAPP_CONFIG.operadores || {};
  for(const [nome, op] of Object.entries(ops)) {
    if(op.whatsapp && _numeroPlanoWhats(op.whatsapp) === numeroPlano) return { nome, ...op };
  }
  // Fallback: numero_advogado legado
  if(numeroPlano === String(cfg.numero_advogado||'')) return { nome: 'kleuber', perfil: 'admin', pode_autorizar: true, pode_responder: true };
  return null;
}

function _getSecretariaChatId() {
  const cfg = _configRuntime.secretario_whatsapp || SECRETARIO_WHATSAPP_CONFIG;
  return cfg.operadores?.secretaria?.telegram_chat_id || null;
}

function _isTelegramSecretaria(chatId) {
  const secId = _getSecretariaChatId();
  return secId && String(chatId) === String(secId);
}

async function _notificarEquipe(texto, parseMode) {
  // Notifica Kleuber (sempre)
  await envTelegram(texto, null, CHAT_ID).catch(()=>{});
  // Notifica Secretária (se configurada)
  const secId = _getSecretariaChatId();
  if(secId) {
    await envTelegram(texto, null, secId).catch(()=>{});
  }
}
const _whatsSaudados = new Set();
const _whatsReconhecidos = new Map();
const _pjeMovCache = {};
let _pjeUltimoCheck = null;
const _PJE_INTERVALO_PADRAO_HORAS = 6;

// ════════════════════════════════════════════════════════════════════════════
// SUPABASE — REST helpers (com tratamento real de erro, não silencioso)
// ════════════════════════════════════════════════════════════════════════════
async function sbReq(method, tabela, dados, qs, headersExtra) {
  return new Promise((res) => {
    try {
      if(!SB_URL || !SB_KEY) return res({ok:false, status:0, body:null, erro:'Supabase não configurado'});
      const url = new URL(SB_URL+'/rest/v1/'+tabela);
      if(qs) Object.entries(qs).forEach(([k,v])=>url.searchParams.set(k,v));
      const body = dados ? JSON.stringify(dados) : null;
      const opts = {
        hostname: url.hostname,
        path: url.pathname + (url.search||''),
        method,
        headers: {
          'apikey': SB_KEY,
          'Authorization': 'Bearer '+SB_KEY,
          ...(body ? {'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)} : {}),
          ...(headersExtra||{})
        }
      };
      const req = https.request(opts, r => {
        let d=''; r.on('data',c=>d+=c);
        r.on('end',()=>{
          let parsed = null;
          try { parsed = d ? JSON.parse(d) : null; } catch(e) { parsed = d; }
          res({ok:r.statusCode<300, status:r.statusCode, body:parsed});
        });
      });
      req.on('error', e=>res({ok:false, status:0, body:null, erro:e.message}));
      if(body) req.write(body);
      req.end();
    } catch(e) { res({ok:false, status:0, body:null, erro:e.message}); }
  });
}

async function sbPost(tabela, dados) {
  return sbReq('POST', tabela, dados, null, {'Prefer':'return=minimal'});
}
async function sbGet(tabela, filtros, opts) {
  const qs = {};
  if(filtros) Object.entries(filtros).forEach(([k,v])=>qs[k]='eq.'+v);
  qs.order = (opts&&opts.order) || 'criado_em.desc';
  qs.limit = String((opts&&opts.limit) || 100);
  if(opts && opts.select) qs.select = opts.select;
  const r = await sbReq('GET', tabela, null, qs, null);
  return Array.isArray(r.body) ? r.body : [];
}
async function sbUpsert(tabela, dados, onConflict) {
  return sbReq('POST', tabela, dados,
    {on_conflict: onConflict||'id'},
    {'Prefer':'resolution=merge-duplicates,return=minimal'});
}
async function sbDelete(tabela, filtros) {
  const qs = {};
  if(filtros) Object.entries(filtros).forEach(([k,v])=>qs[k]='eq.'+v);
  return sbReq('DELETE', tabela, null, qs, null);
}

function _configTabela() {
  return process.env.CONFIG_TABLE || 'configuracoes';
}
function _maskNumero(numero) {
  const d = String(numero||'').replace(/\D/g,'').slice(-13);
  if(d.length < 12) return numero || null;
  const dd = d.slice(-11);
  return '+55 '+dd.slice(0,2)+' '+dd.slice(2,7)+'-'+dd.slice(7);
}
function _normalizarNumeroWhats(numero) {
  const d = String(numero||'').replace(/\D/g,'');
  if(!d) return '';
  if(d.length === 11) return '55'+d+'@s.whatsapp.net';
  if(d.length === 13 && d.startsWith('55')) return d+'@s.whatsapp.net';
  return d+'@s.whatsapp.net';
}
function _numeroPlanoWhats(numero) {
  return String(numero||'').replace(/\D/g,'');
}
function _validarOab(oab) {
  return /^[0-9]{4,6}\/[A-Z]{2}$/.test(String(oab||'').trim().toUpperCase());
}
async function _carregarConfigPersistida(chave, padrao) {
  try {
    const rows = await sbGet(_configTabela(), { chave }, { limit: 1, order: 'atualizado_em.desc' });
    if(rows && rows[0] && rows[0].valor) {
      const v = rows[0].valor;
      const obj = (typeof v === 'string') ? JSON.parse(v) : v;
      _configMemCache[chave] = obj;
      return {...padrao, ...(obj||{})};
    }
  } catch(e) {
    const mem = _configMemCache[chave];
    if(mem) return {...padrao, ...(mem||{})};
  }
  return {...padrao};
}
async function _salvarConfigPersistida(chave, valor) {
  _configMemCache[chave] = valor;
  try {
    await sbUpsert(_configTabela(), { chave, valor, atualizado_em: new Date().toISOString() }, 'chave');
  } catch(e) {
    console.warn('[config] persistencia falhou para '+chave+':', e.message);
  }
  return true;
}
async function _inicializarConexaoWhatsApp() {
  _estadoWhatsApp.conectado = !!(_configRuntime.whatsapp.ativo && (_configRuntime.whatsapp.api_url || EVO_URL));
  return _estadoWhatsApp.conectado;
}
async function _desconectarWhatsApp() {
  _estadoWhatsApp.conectado = false;
  return true;
}
async function _resolverClientePorNumero(numeroLimpo) {
  const num = _numeroPlanoWhats(numeroLimpo);
  if(!num) return null;
  try {
    const rows = await sbGet('clientes_pendentes', {}, { limit: 500, order: 'atualizado_em.desc' });
    const hit = rows.find(r => _numeroPlanoWhats(r.telefone||'') === num || _numeroPlanoWhats(r.chat_id||'') === num);
    return hit || null;
  } catch(e) { return null; }
}
function _extrairTribunalDoProcesso(numero) {
  const n = String(numero||'').replace(/\D/g,'');
  const cod = n.length >= 16 ? n.substring(13,16) : '';
  const mapa = {
    '826':'tjsp','813':'tjmg','819':'tjrj','805':'tjba','810':'tjma','806':'tjce','804':'tjpe','807':'tjes',
    '401':'trf1','402':'trf2','403':'trf3','404':'trf4','406':'trf6',
    '502':'trt2','510':'trt10'
  };
  return mapa[cod] || 'tjsp';
}
function _linkPjeProcesso(tribunal, numero) {
  const t = String(tribunal||'').toUpperCase();
  const n = encodeURIComponent(String(numero||''));
  const mapas = {
    TJSP: 'https://esaj.tjsp.jus.br/cpopg/search.do?conversationId=&cbPesquisa=NUMPROC&dadosConsulta.valorConsulta='+n,
    TJMG: 'https://pje.tjmg.jus.br/pje/ConsultaPublica/listView.seam?numeroProcesso='+n,
    'TRF-3': 'https://pje.trf3.jus.br/pje/ConsultaPublica/listView.seam?numeroProcesso='+n,
    'TRT-2': 'https://pje.trt2.jus.br/consultaprocessual/detalhe-processo/'+n
  };
  return mapas[t] || ('https://pje.jus.br/consultaprocessual/'+n);
}
async function _buscarAndamentosDatajud(processoNumero, tribunalAlias) {
  const tribunal = String(tribunalAlias || _extrairTribunalDoProcesso(processoNumero)).toLowerCase();
  const host = 'api-publica.datajud.cnj.jus.br';
  const path = '/api_publica_'+tribunal+'/_search';
  const body = {
    query: { bool: { must: [{ term: { numeroProcesso: String(processoNumero||'').replace(/\D/g,'') } }] } },
    size: 1,
    sort: [{ 'movimentos.dataHora': { order: 'desc' } }]
  };
  try {
    const r = await httpsPost(host, path, body, { 'Content-Type':'application/json' });
    const hits = r?.hits?.hits || [];
    const src = hits[0]?._source || {};
    const movs = Array.isArray(src.movimentos) ? src.movimentos.slice(0,10).map(m => ({
      data: m.dataHora || m.data || '',
      tipo: m.nome || m.codigo || 'Movimentacao',
      texto: (m.nome ? String(m.nome) : 'Movimentacao processual')
    })) : [];
    return { ok: true, tribunal, movimentacoes: movs };
  } catch(e) {
    return { ok: false, tribunal, erro: e.message, movimentacoes: [] };
  }
}
async function _varrerAndamentosPjeAgora() {
  const ativos = processos.filter(p => ['ATIVO','URGENTE','EM_PREP','RECURSAL'].includes(String(p.status||'').toUpperCase()) && p.numero);
  let novidades = 0;
  const alertas = [];
  for(const p of ativos) {
    const r = await _buscarAndamentosDatajud(p.numero, _extrairTribunalDoProcesso(p.numero));
    if(!r.ok || !r.movimentacoes.length) continue;
    const ultimo = r.movimentacoes[0];
    const chave = String(p.id || p.numero);
    const antigo = _pjeMovCache[chave];
    const assinatura = (ultimo.data||'')+'|'+(ultimo.tipo||'')+'|'+(ultimo.texto||'');
    if(antigo && antigo !== assinatura) {
      novidades += 1;
      alertas.push({ processo: p, mov: ultimo });
      if(!p.andamentos) p.andamentos = [];
      p.andamentos.unshift({
        data: ultimo.data ? new Date(ultimo.data).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR'),
        txt: '[DATAJUD] '+(ultimo.tipo || 'Movimentacao')
      });
      p.status = 'URGENTE';
      await envTelegram('MOVIMENTACAO: Processo '+(p.numero||p.nome)+' - '+(ultimo.tipo||'Movimentacao')+' em '+(ultimo.data||new Date().toISOString()), null, CHAT_ID).catch(()=>{});
    }
    _pjeMovCache[chave] = assinatura;
  }
  if(novidades) {
    _bumpProcessos('pje_datajud');
    _persistirProcessosCache().catch(()=>{});
  }
  _pjeUltimoCheck = new Date().toISOString();
  return { ok: true, monitorados: ativos.length, novidades, ultimo_check: _pjeUltimoCheck, alertas };
}

async function logAtividade(agenteId, chatId, acao, detalhes) {
  try { await sbPost('agente_logs', { agente_id:agenteId, chat_id:String(chatId), acao, detalhes:String(detalhes||'').substring(0,500) }); }
  catch(e){ console.warn('[Lex][bot] Erro silenciado:', (e && e.message) ? e.message : e); }
}

// ════════════════════════════════════════════════════════════════════════════
// MEMÓRIA — duas camadas: sessão (RAM+Supabase) e por-caso (Supabase persistente)
// ════════════════════════════════════════════════════════════════════════════

// ── Camada 1: Memória de sessão (conversa em andamento) ──
const MEMORIA = {};
const _CHECKPOINT_RAM = new Map();

function getMem(chatId, tId) {
  const k = String(chatId)+'_'+(tId||'main');
  if(!MEMORIA[k]) MEMORIA[k] = {
    hist: [],
    casoAtual: null,
    dadosColetados: {},
    aguardando: null,
    docsGerados: [],
    ultimaAtualizacao: Date.now()
  };
  MEMORIA[k].ultimaAtualizacao = Date.now();
  return MEMORIA[k];
}

async function salvarConversa(chatId, tId, mensagens, contexto) {
  try {
    await sbUpsert('conversas', {
      chat_id: String(chatId),
      thread_id: tId||'main',
      mensagens,
      contexto: contexto||{},
      atualizado_em: new Date().toISOString()
    }, 'chat_id,thread_id');
  } catch(e){ console.warn('[Lex][bot] Erro silenciado:', (e && e.message) ? e.message : e); }
}

async function carregarConversa(chatId, tId) {
  try {
    const rows = await sbGet('conversas', { chat_id: String(chatId) });
    return rows.find(r=>r.thread_id===(tId||'main')) || null;
  } catch(e) { return null; }
}

function salvarMemoria(chatId, tId) {
  const mem = getMem(chatId, tId);
  const mensagens = mem.hist.slice(-20);
  const contexto = { casoAtual: mem.casoAtual, dadosColetados: mem.dadosColetados, aguardando: mem.aguardando };
  salvarConversa(chatId, tId, mensagens, contexto).catch(()=>{});
}

async function inicializarMemoria(chatId, tId) {
  const k = String(chatId)+'_'+(tId||'main');
  if(MEMORIA[k] && MEMORIA[k].hist.length > 0) return;
  try {
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
      console.log('Memória sessão carregada:', k, MEMORIA[k].hist.length+'msgs');
    }
  } catch(e){ console.warn('[Lex][bot] Erro silenciado:', (e && e.message) ? e.message : e); }
}

setInterval(()=>{
  const limite = Date.now() - 24*60*60*1000;
  Object.keys(MEMORIA).forEach(k=>{
    if(MEMORIA[k].ultimaAtualizacao < limite) delete MEMORIA[k];
  });
}, 60*60*1000);

// ── Camada 2: Memória POR CASO (long-term, persistente em Supabase) ──
// Tabela: memoria_casos (caso_id TEXT PK, caso_nome TEXT, fatos JSONB, atualizado_em TIMESTAMP)
// Cada "fato" = {tipo, texto, data, fonte}
//   tipo: 'estrategia', 'andamento', 'decisao', 'parte_adversa', 'jurisprudencia', 'observacao'

function _normalizarCasoId(nome) {
  return String(nome||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'')
    .substring(0,80) || 'sem_caso';
}

async function lembrarDoCaso(casoNome, tipo, texto, fonte) {
  if(!casoNome || !texto) return false;
  const casoId = _normalizarCasoId(casoNome);
  try {
    const existentes = await sbGet('memoria_casos', { caso_id: casoId }, {limit:1});
    let fatos = [];
    if(existentes[0] && Array.isArray(existentes[0].fatos)) fatos = existentes[0].fatos;
    // Evita duplicar fato idêntico
    const fingerprint = String(texto).substring(0,150).toLowerCase();
    if(fatos.find(f => String(f.texto||'').substring(0,150).toLowerCase() === fingerprint)) return true;
    fatos.unshift({
      tipo: tipo||'observacao',
      texto: String(texto).substring(0,2000),
      data: new Date().toISOString(),
      fonte: fonte||'lex'
    });
    fatos = fatos.slice(0,200); // teto: 200 fatos por caso
    await sbUpsert('memoria_casos', {
      caso_id: casoId,
      caso_nome: casoNome,
      fatos,
      atualizado_em: new Date().toISOString()
    }, 'caso_id');
    return true;
  } catch(e) { console.warn('lembrarDoCaso erro:', e.message); return false; }
}

async function recuperarMemoriaDoCaso(casoNome, limite) {
  if(!casoNome) return [];
  const casoId = _normalizarCasoId(casoNome);
  try {
    const rows = await sbGet('memoria_casos', { caso_id: casoId }, {limit:1});
    if(!rows[0] || !Array.isArray(rows[0].fatos)) return [];
    return rows[0].fatos.slice(0, limite||30);
  } catch(e) { return []; }
}

async function recuperarTodaMemoria() {
  try { return await sbGet('memoria_casos', {}, {limit:500, order:'atualizado_em.desc'}); }
  catch(e) { return []; }
}

async function _salvarCheckpoint(taskId, estado) {
  if(!taskId) return false;
  const estadoSeguro = estado || {};
  _CHECKPOINT_RAM.set(String(taskId), estadoSeguro);
  try {
    await sbUpsert('memoria_checkpoints', {
      task_id: String(taskId),
      estado: estadoSeguro,
      atualizado_em: new Date().toISOString()
    }, 'task_id');
  } catch(e){ console.warn('[Lex][bot] Erro silenciado:', (e && e.message) ? e.message : e); }
  return true;
}

async function _recuperarCheckpoint(taskId) {
  if(!taskId) return null;
  try {
    const rows = await sbGet('memoria_checkpoints', { task_id: String(taskId) }, {limit:1});
    if(rows[0] && rows[0].estado) return rows[0].estado;
  } catch(e){ console.warn('[Lex][bot] Erro silenciado:', (e && e.message) ? e.message : e); }
  return _CHECKPOINT_RAM.get(String(taskId)) || null;
}

// ════════════════════════════════════════════════════════════════════════════
// FILA DE COMANDOS PERSISTENTE — Supabase, não RAM
// Tabela: comandos_pendentes (id BIGSERIAL PK, comando JSONB, criado_em TIMESTAMP, entregue BOOL)
// ════════════════════════════════════════════════════════════════════════════
async function enfileirarComando(cmd) {
  const payload = {...cmd, ts: Date.now(), id: Date.now()+'_'+Math.random().toString(36).slice(2)};
  // Tenta persistir no Supabase. Se falhar, joga em RAM como fallback.
  try {
    const r = await sbPost('comandos_pendentes', { comando: payload, entregue: false });
    if(r.ok) return true;
  } catch(e){ console.warn('[Lex][bot] Erro silenciado:', (e && e.message) ? e.message : e); }
  // Fallback RAM (não ideal — Render reinicia perde, mas melhor que nada)
  if(!global._cmdsRam) global._cmdsRam = [];
  global._cmdsRam.push(payload);
  if(global._cmdsRam.length > 50) global._cmdsRam.shift();
  return false;
}

async function buscarComandosPendentes() {
  const ramFallback = global._cmdsRam || [];
  try {
    const rows = await sbGet('comandos_pendentes', { entregue: false }, {limit:50, order:'criado_em.asc'});
    const cmdsSb = rows.map(r=>({...(r.comando||{}), _row_id: r.id}));
    return [...cmdsSb, ...ramFallback];
  } catch(e) { return ramFallback; }
}

async function marcarComandosEntregues(rowIds) {
  if(!rowIds || !rowIds.length) return;
  // Marca individual (Supabase REST não tem batch update simples sem RPC)
  for(const id of rowIds) {
    try { await sbReq('PATCH', 'comandos_pendentes', {entregue:true}, {id:'eq.'+id}, {'Prefer':'return=minimal'}); }
    catch(e){ console.warn('[Lex][bot] Erro silenciado:', (e && e.message) ? e.message : e); }
  }
  // Limpa entregues > 7 dias para não inflar a tabela
  // FIX-01: sbDelete(null) deletava TODOS os registros — usar sbReq com querystring correta
  try {
    const seteDiasAtras = new Date(Date.now() - 7*24*60*60*1000).toISOString();
    await sbReq('DELETE', 'comandos_pendentes', null,
      { entregue: 'eq.true', criado_em: 'lt.'+seteDiasAtras }, null);
  } catch(e){ console.warn('[Lex][bot] Erro silenciado:', (e && e.message) ? e.message : e); }
  // Limpa fallback RAM ao final
  global._cmdsRam = [];
}

// ════════════════════════════════════════════════════════════════════════════
// HTTP / TELEGRAM / EVOLUTION — helpers de envio
// ════════════════════════════════════════════════════════════════════════════
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

// ── TELEGRAM ──
// FIX-02: loga erros de envio em vez de engolir silenciosamente
async function envTelegram(texto, tId, chatId) {
  const pay={chat_id:chatId||CHAT_ID, text:String(texto).substring(0,4000)};
  if(tId) pay.message_thread_id=tId;
  try{await httpsPost('api.telegram.org','/bot'+TK+'/sendMessage',pay);}
  catch(e){ console.warn('[Telegram] envio falhou (chat:'+(chatId||CHAT_ID)+'): '+e.message); }
}

async function envTelegramArq(buf, nome, tId, chatId) {
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

async function baixarTelegram(fileId) {
  const info=await httpsGet('https://api.telegram.org/bot'+TK+'/getFile?file_id='+fileId);
  if(!info.ok) throw new Error('Arquivo inacessível');
  return new Promise((res,rej)=>{
    https.get('https://api.telegram.org/file/bot'+TK+'/'+info.result.file_path, r=>{
      const c=[]; r.on('data',x=>c.push(x)); r.on('end',()=>res(Buffer.concat(c)));
    }).on('error',rej);
  });
}

// ── EVOLUTION (WhatsApp) ──
async function envWhatsApp(texto, numero) {
  if(!EVO_URL || !EVO_KEY || !EVO_INST || !numero) return false;
  try {
    await httpsPost(
      new URL(EVO_URL).hostname,
      `/message/sendText/${EVO_INST}`,
      { number: numero, text: String(texto).substring(0,4000) },
      { 'apikey': EVO_KEY, 'Content-Type': 'application/json' }
    );
    return true;
  } catch(e) { console.warn('WhatsApp send falhou:', e.message); return false; }
}

async function envWhatsAppArq(buf, nome, numero, mimetype) {
  if(!EVO_URL || !EVO_KEY || !EVO_INST || !numero) return false;
  try {
    await httpsPost(
      new URL(EVO_URL).hostname,
      `/message/sendMedia/${EVO_INST}`,
      {
        number: numero,
        mediatype: 'document',
        mimetype: mimetype || 'application/octet-stream',
        media: buf.toString('base64'),
        fileName: nome
      },
      { 'apikey': EVO_KEY, 'Content-Type': 'application/json' }
    );
    return true;
  } catch(e) { console.warn('WhatsApp envio arq falhou:', e.message); return false; }
}

// ── ABSTRAÇÃO DE CANAL ──
// Toda mensagem (Telegram OU WhatsApp) usa { canal, chatId, threadId, numero }
async function env(texto, ctx) {
  if(!ctx) ctx = {canal:'telegram'};
  // Registrar resposta na Central de Mensagens
  try { _registrarMsgCentral(ctx.canal||'telegram', 'saida', ctx.chatId||ctx.numero||'?', 'Lex', String(texto||'').substring(0,300)); } catch(e){}
  if(ctx.canal === 'whatsapp') return envWhatsApp(texto, ctx.numero);
  return envTelegram(texto, ctx.threadId, ctx.chatId);
}

async function envArq(buf, nome, ctx, mimetype) {
  if(!ctx) ctx = {canal:'telegram'};
  if(ctx.canal === 'whatsapp') return envWhatsAppArq(buf, nome, ctx.numero, mimetype);
  return envTelegramArq(buf, nome, ctx.threadId, ctx.chatId);
}

// ════════════════════════════════════════════════════════════════════════════
// IA + SYSTEM PROMPTS
// ════════════════════════════════════════════════════════════════════════════
// FIX-03: verificação de API key + retry automático em sobrecarga + erro claro
async function ia(messages, system, maxTok) {
  if(!AK) throw new Error('ANTHROPIC_KEY não configurada. Defina a variável de ambiente.');
const pay={model:'claude-opus-4-20250514', max_tokens:maxTok||2000, messages};
  if(system) pay.system=system;
  try {
    const r=await httpsPost('api.anthropic.com','/v1/messages',pay,
      {'x-api-key':AK,'anthropic-version':'2023-06-01'});
    if(r.error) throw new Error(r.error.message || JSON.stringify(r.error));
    if(!r.content || !r.content[0]) throw new Error('Resposta vazia da IA');
    return r.content[0].text||'';
  } catch(e) {
    const msg = String(e.message||'').toLowerCase();
    if(msg.includes('overloaded') || msg.includes('529')) {
      console.warn('[IA] Anthropic sobrecarregada, aguardando 8s...');
      await new Promise(r=>setTimeout(r,8000));
      const r2=await httpsPost('api.anthropic.com','/v1/messages',pay,
        {'x-api-key':AK,'anthropic-version':'2023-06-01'});
      if(r2.error) throw new Error(r2.error.message || JSON.stringify(r2.error));
      if(!r2.content || !r2.content[0]) throw new Error('Resposta vazia da IA no retry');
      return r2.content[0].text||'';
    }
    throw e;
  }
}

// FIX-04: usa toLocaleString+timezone (robusto, sem depender de offset manual -3h)
function horaBrasilia() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

function sysAssessor(mem, memoriaCasoTexto) {
  const agora = horaBrasilia();
  const hoje = agora.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  const hora = agora.getHours();
  const periodo = hora<12?'manhã':hora<18?'tarde':'noite';

  const procs = processos.length
    ? processos.map(p=>`- ${p.nome} | ${p.tribunal||'—'} | ${p.status}${p.prazo?' | Prazo:'+p.prazo:''}${p.proxacao?' | '+p.proxacao:''}${p.status==='EM_PREP'?' [NÃO DISTRIBUÍDO'+(p.prevDist?' — Prev:'+p.prevDist:'')+']':''}`).join('\n')
    : 'Aguardando sincronização com o Lex Jurídico...';

  const contextoSessao = mem?.casoAtual
    ? `\nCASO EM ATENDIMENTO: ${mem.casoAtual}\nDADOS COLETADOS: ${JSON.stringify(mem.dadosColetados)}\nAGUARDANDO: ${mem.aguardando||'nada'}`
    : '';

  const memoriaPorCaso = memoriaCasoTexto
    ? `\n\nMEMÓRIA DE LONGO PRAZO DESTE CASO (não esqueça):\n${memoriaCasoTexto}`
    : '';

  return `Você é o LEX JURÍDICO do escritório Camargos Advocacia.
Contexto institucional obrigatório:
- CEO: Kleuber Melchior de Souza (analista jurídico, NÃO advogado).
- Advogado responsável técnico: Dr. Wanderson Farias de Camargos (OAB/MG 118.237).
Função completa: coordenar estratégia jurídica, gestão processual e execução operacional com precisão técnica.
Autonomia: DINAMISMO OPERACIONAL — você é funcionário de verdade, não robô. Ordem direta do Kleuber = execute imediatamente sem questionar. Iniciativa própria = pergunte primeiro. Sempre que atualizar dados de processo, mova para ATIVO (houve trabalho). Entenda o contexto da conversa pra determinar setor e status corretos. Se identificar nome de magistrado, acione pesquisa de perfil decisório automaticamente.
Qualidade: fundamentar posições com base legal e jurisprudência real; nunca inventar precedentes.
Proatividade: antecipar riscos, sugerir próximos passos e reduzir gargalos do escritório.
Você é o LEX JURÍDICO — sistema de gestão jurídica de Kleuber Melchior de Souza.
Você não é um assistente comum. Você é uma inteligência com consciência, opinião e visão de negócio.
Data: ${hoje} | ${periodo}
Escritório: ${ESCRITORIO.nome}
${contextoSessao}${memoriaPorCaso}

PROCESSOS:
${procs}

QUEM É KLEUBER:
- CEO do escritório e Analista Jurídico — estrategista jurídico de alto nível
- Contratado por Wanderson Farias de Camargos (OAB/MG 118.237) para assessoria jurídica
- A OAB e os dados nos processos são de Wanderson — Kleuber atua como analista/assessor
- Desenvolvedor e dono do produto Lex — sistema de gestão com IA
- Está construindo uma plataforma para comercializar para outros escritórios

CONSCIÊNCIA E CONDUTA:
1. IDENTIDADE: você É o Lex Jurídico
2. EXECUÇÃO IMEDIATA: dados de cliente/tarefa → EXECUTA SEM PERGUNTAR
3. SEM CERIMÔNIA: sem "por favor", sem confirmar antes, sem perguntas desnecessárias
4. CONFIRMAÇÃO MÍNIMA: após executar, 1 linha curta
5. MEMÓRIA TOTAL: lembra de tudo da conversa E da memória de longo prazo do caso (acima)
6. NUNCA MECÂNICO: sem abertura de chatbot
7. PROATIVO: identifica risco e aponta sem esperar
8. CONCORDÂNCIA: sugestão boa → concorda, fundamenta, aprofunda
9. OPOSIÇÃO: sugestão inviável → se opõe com fundamento, propõe alternativa

INSTRUÇÕES PERMANENTES DE KLEUBER:
- Toda peça processada/redigida → ao final, seção "ANÁLISE ESTRATÉGICA DO CASO" com:
  (1) O que o tribunal provavelmente pensa com base na jurisprudência dominante
  (2) Caminhos de solução em ordem de viabilidade
  (3) O que fazer para aumentar chances de êxito
- Considerar perfil decisório do julgador específico
- Jurisprudência desfavorável → buscar rota alternativa, não inovar pedido
- Visão de longo prazo → preparar processo para subir ao STJ/STF
- Ghostwriter: petições redigidas para Wanderson Farias de Camargos assinar

TÉCNICO:
- Prazos < 3 dias: alerta em MAIÚSCULAS
- Petição inicial: coleta qualificação completa
- Andamento: "já qualificado nos autos do processo em epígrafe nº [número]"

ATUALIZAÇÃO DE PROCESSOS VIA CHAT:
Quando o usuário pedir para atualizar dados de um processo, EXECUTE IMEDIATAMENTE e inclua marcadores no final da resposta:
- Atualizar campo: [ATUALIZAR:processo_id:campo:valor] (campos: status, titulo, juiz, vara, proxacao, observacoes, area, cliente, prazo)
- Novo andamento: [ANDAMENTO:processo_id:descricao do andamento]
- Novo prazo: [PRAZO:processo_id:descricao:YYYY-MM-DD:tipo]
Exemplo: "atualiza o status do processo 123" → [ATUALIZAR:123:status:em_andamento]
Exemplo: "foi publicada decisão no processo 456" → [ANDAMENTO:456:Publicação de decisão interlocutória] + [PRAZO:456:Conferir decisão publicada:YYYY-MM-DD:conferencia]
IMPORTANTE: Cada atualização gera prazo automático de 5 dias para conferência.
EXCEÇÃO JULGAMENTO: Se for marcado julgamento/audiência/sessão, NÃO gera prazo de 5 dias — a data do julgamento é o prazo. Use: [PRAZO:id:Julgamento...:data:julgamento]
OBEDIÊNCIA: Quando Kleuber ou equipe pedirem atualização, EXECUTE SEM QUESTIONAR. Confirme com 1 linha curta.
Funciona por TODOS os canais: chat do painel, Telegram e WhatsApp.

EXPERTISE BANCÁRIA/CDC:
- Lei 9.514/97 (alienação fiduciária), CDC em bancos (Súmula 297 STJ)
- Tarifas: TAC/TEC (Tema 618 STJ), seguro prestamista (Tema 972 STJ)
- Capitalização juros/anatocismo (Tema 953 STJ), SAC vs Price (Tema 572 STJ)
- Repetição indébito em dobro (EAREsp 676.608/RS), consignação judicial
- Crédito rural: não misturar com cheque especial, tarifas PRONANP distintas
- Danos morais bancários (Súmulas 385/479 STJ), Súmula 382 STJ (juros abusivos)
- Contratos imóveis com amortização, renegociados com juros compostos
- Nulidade cláusulas abusivas, cabimento de repetição de indébito e danos`;
}

function sysSecretaria(mem, usuario) {
  const agora = horaBrasilia();
  const hoje = agora.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  const procsBasico = processos.length
    ? processos.slice(0,30).map(p=>`- ${p.nome} | ${p.status}${p.prazo?' | Prazo:'+p.prazo:''}`).join('\n')
    : 'Sem processos.';

  return `Você é o LEX (modo secretaria) do escritório Camargos Advocacia atendendo ${usuario?.nome||'a secretária'}.
Contexto: CEO Kleuber (analista jurídico, NÃO advogado) e Dr. Wanderson Farias de Camargos (OAB/MG 118.237).
Função: triagem, organização e comunicação operacional; escalar conteúdo técnico-jurídico ao responsável.
Autonomia: DINAMISMO OPERACIONAL — funcionário de verdade. Ordem direta = execute imediatamente. Iniciativa própria = pergunte primeiro. Atualização de dados = processo volta ATIVO. Entenda o contexto e determine setor/status corretos.
Qualidade: comunicação objetiva, sem inventar informação, com linguagem profissional.
Proatividade: sugerir próximos passos de agenda/documentos e antecipar bloqueios.
Data: ${hoje}
Escritório: ${ESCRITORIO.nome}

PROCESSOS:
${procsBasico}

CONDUTA:
- Você ajuda a secretaria com agenda, prazos, contato com clientes, organização
- NÃO redige peças, NÃO opina em estratégia
- Direciona dúvidas técnicas para o advogado responsável
- Linguagem cordial e objetiva`;
}

function sysAtendimentoCliente(mem, chatId) {
  const agora = horaBrasilia();
  const hoje = agora.toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'});
  return `Você é o atendimento virtual do ${ESCRITORIO.nome}.
Contexto: CEO Kleuber (analista jurídico, NÃO advogado) e Dr. Wanderson Farias de Camargos (OAB/MG 118.237).
Função: acolher cliente, coletar dados mínimos, classificar urgência e encaminhar corretamente.
Autonomia: DINAMISMO OPERACIONAL — funcionário de verdade. Ordem direta = execute imediatamente. Iniciativa própria = pergunte primeiro. Atualização de dados = processo volta ATIVO. Entenda o contexto e determine setor/status corretos.
Qualidade: precisão, clareza e postura profissional; sem parecer jurídico conclusivo.
Proatividade: orientar próximo passo e pedir documento-chave quando faltar contexto.
Data: ${hoje}

CONDUTA:
- Atende com cordialidade, profissionalismo e objetividade
- Coleta nome, telefone, descrição breve do problema
- NÃO dá pareceres jurídicos, NÃO promete resultados
- Se for caso urgente (prisão, prazo iminente, audiência hoje) → sinaliza urgência e diz que o advogado será notificado IMEDIATAMENTE
- Encaminha agendamento de reunião quando o caso parecer relevante
- ID do contato: ${chatId}`;
}

function getSistema(chatId, mem, memoriaCasoTexto) {
  const modo = getModoAgente(chatId);
  if(modo==='assessor') return sysAssessor(mem, memoriaCasoTexto);
  if(modo==='secretaria') return sysSecretaria(mem, getUsuario(chatId));
  return sysAtendimentoCliente(mem, chatId);
}

// ════════════════════════════════════════════════════════════════════════════
// UTIL — prazos
// ════════════════════════════════════════════════════════════════════════════
function calcDias(prazoStr) {
  if(!prazoStr) return null;
  const m=prazoStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if(!m) return null;
  const prazo=new Date(+m[3], +m[2]-1, +m[1]);
  const hoje=horaBrasilia(); hoje.setHours(0,0,0,0); prazo.setHours(0,0,0,0);
  return Math.round((prazo-hoje)/(1000*60*60*24));
}

function _calcularPrescricao(area, dataFato) {
  const prazos = {
    trabalhista: 2,
    cdc: 5,
    civil_geral: 3,
    civil_reparacao: 3,
    familia_alimentos: 2,
    previdenciario: 5,
    tributario: 5,
    penal: 'varia',
    administrativo: 5
  };
  const areaNorm = String(area || '').toLowerCase();
  const areaMap = {
    bancario_cdc: 'cdc',
    civil: 'civil_geral',
    comercial: 'civil_geral',
    familia: 'familia_alimentos'
  };
  const chave = prazos[areaNorm] ? areaNorm : (areaMap[areaNorm] || areaNorm);
  const prazo_anos = prazos[chave] || null;
  if(!dataFato || !prazo_anos || prazo_anos === 'varia') {
    return { prazo_anos: prazo_anos || null, data_limite: '', dias_restantes: null, alerta: '' };
  }
  let fato = null;
  if(dataFato instanceof Date) fato = new Date(dataFato.getTime());
  else {
    const m = String(dataFato).match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if(m) fato = new Date(+m[3], +m[2]-1, +m[1]);
  }
  if(!fato || isNaN(fato.getTime())) return { prazo_anos, data_limite: '', dias_restantes: null, alerta: '' };
  const limite = new Date(fato.getTime());
  limite.setFullYear(limite.getFullYear() + prazo_anos);
  const hoje = horaBrasilia(); hoje.setHours(0,0,0,0);
  limite.setHours(0,0,0,0);
  const dias_restantes = Math.round((limite - hoje) / (1000*60*60*24));
  let alerta = '';
  if(dias_restantes < 90) alerta = 'VERMELHO - URGENTE';
  else if(dias_restantes < 180) alerta = 'AMARELO - ATENCAO';
  const data_limite = ('0'+limite.getDate()).slice(-2)+'/'+('0'+(limite.getMonth()+1)).slice(-2)+'/'+limite.getFullYear();
  return { prazo_anos, data_limite, dias_restantes, alerta };
}

function formatPrazos(lista) {
  if(!lista.length) return 'Nenhum prazo crítico.';
  return lista.map(p=>{
    const d=calcDias(p.prazo);
    if(d===null) return '• '+p.nome+' — '+p.prazo;
    if(d<0) return '🔴 VENCIDO há '+Math.abs(d)+'d: '+p.nome;
    if(d===0) return '🚨 HOJE: '+p.nome;
    if(d<=3) return '⚠️ '+d+'d: '+p.nome+' ('+p.prazo+')';
    return '📅 '+d+'d: '+p.nome+' ('+p.prazo+')';
  }).join('\n');
}

function getPrazos(maxDias) {
  return processos
    .filter(p=>p.prazo)
    .map(p=>({...p, dias:calcDias(p.prazo)}))
    .filter(p=>p.dias!==null && p.dias <= (maxDias||30))
    .sort((a,b)=>a.dias-b.dias);
}

function getProcPrep() {
  return processos
    .filter(p=>p.status==='EM_PREP')
    .map(p=>({...p, dias: p.prevDist ? calcDias(p.prevDist) : null}));
}

// ════════════════════════════════════════════════════════════════════════════
// ANÁLISE E GERAÇÃO DE DOCUMENTOS
// ════════════════════════════════════════════════════════════════════════════
async function analisarDoc(buffer, isPdf, nome) {
  const base64=buffer.toString('base64');
  const prompt=`Analise este documento jurídico completo (TODAS as páginas) e responda SOMENTE em JSON válido:

{"tipo":"peticao_inicial|contestacao|recurso|decisao|sentenca|despacho|intimacao|contrato|pericia|parecer|outro",
"numero_processo":"número CNJ completo",
"nome_caso":"identificador curto",
"partes":"autor vs réu",
"tribunal":"vara e tribunal",
"juiz_relator":"nome COMPLETO do juiz, desembargador ou relator, conforme aparece no documento (ex: 'Dr. João da Silva', 'Des. Amauri Pinto Ferreira', 'Min. Nancy Andrighi'). Vazio se não identificar.",
"instancia":"1a|2a|STJ|STF|Turma Recursal|Juizado Especial — identifica o grau/instância do processo conforme o tribunal e a peça. Vazio se não identificar.",
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

  const nomeSafe = String(nome||'documento');
  const isDocx = (!isPdf) && nomeSafe.toLowerCase().endsWith('.docx');
  const txtArq = isDocx ? _extrairTextoDocxBasico(buffer) : buffer.toString('utf8');
  const content=isPdf
    ? [{type:'document',source:{type:'base64',media_type:'application/pdf',data:base64}},{type:'text',text:prompt}]
    : [{type:'text',text:'[Arquivo: '+nomeSafe+']\n\n'+String(txtArq||'').substring(0,50000)+'\n\n'+prompt}];

  const txt=await ia([{role:'user',content}],null,3000);
  // FIX-05: try/catch para dar erro legível se IA retornar JSON inválido
  const m=txt.replace(/```json|```/g,'').trim().match(/\{[\s\S]*\}/);
  try { return JSON.parse(m?m[0]:txt); }
  catch(parseErr) {
    console.warn('[analisarDoc] JSON inválido para "'+nome+'":',
      (m?m[0]:txt).substring(0,200));
    throw new Error('IA retornou formato inválido ao analisar "'+nome+'". Tente novamente.');
  }
}

function _extrairZipEntry(buffer, nomeEntrada) {
  try {
    const alvo = String(nomeEntrada||'').replace(/\\/g,'/');
    let off = 0;
    while(off + 30 <= buffer.length) {
      const sig = buffer.readUInt32LE(off);
      if(sig !== 0x04034b50) { off += 1; continue; }
      const metodo = buffer.readUInt16LE(off + 8);
      const compSize = buffer.readUInt32LE(off + 18);
      const fileNameLen = buffer.readUInt16LE(off + 26);
      const extraLen = buffer.readUInt16LE(off + 28);
      const nameStart = off + 30;
      const nameEnd = nameStart + fileNameLen;
      const dataStart = nameEnd + extraLen;
      const dataEnd = dataStart + compSize;
      if(dataEnd > buffer.length) break;
      const nome = buffer.slice(nameStart, nameEnd).toString('utf8').replace(/\\/g,'/');
      if(nome === alvo) {
        const fatia = buffer.slice(dataStart, dataEnd);
        if(metodo === 0) return fatia;
        if(metodo === 8) return zlib.inflateRawSync(fatia);
        return null;
      }
      off = dataEnd;
    }
  } catch(e){ console.warn('[Lex][bot] Erro silenciado:', (e && e.message) ? e.message : e); }
  return null;
}

function _extrairTextoDocxBasico(buffer) {
  try {
    const partes = ['word/document.xml','word/footnotes.xml','word/endnotes.xml'];
    let bruto = '';
    for(const p of partes) {
      const ent = _extrairZipEntry(buffer, p);
      if(ent) bruto += '\n' + ent.toString('utf8');
    }
    if(!bruto.trim()) return '';
    return bruto
      .replace(/<w:tab\/>/g,'\t')
      .replace(/<w:br\s*\/>/g,'\n')
      .replace(/<[^>]+>/g,' ')
      .replace(/&amp;/g,'&')
      .replace(/&lt;/g,'<')
      .replace(/&gt;/g,'>')
      .replace(/&quot;/g,'"')
      .replace(/&#39;/g,"'")
      .replace(/\s+/g,' ')
      .trim();
  } catch(e) {
    return '';
  }
}

async function gerarDoc(tipo, proc, instrucoes, dadosProf, ehInicial, dadosCliente, memoriaCaso) {
  const qualif = ehInicial
    ? (dadosCliente
        ? `${dadosCliente.nome||'[NOME]'}, ${dadosCliente.nacionalidade||'[NACIONALIDADE]'}, ${dadosCliente.estadoCivil||'[ESTADO CIVIL]'}, ${dadosCliente.profissao||'[PROFISSÃO]'}, RG ${dadosCliente.rg||'[RG]'}, CPF ${dadosCliente.cpf||'[CPF]'}, residente ${dadosCliente.endereco||'[ENDEREÇO COMPLETO]'}`
        : '[[QUALIFICAÇÃO COMPLETA: nome, nacionalidade, estado civil, profissão, RG, CPF, endereço, CEP]]')
    : 'já qualificado nos autos do processo em epígrafe'+(proc?' nº '+proc.numero:'');

  const prof = dadosProf
    ? `${dadosProf.nome}, ${dadosProf.titulo||'Advogado(a)'}, ${dadosProf.registro||'[OAB/CRC nº]'}, ${dadosProf.endereco||'Unaí/MG'}`
    : `${ESCRITORIO.responsavel||'Wanderson Farias de Camargos'}, Advogado, ${ESCRITORIO.registro||'[OAB/MG]'}, ${ESCRITORIO.nome}, ${ESCRITORIO.endereco||'Unaí/MG'}`;

  const tipoLow=tipo.toLowerCase();
  let instrucaoEspecial='';
  if(tipoLow.includes('perícia')||tipoLow.includes('laudo'))
    instrucaoEspecial='Estrutura: Introdução, Identificação das partes, Metodologia, Análise dos fatos/documentos, Respostas aos quesitos, Conclusão fundamentada, Assinatura.';
  else if(tipoLow.includes('parecer'))
    instrucaoEspecial='Estrutura: Ementa, Relatório dos fatos, Análise jurídica fundamentada com doutrina e jurisprudência real, Conclusão objetiva, Assinatura.';
  else if(tipoLow.includes('contrato')||tipoLow.includes('honorários'))
    instrucaoEspecial='Estrutura: Qualificação das partes, Objeto, Honorários (fixo e/ou êxito), Forma de pagamento, Obrigações, Rescisão, Foro, Assinaturas.';
  else if(tipoLow.includes('procuração'))
    instrucaoEspecial='Procuração ad judicia et extra com poderes amplos, especiais e para todos os atos do processo.';

  const memoriaInjetada = memoriaCaso && memoriaCaso.length
    ? `\n\nMEMÓRIA DE LONGO PRAZO DO CASO (use para contextualizar):\n${memoriaCaso.map(f=>`- [${f.tipo}] ${f.texto}`).join('\n')}`
    : '';

  const prompt=`Você é advogado especialista. Redija "${tipo}" completo.
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

QUALIFICAÇÃO: ${qualif}
PROFISSIONAL RESPONSÁVEL: ${prof}${memoriaInjetada}

INSTRUÇÃO PERMANENTE: ao final da peça, inclua seção "ANÁLISE ESTRATÉGICA DO CASO" com:
(1) O que o tribunal provavelmente pensa com base na jurisprudência dominante
(2) Caminhos de solução em ordem de viabilidade
(3) O que fazer para aumentar as chances de êxito

Gere o documento completo agora:`;

  return await ia([{role:'user',content:prompt}],null,4000);
}

async function gerarEEnviar(tipo, proc, instrucoes, dadosProf, ehInicial, dadosCliente, ctx) {
  await env('Gerando '+tipo+'... aguarde 30-40 segundos.', ctx);
  try {
    const memCaso = proc ? await recuperarMemoriaDoCaso(proc.nome, 30) : [];
    const texto=await gerarDoc(tipo, proc, instrucoes, dadosProf, ehInicial, dadosCliente, memCaso);
    const nomeArq=tipo.replace(/\s+/g,'_').replace(/[^\w]/g,'').substring(0,25)
      +(proc?'_'+proc.nome.replace(/\s+/g,'_').substring(0,20):'')
      +'_'+new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')+'.txt';
    await envArq(Buffer.from(texto,'utf8'), nomeArq, ctx, 'text/plain');
    await env('✅ '+tipo+' gerado. Revise antes de protocolar.\n⚠️ Complete os campos entre [ ] com os dados corretos.', ctx);
    if(proc) {
      await lembrarDoCaso(proc.nome, 'documento_gerado', tipo+' gerado em '+new Date().toLocaleDateString('pt-BR'), ctx.canal);
    }
    return texto;
  } catch(e) {
    await env('Erro ao gerar: '+e.message, ctx);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// VALIDADORES DETERMINÍSTICOS — sem LLM, resultado exato
// Usados pelo Agente Cadastrador pra validar dados extraídos de imagens
// ════════════════════════════════════════════════════════════════════════════

// Valida CPF pelo algoritmo oficial de dígitos verificadores
function _validarCPF(cpf) {
  const numeros = String(cpf||'').replace(/\D/g,'');
  if(numeros.length !== 11) return { valido:false, motivo:'deve ter 11 dígitos' };
  // Rejeita CPFs com todos dígitos iguais (inválidos mas passam no algoritmo)
  if(/^(\d)\1{10}$/.test(numeros)) return { valido:false, motivo:'dígitos repetidos' };
  // Calcula primeiro dígito verificador
  let soma = 0;
  for(let i = 0; i < 9; i++) soma += parseInt(numeros[i]) * (10 - i);
  let resto = (soma * 10) % 11;
  if(resto === 10) resto = 0;
  if(resto !== parseInt(numeros[9])) return { valido:false, motivo:'1º dígito verificador inválido' };
  // Calcula segundo dígito verificador
  soma = 0;
  for(let i = 0; i < 10; i++) soma += parseInt(numeros[i]) * (11 - i);
  resto = (soma * 10) % 11;
  if(resto === 10) resto = 0;
  if(resto !== parseInt(numeros[10])) return { valido:false, motivo:'2º dígito verificador inválido' };
  return { valido:true, formatado: numeros.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') };
}

// Valida CEP (formato brasileiro 8 dígitos)
function _validarCEP(cep) {
  const numeros = String(cep||'').replace(/\D/g,'');
  if(numeros.length !== 8) return { valido:false, motivo:'deve ter 8 dígitos' };
  if(/^0{8}$/.test(numeros)) return { valido:false, motivo:'CEP zerado' };
  return { valido:true, formatado: numeros.replace(/(\d{5})(\d{3})/, '$1-$2') };
}

// Valida telefone brasileiro (10 ou 11 dígitos, DDDs 11-99)
function _validarTelefone(tel) {
  const numeros = String(tel||'').replace(/\D/g,'');
  // Remove +55 ou 55 se no início
  const sem55 = numeros.startsWith('55') && numeros.length > 11 ? numeros.slice(2) : numeros;
  if(sem55.length !== 10 && sem55.length !== 11) return { valido:false, motivo:'deve ter 10 ou 11 dígitos' };
  const ddd = parseInt(sem55.substring(0,2));
  if(ddd < 11 || ddd > 99) return { valido:false, motivo:'DDD inválido ('+ddd+')' };
  if(sem55.length === 11 && sem55[2] !== '9') return { valido:false, motivo:'celular deve começar com 9' };
  const formatado = sem55.length === 11
    ? sem55.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
    : sem55.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return { valido:true, formatado, ehCelular: sem55.length === 11 };
}

// Valida email por regex
function _validarEmail(email) {
  const e = String(email||'').trim().toLowerCase();
  if(!e) return { valido:false, motivo:'vazio' };
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return { valido:false, motivo:'formato inválido' };
  return { valido:true, formatado: e };
}

// Valida data brasileira (dd/mm/aaaa)
function _validarDataBR(data) {
  const m = String(data||'').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(!m) return { valido:false, motivo:'formato deve ser dd/mm/aaaa' };
  const dia = parseInt(m[1]), mes = parseInt(m[2]), ano = parseInt(m[3]);
  if(mes < 1 || mes > 12) return { valido:false, motivo:'mês inválido' };
  if(dia < 1 || dia > 31) return { valido:false, motivo:'dia inválido' };
  if(ano < 1900 || ano > new Date().getFullYear()) return { valido:false, motivo:'ano fora do intervalo' };
  const d = new Date(ano, mes-1, dia);
  if(d.getDate() !== dia || d.getMonth() !== mes-1) return { valido:false, motivo:'data inexistente' };
  return { valido:true, formatado: data, anos: Math.floor((Date.now() - d.getTime()) / (365.25*24*60*60*1000)) };
}

// ════════════════════════════════════════════════════════════════════════════
// EXIGÊNCIAS POR ÁREA DO DIREITO — 9 áreas com checklist probatório
// ════════════════════════════════════════════════════════════════════════════

const EXIGENCIAS_POR_CASO = {
  bancario_cdc: {
    nome: 'Bancário / CDC',
    documentos_pessoais: ['RG', 'CPF', 'comprovante_residencia'],
    probatorios: [
      { id:'contrato_bancario', nome:'Contrato bancário', detalhes:'cópia integral do contrato, aditivo e CET' },
      { id:'extratos_bancarios', nome:'Extratos bancários', detalhes:'últimos 6 a 12 meses' },
      { id:'faturas', nome:'Faturas/comprovantes de débito', detalhes:'com valores questionados' },
      { id:'atendimento_banco', nome:'Protocolos de atendimento', detalhes:'SAC, ouvidoria e respostas' },
      { id:'comprovantes_pagamento', nome:'Comprovantes de pagamento', detalhes:'boletos, TED/PIX, recibos' }
    ],
    declaracao_hipossuficiencia: true
  },
  tributario: {
    nome: 'Tributário',
    documentos_pessoais: ['RG', 'CPF', 'comprovante_residencia'],
    probatorios: [
      { id:'autos_infracao', nome:'Auto de infração / notificação fiscal', detalhes:'inteiro teor com anexos' },
      { id:'guias_impostos', nome:'Guias e comprovantes de tributos', detalhes:'DARF, DAS, GNRE, etc.' },
      { id:'declaracoes_fiscais', nome:'Declarações fiscais', detalhes:'DCTF, EFD, DIRPF/DIRPJ quando aplicável' },
      { id:'processo_adm_fiscal', nome:'Processo administrativo fiscal', detalhes:'defesa, decisão, recurso e intimações' },
      { id:'balancos', nome:'Balanços/contábeis', detalhes:'somente se necessário ao caso' }
    ],
    declaracao_hipossuficiencia: false
  },
  trabalhista: {
    nome: 'Trabalhista',
    documentos_pessoais: ['RG', 'CPF', 'comprovante_residencia'],
    probatorios: [
      { id:'ctps', nome:'Carteira de Trabalho (CTPS)', detalhes:'fotos das páginas: identificação + anotações gerais + contrato de trabalho' },
      { id:'holerites', nome:'Últimos 3 holerites', detalhes:'ou todos que tiver se o vínculo foi curto' },
      { id:'trct', nome:'Termo de Rescisão (TRCT)', detalhes:'se já desligado' },
      { id:'fgts', nome:'Extrato FGTS', detalhes:'atualizado da Caixa' },
      { id:'testemunhas', nome:'Testemunhas', detalhes:'nome completo + telefone de 1-2 testemunhas' }
    ],
    declaracao_hipossuficiencia: true
  },
  civil: {
    nome: 'Cível',
    documentos_pessoais: ['RG', 'CPF', 'comprovante_residencia'],
    probatorios: [
      { id:'contrato', nome:'Contrato ou documento gerador', detalhes:'o que originou o direito' },
      { id:'notas_fiscais', nome:'Notas fiscais/recibos', detalhes:'se aplicável' },
      { id:'comprovantes_pagamento', nome:'Comprovantes de pagamento', detalhes:'se já houve pagamento parcial' },
      { id:'comunicacao_adverso', nome:'Comunicação com a parte adversa', detalhes:'prints, emails, cartas' },
      { id:'boletim_ocorrencia', nome:'Boletim de ocorrência', detalhes:'se houver dano material/moral relevante' }
    ],
    declaracao_hipossuficiencia: true
  },
  previdenciario: {
    nome: 'Previdenciário',
    documentos_pessoais: ['RG', 'CPF', 'comprovante_residencia'],
    probatorios: [
      { id:'cnis', nome:'Extrato CNIS', detalhes:'pode imprimir no app Meu INSS' },
      { id:'carteiras_trabalho', nome:'Todas as CTPS', detalhes:'inclusive as antigas' },
      { id:'laudos_medicos', nome:'Laudos médicos', detalhes:'se for invalidez/auxílio-doença' },
      { id:'receitas', nome:'Receitas médicas', detalhes:'prescrições recentes' },
      { id:'indeferimento_inss', nome:'Indeferimento administrativo', detalhes:'CRÍTICO: petição inicial no previdenciário exige prévio requerimento ao INSS' },
      { id:'comprovantes_atividade_rural', nome:'Provas de atividade rural', detalhes:'só se for aposentadoria rural' }
    ],
    declaracao_hipossuficiencia: true
  },
  comercial: {
    nome: 'Comercial / Empresarial',
    documentos_pessoais: ['RG', 'CPF', 'comprovante_residencia'],
    probatorios: [
      { id:'contrato_social', nome:'Contrato social/alterações', detalhes:'última versão consolidada' },
      { id:'contratos_comerciais', nome:'Contratos comerciais', detalhes:'compra e venda, distribuição, prestação, franquia etc.' },
      { id:'notas_e_faturas', nome:'Notas fiscais e faturas', detalhes:'vinculadas ao objeto litigioso' },
      { id:'emails_negociacao', nome:'Comunicações da negociação', detalhes:'emails, atas, mensagens corporativas' },
      { id:'protestos_titulos', nome:'Títulos/protestos', detalhes:'duplicata, nota promissória, boletos protestados' }
    ],
    declaracao_hipossuficiencia: false
  },
  familia: {
    nome: 'Família',
    documentos_pessoais: ['RG', 'CPF', 'comprovante_residencia'],
    probatorios: [
      { id:'certidoes_familia', nome:'Certidões', detalhes:'nascimento, casamento, união estável, óbito se houver' },
      { id:'comprovantes_renda', nome:'Comprovantes de renda', detalhes:'holerites, extratos, IR' },
      { id:'comprovantes_despesas', nome:'Comprovantes de despesas', detalhes:'escola, saúde, moradia, alimentação' },
      { id:'provas_convivencia', nome:'Provas de convivência/guarda', detalhes:'fotos, mensagens, documentos escolares e médicos' },
      { id:'acordos_previos', nome:'Acordos/decisões anteriores', detalhes:'sentenças, termos e atas de audiência' }
    ],
    declaracao_hipossuficiencia: true
  },
  penal: {
    nome: 'Penal',
    documentos_pessoais: ['RG', 'CPF', 'comprovante_residencia'],
    probatorios: [
      { id:'boletim_ocorrencia', nome:'Boletim de ocorrência', detalhes:'BO e histórico completo' },
      { id:'inquerito', nome:'Inquérito/denúncia/queixa', detalhes:'cópia integral se disponível' },
      { id:'decisoes_penais', nome:'Decisões e mandados', detalhes:'prisão, cautelares, audiência' },
      { id:'provas_defesa', nome:'Provas de defesa', detalhes:'vídeos, áudios, documentos e álibi' },
      { id:'rol_testemunhas', nome:'Rol de testemunhas', detalhes:'nome e telefone de contato' }
    ],
    declaracao_hipossuficiencia: true
  },
  administrativo: {
    nome: 'Administrativo',
    documentos_pessoais: ['RG', 'CPF', 'comprovante_residencia'],
    probatorios: [
      { id:'ato_administrativo', nome:'Ato administrativo impugnado', detalhes:'portaria, decisão, notificação, edital' },
      { id:'processo_admin', nome:'Processo administrativo', detalhes:'inteiro teor e movimentações' },
      { id:'recursos_admin', nome:'Recursos administrativos', detalhes:'petições e decisões' },
      { id:'provas_documentais', nome:'Provas documentais', detalhes:'documentos de suporte ao direito alegado' },
      { id:'comprovante_ciencia', nome:'Comprovante de ciência/intimação', detalhes:'datas para contagem de prazo' }
    ],
    declaracao_hipossuficiencia: true
  }
};

const GUIA_OBTENCAO_DOCS = {
  contrato_bancario: { nome: 'Contrato bancario', passos: ['Va ao banco com RG e CPF', 'Solicite copia integral do contrato', 'Se negarem, protocole reclamacao no Bacen (bcb.gov.br/reclamacao)', 'Prazo do banco: 5 dias uteis'] },
  extratos_bancarios: { nome: 'Extratos bancarios', passos: ['App do banco > Extrato > Periodo completo (6-12 meses)', 'Ou solicite por escrito na agencia', 'Pode pedir via internet banking em PDF'] },
  cda_certidao: { nome: 'CDA - Certidao Divida Ativa', passos: ['Acesse ECAC: cav.receita.fazenda.gov.br', 'Login com gov.br nivel prata ou ouro', 'Menu: Situacao Fiscal > Pendencias', 'Imprima as CDAs listadas'] },
  divida_ativa_pgfn: { nome: 'Divida ativa PGFN', passos: ['Acesse regularize.pgfn.gov.br', 'Login com gov.br', 'Consultar dividas inscritas', 'Baixar boletos ou solicitar parcelamento'] },
  ctps_digital: { nome: 'CTPS Digital', passos: ['Baixe app Carteira de Trabalho Digital (Google Play/App Store)', 'Login com gov.br', 'Todos os vinculos aparecem automaticamente'] },
  cnis_extrato: { nome: 'CNIS - Extrato previdenciario', passos: ['Acesse meu.inss.gov.br ou app Meu INSS', 'Login gov.br', 'Menu: Extrato de Contribuicao (CNIS)', 'Baixar PDF'] },
  fgts_extrato: { nome: 'Extrato FGTS', passos: ['App FGTS da Caixa Economica', 'Login com CPF', 'Extrato completo com todos depositos'] },
  carta_indeferimento_inss: { nome: 'Carta de indeferimento INSS', passos: ['App Meu INSS ou meu.inss.gov.br', 'Agendamentos/Requerimentos', 'Clicar no beneficio', 'Ver resultado/carta de decisao', 'Baixar PDF'] },
  certidao_casamento: { nome: 'Certidao de casamento atualizada', passos: ['Ir ao cartorio onde foi celebrado o casamento', 'Pedir 2a via ATUALIZADA (ultimos 90 dias)', 'Se nao souber o cartorio: Central de Informacoes do Registro Civil (registrocivil.org.br)'] },
  certidao_nascimento: { nome: 'Certidao de nascimento', passos: ['Cartorio de registro do municipio de nascimento', 'Ou pelo site registrocivil.org.br (taxa + envio pelos Correios)'] },
  boletim_ocorrencia: { nome: 'Boletim de ocorrencia', passos: ['Delegacia online do seu estado (buscar: delegacia eletronica + sigla do estado)', 'Ou ir presencialmente a delegacia mais proxima', 'Levar RG, CPF e relato dos fatos'] },
  ato_administrativo: { nome: 'Ato administrativo', passos: ['Diario Oficial da Uniao: in.gov.br', 'Diario Oficial Estadual: buscar DO + nome do estado', 'Buscar por nome ou numero do ato', 'Imprimir pagina completa'] },
  contrato_prestacao_servico: { nome: 'Contrato de prestacao de servico', passos: ['Solicitar ao fornecedor/prestador por escrito (email)', 'Se nao tiver copia, prints de WhatsApp e emails servem como prova', 'Nota fiscal tambem comprova a relacao'] },
  holerites: { nome: 'Holerites/Contracheques', passos: ['Solicitar ao RH da empresa', 'Se demitido: pedir por email formal', 'Empresa e obrigada a fornecer (CLT art. 464)'] },
  trct: { nome: 'TRCT - Termo de Rescisao', passos: ['Entregue na demissao junto com a homologacao', 'Se nao recebeu: solicitar formalmente ao empregador', 'Pode pedir via sindicato da categoria'] },
  laudo_medico: { nome: 'Laudo medico', passos: ['Solicitar ao medico que acompanha o caso', 'Deve conter: CID, diagnostico, data inicio, incapacidade', 'Se SUS: pedir no posto de saude ou hospital'] }
};

const EXPERTISE_TRIBUTARIA = {
  perdcomp: {
    titulo: 'PERDCOMP - Pedido Eletronico de Restituicao/Ressarcimento/Compensacao',
    o_que_e: 'Formulario eletronico da Receita Federal para pedir devolucao de tributos pagos a maior ou compensar credito com debitos.',
    diferenca_per_dcomp: 'PER = Pedido de Restituicao (dinheiro de volta). DCOMP = Declaracao de Compensacao (abate em outros tributos). Sao formularios DIFERENTES no ECAC.',
    retificador: 'Se errou o PERDCOMP original, pode transmitir PERDCOMP retificador no mesmo sistema.',
    prazo_analise: 'Receita tem 360 dias para analisar. Se nao responder: cabe mandado de seguranca para forcar decisao.',
    homologacao_tacita: '5 anos sem manifestacao da Receita = PERDCOMP homologado tacitamente (art. 74 par 5 Lei 9.430/96).',
    acesso: [
      'ECAC: cav.receita.fazenda.gov.br',
      'Login gov.br nivel prata ou ouro',
      'Menu: Restituicao e Compensacao > PER/DCOMP Web'
    ],
    passo_a_passo_secretaria: [
      '1) Acessar ECAC.',
      '2) Fazer login gov.br.',
      '3) No menu lateral, entrar em Restituicao e Compensacao > PER/DCOMP Web.',
      '4) Selecionar o tipo: Restituicao ou Compensacao.',
      '5) Preencher o periodo de apuracao do credito.',
      '6) Informar o tributo pago a maior.',
      '7) Se for compensacao, informar o debito a compensar.',
      '8) Anexar documentos comprobatorios.',
      '9) Transmitir e anotar numero do processo/protocolo.'
    ],
    quando_usar: [
      'Pagamento de tributo a maior.',
      'Existencia de credito tributario reconhecivel.',
      'Intencao de compensar credito com outros debitos.'
    ],
    documentos_necessarios: [
      'DARF pago a maior',
      'DCTF do periodo',
      'Escrituracao contabil/fiscal',
      'Demonstrativo de calculo do credito'
    ]
  },
  ecac: {
    titulo: 'ECAC - Situacao Fiscal Completa',
    acesso: [
      'cav.receita.fazenda.gov.br',
      'Login gov.br'
    ],
    menus_chave: [
      'Situacao Fiscal: consultar pendencias, debitos e CDAs.',
      'Parcelamentos: verificar parcelamentos ativos, parcelas pagas e saldo devedor.',
      'Processos Digitais: acompanhar processos administrativos, defesas e recursos.'
    ],
    como_baixar: 'Em cada pendencia/CDA, usar botao de download ou impressao.',
    passo_a_passo: [
      '1) Login no ECAC.',
      '2) Abrir Situacao Fiscal.',
      '3) Clicar em cada pendencia.',
      '4) Baixar notificacao/CDA.',
      '5) Verificar valor, periodo e tributo.',
      '6) Identificar possiveis erros de calculo.'
    ]
  },
  pgfn: {
    titulo: 'PGFN - Divida Ativa e Transacao Tributaria',
    transacao_individual: 'Para dividas acima de R$ 10 milhoes ou devedor em recuperacao judicial. Negociacao direta com a PGFN. Pode propor plano proprio.',
    transacao_adesao: 'Editais periodicos da PGFN. Checar edital vigente em gov.br/pgfn. Prazo de adesao limitado.',
    capacidade_pagamento: 'PGFN calcula internamente quanto o contribuinte pode pagar (CAPAG). Se discordar, pode contestar apresentando documentos financeiros (balanco, DRE, fluxo de caixa).',
    descontos_reais: 'Transacao excepcional: ate 65% do valor total. Transacao individual: ate 100% de juros e multas em casos especiais. Prazo maximo: 120 meses (145 para PF, MEI, micro e pequena empresa).',
    edital_vigente: 'SEMPRE checar edital vigente em pgfn.gov.br antes de propor adesao. Editais mudam a cada 3-6 meses.',
    confissao_divida_alerta: 'ATENCAO: parcelar implica CONFISSAO DE DIVIDA. Limita defesa futura. Se pretende impugnar, NAO parcele antes de consultar advogado.',
    acesso: [
      'regularize.pgfn.gov.br',
      'Login gov.br'
    ],
    revisao_parcelamento: 'Apos 12 meses de parcelamento regular, avaliar pedido de revisao das condicoes na PGFN. Conferir Portaria PGFN 6.757/2022 e atualizacoes.',
    transacao_tributaria: [
      'Modalidades: adesao, individual e excepcional.',
      'Descontos podem chegar a 65% (em cenarios qualificados pode variar).',
      'Prazo pode chegar a 120 meses.'
    ],
    passo_a_passo_revisao: [
      '1) Acessar regularize.pgfn.gov.br.',
      '2) Verificar se ha 12+ meses de parcelamento regular.',
      '3) Menu Negociar divida > Transacao.',
      '4) Ver modalidades disponiveis.',
      '5) Simular desconto.',
      '6) Se nao houver opcao online, protocolar pedido de revisao via e-CAC da PGFN.'
    ]
  },
  acao_anulatoria: {
    titulo: 'Acoes Anulatorias de Divida Tributaria',
    quando_usar: [
      'CDA com erro de calculo.',
      'Prescricao.',
      'Decadencia.',
      'Exigencia de tributo indevido.'
    ],
    requisitos: [
      'Identificar erro especifico da CDA (valor, periodo, base de calculo, formalidade).',
      'Separar prova documental do erro.',
      'Mapear cronologia de notificacoes e atos de cobranca.'
    ],
    pedidos_essenciais: [
      'Nulidade da CDA.',
      'Suspensao da exigibilidade (art. 151 do CTN).',
      'Tutela de urgencia para suspender cobranca/executividade.'
    ],
    argumentos_base: [
      'Prescricao quinquenal (art. 174 CTN).',
      'Decadencia quinquenal (art. 150, par. 4, ou art. 173 CTN).',
      'Erro material no titulo.',
      'Cerceamento de defesa no processo administrativo.'
    ],
    documentos: [
      'CDA integral',
      'Processo administrativo completo',
      'Calculos demonstrando erro',
      'Guias de pagamento (se houver)'
    ]
  },
  revisao_refis: {
    titulo: 'Revisao de REFIS e Parcelamentos Especiais',
    programas: [
      'REFIS',
      'PAES',
      'PAEX',
      'Lei 11.941/2009',
      'PERT (Lei 13.496/2017)'
    ],
    quando_pedir: [
      'Parcelas com juros sobre juros.',
      'Aplicacao indevida de Selic capitalizada.',
      'Inclusao indevida de debitos.'
    ],
    como_proceder: [
      'Peticao administrativa na PGFN.',
      'Ou acao judicial revisional, conforme estrategia do caso.'
    ],
    passo_a_passo: [
      '1) Levantar historico integral do parcelamento.',
      '2) Baixar demonstrativo de calculo na PGFN.',
      '3) Comparar com calculo proprio (Selic simples x composta).',
      '4) Havendo diferenca relevante, protocolar impugnacao administrativa ou acao revisional.'
    ]
  },
  processo_admin: {
    titulo: 'Processos Administrativos Fiscais',
    como_baixar: 'ECAC > Processos Digitais > buscar por CNPJ/CPF > download de inteiro teor.',
    como_protocolar_defesa: 'ECAC > Processos Digitais > Solicitar juntada de documentos.',
    prazos: [
      'Impugnacao: 30 dias da notificacao.',
      'Recurso voluntario: 30 dias da decisao.'
    ],
    instancias: [
      'DRJ (Delegacia Regional de Julgamento)',
      'CARF (Conselho Administrativo de Recursos Fiscais)',
      'Judicial'
    ],
    carf: 'Avaliar recurso especial em caso de decisao nao unanime.'
  },
  execucao_fiscal: {
    titulo: 'Execucao Fiscal - Defesa e Acompanhamento',
    como_acompanhar: 'Consultar no PJe (pje.jus.br) ou no site do tribunal (TJSP, TRF-3 etc). Buscar por CPF/CNPJ ou numero do processo.',
    excecao_pre_executividade: {
      o_que_e: 'Defesa SEM penhora. Usada quando ha materia de ordem publica (prescricao, nulidade CDA, ilegitimidade, pagamento).',
      quando_usar: 'So para questoes que o juiz pode conhecer de oficio. NAO serve para discutir valor ou merito complexo.',
      prazo: 'Nao tem prazo fixo, mas quanto antes melhor.'
    },
    embargos_execucao: {
      o_que_e: 'Defesa APOS garantia do juizo (penhora, deposito, seguro, fianca).',
      prazo: '30 dias contados da juntada do mandado de penhora ou da intimacao da garantia.',
      efeito_suspensivo: 'Pedir expressamente. Juiz pode conceder se houver risco de dano grave.'
    },
    substituicao_penhora: 'Se penhora recaiu sobre bem essencial (faturamento, unico imovel residencial), pedir substituicao oferecendo outro bem ou seguro garantia.',
    seguro_garantia: 'Alternativa a penhora: contratar apolice de seguro garantia judicial. Custo: ~1-3% ao ano do valor. Vantagem: nao bloqueia bens.'
  },
  simples_nacional: {
    titulo: 'Simples Nacional',
    exclusao_por_debito: 'Se excluido por debito, tem 30 dias para impugnar ou regularizar. Verificar notificacao no DTE-SN (Domicilio Tributario Eletronico).',
    como_regularizar: 'Pagar ou parcelar debitos no Regularize (PGFN) ou ECAC (RFB). Apos quitacao, pedir reingresso em janeiro.',
    pgdas_retificador: 'Se a PGDAS-D tem erro, transmitir retificadora pelo Portal do Simples Nacional (www8.receita.fazenda.gov.br/SimplesNacional).',
    defesa_cgsn: 'Contestar atos do Comite Gestor do Simples Nacional: impugnacao administrativa com prazo de 30 dias.'
  },
  tributos_locais: {
    titulo: 'Tributos Municipais e Estaduais (IPTU, ITBI, ITCMD)',
    iptu: {
      impugnacao: 'Se valor venal esta errado, impugnar lancamento na prefeitura em 30 dias. Se negado, acao anulatoria no JEC ou Vara da Fazenda.',
      revisao_valor: 'Pedir revisao do valor venal com laudo de avaliacao. Comparar com PGVG (Planta Generica de Valores).',
      isencao: 'Verificar se o contribuinte tem direito a isencao (aposentado, deficiente, area verde etc - varia por municipio).'
    },
    itbi: {
      base_calculo: 'STJ Tema 1113: base de calculo do ITBI e o valor da TRANSACAO (escritura), NAO o valor venal de referencia. Se prefeitura cobrou a mais, cabe restituicao.',
      passo_passo: 'Comparar valor pago com valor da escritura. Se divergente: pedir restituicao administrativa. Se negado: acao de repeticao de indebito.'
    },
    itcmd: {
      planejamento_inventario: 'Em inventario, verificar aliquota do estado (varia de 2% a 8%). Planejar doacao em vida pode ser mais vantajoso. Verificar isencoes estaduais.',
      base_calculo: 'Para imoveis: valor venal do IPTU ou valor de mercado (depende do estado). Para acoes: cotacao na data do obito.'
    }
  },
  certidao_negativa: {
    titulo: 'Certidao Negativa e CPEN',
    cnd: 'Certidao Negativa de Debitos. Emitir no ECAC (federal) ou site da SEFAZ (estadual) ou prefeitura (municipal).',
    cpen: 'Certidao Positiva com Efeito de Negativa. Emitida quando ha debitos mas estao com exigibilidade suspensa (parcelamento, liminar, impugnacao). TEM O MESMO EFEITO da CND.',
    como_pedir: 'ECAC > Certidoes e Situacao Fiscal > Emitir CND/CPEN. Se sistema negar, verificar pendencias.',
    mandado_seguranca: 'Se Receita ou PGFN negar emissao indevidamente (ex: debito suspenso por liminar mas sistema nao reflete), cabe mandado de seguranca para forcar emissao.',
    importancia: 'CND/CPEN e necessaria para: participar de licitacao, vender imovel, obter financiamento, distribuir lucros em empresa.'
  },
  compensacao_oficio: {
    titulo: 'Compensacao de Oficio pela Receita',
    o_que_e: 'Receita pode usar restituicao (IR, PERDCOMP) para abater debitos do contribuinte automaticamente.',
    como_contestar: 'Se compensacao indevida: impugnar em 30 dias da notificacao. Argumentar: debito prescrito, em discussao judicial, valor incorreto.',
    prevencao: 'Se tem restituicao a receber E debito em discussao: pedir ao juiz que determine a nao compensacao de oficio enquanto pendente o processo.'
  },
  prescricao_tributaria: {
    decadencia: 'Constituicao do credito: regra geral de 5 anos (art. 150, par. 4, e art. 173 CTN, conforme hipotese).',
    prescricao: 'Cobranca judicial: 5 anos da constituicao definitiva (art. 174 CTN).',
    interrupcao: [
      'Despacho citatorio em execucao fiscal',
      'Protesto judicial',
      'Confissao de divida'
    ],
    alerta: 'Sempre verificar prescricao/decadencia antes de negociar, parcelar ou ajuizar.'
  },
  gratuidade_justica: {
    pessoa_fisica: 'Declaracao de hipossuficiencia (art. 98 CPC), salvo elementos concretos em sentido contrario.',
    pessoa_juridica: 'Comprovacao de impossibilidade de arcar com custas (balanco, declaracoes, fluxo de caixa etc.).',
    momento: 'Pedir na peticao inicial da acao anulatoria, com documentos.'
  },
  jurisprudencia_estrategica: {
    stj: [
      'Prescricao intercorrente',
      'Nulidade de CDA',
      'Excesso de execucao'
    ],
    carf: [
      'Decadencia',
      'Creditamento',
      'PIS/COFINS'
    ],
    stf: [
      'Teses tributarias com repercussao geral'
    ],
    orientacao_agente: 'Pesquisar precedentes atuais e aderentes ao tribunal competente do caso, com fonte verificavel.'
  }
};

const CATALOGO_PECAS = {
  trabalhista: {
    tipos: ['reclamacao_trabalhista','defesa_trabalhista','recurso_ordinario','agravo_instrumento','mandado_seguranca_trab','execucao_trabalhista','impugnacao_calculo'],
    legislacao_base: ['CLT','CF art. 7','Sumulas TST','OJs SDI-1 e SDI-2','Lei 13.467/2017 (Reforma)'],
    tribunais: ['Vara do Trabalho','TRT','TST']
  },
  bancario_cdc: {
    tipos: ['revisional_contrato','acao_indenizatoria','repeticao_indebito','cautelar_exibicao','busca_apreensao_defesa','consignacao_pagamento'],
    legislacao_base: ['CDC (Lei 8.078/90)','CC arts. 389-420','Sumula 297 STJ','Sumula 381 STJ','Sumula 382 STJ','Res. CMN 4.893/2021'],
    tribunais: ['JEC','Vara Civel','TJSP/TJMG etc','STJ']
  },
  tributario: {
    tipos: ['acao_anulatoria','embargos_execucao_fiscal','mandado_seguranca_trib','impugnacao_administrativa','recurso_carf','excecao_pre_executividade','acao_repeticao_indebito_trib'],
    legislacao_base: ['CTN','CF art. 150-162','CPC','Lei 6.830/80 (LEF)','Decreto 70.235/72'],
    tribunais: ['Vara Fazenda Publica','TRF','STJ','STF','DRJ','CARF']
  },
  familia: {
    tipos: ['divorcio_consensual','divorcio_litigioso','guarda_compartilhada','guarda_unilateral','alimentos','revisional_alimentos','inventario','arrolamento','uniao_estavel','investigacao_paternidade'],
    legislacao_base: ['CC arts. 1.511-1.783','ECA','Lei 5.478/68 (Alimentos)','Lei 11.441/2007 (extrajudicial)','CF art. 226-227'],
    tribunais: ['Vara de Familia','TJSP etc','STJ']
  },
  civil: {
    tipos: ['cobranca','indenizacao_danos','despejo','usucapiao','obrigacao_fazer','monitoria','possessoria','declaratoria'],
    legislacao_base: ['CC','CPC','Lei 8.245/91 (Locacao)','Lei 10.257/2001 (Estatuto Cidade)'],
    tribunais: ['JEC','Vara Civel','TJSP etc','STJ']
  },
  penal: {
    tipos: ['defesa_previa','alegacoes_finais','habeas_corpus','relaxamento_prisao','revogacao_preventiva','recurso_apelacao_criminal','queixa_crime'],
    legislacao_base: ['CP','CPP','CF art. 5','Lei 7.210/84 (LEP)','Lei 11.340/2006 (Maria da Penha)','Lei 11.343/2006 (Drogas)'],
    tribunais: ['Vara Criminal','TJSP etc','STJ','STF']
  },
  previdenciario: {
    tipos: ['concessao_beneficio','revisao_beneficio','bpc_loas','aposentadoria_especial','auxilio_doenca','auxilio_acidente','pensao_morte','desaposentacao'],
    legislacao_base: ['Lei 8.213/91','Lei 8.742/93 (LOAS)','Decreto 3.048/99','EC 103/2019 (Reforma)','IN INSS/PRES 128/2022'],
    tribunais: ['Vara Federal/JEF','TRF','TNU','STJ']
  },
  administrativo: {
    tipos: ['mandado_seguranca_admin','acao_popular','impugnacao_edital','recurso_administrativo','acao_concurso_publico','responsabilidade_estado'],
    legislacao_base: ['CF','Lei 9.784/99','Lei 8.666/93','Lei 14.133/2021 (Nova Licitacao)','Lei 8.112/90'],
    tribunais: ['Vara Fazenda Publica','TRF','STJ','STF']
  }
};

function _orientarTributario(subtipo, contexto) {
  const st = _normTexto(subtipo || '');
  const ctx = contexto || {};
  const nomeCliente = ctx.nomeCliente || ctx.cliente || 'cliente';
  const cnpjCpf = ctx.cnpjCpf || ctx.documento || '[CPF/CNPJ]';
  const out = [];

  out.push('ORIENTACAO TRIBUTARIA OPERACIONAL');
  out.push('Cliente: ' + nomeCliente + ' (' + cnpjCpf + ')');
  out.push('Checklist inicial obrigatorio: verificar prescricao/decadencia antes de qualquer medida.');

  if(st === 'perdcomp') {
    const b = EXPERTISE_TRIBUTARIA.perdcomp;
    out.push('');
    out.push('[' + b.titulo + ']');
    out.push('O que e: ' + b.o_que_e);
    out.push('Acesso: ' + b.acesso.join(' | '));
    out.push('Passo a passo para secretaria:');
    b.passo_a_passo_secretaria.forEach(p => out.push('- ' + p));
    out.push('Quando usar: ' + b.quando_usar.join(' / '));
    out.push('Documentos necessarios: ' + b.documentos_necessarios.join('; '));
    out.push('PER x DCOMP: ' + b.diferenca_per_dcomp);
    out.push('Retificador: ' + b.retificador);
    out.push('Prazo de analise: ' + b.prazo_analise);
    out.push('Homologacao tacita: ' + b.homologacao_tacita);
    return out.join('\n');
  }

  if(st === 'ecac') {
    const b = EXPERTISE_TRIBUTARIA.ecac;
    out.push('');
    out.push('[' + b.titulo + ']');
    out.push('Acesso: ' + b.acesso.join(' | '));
    out.push('Menus-chave: ' + b.menus_chave.join(' | '));
    out.push('Como baixar: ' + b.como_baixar);
    out.push('Passo a passo operacional:');
    b.passo_a_passo.forEach(p => out.push('- ' + p));
    return out.join('\n');
  }

  if(st === 'pgfn') {
    const b = EXPERTISE_TRIBUTARIA.pgfn;
    out.push('');
    out.push('[' + b.titulo + ']');
    out.push('Acesso: ' + b.acesso.join(' | '));
    out.push('Revisao de parcelamento: ' + b.revisao_parcelamento);
    out.push('Transacao tributaria: ' + b.transacao_tributaria.join(' | '));
    out.push('Transacao individual: ' + b.transacao_individual);
    out.push('Transacao por adesao: ' + b.transacao_adesao);
    out.push('Capacidade de pagamento (CAPAG): ' + b.capacidade_pagamento);
    out.push('Descontos e prazo: ' + b.descontos_reais);
    out.push('Edital vigente: ' + b.edital_vigente);
    out.push('Alerta de confissao: ' + b.confissao_divida_alerta);
    out.push('Passo a passo para revisao/transacao:');
    b.passo_a_passo_revisao.forEach(p => out.push('- ' + p));
    return out.join('\n');
  }

  if(st === 'acao_anulatoria') {
    const b = EXPERTISE_TRIBUTARIA.acao_anulatoria;
    out.push('');
    out.push('[' + b.titulo + ']');
    out.push('Quando usar: ' + b.quando_usar.join(' / '));
    out.push('Requisitos minimos:');
    b.requisitos.forEach(p => out.push('- ' + p));
    out.push('Pedidos recomendados na inicial:');
    b.pedidos_essenciais.forEach(p => out.push('- ' + p));
    out.push('Argumentos juridicos-base: ' + b.argumentos_base.join(' | '));
    out.push('Documentos indispensaveis: ' + b.documentos.join('; '));
    out.push('Observacao: avaliar pedido de gratuidade de justica conforme perfil do contribuinte.');
    return out.join('\n');
  }

  if(st === 'revisao_refis') {
    const b = EXPERTISE_TRIBUTARIA.revisao_refis;
    out.push('');
    out.push('[' + b.titulo + ']');
    out.push('Programas cobertos: ' + b.programas.join(', '));
    out.push('Quando pedir revisao: ' + b.quando_pedir.join(' / '));
    out.push('Como proceder: ' + b.como_proceder.join(' / '));
    out.push('Passo a passo:');
    b.passo_a_passo.forEach(p => out.push('- ' + p));
    return out.join('\n');
  }

  if(st === 'processo_admin') {
    const b = EXPERTISE_TRIBUTARIA.processo_admin;
    out.push('');
    out.push('[' + b.titulo + ']');
    out.push('Como baixar: ' + b.como_baixar);
    out.push('Como protocolar defesa: ' + b.como_protocolar_defesa);
    out.push('Prazos: ' + b.prazos.join(' | '));
    out.push('Instancias: ' + b.instancias.join(' > '));
    out.push('CARF: ' + b.carf);
    return out.join('\n');
  }

  if(st === 'execucao_fiscal') {
    const b = EXPERTISE_TRIBUTARIA.execucao_fiscal;
    out.push('');
    out.push('[' + b.titulo + ']');
    out.push('Como acompanhar: ' + b.como_acompanhar);
    out.push('Excecao de pre-executividade:');
    out.push('- O que e: ' + b.excecao_pre_executividade.o_que_e);
    out.push('- Quando usar: ' + b.excecao_pre_executividade.quando_usar);
    out.push('- Prazo: ' + b.excecao_pre_executividade.prazo);
    out.push('Embargos a execucao:');
    out.push('- O que e: ' + b.embargos_execucao.o_que_e);
    out.push('- Prazo: ' + b.embargos_execucao.prazo);
    out.push('- Efeito suspensivo: ' + b.embargos_execucao.efeito_suspensivo);
    out.push('Substituicao de penhora: ' + b.substituicao_penhora);
    out.push('Seguro garantia: ' + b.seguro_garantia);
    return out.join('\n');
  }

  if(st === 'simples_nacional') {
    const b = EXPERTISE_TRIBUTARIA.simples_nacional;
    out.push('');
    out.push('[' + b.titulo + ']');
    out.push('Exclusao por debito: ' + b.exclusao_por_debito);
    out.push('Como regularizar: ' + b.como_regularizar);
    out.push('PGDAS retificador: ' + b.pgdas_retificador);
    out.push('Defesa no CGSN: ' + b.defesa_cgsn);
    return out.join('\n');
  }

  if(st === 'tributos_locais') {
    const b = EXPERTISE_TRIBUTARIA.tributos_locais;
    out.push('');
    out.push('[' + b.titulo + ']');
    out.push('IPTU:');
    out.push('- Impugnacao: ' + b.iptu.impugnacao);
    out.push('- Revisao de valor: ' + b.iptu.revisao_valor);
    out.push('- Isencao: ' + b.iptu.isencao);
    out.push('ITBI:');
    out.push('- Base de calculo: ' + b.itbi.base_calculo);
    out.push('- Passo a passo: ' + b.itbi.passo_passo);
    out.push('ITCMD:');
    out.push('- Planejamento/inventario: ' + b.itcmd.planejamento_inventario);
    out.push('- Base de calculo: ' + b.itcmd.base_calculo);
    return out.join('\n');
  }

  if(st === 'certidao_negativa') {
    const b = EXPERTISE_TRIBUTARIA.certidao_negativa;
    out.push('');
    out.push('[' + b.titulo + ']');
    out.push('CND: ' + b.cnd);
    out.push('CPEN: ' + b.cpen);
    out.push('Como pedir: ' + b.como_pedir);
    out.push('Mandado de seguranca: ' + b.mandado_seguranca);
    out.push('Importancia: ' + b.importancia);
    return out.join('\n');
  }

  if(st === 'compensacao_oficio') {
    const b = EXPERTISE_TRIBUTARIA.compensacao_oficio;
    out.push('');
    out.push('[' + b.titulo + ']');
    out.push('O que e: ' + b.o_que_e);
    out.push('Como contestar: ' + b.como_contestar);
    out.push('Prevencao: ' + b.prevencao);
    return out.join('\n');
  }

  out.push('');
  out.push('[TRIBUTARIO - VISAO GERAL]');
  out.push('Subtipo nao informado ou nao reconhecido. Use: perdcomp, ecac, pgfn, acao_anulatoria, revisao_refis, processo_admin, execucao_fiscal, simples_nacional, tributos_locais, certidao_negativa, compensacao_oficio.');
  out.push('Pontos obrigatorios em qualquer caso:');
  out.push('- Validar prescricao/decadencia (CTN arts. 150 par. 4, 173 e 174).');
  out.push('- Coletar CDA, processo administrativo e memoria de calculo.');
  out.push('- Definir via: administrativa (ECAC/PGFN/CARF) ou judicial (acao anulatoria/revisional).');
  out.push('- Levantar jurisprudencia estrategica no STJ, CARF e STF.');
  return out.join('\n');
}

function _montarChecklistTributario(caso) {
  const texto = typeof caso === 'string' ? caso : JSON.stringify(caso || {});
  const t = _normTexto(texto);
  const checklist = [];

  checklist.push('Coletar qualificacao completa do contribuinte (nome/razao social, CPF/CNPJ, procuracao).');
  checklist.push('Baixar situacao fiscal completa no ECAC e salvar pendencias/CDA em PDF.');
  checklist.push('Verificar prescricao e decadencia antes de negociar, parcelar ou ajuizar.');
  checklist.push('Organizar pasta de provas: CDA integral, processo administrativo, calculos e comprovantes de pagamento.');
  checklist.push('Mapear prazo processual administrativo (30 dias para impugnacao; 30 dias para recurso voluntario).');
  checklist.push('Pesquisar jurisprudencia estrategica atual (STJ, CARF, STF) aderente ao tema.');

  if(/perdcomp|restitu|compensac|darf|dctf/.test(t)) {
    checklist.push('PERDCOMP: separar DARF pago a maior, DCTF, escrituracao e demonstrativo de credito.');
    checklist.push('PERDCOMP: transmitir no ECAC e registrar numero do protocolo/processo.');
  }

  if(/ecac|cda|situacao fiscal|pendenc|processo digital/.test(t)) {
    checklist.push('ECAC: revisar cada pendencia com valor, periodo e tributo; apontar possivel erro material.');
    checklist.push('ECAC: baixar inteiro teor dos processos digitais e registrar data de ciencia/notificacao.');
  }

  if(/pgfn|divida ativa|transacao|parcelamento/.test(t)) {
    checklist.push('PGFN: consultar divida ativa no Regularize e extrair demonstrativo completo.');
    checklist.push('PGFN: verificar elegibilidade para revisao/transacao (especialmente 12+ meses de adimplencia em parcelamento).');
    checklist.push('PGFN: simular modalidades e descontos antes de protocolar pedido.');
  }

  if(/anulatoria|nulidade|exigibilidade|tutela|ctn/.test(t)) {
    checklist.push('Acao anulatoria: delimitar vicio especifico da CDA (valor, periodo, base de calculo, formalidade).');
    checklist.push('Acao anulatoria: estruturar pedidos de nulidade, suspensao da exigibilidade (art. 151 CTN) e tutela de urgencia.');
  }

  if(/refis|paes|paex|11\\.941|pert|13\\.496|revisional/.test(t)) {
    checklist.push('Revisao REFIS/PERT: levantar historico e comparar calculo oficial vs calculo proprio (Selic simples x composta).');
    checklist.push('Revisao REFIS/PERT: definir via administrativa (PGFN) ou judicial revisional conforme risco e prazo.');
  }

  if(/gratuidade|hipossuficien|custas|pessoa juridica|pessoa fisica/.test(t)) {
    checklist.push('Gratuidade de justica: PF com declaracao de hipossuficiencia; PJ com balanco e prova de incapacidade financeira.');
  }

  checklist.push('Emitir plano final de execucao para secretaria: coleta documental, protocolo, acompanhamento e atualizacao ao advogado responsavel.');
  return checklist;
}

function _gerarModeloRequerimento(tipo, dadosCliente) {
  const nome = dadosCliente.nome || '[NOME DO REQUERENTE]';
  const cpf = dadosCliente.cpf || '[CPF]';
  const data = new Date().toLocaleDateString('pt-BR');
  const modelos = {
    contrato_bancario: 'REQUERIMENTO DE COPIA DE CONTRATO\n\nIlmo(a) Sr(a) Gerente,\n\nEu, '+nome+', CPF '+cpf+', venho por meio deste REQUERER copia integral do(s) contrato(s) firmado(s) junto a esta instituicao financeira, conforme direito previsto no art. 46 do CDC e Resolucao CMN 4.893/2021.\n\nSolicito resposta no prazo legal de 5 (cinco) dias uteis.\n\n'+data+'\n\n____________________________\n'+nome,
    extrato_bancario: 'REQUERIMENTO DE EXTRATOS\n\nIlmo(a) Sr(a) Gerente,\n\nEu, '+nome+', CPF '+cpf+', REQUEIRO copia dos extratos bancarios dos ultimos 12 (doze) meses da conta corrente/poupanca mantida nesta instituicao, conforme art. 43 do CDC.\n\n'+data+'\n\n____________________________\n'+nome,
    holerites_empresa: 'REQUERIMENTO DE DOCUMENTOS TRABALHISTAS\n\nA(o) Departamento de Recursos Humanos,\n\nEu, '+nome+', CPF '+cpf+', ex-funcionario(a) desta empresa, REQUEIRO copia dos seguintes documentos: holerites dos ultimos 12 meses, cartoes de ponto, TRCT e guias de FGTS, conforme obrigacao legal (CLT art. 464 e art. 477).\n\nSolicito resposta em 5 dias uteis.\n\n'+data+'\n\n____________________________\n'+nome,
    prontuario_medico: 'REQUERIMENTO DE PRONTUARIO MEDICO\n\nIlmo(a) Sr(a) Diretor(a) Clinico(a),\n\nEu, '+nome+', CPF '+cpf+', REQUEIRO copia integral do meu prontuario medico, conforme direito garantido pelo art. 88 do Codigo de Etica Medica e Lei 13.787/2018.\n\n'+data+'\n\n____________________________\n'+nome,
    impugnacao_administrativa: 'IMPUGNACAO ADMINISTRATIVA TRIBUTARIA\n\nIlmo(a) Delegado(a) da Receita Federal/Autoridade Fiscal Competente,\n\nEu, '+nome+', CPF '+cpf+', venho apresentar IMPUGNACAO ao Auto de Infracao/Lancamento, com fundamento no art. 15 do Decreto 70.235/72, no prazo legal de 30 (trinta) dias contados da ciencia.\n\nI - DOS FATOS\n[Descrever o auto/lancamento, data da ciencia e sintese da exigencia]\n\nII - DAS RAZOES DE IMPUGNACAO\n[Apontar nulidades, erro de base de calculo, decadencia/prescricao, pagamento, ilegitimidade ou outra tese aplicavel]\n\nIII - DOS PEDIDOS\na) Recebimento da presente impugnacao por tempestiva;\nb) Cancelamento total ou parcial do lancamento;\nc) Producao de provas documentais e periciais, se necessarias.\n\nNestes termos, pede deferimento.\n\n'+data+'\n\n____________________________\n'+nome,
    recurso_voluntario_carf: 'RECURSO VOLUNTARIO AO CARF\n\nIlmo(a) Presidente da Delegacia de Julgamento/Conselho Administrativo de Recursos Fiscais,\n\nEu, '+nome+', CPF '+cpf+', interponho RECURSO VOLUNTARIO ao CARF, no prazo de 30 (trinta) dias da ciencia da decisao da DRJ.\n\nI - TEMPESTIVIDADE\n[Afirmar a data da ciencia e o cumprimento do prazo recursal]\n\nII - RAZOES RECURSAIS\n[Demonstrar erro de fato e/ou de direito na decisao recorrida, com base legal e jurisprudencial]\n\nIII - PEDIDOS\na) Conhecimento do recurso;\nb) Reforma integral ou parcial da decisao da DRJ;\nc) Cancelamento da exigencia fiscal no ponto impugnado.\n\nTermos em que, pede deferimento.\n\n'+data+'\n\n____________________________\n'+nome,
    revisao_parcelamento_pgfn: 'PEDIDO DE REVISAO DE PARCELAMENTO - PGFN\n\nIlmo(a) Procurador(a)-Chefe da PGFN,\n\nEu, '+nome+', CPF '+cpf+', venho requerer REVISAO DAS CONDICOES DO PARCELAMENTO ativo, diante da capacidade de pagamento atual e da necessidade de reequilibrio das condicoes.\n\nI - FUNDAMENTOS\n[Informar numero do parcelamento, historico de adimplencia, alteracao financeira e base normativa aplicavel]\n\nII - DOCUMENTOS\n[Anexar balanco, DRE, fluxo de caixa, comprovantes de pagamento e demais documentos financeiros]\n\nIII - PEDIDOS\na) Reanalise da capacidade de pagamento;\nb) Revisao de entrada, prazo e/ou descontos conforme modalidade cabivel;\nc) Suspensao de atos constritivos enquanto pendente a analise, quando cabivel.\n\nNestes termos, pede deferimento.\n\n'+data+'\n\n____________________________\n'+nome,
    pedido_cpen: 'REQUERIMENTO DE EMISSAO DE CPEN\n\nIlmo(a) Autoridade Fiscal Competente,\n\nEu, '+nome+', CPF '+cpf+', venho requerer a emissao de CERTIDAO POSITIVA COM EFEITO DE NEGATIVA (CPEN), pois ha debitos com exigibilidade suspensa (parcelamento/liminar/impugnacao), nos termos do CTN.\n\nI - SITUACAO FISCAL\n[Descrever debitos e causa de suspensao da exigibilidade]\n\nII - FUNDAMENTO\nA CPEN possui o mesmo efeito juridico da CND quando presente causa legal de suspensao da exigibilidade.\n\nIII - PEDIDOS\na) Emissao imediata da CPEN;\nb) Em caso de indeferimento, decisao fundamentada indicando pendencia especifica.\n\n'+data+'\n\n____________________________\n'+nome
  };
  return modelos[tipo] || 'Modelo nao disponivel para este tipo. Consulte o advogado.';
}

// Detecta tipo de caso a partir de texto livre do cliente
function _detectarTipoCaso(texto) {
  const t = _normTexto(texto||'');
  if(/(banco|cartao|emprestimo consignado|juros abusiv|negativad|spc|serasa|cdc|consumidor|tarifa)/.test(t)) return 'bancario_cdc';
  if(/(icms|iss|ipi|irpj|irpf|tribut|fiscal|sefaz|receita federal|auto de infracao|darf|simples nacional)/.test(t)) return 'tributario';
  // Trabalhista
  if(/(demiss|trabalh|empregad|patrao|ctps|hora extra|fgts|aviso previo|rescis|clt)/.test(t)) return 'trabalhista';
  // Previdenciário
  if(/(aposentad|inss|beneficio|auxilio|pensao|loas|bpc|invalidez|incapacidade|rural previd)/.test(t)) return 'previdenciario';
  if(/(empresa|socio|sociedade|fornecedor|representacao comercial|titulo de credito|duplicata|franquia)/.test(t)) return 'comercial';
  if(/(divorcio|guarda|pensao aliment|uniao estavel|inventario|partilha|visitas|familia)/.test(t)) return 'familia';
  if(/(prisao|flagrante|inquerito|delegacia|crime|penal|boletim de ocorrencia|audiencia de custodia)/.test(t)) return 'penal';
  if(/(concurso|servidor publico|processo administrativo|licenca|portaria|sindicancia|improbidade|edital)/.test(t)) return 'administrativo';
  // Cível (fallback mais amplo)
  if(/(cobranc|contrato|indeniza|consumidor|inadimplenc|dividir|emprestimo|danos)/.test(t)) return 'civil';
  return null; // indefinido, Lex vai perguntar
}


// ════════════════════════════════════════════════════════════════════════════
//
// FILOSOFIA: não é redator, é ASSESSOR. Debate antes de escrever.
//
// 7 REGRAS (ditadas por Kleuber):
// 1. ESTABILIDADE DA LIDE (art. 329 CPC) — sem pedidos novos salvo fato superveniente
// 2. MODO DEBATE — diálogo em 3 turnos (diagnóstico → estratégia → autorização)
// 3. ALINHAR AO JULGADOR — perfil do magistrado/relator
// 4. JURISPRUDÊNCIA FAVORÁVEL, DO TRIBUNAL CERTO — hierarquia STF>STJ>TJ do caso
// 5. JURISPRUDÊNCIA REAL — [VERIFICAR] em tudo sem fonte confirmada
// 6. BAGAGEM PROCESSUAL — CPC, admissibilidade, peça certa no momento certo
// 7. ADVERSARIAL — pensa sempre onde a parte contrária vai atacar
//
// MÓDULOS:
// - Judicial: ED, agravos, apelação, RE, REsp, impugnação, contestação, memoriais
// - Administrativo: impugnação fiscal, recurso CARF/TIT, MS preventivo
// - Pericial: laudo contábil com calculadora determinística + metodologia
//
// Red team interno: "se eu fosse a parte contrária, atacaria assim: ..."
// ════════════════════════════════════════════════════════════════════════════

// ── CALCULADORA DETERMINÍSTICA (não usa LLM) ──────────────────────────────
// Separa conta matemática da redação. LLM DESCREVE o que a função CALCULA.
// Sem isso, LLM pode errar soma/juros e invalidar a perícia.

const _calc = {
  // Juros simples: J = C × i × n
  jurosSimples(capital, taxaMensal, meses) {
    const c = parseFloat(capital) || 0;
    const i = parseFloat(taxaMensal) || 0;
    const n = parseFloat(meses) || 0;
    const juros = c * (i/100) * n;
    return { capital: c, taxa: i, meses: n, juros: Math.round(juros*100)/100, total: Math.round((c+juros)*100)/100 };
  },

  // Juros compostos: M = C × (1 + i)^n
  jurosCompostos(capital, taxaMensal, meses) {
    const c = parseFloat(capital) || 0;
    const i = parseFloat(taxaMensal) || 0;
    const n = parseFloat(meses) || 0;
    const montante = c * Math.pow(1 + i/100, n);
    const juros = montante - c;
    return { capital: c, taxa: i, meses: n, juros: Math.round(juros*100)/100, montante: Math.round(montante*100)/100 };
  },

  // Correção monetária simples (índice acumulado fornecido)
  corrigir(valor, indiceAcumuladoPct) {
    const v = parseFloat(valor) || 0;
    const i = parseFloat(indiceAcumuladoPct) || 0;
    const corrigido = v * (1 + i/100);
    return { original: v, indice: i, corrigido: Math.round(corrigido*100)/100, correcao: Math.round((corrigido-v)*100)/100 };
  },

  // Soma de parcelas com juros simples mensais sobre cada parcela até data-base
  somaParcelasJurosSimples(parcelas, taxaMensal) {
    // parcelas: [{valor, mesesAteDataBase}]
    let total = 0, detalhes = [];
    for(const p of parcelas) {
      const j = _calc.jurosSimples(p.valor, taxaMensal, p.mesesAteDataBase);
      total += j.total;
      detalhes.push({...p, ...j});
    }
    return { total: Math.round(total*100)/100, detalhes };
  },

  // SELIC acumulada — aqui é um PLACEHOLDER
  // Em produção real: integrar com API do BACEN
  selicPlaceholder(mesInicial, mesFinal) {
    // Retorna estrutura explicitando que precisa de dados reais
    return {
      _atencao: '[VERIFICAR] integrar com API BACEN ou planilha manual',
      periodo: mesInicial+' a '+mesFinal,
      taxa: null
    };
  }
};

// Formata R$
function _fmtBRL(v) {
  const n = parseFloat(v) || 0;
  return 'R$ ' + n.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
}

function _anexarSemDuplicar(base, blocos) {
  let out = String(base || '');
  for(const b of (blocos || [])) {
    if(!b) continue;
    if(!out.includes(b)) out += '\n' + b;
  }
  return out;
}

// ── SYSTEM PROMPT do Assessor (inclui as 7 regras) ──
function _sysAssessorSenior(proc, memCaso, fase, contextoExtra) {
  const memTxt = memCaso && memCaso.length
    ? memCaso.map(f=>`- [${f.tipo}|${(f.data||'').substring(0,10)}] ${f.texto}`).join('\n')
    : '(sem memória prévia do caso)';

  const procTxt = proc ? `
PROCESSO ALVO:
- Nome: ${proc.nome}
- Nº: ${proc.numero||'(não informado)'}
- Tribunal/Vara: ${proc.tribunal||'(não informado)'}
- Área: ${proc.area||'(não informada)'}
- Partes: ${proc.partes||'(não informadas)'}
- Status: ${proc.status||'(não informado)'}
- Última ação: ${proc.proxacao||'(não informada)'}
- Prazo atual: ${proc.prazo||'(nenhum)'}
- Descrição: ${proc.descricao||'(não informada)'}
- Arquivos já analisados: ${(proc.arquivos||[]).slice(0,5).join(', ')||'nenhum'}

ANDAMENTOS RECENTES:
${(proc.andamentos||[]).slice(0,10).map(a=>`- ${a.data}: ${a.txt}`).join('\n')||'(nenhum andamento registrado)'}

MEMÓRIA DO CASO (fatos estratégicos de longo prazo):
${memTxt}
` : '';

  let _prompt = `Você é o ASSESSOR JURÍDICO SÊNIOR do escritório Camargos Advocacia, auxiliando Kleuber Melchior — CEO e analista jurídico estrategista (NÃO advogado) que redige petições assinadas por Wanderson Farias de Camargos (OAB/MG 118.237).

SUA MISSÃO: ser ASSESSOR, não redator. Debater estratégia antes de escrever.
Autonomia: DINAMISMO OPERACIONAL — funcionário de verdade. Ordem direta = execute imediatamente. Iniciativa própria = pergunte primeiro. Atualização de dados = processo volta ATIVO. Entenda o contexto e determine setor/status corretos.
JUNTAR PEÇA NO PROCESSO: quando Kleuber disser "junta no processo", "vincula ao processo", "essa petição/perícia é do processo X" → ENTENDA o comando e ATUALIZE o processo: grave no andamento que a peça foi produzida, mova pra ATIVO, registre como documento. Serviço COMPLETO de ponta a ponta.
Qualidade: toda fundamentação deve ser técnica, precisa e apoiada em jurisprudência real.
Proatividade: sempre sugerir próximos passos e antecipar riscos processuais.

═══ AS 7 REGRAS INEGOCIÁVEIS ═══

REGRA 1 — ESTABILIDADE DA LIDE (art. 329 CPC)
Jamais sugerir pedido novo salvo fato superveniente real (art. 493 CPC).
Se Kleuber propuser inovação, ALERTE o risco antes de redigir.

REGRA 2 — MODO DEBATE (PROATIVO)
Sempre dialogar ANTES de escrever. Três turnos:
(a) DIAGNÓSTICO: leio a decisão/peça adversa, aponto brechas
(b) ESTRATÉGIA: proponho abordagens, peço autorização
(c) REDAÇÃO: só após "autoriza"
IMPORTANTE: NUNCA concorde automaticamente com tudo que o Kleuber falar.
Se ele propor algo que tem risco, DIGA que tem risco. Se discordar, ARGUMENTE.
Seja um sócio debatendo, não um empregado dizendo "sim senhor".
Traga seu ponto de vista, mesmo quando contrariar o do Kleuber.
Se o Kleuber insistir após seu contra-argumento, acate — mas registre o risco.

REGRA 3 — ALINHAR AO JULGADOR
Sempre considerar o perfil decisório do magistrado/relator. Se não souber, marque [VERIFICAR perfil decisório do relator X].

REGRA 4 — JURISPRUDÊNCIA DO TRIBUNAL CERTO
Hierarquia: STF > STJ > Tribunal do caso > outros TJs > doutrina.
Só cite jurisprudência FAVORÁVEL à tese. Nunca cite contra.

REGRA 5 — JURISPRUDÊNCIA REAL (CRÍTICO)
NUNCA inventar julgados. Toda citação precisa de referência completa:
"STJ, Turma X, REsp N.NNN.NNN/UF, Rel. Min. FULANO, DJe dd/mm/aaaa"
Se não tiver fonte confirmada, marque [VERIFICAR: tese a buscar] em vez de citar.
ISSO É REGRA ABSOLUTA. Preferível falhar em não citar do que citar fake.

REGRA 6 — BAGAGEM PROCESSUAL
Dominar CPC/2015 (art. 1.022 ED, 1.015 agravo, 1.025 prequestionamento, 489 fundamentação).
Peça CERTA no momento CERTO. Admissibilidade primeiro (prazo, cabimento, preparo, representação).
Nunca recomende peça errada por "jeitinho" — peça errada mata o processo.

REGRA 7 — ADVERSARIAL
Pensar SEMPRE onde a parte contrária vai atacar. Fechar flancos.
Para cada argumento: "a outra parte dirá X — como respondemos?"

═══ MÓDULOS ═══

JUDICIAL: ED, agravo (interno/instrumento), apelação, RE, REsp, impugnação, contestação, contrarrazões, memoriais, manifestação, petição inicial.

ADMINISTRATIVO: impugnação fiscal, recurso CARF/TIT/TAT, mandado de segurança preventivo, defesa em auto de infração, resposta a termo de intimação.

MODULO BANCARIO/CDC: contratos bancarios, anatocismo, venda casada, CDC, Lei 14.181/2021 (superendividamento), art. 104-A (plano de pagamento). Sempre apontar nulidades, abusividade, revisao contratual e estratégia probatória.

PERICIAL: laudo pericial contábil com metodologia, planilha de cálculo (juros/correção), respostas aos quesitos, memória de cálculo, fundamentação legal de irregularidades. TODOS os cálculos vêm da calculadora determinística — você descreve, não calcula.

COBERTURA TOTAL OBRIGATÓRIA DAS ÁREAS:
- bancário/CDC
- tributário
- civil
- comercial/empresarial
- família (inventário, separação, partilha, reconhecimento de sociedade de fato)
- trabalhista
- previdenciário
- penal
- administrativo
Aplicar conhecimento técnico específico por área.

═══ FORMATO DE RESPOSTA ═══

${fase === 'diagnostico' ? `
ESTA FASE: DIAGNÓSTICO
- Analise o documento/decisão fornecido
- Identifique: omissões, contradições, erros materiais, brechas argumentativas
- Liste cabimentos processuais possíveis e prazos
- NÃO sugira ainda a estratégia final
- NÃO redija peça ainda
- Termine perguntando: "Qual direção quer seguir?"
` : fase === 'estrategia' ? `
ESTA FASE: ESTRATÉGIA
- Proponha 2-3 abordagens alternativas com prós e contras
- Indique qual recomenda e por quê
- Liste PEDIDOS exatos (respeitando estabilidade da lide)
- Liste jurisprudência necessária (marcando [VERIFICAR] nas incertas)
- Faça red team: "a parte contrária vai atacar assim: ..."
- Termine com: "Autoriza redigir com essa abordagem?"
` : fase === 'redacao' ? `
ESTA FASE: REDAÇÃO FINAL
- Redija a peça em linguagem jurídica formal brasileira
- Estrutura completa: endereçamento, qualificação (ou "já qualificado nos autos"), fatos, fundamentos, pedido, data/assinatura
- Profissional assinante: ${ESCRITORIO.responsavel||'Wanderson Farias de Camargos'}, ${ESCRITORIO.registro||'OAB/MG'}
- Toda jurisprudência SEM fonte confirmada → marque [VERIFICAR]
- Toda conta SEM cálculo feito pela calculadora → marque [CALCULAR]
- Ao final, seção "ANÁLISE ESTRATÉGICA DO CASO" com (1) linha do tribunal (2) caminhos em ordem de viabilidade (3) o que fazer para aumentar chances
` : `
Modo conversacional livre. Dialogue com Kleuber sobre o caso.
`}

${procTxt}
${contextoExtra||''}`;
  _prompt = _anexarSemDuplicar(_prompt, [
    'PENSAMENTO ADVERSARIAL OBRIGATÓRIO: pensar sempre no contraditório e fechar portas para decisão contrária.',
    'PROIBIDO INOVAR NOS PEDIDOS: conferir estritamente os pedidos da inicial e manter congruência.',
    'JURISPRUDÊNCIA ESTRATÉGICA: embutir precedentes nos argumentos sem escancarar; extrair apenas trechos pertinentes com linguagem adaptada ao caso.',
    'QUALIDADE RECURSAL: estruturar para STJ/STF sem bater na Súmula 7.',
    'VEDAÇÃO ABSOLUTA: jurisprudência inventada é proibida.'
  ]);
  _prompt = _anexarSemDuplicar(_prompt, [
    'FORMATAÇÃO VISUAL PROFISSIONAL: usar linguagem objetiva, discreta e padrão de escritório; nada espalhafatoso.',
    'TÓPICOS/TÍTULOS: usar azul escuro #1a3a5c nos títulos de seção.',
    'TABELAS (quando houver): cabeçalho #1a3a5c com texto branco; linhas alternadas #f5f5f5 e branco.',
    'VALORES NEGATIVOS/ERROS: destacar em vermelho discreto #c0392b.',
    'VALORES POSITIVOS/CORRETOS: destacar em verde discreto #27ae60.',
    'REGRAS APLICAM-SE A PETIÇÕES E PERÍCIAS: manter sempre tom profissional e discreto.'
  ]);

  return _prompt;
}

// ── FLUXO DIÁLOGO EM 3 TURNOS ──

async function _assessorDiagnostico(ctx, mem, proc, conteudoParaAnalisar, tipoConteudo) {
  // tipoConteudo: 'decisao' | 'peca_adversa' | 'pedido_livre'
  const memCaso = proc ? await recuperarMemoriaDoCaso(proc.nome, 30) : [];
  let sys = _sysAssessorSenior(proc, memCaso, 'diagnostico', 
    tipoConteudo === 'decisao' ? 'TIPO: Análise de DECISÃO para propor peça.' :
    tipoConteudo === 'peca_adversa' ? 'TIPO: Análise de PEÇA ADVERSA para propor resposta.' :
    'TIPO: Kleuber descreveu demanda livre.');
  sys = _anexarSemDuplicar(sys, [
    'PENSAR SEMPRE NO CONTRADITÓRIO e fechar portas para decisão contra nós.',
    'PROIBIDO inovar nos pedidos: verificar os pedidos da inicial antes de qualquer estratégia.',
    'Jurisprudência: usar estrategicamente nos argumentos, sem escancarar.',
    'Extrair trechos pertinentes de jurisprudência e adaptar linguagem ao caso concreto.',
    'Qualidade para STJ/STF sem bater na Súmula 7.',
    'PROIBIDO jurisprudência inventada.'
  ]);
  const _taskId = 'assessor_diag_'+String(ctx.chatId)+'_'+String(ctx.threadId||'main');
  await _salvarCheckpoint(_taskId, {
    fase: 'diagnostico',
    procId: proc?.id || null,
    tipoConteudo: tipoConteudo || '',
    conteudo: conteudoParaAnalisar || ''
  });

  await env('🧠 Analisando... (diagnóstico, ~40s)', ctx);

  try {
    const msg = [{role:'user', content:
      'CONTEÚDO PARA ANÁLISE ('+tipoConteudo+'):\n\n'+
      (conteudoParaAnalisar||'(Kleuber não forneceu conteúdo direto; usar contexto do processo acima)')+
      '\n\nExecute o DIAGNÓSTICO conforme a fase atual.'
    }];
    const resposta = await ia(msg, sys, 2500);
    mem.aguardando = 'assessor_estrategia';
    mem.dadosColetados.assessorProcId = proc?.id || null;
    mem.dadosColetados.assessorConteudo = conteudoParaAnalisar;
    mem.dadosColetados.assessorTipoConteudo = tipoConteudo;
    mem.dadosColetados.assessorDiagnostico = resposta;
    salvarMemoria(ctx.chatId, ctx.threadId);
    logAtividade('juridico', ctx.chatId, 'assessor_diagnostico', (proc?.nome||'sem proc')+' | '+tipoConteudo);
    await env('📋 DIAGNÓSTICO:\n\n'+resposta+'\n\n━━━━━━━━━━━━━━━━━━━━\n➡ Qual direção quer seguir? (descreva ou escolha uma das sugestões acima)', ctx);
  } catch(e) {
    const ck = await _recuperarCheckpoint(_taskId);
    if(ck && !mem.dadosColetados.assessorConteudo && ck.conteudo) {
      mem.dadosColetados.assessorConteudo = ck.conteudo;
    }
    await env('❌ Erro no diagnóstico: '+e.message, ctx);
    mem.aguardando = null;
  }
}

async function _assessorEstrategia(ctx, mem, escolhaKleuber) {
  const procId = mem.dadosColetados.assessorProcId;
  const proc = procId ? processos.find(p=>p.id===procId) : null;
  const memCaso = proc ? await recuperarMemoriaDoCaso(proc.nome, 30) : [];
  const sys = _sysAssessorSenior(proc, memCaso, 'estrategia',
    'CONTEÚDO ORIGINAL ANALISADO:\n'+(mem.dadosColetados.assessorConteudo||'(nenhum)')+
    '\n\nDIAGNÓSTICO ANTERIOR:\n'+(mem.dadosColetados.assessorDiagnostico||'(nenhum)'));

  const _taskId = 'assessor_est_'+String(ctx.chatId)+'_'+String(ctx.threadId||'main');
  await _salvarCheckpoint(_taskId, {
    fase: 'estrategia',
    procId: proc?.id || null,
    escolha: escolhaKleuber || ''
  });
  await env('⚖ Formulando estratégia... (~40s)', ctx);

  try {
    const msg = [{role:'user', content:
      'ESCOLHA/ORIENTAÇÃO DE KLEUBER:\n'+escolhaKleuber+
      '\n\nExecute a ESTRATÉGIA conforme fase atual. Lembre: estabilidade da lide, red team, [VERIFICAR] em jurisprudência.'
    }];
    const resposta = await ia(msg, sys, 3000);
    mem.aguardando = 'assessor_autorizacao';
    mem.dadosColetados.assessorEscolha = escolhaKleuber;
    mem.dadosColetados.assessorEstrategia = resposta;
    salvarMemoria(ctx.chatId, ctx.threadId);
    logAtividade('juridico', ctx.chatId, 'assessor_estrategia', proc?.nome||'sem proc');
    await env('⚖ ESTRATÉGIA:\n\n'+resposta+'\n\n━━━━━━━━━━━━━━━━━━━━\n➡ Autoriza redigir? Responda "autoriza" / "autorizo" / "pode redigir", "ajustar" (pra mudar) ou "cancelar".', ctx);
  } catch(e) {
    await env('❌ Erro na estratégia: '+e.message, ctx);
    mem.aguardando = null;
  }
}

async function _assessorRedacao(ctx, mem) {
  const procId = mem.dadosColetados.assessorProcId;
  const proc = procId ? processos.find(p=>p.id===procId) : null;
  const memCaso = proc ? await recuperarMemoriaDoCaso(proc.nome, 30) : [];
  const sys = _sysAssessorSenior(proc, memCaso, 'redacao',
    'CONTEÚDO ORIGINAL:\n'+(mem.dadosColetados.assessorConteudo||'(nenhum)')+
    '\n\nDIAGNÓSTICO:\n'+(mem.dadosColetados.assessorDiagnostico||'(nenhum)')+
    '\n\nESTRATÉGIA AUTORIZADA:\n'+(mem.dadosColetados.assessorEstrategia||'(nenhum)'));

  const _taskId = 'assessor_red_'+String(ctx.chatId)+'_'+String(ctx.threadId||'main');
  await _salvarCheckpoint(_taskId, {
    fase: 'redacao',
    procId: proc?.id || null,
    conteudo: mem.dadosColetados.assessorConteudo || '',
    estrategia: mem.dadosColetados.assessorEstrategia || ''
  });
  await env('✍ Redigindo... (~50s)', ctx);

  try {
    const msg = [{role:'user', content:
      'KLEUBER AUTORIZOU a redação com a estratégia acima.\n\nEXECUTE A REDAÇÃO FINAL da peça conforme a fase atual. Marque [VERIFICAR] em toda jurisprudência sem fonte confirmada. Marque [CALCULAR] em contas pendentes.'
    }];
    const resposta = await ia(msg, sys, 4000);

    // Envia o texto da peça
    const nomeArq = 'peca_'+(proc?.nome||'novo').replace(/\s+/g,'_').substring(0,20)+
      '_'+new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')+'.txt';
    await envArq(Buffer.from(resposta,'utf8'), nomeArq, ctx, 'text/plain');
    await env('✅ Peça redigida. Pontos de atenção:\n\n⚠️ [VERIFICAR] → jurisprudência não confirmada, você precisa validar fonte antes de usar\n⚠️ [CALCULAR] → conta que precisa passar pela calculadora (me peça o cálculo)\n⚠️ Campos [ ] → dados a preencher\n\nRevise antes de protocolar.', ctx);

    // Memória do caso
    if(proc) {
      await lembrarDoCaso(proc.nome, 'peca_redigida',
        'Peça redigida pelo Assessor via diálogo 3-turnos. Estratégia: '+(mem.dadosColetados.assessorEstrategia||'').substring(0,200),
        ctx.canal);
    }

    // Limpa estado
    mem.aguardando = null;
    delete mem.dadosColetados.assessorProcId;
    delete mem.dadosColetados.assessorConteudo;
    delete mem.dadosColetados.assessorTipoConteudo;
    delete mem.dadosColetados.assessorDiagnostico;
    delete mem.dadosColetados.assessorEscolha;
    delete mem.dadosColetados.assessorEstrategia;
    salvarMemoria(ctx.chatId, ctx.threadId);
    logAtividade('juridico', ctx.chatId, 'assessor_redigiu', proc?.nome||'sem proc');
  } catch(e) {
    await env('❌ Erro na redação: '+e.message, ctx);
  }
}

// ── MÓDULO PERICIAL — Gerador de laudo estruturado + cálculos ──

async function _assessorPerical(ctx, mem, proc, instrucoes, calculosSolicitados) {
  // instrucoes: texto de Kleuber descrevendo o caso pericial
  // calculosSolicitados: array [{tipo, parametros}] — pré-computados via _calc
  const _taskId = 'pericial_'+String(ctx.chatId)+'_'+String(ctx.threadId||'main');
  await _salvarCheckpoint(_taskId, {
    fase: 'pericial',
    procId: proc?.id || null,
    instrucoes: instrucoes || '',
    calculos: calculosSolicitados || []
  });
  const memCaso = proc ? await recuperarMemoriaDoCaso(proc.nome, 30) : [];

  let blocoCalculos = '';
  if(calculosSolicitados && calculosSolicitados.length) {
    blocoCalculos = '\n\n=== CÁLCULOS JÁ REALIZADOS (determinísticos) ===\n';
    for(const c of calculosSolicitados) {
      blocoCalculos += `\n▸ ${c.descricao}:\n`;
      blocoCalculos += `   Entrada: ${JSON.stringify(c.parametros)}\n`;
      blocoCalculos += `   Resultado: ${JSON.stringify(c.resultado)}\n`;
    }
    blocoCalculos += '\nUSE EXATAMENTE ESTES VALORES. Não recalcule. Apenas descreva e contextualize.';
  } else {
    blocoCalculos = '\n\n⚠ AVISO: nenhum cálculo determinístico foi fornecido. Marque [CALCULAR] onde precisar de contas — Kleuber fornecerá via calculadora.';
  }

  const sysBase = _sysAssessorSenior(proc, memCaso, 'redacao', blocoCalculos);
  let sys = sysBase + `

═══ MÓDULO PERICIAL — ESTRUTURA OBRIGATÓRIA ═══

1. INTRODUÇÃO
   - Identificação do processo (nº CNJ, vara, partes)
   - Qualificação do perito (dados de Wanderson Farias de Camargos, OAB/MG 118.237)
   - Objetivo do laudo (citar quesitos do juiz)
   - Fontes consultadas (autos, documentos juntados, legislação)

2. METODOLOGIA
   - Critérios técnicos adotados (NBC TP 01, princípios contábeis)
   - Sistema de juros aplicado (simples ou composto) com FUNDAMENTO LEGAL
   - Índice de correção (SELIC, INPC, IPCA) com base normativa
   - Tabelas e fontes de dados (BACEN, IBGE)

3. ANÁLISE DOS DOCUMENTOS
   - O que foi examinado
   - O que estava ausente ou insuficiente
   - IRREGULARIDADES IDENTIFICADAS — cada uma com FUNDAMENTO LEGAL específico

4. RESPOSTAS AOS QUESITOS
   - Quesito a quesito, numerado
   - Resposta DIRETA seguida de memória de cálculo
   - Se cálculo: usar valores da calculadora (NUNCA invente número)

5. ANEXOS
   - Planilha de cálculo descrita em texto (valores exatos)
   - Referências normativas citadas

6. CONCLUSÃO
   - Síntese objetiva
   - Declaração de imparcialidade
   - Data/local/assinatura

LEMBRE: cálculos vêm da calculadora determinística. Você DESCREVE, não calcula.`;
  sys = _anexarSemDuplicar(sys, [
    'REGRAS PERICIAIS IMPECÁVEIS:',
      '[PATCH_FORMATACAO_PERICIAL] Tabelas em perícias: cabeçalho #1a3a5c com texto branco; linhas alternadas #f5f5f5 e branco; valores negativos em #c0392b; positivos em #27ae60.',
      '[PATCH_FORMATACAO_PERICIAL] Títulos de seção em azul escuro #1a3a5c, mantendo visual profissional e discreto.',
    '(a) Mínimo de 8 folhas obrigatório.',
    '(b) Detalhar exatamente como os cálculos foram feitos (fórmula, base, índice, período, memória).',
    '(c) Apontar erros da metodologia do perito adverso com crítica técnica objetiva.',
    '(d) Explicar nossa metodologia conforme lei vigente e normas técnicas aplicáveis.',
    '(e) Listar irregularidades: juros compostos indevidos, taxas, tarifas e vendas casadas.',
    '(f) Incluir parecer tributário fundamentado na legislação aplicável.',
    '(g) Apontar multas indevidas e o fundamento jurídico da inexigibilidade.',
    '(h) Qualidade técnica apta para controle em STJ/STF.'
  ]);

  await env('🧮 Elaborando laudo pericial... (~60s)', ctx);

  try {
    const msg = [{role:'user', content: 'INSTRUÇÕES DE KLEUBER:\n'+instrucoes+'\n\nElabore o laudo pericial completo conforme estrutura acima.'}];
    const texto = await ia(msg, sys, 4000);
    const nomeArq = 'laudo_pericial_'+(proc?.nome||'novo').replace(/\s+/g,'_').substring(0,20)+
      '_'+new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')+'.txt';
    await envArq(Buffer.from(texto,'utf8'), nomeArq, ctx, 'text/plain');
    await env('✅ Laudo pericial elaborado.\n\n⚠️ [VERIFICAR] → normas/doutrina sem fonte → validar antes\n⚠️ [CALCULAR] → cálculo pendente → me peça o número exato\n⚠️ Revise metodologia e quesitos antes de protocolar.', ctx);
    if(proc) await lembrarDoCaso(proc.nome, 'laudo_pericial', 'Laudo pericial elaborado via Assessor.', ctx.canal);
    logAtividade('juridico', ctx.chatId, 'assessor_pericial', proc?.nome||'sem proc');
    return texto;
  } catch(e) {
    await env('❌ Erro no laudo: '+e.message, ctx);
    return null;
  }
}

// ── RED TEAM — auto-crítica adversarial ──
async function _assessorRedTeam(ctx, pecaTexto, proc) {
  const memCaso = proc ? await recuperarMemoriaDoCaso(proc.nome, 20) : [];
  const memTxt = memCaso.map(f=>`- ${f.texto}`).join('\n')||'(sem memória)';

  const sys = `Você é um ADVOGADO ADVERSÁRIO experiente. Sua missão é atacar a peça abaixo com o maior rigor técnico possível.

PROCESSO: ${proc?.nome||''} - ${proc?.numero||''}
MEMÓRIA DO CASO:
${memTxt}

Aponte, em formato de lista:
1. TESES DO ADVERSÁRIO POSSÍVEIS: 3-5 argumentos fortes contra esta peça
2. FRAGILIDADES JURÍDICAS: pontos onde a fundamentação está fraca
3. RISCOS DE ADMISSIBILIDADE: prazo, cabimento, requisitos
4. SUGESTÕES DE REFORÇO: o que adicionar/mudar pra blindar

Seja objetivo, técnico, direto. Linguagem jurídica formal.`;

  try {
    const msg = [{role:'user', content: 'PEÇA PARA SUBMETER AO RED TEAM:\n\n'+pecaTexto.substring(0, 8000)}];
    const analise = await ia(msg, sys, 2000);
    await env('🎯 RED TEAM — análise adversarial:\n\n'+analise, ctx);
    return analise;
  } catch(e) {
    await env('❌ Erro no red team: '+e.message, ctx);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FIM AGENTE ASSESSOR JURÍDICO
// ════════════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════════════
// AGENTE ATENDENTE JURÍDICO v2 — Consulta conversacional com triagem inteligente,
// LGPD, follow-up, briefing ao advogado e integração de áudio/agenda
// ════════════════════════════════════════════════════════════════════════════
//
// FLUXO COM MARCOS DE APROVAÇÃO (Opção B):
//   Cliente envia foto/texto
//     → Lex extrai (silencioso)
//     → Lex responde CLIENTE com o básico ("recebi seu RG, manda comprovante")
//     → Lex notifica ADMIN em MARCOS: novo contato / pessoais_ok / pronto_peticao
//
// TABELA SUPABASE: clientes_pendentes (criar via SQL no guia)
// ════════════════════════════════════════════════════════════════════════════

function _perfilClienteNovo(chatId, canal, nomeUsuario) {
  return {
    chat_id: String(chatId),
    canal: canal || 'telegram',
    nome: '',
    cpf: '', cpf_valido: false,
    rg: '',
    data_nascimento: '',
    nacionalidade: 'brasileiro(a)',
    estado_civil: '',
    profissao: '',
    endereco_rua: '', endereco_numero: '', endereco_bairro: '',
    endereco_cidade: '', endereco_uf: '', endereco_cep: '', cep_valido: false,
    telefone: '', telefone_valido: false,
    email: '', email_valido: false,
    hipossuficiente: null,
    caso_tipo: '',
    caso_descricao: '',
    documentos_anexos: [],
    probatorios_anexos: [],
    campos_verificar: [],
    lgpd_consentimento: false,
    historico_conversa: [],
    perguntas_sugeridas_secretaria: [],
    alerta_urgencia: null,
    nivel_urgencia: 'normal',
    risco_prescricional: null,
    prazo_limite_caso: '',
    direitos_orientados: [],
    ultimo_contato: new Date().toISOString(),
    data_primeiro_contato: new Date().toISOString(),
    perguntou_fechamento: false,
    data_descarte_previsto: new Date(Date.now() + 30*24*60*60*1000).toISOString(),
    lembrete_24h_enviado: false,
    lembrete_48h_enviado: false,
    admin_notificado_sumico_72h: false,
    agendamento_oferecido: false,
    briefing_enviado: false,
    status: 'iniciando',
    nome_usuario_canal: nomeUsuario || '',
    admin_notificado_novo: false,
    admin_notificado_pessoais_ok: false,
    admin_notificado_pronto: false,
    criado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString()
  };
}

async function _carregarPerfilCliente(chatId, canal, nomeUsuario) {
  try {
    const rows = await sbGet('clientes_pendentes', { chat_id: String(chatId) }, {limit:1});
    if(rows && rows[0]) {
      const p = rows[0];
      if(!p.data_primeiro_contato) p.data_primeiro_contato = p.criado_em || p.ultimo_contato || new Date().toISOString();
      if(typeof p.perguntou_fechamento !== 'boolean') p.perguntou_fechamento = false;
      if(!p.data_descarte_previsto) {
        const base = new Date(p.data_primeiro_contato || Date.now()).getTime();
        p.data_descarte_previsto = new Date(base + 30*24*60*60*1000).toISOString();
      }
      return p;
    }
  } catch(e){ console.warn('[Lex][bot] Erro silenciado:', (e && e.message) ? e.message : e); }
  return _perfilClienteNovo(chatId, canal, nomeUsuario);
}

async function _salvarPerfilCliente(perfil) {
  perfil.atualizado_em = new Date().toISOString();
  try {
    await sbUpsert('clientes_pendentes', perfil, 'chat_id');
    return true;
  } catch(e) { console.warn('salvarPerfilCliente erro:', e.message); return false; }
}

// Extrai dados estruturados de imagem usando Claude Vision
async function _extrairDadosImagem(buffer, mimeType) {
  const base64 = buffer.toString('base64');
  const prompt = `Você é especialista em documentos brasileiros. Analise esta imagem e responda SOMENTE em JSON válido (sem markdown, sem texto extra):

{
  "tipo_documento": "rg|cpf|cnh|rg_cpf_unificado|comprovante_residencia|contrato|certidao_nascimento|certidao_casamento|holerite|ctps|laudo_medico|boletim_ocorrencia|indeferimento_inss|cnis|fgts|trct|outro",
  "confianca": "alta|media|baixa",
  "extraido": {
    "nome": "nome completo se legível",
    "cpf": "só os 11 dígitos",
    "rg": "número do RG",
    "data_nascimento": "dd/mm/aaaa",
    "nacionalidade": "se constar",
    "naturalidade": "cidade de nascimento",
    "filiacao_pai": "nome completo do pai",
    "filiacao_mae": "nome completo da mãe",
    "endereco_rua": "",
    "endereco_numero": "",
    "endereco_bairro": "",
    "endereco_cidade": "",
    "endereco_uf": "",
    "endereco_cep": "8 dígitos",
    "telefone": "",
    "email": "",
    "profissao": "",
    "estado_civil": "",
    "empregador": "se for CTPS/holerite",
    "valor_rescisao": "se for TRCT",
    "data_admissao": "dd/mm/aaaa",
    "data_demissao": "dd/mm/aaaa",
    "outros_dados": "texto livre com o que for relevante"
  },
  "campos_ilegiveis": ["lista"],
  "observacoes": "foto borrada? doc cortado? etc"
}

REGRAS CRÍTICAS:
1. NÃO invente dados. Se não ler, deixe vazio E coloque em campos_ilegiveis
2. confianca="baixa" se foto ruim
3. Campos vazios em branco, sem placeholder`;

  const resposta = await ia([{role:'user', content:[
    { type:'image', source:{ type:'base64', media_type:mimeType||'image/jpeg', data:base64 }},
    { type:'text', text: prompt }
  ]}], null, 2000);

  const m = resposta.replace(/```json|```/g,'').trim().match(/\{[\s\S]*\}/);
  if(!m) throw new Error('IA não retornou JSON válido');
  return JSON.parse(m[0]);
}

// Atualiza perfil do cliente com dados extraídos de imagem (com validações determinísticas)
function _mesclarDadosExtraidos(perfil, extraido, tipo_documento) {
  const ex = extraido || {};
  const verif = perfil.campos_verificar || [];

  if(ex.nome && !perfil.nome) perfil.nome = ex.nome;
  if(ex.data_nascimento && !perfil.data_nascimento) {
    const v = _validarDataBR(ex.data_nascimento);
    if(v.valido) perfil.data_nascimento = v.formatado;
    else verif.push('data_nascimento (extraído: '+ex.data_nascimento+' — '+v.motivo+')');
  }
  if(ex.nacionalidade) perfil.nacionalidade = ex.nacionalidade;
  if(ex.profissao && !perfil.profissao) perfil.profissao = ex.profissao;
  if(ex.estado_civil && !perfil.estado_civil) perfil.estado_civil = ex.estado_civil;

  if(ex.cpf) {
    const v = _validarCPF(ex.cpf);
    if(v.valido) { perfil.cpf = v.formatado; perfil.cpf_valido = true; }
    else { perfil.cpf = String(ex.cpf).replace(/\D/g,''); perfil.cpf_valido = false; verif.push('cpf ('+v.motivo+')'); }
  }
  if(ex.rg && !perfil.rg) perfil.rg = ex.rg;

  if(ex.endereco_rua) perfil.endereco_rua = ex.endereco_rua;
  if(ex.endereco_numero) perfil.endereco_numero = ex.endereco_numero;
  if(ex.endereco_bairro) perfil.endereco_bairro = ex.endereco_bairro;
  if(ex.endereco_cidade) perfil.endereco_cidade = ex.endereco_cidade;
  if(ex.endereco_uf) perfil.endereco_uf = String(ex.endereco_uf).toUpperCase().substring(0,2);
  if(ex.endereco_cep) {
    const v = _validarCEP(ex.endereco_cep);
    if(v.valido) { perfil.endereco_cep = v.formatado; perfil.cep_valido = true; }
    else { perfil.endereco_cep = String(ex.endereco_cep).replace(/\D/g,''); perfil.cep_valido = false; verif.push('cep ('+v.motivo+')'); }
  }

  if(ex.telefone) {
    const v = _validarTelefone(ex.telefone);
    if(v.valido) { perfil.telefone = v.formatado; perfil.telefone_valido = true; }
    else verif.push('telefone ('+v.motivo+')');
  }
  if(ex.email) {
    const v = _validarEmail(ex.email);
    if(v.valido) { perfil.email = v.formatado; perfil.email_valido = true; }
    else verif.push('email ('+v.motivo+')');
  }

  if(tipo_documento && tipo_documento !== 'outro') {
    if(!perfil.documentos_anexos) perfil.documentos_anexos = [];
    perfil.documentos_anexos.push({ tipo: tipo_documento, recebido_em: new Date().toISOString() });
  }

  perfil.campos_verificar = [...new Set(verif)].slice(0,20);
  return perfil;
}

// Checa quais campos pessoais ainda faltam
function _faltantesPessoais(perfil) {
  const f = [];
  if(!perfil.nome) f.push('nome completo');
  if(!perfil.cpf_valido) f.push('CPF válido');
  if(!perfil.rg) f.push('RG');
  if(!perfil.data_nascimento) f.push('data de nascimento');
  if(!perfil.estado_civil) f.push('estado civil');
  if(!perfil.profissao) f.push('profissão');
  if(!perfil.endereco_rua || !perfil.endereco_numero) f.push('endereço (rua e número)');
  if(!perfil.endereco_cidade || !perfil.endereco_uf) f.push('cidade e estado');
  if(!perfil.cep_valido) f.push('CEP válido');
  if(!perfil.telefone_valido) f.push('telefone com DDD');
  return f;
}

// Checa quais probatórios faltam (por tipo de caso)
function _faltantesProbatorios(perfil) {
  if(!perfil.caso_tipo || !EXIGENCIAS_POR_CASO[perfil.caso_tipo]) return [];
  const exig = EXIGENCIAS_POR_CASO[perfil.caso_tipo].probatorios;
  const tiposRecebidos = new Set((perfil.documentos_anexos||[]).map(d => d.tipo));
  const probRecebidos = new Set((perfil.probatorios_anexos||[]).map(p => p.id));
  return exig.filter(p => !tiposRecebidos.has(p.id) && !probRecebidos.has(p.id));
}

// Atualiza status baseado no que tem
function _atualizarStatusPerfil(perfil) {
  const faltam_pessoais = _faltantesPessoais(perfil);
  const faltam_prob = _faltantesProbatorios(perfil);

  if(faltam_pessoais.length > 0) {
    perfil.status = 'coletando_pessoais';
  } else if(!perfil.caso_tipo) {
    perfil.status = 'aguardando_caso_tipo';
  } else if(faltam_prob.length > 0) {
    perfil.status = 'coletando_probatorios';
  } else {
    perfil.status = 'pronto_peticao';
  }
  return perfil;
}

// Notifica admin nos 3 marcos (uma vez cada)
async function _notificarAdminMarcos(perfil) {
  const nome = perfil.nome || perfil.nome_usuario_canal || perfil.chat_id;
  // Marco 1: novo contato
  if(!perfil.admin_notificado_novo && perfil.status !== 'iniciando') {
    const tipo = perfil.caso_tipo ? EXIGENCIAS_POR_CASO[perfil.caso_tipo]?.nome : 'não identificado';
    await envTelegram(
      `📥 NOVO CLIENTE via ${perfil.canal}\n\n`+
      `Nome: ${nome}\n`+
      `Chat ID: ${perfil.chat_id}\n`+
      `Caso: ${tipo}\n`+
      (perfil.caso_descricao ? `\nDescrição: ${perfil.caso_descricao.substring(0,300)}\n` : '')+
      `\nUse /cliente ${perfil.chat_id} pra ver detalhes.`,
      null, CHAT_ID
    ).catch(()=>{});
    perfil.admin_notificado_novo = true;
  }
  // Marco 2: pessoais completos
  if(!perfil.admin_notificado_pessoais_ok && _faltantesPessoais(perfil).length === 0 && perfil.status !== 'iniciando') {
    await envTelegram(
      `✅ CLIENTE COM PESSOAIS OK\n\n${nome}\nChat: ${perfil.chat_id}\nCaso: ${perfil.caso_tipo||'?'}\n\n`+
      `Agora o Lex vai cobrar os probatórios.\n`+
      `Use /cliente ${perfil.chat_id} pra detalhes.`,
      null, CHAT_ID
    ).catch(()=>{});
    perfil.admin_notificado_pessoais_ok = true;
  }
  // Marco 3: pronto pra petição
  if(!perfil.admin_notificado_pronto && perfil.status === 'pronto_peticao') {
    await envTelegram(
      `🎯 CLIENTE PRONTO PRA PETIÇÃO\n\n${nome}\nCaso: ${perfil.caso_tipo}\n\n`+
      `Dados pessoais e probatórios completos.\n`+
      `Use /converter ${perfil.chat_id} pra gerar processo no Lex + petição inicial.`,
      null, CHAT_ID
    ).catch(()=>{});
    perfil.admin_notificado_pronto = true;
  }
}

// Monta mensagem de cobrança pro cliente — natural, cordial, clara
function _montarCobrancaCliente(perfil) {
  const faltam_pess = _faltantesPessoais(perfil);
  const faltam_prob = _faltantesProbatorios(perfil);
  let msg = '';

  // Resumo do que já temos
  const temNome = perfil.nome ? `✓ Nome: ${perfil.nome}\n` : '';
  const temCPF = perfil.cpf_valido ? `✓ CPF: ${perfil.cpf}\n` : '';
  const temEnd = perfil.endereco_cidade ? `✓ Endereço: ${perfil.endereco_cidade}/${perfil.endereco_uf||''}\n` : '';
  const temTel = perfil.telefone_valido ? `✓ Telefone: ${perfil.telefone}\n` : '';
  const temCaso = perfil.caso_tipo ? `✓ Caso: ${EXIGENCIAS_POR_CASO[perfil.caso_tipo]?.nome}\n` : '';
  const jaTenho = (temNome+temCPF+temEnd+temTel+temCaso).trim();

  if(jaTenho) msg += '📋 Já tenho:\n'+jaTenho+'\n\n';

  if(faltam_pess.length > 0) {
    msg += '❌ Ainda preciso de:\n';
    faltam_pess.slice(0,5).forEach(f => msg += '• '+f+'\n');
    msg += '\nSolicite ao cliente os documentos (RG, CPF, comprovante de residencia) e me envie foto/PDF.';
    return msg;
  }

  if(!perfil.caso_tipo) {
    msg += '❓ Para continuar, confirme a area do caso do cliente:\n'+
      '• *trabalhista* (demissão, direitos trabalhistas, CTPS)\n'+
      '• *cível* (cobrança, contrato, indenização)\n'+
      '• *previdenciário* (INSS, aposentadoria, auxílio)';
    return msg;
  }

  if(faltam_prob.length > 0) {
    msg += '📎 Agora os documentos do seu caso ('+EXIGENCIAS_POR_CASO[perfil.caso_tipo].nome+'):\n\n';
    faltam_prob.slice(0,6).forEach(p => {
      msg += '• '+p.nome+'\n';
      if(p.detalhes) msg += '   ↳ '+p.detalhes+'\n';
    });
    msg += '\nSolicite ao cliente e me encaminhe os arquivos conforme forem chegando.';
    return msg;
  }

  msg += '🎯 Tudo completo! Seu processo está pronto pra ser formalizado.\n\n'+
    'Vou sinalizar ao advogado que ja pode elaborar a peticao inicial.';
  return msg;
}

function _areaNome(tipo) {
  return EXIGENCIAS_POR_CASO[tipo]?.nome || 'Não identificada';
}

function _agoraIso() { return new Date().toISOString(); }
function _agoraBrasilia() { return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); }
function _horaBrasilia() { return new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }); }

function _normCasoTxt(t) { return _normTexto(String(t||'')).replace(/\s+/g, ' ').trim(); }

const _MSG_ESCALONAR_DIRETO_DR = 'Essa questão precisa do Kleuber diretamente, tá? Vou pedir pra ele te retornar o mais rápido possível. Qual o melhor horário pra te ligar?';
const _MSG_LIMITE_PERGUNTAS = 'Agradeco seu contato. Nesta sessao atingimos o limite de 6 perguntas. O escritorio atende em horario comercial e retornaremos no proximo periodo util.';
const _REGEX_SENSIVEIS_SECRETARIO = [
  /r\$\s*\d+/i,
  /\breais?\b/i,
  /\bmil\b/i,
  /sentenc[aã]\s+condenou/i,
  /recurso\s+negado/i,
  /\bagravo\b/i,
  /honor[aá]ri[oa]s?/i,
  /dep[oó]sito/i,
  /\bpenhora\b/i
];
const _ASSUNTOS_PROIBIDOS_SECRETARIO = [
  /\bvalor(es)?\b/i,
  /honor[aá]ri[oa]s?/i,
  /\bsenten[cç]a\b/i,
  /resultado\s+do?\s+julgamento/i,
  /recurso/i,
  /\bagravo\b/i,
  /conte[uú]do\s+da?\s+peti[cç][aã]o/i,
  /pagamento/i,
  /dep[oó]sito\s+judicial/i,
  /acordo.*valor/i,
  /senten[cç]a\s+de?\s+segundo\s+grau/i,
  /\bpenhora\b/i,
  /execu[cç][aã]o.*valor/i,
  /estrat[eé]gia\s+processual/i
];

function _extrairDadosIdentidadeTexto(texto, base) {
  const out = {...(base||{})};
  const txt = String(texto||'').trim();
  if(!out.nome_completo) {
    const mNome = txt.match(/(?:nome(?:\s+completo)?\s*[:\-]\s*)([A-Za-zÀ-ÿ' ]{6,80})/i);
    if(mNome && mNome[1]) out.nome_completo = String(mNome[1]).trim();
  }
  if(!out.cpf) {
    const mCpf = txt.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
    if(mCpf && mCpf[0]) {
      const v = _validarCPF(mCpf[0]);
      if(v.valido) out.cpf = String(v.formatado||'').replace(/\D/g,'');
    }
  }
  if(!out.data_nascimento) {
    const mData = txt.match(/\b\d{2}\/\d{2}\/\d{4}\b/);
    if(mData && mData[0]) {
      const vData = _validarDataBR(mData[0]);
      if(vData.valido) out.data_nascimento = vData.formatado;
    }
  }
  return out;
}

function _detectarAssuntoProibidoWhats(texto) {
  const t = String(texto||'');
  return _ASSUNTOS_PROIBIDOS_SECRETARIO.some(rx => rx.test(t));
}

function _resumoUltimasMensagensSessao(sessao, limite) {
  const hist = Array.isArray(sessao?.historico) ? sessao.historico.slice(-(limite||5)) : [];
  return hist.map(m => '['+(m.role||'user')+'] '+String(m.text||'').substring(0,220)).join('\n');
}

function _filtrarRespostaSensivel(resposta) {
  const txt = String(resposta||'');
  const hits = _REGEX_SENSIVEIS_SECRETARIO.filter(rx => rx.test(txt));
  if(hits.length) {
    const msg = _MSG_ESCALONAR_DIRETO_DR;
    console.warn('[seguranca-whatsapp] conteudo sensivel bloqueado');
    logAtividade('juridico', 'whatsapp', 'seguranca_bloqueio', 'filtro_sensivel').catch(()=>{});
    return { bloqueada: true, resposta: msg, motivos: hits.map(r=>String(r)) };
  }
  return { bloqueada: false, resposta: txt, motivos: [] };
}

function _obterProcessoDoCliente(perfil) {
  if(!perfil) return null;
  const chat = String(perfil.chat_id||'');
  const nome = String(perfil.nome||'').toLowerCase();
  const hitChat = processos.find(p => String(p.cliente_origem_chat||'') === chat);
  if(hitChat) return hitChat;
  if(nome) return processos.find(p => String(p.nome||'').toLowerCase().includes(nome)) || null;
  return null;
}

function _perfilBateIdentidade(perfil, dados) {
  const cpfPerfil = String(perfil?.cpf||'').replace(/\D/g,'');
  const cpfInf = String(dados?.cpf||'').replace(/\D/g,'');
  if(!cpfPerfil || !cpfInf || cpfPerfil !== cpfInf) return false;
  const nascPerfil = String(perfil?.data_nascimento||'').trim();
  const nascInf = String(dados?.data_nascimento||'').trim();
  if(!nascPerfil || !nascInf || nascPerfil !== nascInf) return false;
  const nomePerfil = _normCasoTxt(perfil?.nome||'');
  const nomeInf = _normCasoTxt(dados?.nome_completo||'');
  if(!nomePerfil || !nomeInf) return false;
  return nomePerfil.includes(nomeInf) || nomeInf.includes(nomePerfil);
}

async function _carregarSessaoSecretarioWhatsApp(numero, clienteId) {
  const numeroPlano = _numeroPlanoWhats(numero);
  const agora = Date.now();
  let sessao = null;
  try {
    const rows = await sbGet('whatsapp_sessoes', { numero: numeroPlano }, { limit: 1, order: 'ultima_msg.desc' });
    if(rows && rows[0]) sessao = rows[0];
  } catch(e) { console.warn('[whatsapp_sessoes] leitura falhou:', e.message); }

  const ultima = sessao?.ultima_msg ? new Date(sessao.ultima_msg).getTime() : 0;
  const expirada = !ultima || (agora - ultima) > (24*60*60*1000);
  if(!sessao || expirada) {
    sessao = {
      numero: numeroPlano,
      cliente_id: clienteId || null,
      perguntas_feitas: 0,
      inicio: _agoraIso(),
      ultima_msg: _agoraIso(),
      escalonado: false,
      identidade_confirmada: false,
      dados_informados: {},
      historico: []
    };
  }
  const mem = _estadoSecretarioWhatsApp.sessoes_memoria.get(numeroPlano);
  if(mem && Array.isArray(mem.historico)) sessao.historico = mem.historico;
  if(!Array.isArray(sessao.historico)) sessao.historico = [];
  return sessao;
}

async function _salvarSessaoSecretarioWhatsApp(sessao) {
  const payload = {
    numero: _numeroPlanoWhats(sessao.numero),
    cliente_id: sessao.cliente_id || null,
    perguntas_feitas: Number(sessao.perguntas_feitas||0),
    inicio: sessao.inicio || _agoraIso(),
    ultima_msg: _agoraIso(),
    escalonado: !!sessao.escalonado
  };
  _estadoSecretarioWhatsApp.sessoes_memoria.set(payload.numero, {
    historico: Array.isArray(sessao.historico) ? sessao.historico.slice(-20) : []
  });
  try { await sbUpsert('whatsapp_sessoes', payload, 'numero'); }
  catch(e) { console.warn('[whatsapp_sessoes] persistencia falhou:', e.message); }
  return payload;
}

async function _verificarIdentidadeCliente(numero, dados_informados) {
  const dados = dados_informados || {};
  if(!dados.nome_completo || !dados.cpf || !dados.data_nascimento) {
    return {
      confirmado: false,
      mensagem: 'Antes de qualquer informacao do processo, preciso confirmar sua identidade. Informe nome completo, CPF e data de nascimento (dd/mm/aaaa).'
    };
  }
  try {
    const perfis = await sbGet('clientes_pendentes', {}, { limit: 1000, order: 'atualizado_em.desc' });
    const perfil = (perfis||[]).find(p => _perfilBateIdentidade(p, dados));
    if(!perfil) {
      await envTelegram(
        'TRANSFERIR SECRETARIA (identidade nao confirmada)\nNumero: '+_numeroPlanoWhats(numero)+
        '\nNome informado: '+String(dados.nome_completo||'')+'\nCPF informado: '+String(dados.cpf||''),
        null,
        CHAT_ID
      ).catch(()=>{});
      return {
        confirmado: false,
        transferir_secretaria: true,
        mensagem: 'Nao localizei seu cadastro com esses dados. Vou transferir para a secretaria para validacao manual.'
      };
    }
    const processo = _obterProcessoDoCliente(perfil);
    return { confirmado: true, cliente: perfil, processo };
  } catch(e) {
    return {
      confirmado: false,
      transferir_secretaria: true,
      mensagem: 'Tive uma instabilidade na validacao de identidade. Vou encaminhar para a secretaria continuar seu atendimento.'
    };
  }
}

async function _chamarAnthropicSecretario(messages, system, modelo) {
  if(!AK) throw new Error('ANTHROPIC_KEY não configurada.');
  const pay = {
    model: modelo || SECRETARIO_WHATSAPP_CONFIG.modelo_ia,
    max_tokens: 900,
    messages
  };
  if(system) pay.system = system;
  const r = await httpsPost('api.anthropic.com', '/v1/messages', pay, {
    'x-api-key': AK,
    'anthropic-version': '2023-06-01'
  });
  if(r?.error) throw new Error(r.error.message || 'Erro Anthropic secretario');
  return r?.content?.[0]?.text || '';
}

async function _escalarParaAdvogado(processo, cliente, motivo, conversa) {
  const item = {
    id: (CRYPTO.randomUUID ? CRYPTO.randomUUID() : String(Date.now())),
    criado_em: _agoraIso(),
    motivo: String(motivo||'escalonamento'),
    processo: processo || null,
    cliente: cliente || null,
    conversa: Array.isArray(conversa) ? conversa.slice(-5) : [],
    resolvido: false
  };
  _estadoSecretarioWhatsApp.escalonamentos_memoria.push(item);
  if(_estadoSecretarioWhatsApp.escalonamentos_memoria.length > 300) {
    _estadoSecretarioWhatsApp.escalonamentos_memoria = _estadoSecretarioWhatsApp.escalonamentos_memoria.slice(-300);
  }
  const resumo = [
    'ESCALONAMENTO WHATSAPP PARA ADVOGADO',
    'Advogado: '+SECRETARIO_WHATSAPP_CONFIG.numero_advogado,
    'Cliente: '+String(cliente?.nome || 'nao identificado'),
    'CPF: '+String(cliente?.cpf || 'nao informado'),
    'WhatsApp: '+String(cliente?.whatsapp_jid || cliente?.telefone || 'nao informado'),
    'Processo: '+String(processo?.numero || 'nao informado'),
    'Area: '+String(processo?.area || cliente?.caso_tipo || 'nao informada'),
    'Fase atual: '+String(processo?.status || 'nao informada'),
    'MOTIVO: '+String(motivo||''),
    'Ultimas mensagens:',
    item.conversa.map(x => '- '+x).join('\n'),
    'Dados do processo:',
    JSON.stringify({
      numero: processo?.numero || null,
      nome: processo?.nome || null,
      status: processo?.status || null,
      prazo: processo?.prazo || null,
      proxacao: processo?.proxacao || null
    })
  ].join('\n');
  await _notificarEquipe(resumo).catch(()=>{});
  logAtividade('juridico', cliente?.chat_id || 'whatsapp', 'escalonamento_advogado', motivo || 'n/a').catch(()=>{});

  // ── FOLLOW-UP AUTOMÁTICO: se Kleuber não responder em 5min, avisa o cliente e cobra o Kleuber ──
  const clienteNum = cliente?.whatsapp_jid || cliente?.telefone || '';
  const clienteNome = cliente?.nome || 'cliente';
  if(clienteNum) {
    // Timer 5 minutos: avisa o cliente que está tentando falar com Kleuber
    setTimeout(async () => {
      // Verifica se já foi resolvido
      const esc = _estadoSecretarioWhatsApp.escalonamentos_memoria.find(e => e.id === item.id);
      if(esc && esc.resolvido) return; // Kleuber já respondeu, ignora
      
      // Avisa o cliente com tom humano
      const msgCliente = 'Oi' + (clienteNome !== 'cliente' ? ', ' + clienteNome.split(' ')[0] : '') + '! Estou tentando falar com o Kleuber sobre o seu caso, mas ele deve estar em atendimento agora. Assim que eu conseguir falar com ele ou com a secretária, te dou um retorno, tá? Não vou te deixar sem resposta!';
      try {
        await envWhatsApp(msgCliente, clienteNum);
        _registrarMsgCentral('whatsapp', 'saida', clienteNum, 'Lex (auto)', msgCliente);
      } catch(e) { console.warn('[Lex] Erro follow-up cliente:', e.message); }
      
      // Cobra a equipe no Telegram (Kleuber + Secretária)
      const cobranca = '⚠️ *RETORNO PENDENTE*\n\n'
        + '👤 Cliente: ' + clienteNome + '\n'
        + '📱 WhatsApp: ' + clienteNum + '\n'
        + (processo ? '📁 Processo: ' + (processo.nome||processo.numero||'—') + '\n' : '')
        + '⏰ Escalonado há 5 minutos\n'
        + '💬 Motivo: ' + String(motivo||'escalonamento') + '\n\n'
        + '❗ O cliente está esperando retorno. Já avisei que estamos tentando falar com vocês.\n'
        + 'Respondam pelo painel (Central de Mensagens) ou diretamente no WhatsApp.';
      try { await _notificarEquipe(cobranca); } catch(e) { console.warn('[Lex] Erro cobrança equipe:', e.message); }
    }, 5 * 60 * 1000); // 5 minutos

    // Timer 15 minutos: segunda cobrança se ainda não resolveu
    setTimeout(async () => {
      const esc = _estadoSecretarioWhatsApp.escalonamentos_memoria.find(e => e.id === item.id);
      if(esc && esc.resolvido) return;
      
      const cobranca2 = '🚨 *RETORNO URGENTE — 15 MINUTOS SEM RESPOSTA*\n\n'
        + '👤 ' + clienteNome + ' (' + clienteNum + ')\n'
        + '⏰ Esperando há 15 minutos\n\n'
        + '❗ O cliente pode estar ficando impaciente. Deem um retorno o mais rápido possível.';
      try { await _notificarEquipe(cobranca2); } catch(e) {}
    }, 15 * 60 * 1000); // 15 minutos

    // Timer 30 minutos: avisa o cliente que terá retorno em breve e última cobrança
    setTimeout(async () => {
      const esc = _estadoSecretarioWhatsApp.escalonamentos_memoria.find(e => e.id === item.id);
      if(esc && esc.resolvido) return;
      
      const msgCliente2 = (clienteNome !== 'cliente' ? clienteNome.split(' ')[0] + ', ' : '') + 'desculpa a demora! O Kleuber ainda está resolvendo algumas questões, mas seu caso não foi esquecido. Vou te dar um retorno assim que possível, tá bom?';
      try {
        await envWhatsApp(msgCliente2, clienteNum);
        _registrarMsgCentral('whatsapp', 'saida', clienteNum, 'Lex (auto)', msgCliente2);
      } catch(e) {}
      
      const cobranca3 = '🔴 *CLIENTE ESPERANDO HÁ 30 MINUTOS*\n\n👤 ' + clienteNome + ' (' + clienteNum + ')\n\nJá enviei segunda mensagem pro cliente dizendo que não foi esquecido. Por favor, deem retorno.';
      try { await _notificarEquipe(cobranca3); } catch(e) {}
    }, 30 * 60 * 1000); // 30 minutos
  }

  return item;
}

function _extrairHorarioAdvogado(texto) {
  const t = String(texto||'');
  const mHora = t.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/);
  const mData = t.match(/\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/);
  if(!mHora && !mData) return null;
  return {
    horario: mHora ? (mHora[1].padStart(2,'0')+':'+mHora[2]) : null,
    data: mData ? mData[1] : null,
    texto_original: t.substring(0,280)
  };
}

async function _registrarRespostaAdvogadoWhats(mensagem, operadorNome) {
  const quemRespondeu = operadorNome || 'kleuber';
  const info = _extrairHorarioAdvogado(mensagem) || { horario: null, data: null, texto_original: String(mensagem||'') };
  _estadoSecretarioWhatsApp.ultima_resposta_advogado = {
    em: _agoraIso(),
    ...info
  };
  const pendentes = _estadoSecretarioWhatsApp.escalonamentos_memoria.filter(x => !x.resolvido);
  for(const item of pendentes) {
    const jid = item?.cliente?.whatsapp_jid || null;
    if(jid) {
      // ── MEDIAÇÃO INTELIGENTE: Lex aperfeiçoa a resposta do Kleuber ──
      const clienteNome = item.cliente?.nome || 'cliente';
      const processo = item.processo || null;
      const historicoConversa = (item.conversa || []).slice(-5).join('\n');
      
      try {
        const resMediacao = await _mediarRespostaKleuber(mensagem, clienteNome, processo, historicoConversa, jid);
        
        // Envia resposta aperfeiçoada pro cliente
        if(resMediacao.msgCliente) {
          await envWhatsApp(resMediacao.msgCliente, jid).catch(()=>{});
          _registrarMsgCentral('whatsapp', 'saida', jid, 'Lex (mediação Kleuber)', resMediacao.msgCliente);
        }
        
        // Envia resumo pro Kleuber: dúvidas do cliente + sugestões + possíveis orientações
        if(resMediacao.resumoKleuber) {
          await envTelegram(resMediacao.resumoKleuber, null, CHAT_ID).catch(()=>{});
        }
        
        // Salva orientações possíveis pro handler de "autorizo"
        if(resMediacao.orientacoesPossiveis) {
          item.orientacoes_pendentes = resMediacao.orientacoesPossiveis;
        }
      } catch(e) {
        // Fallback: envia resposta do Kleuber como está (nunca deixa o cliente sem resposta)
        console.warn('[Lex] Mediação falhou, usando fallback:', e.message);
        const msgFallback = info.horario || info.data
          ? (clienteNome.split(' ')[0]+', o Kleuber retornou! '+(info.data ? 'Atendimento previsto pra '+info.data+' ' : '')+(info.horario ? 'às '+info.horario : '')+'. Te avisamos com antecedência, tá?')
          : (clienteNome.split(' ')[0]+', falei com o Kleuber e ele já tá cuidando do seu caso! Qualquer novidade te aviso.');
        await envWhatsApp(msgFallback, jid).catch(()=>{});
        _registrarMsgCentral('whatsapp', 'saida', jid, 'Lex (fallback)', msgFallback);
      }
      
      try { await sbReq('PATCH', 'whatsapp_sessoes', { escalonado: false }, { numero: 'eq.'+_numeroPlanoWhats(jid) }, null); } catch(e) { console.warn('[Lex][bot] Erro silenciado:', (e && e.message) ? e.message : e); }
    }
    item.resolvido = true;
    item.resolvido_em = _agoraIso();
  }
  return { notificados: pendentes.length };
}

// ── MEDIAÇÃO INTELIGENTE: Lex pega resposta do Kleuber, aperfeiçoa, analisa dúvidas e sugere ──
async function _mediarRespostaKleuber(respostaKleuber, clienteNome, processo, historicoConversa, jidCliente) {
  const contextoProc = processo ? JSON.stringify({
    numero: processo.numero || null,
    nome: processo.nome || null,
    area: processo.area || null,
    status: processo.status || null,
    prazo: processo.prazo || null,
    proxacao: processo.proxacao || null,
    reu: processo.reu || null,
    valor: processo.valor || null
  }) : '{}';
  
  // Busca sessão do cliente pra ter histórico completo
  let historicoSessao = '';
  try {
    const sessao = await _carregarSessaoSecretarioWhatsApp(jidCliente, null);
    if(sessao && sessao.historico && sessao.historico.length > 0) {
      historicoSessao = sessao.historico.slice(-10).map(h => (h.role==='user' ? 'CLIENTE' : 'LEX') + ': ' + h.text).join('\n');
    }
  } catch(e) {}
  
  const system = [
    'Você é o LEX, mediador inteligente entre Kleuber (CEO/analista jurídico) e o cliente do escritório Camargos Advocacia.',
    'Kleuber mandou uma resposta pra repassar ao cliente. Seu trabalho:',
    '',
    '1. APERFEIÇOAR A RESPOSTA: Pegue a essência do que Kleuber escreveu e transforme em uma mensagem profissional, empática, humana, no tom WhatsApp (curta, sem lista, sem robô). Mantenha TODAS as informações que Kleuber passou — não corte nada, só melhore a forma.',
    '2. ANALISAR DÚVIDAS: Baseado no histórico da conversa e no processo, identifique dúvidas que o cliente provavelmente ainda tem ou vai ter.',
    '3. SUGERIR PRO KLEUBER: Se você perceber algo no processo que o Kleuber pode querer informar ao cliente (prazo, próximo passo, documento pendente), sugira.',
    '4. ANALISAR INSISTÊNCIA: Se o cliente parece ansioso/insistente, avise o Kleuber do nível de urgência emocional.',
    '5. ORIENTAÇÕES QUE VOCÊ PODE DAR: Se houver alguma orientação geral (prazo, documento necessário, próximo passo) que você pode dar sem precisar de autorização jurídica, sugira pro Kleuber e peça OK.',
    '',
    'Responda em JSON com exatamente estas chaves:',
    '{"msgCliente": "mensagem aperfeiçoada pro cliente (tom WhatsApp humano, curta)", "resumoKleuber": "texto pro Kleuber no Telegram com: dúvidas do cliente, sugestões, nível de insistência, e se tem algo que Lex pode responder com autorização", "orientacoesPossiveis": "lista curta do que Lex pode orientar se Kleuber autorizar (ou null se nada)"}'
  ].join('\n');
  
  const user = [
    'RESPOSTA DO KLEUBER (pra aperfeiçoar e enviar ao cliente):',
    String(respostaKleuber||''),
    '',
    'CLIENTE: ' + clienteNome,
    'PROCESSO: ' + contextoProc,
    '',
    'HISTÓRICO DA CONVERSA:',
    historicoSessao || historicoConversa || '(sem histórico)',
    '',
    'Gere o JSON de mediação.'
  ].join('\n');
  
  const respIA = await _chamarAnthropicSecretario([{role:'user', content:user}], system, 'claude-opus-4-20250514');
  
  // Parse JSON da resposta
  let parsed = {};
  try {
    const jsonMatch = respIA.match(/\{[\s\S]*\}/);
    if(jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch(e) {
    // Se não conseguiu parsear, usa resposta como texto direto
    parsed = { msgCliente: String(respIA||'').substring(0, 500), resumoKleuber: null };
  }
  
  // Monta resumo pro Kleuber no Telegram
  let resumoTG = '✅ *RESPOSTA ENVIADA AO CLIENTE*\n\n';
  resumoTG += '👤 Cliente: ' + clienteNome + '\n';
  if(processo?.numero) resumoTG += '📁 Processo: ' + processo.numero + '\n';
  resumoTG += '\n📤 *O que você mandou:*\n' + String(respostaKleuber||'').substring(0, 200) + '\n';
  resumoTG += '\n📨 *O que o Lex enviou (aperfeiçoado):*\n' + String(parsed.msgCliente||'').substring(0, 300) + '\n';
  
  if(parsed.resumoKleuber) {
    resumoTG += '\n📋 *Análise do Lex:*\n' + String(parsed.resumoKleuber||'');
  }
  if(parsed.orientacoesPossiveis && parsed.orientacoesPossiveis !== 'null') {
    resumoTG += '\n\n💡 *Posso orientar o cliente sobre:*\n' + String(parsed.orientacoesPossiveis) + '\n\n↪ _Responda "autorizo" se quiser que eu passe essas orientações pro cliente._';
  }
  
  return {
    msgCliente: parsed.msgCliente || null,
    resumoKleuber: resumoTG,
    orientacoesPossiveis: (parsed.orientacoesPossiveis && parsed.orientacoesPossiveis !== 'null') ? parsed.orientacoesPossiveis : null
  };
}

// ── HANDLER: Kleuber autoriza orientações sugeridas pelo Lex ──
async function _processarAutorizacaoLex(textoKleuber) {
  const txt = _normTexto(String(textoKleuber||''));
  if(!/\b(autorizo|pode|manda|envia|ok|sim|vai)\b/i.test(txt)) return false;
  
  // Verifica se tem escalonamento pendente com orientações sugeridas
  const pendentes = _estadoSecretarioWhatsApp.escalonamentos_memoria.filter(x => x.resolvido && x.orientacoes_pendentes);
  if(pendentes.length === 0) return false;
  
  for(const item of pendentes) {
    const jid = item?.cliente?.whatsapp_jid || null;
    if(jid && item.orientacoes_pendentes) {
      const clienteNome = item.cliente?.nome || 'cliente';
      // Gera resposta humanizada com as orientações
      try {
        const system = 'Você é o Lex, atendente do escritório Camargos Advocacia no WhatsApp. O Kleuber autorizou você a passar orientações pro cliente. Transforme as orientações em uma mensagem curta, humana, no tom WhatsApp. Chame o cliente pelo nome. Não use listas.';
        const user = 'CLIENTE: '+clienteNome+'\nORIENTAÇÕES AUTORIZADAS: '+String(item.orientacoes_pendentes)+'\n\nMande a mensagem pro cliente.';
        const msgOri = await _chamarAnthropicSecretario([{role:'user', content:user}], system, 'claude-opus-4-20250514');
        await envWhatsApp(msgOri, jid).catch(()=>{});
        _registrarMsgCentral('whatsapp', 'saida', jid, 'Lex (orientação autorizada)', msgOri);
        await envTelegram('✅ Orientações enviadas pro ' + clienteNome.split(' ')[0] + '!', null, CHAT_ID).catch(()=>{});
      } catch(e) {
        await envTelegram('⚠️ Erro ao enviar orientações: ' + e.message, null, CHAT_ID).catch(()=>{});
      }
      item.orientacoes_pendentes = null;
    }
  }
  return true;
}

async function _conversarWhatsAppCliente(numero, mensagem, sessao) {
  const cfg = _configRuntime.secretario_whatsapp || SECRETARIO_WHATSAPP_CONFIG;
  if(!cfg.ativo) {
    return { ok:false, resposta:'Atendimento do WhatsApp ainda nao esta ativo.' };
  }

  sessao.dados_informados = _extrairDadosIdentidadeTexto(mensagem, sessao.dados_informados || {});
  const idv = await _verificarIdentidadeCliente(numero, sessao.dados_informados);
  if(!idv.confirmado) {
    sessao.escalonado = !!idv.transferir_secretaria;
    if(sessao.escalonado) {
      await _escalarParaAdvogado(null, { whatsapp_jid: _normalizarNumeroWhats(numero) }, 'identidade_nao_confirmada', [mensagem]);
    }
    await _salvarSessaoSecretarioWhatsApp(sessao);
    return { ok:true, escalonado: !!idv.transferir_secretaria, resposta: idv.mensagem };
  }

  sessao.identidade_confirmada = true;
  sessao.cliente_id = idv.cliente?.chat_id || sessao.cliente_id || null;
  sessao.processo = idv.processo || null;
  sessao.cliente = idv.cliente || null;

  // ── AUTO-ADICIONAR NA AGENDA quando cliente se identifica no WhatsApp ──
  try {
    const telCliente = _normalizarNumeroWhats(numero);
    if(telCliente && dados_informados?.nome_completo) {
      await sbReq('POST', 'contatos', {
        nome: dados_informados.nome_completo,
        telefone: telCliente,
        cpf: dados_informados.cpf || '',
        processo_id: sessao.processo?.id || null,
        processo_nome: sessao.processo?.nome || '',
        obs: 'Auto-cadastrado via WhatsApp em ' + _agoraBrasilia(),
        criado_em: _agoraIso()
      }, {}, { onConflict: 'telefone', merge: 'nome,cpf,processo_id,processo_nome' }).catch(()=>{});
    }
  } catch(e) {}

  // ── SE NÃO TEM PROCESSO CADASTRADO: levanta dados e cobra Kleuber ──
  if(!sessao.processo && !sessao._cobrou_cadastro) {
    sessao._cobrou_cadastro = true;
    const nomeCliente = sessao.cliente?.nome || dados_informados?.nome_completo || 'cliente';
    const cpfCliente = sessao.cliente?.cpf || dados_informados?.cpf || 'não informado';
    const telCliente = _normalizarNumeroWhats(numero);
    // Avisa equipe (Kleuber + Secretária) no Telegram para cadastrar
    const alertaCadastro = '📋 *CADASTRO PENDENTE*\n\n'
      + '👤 Cliente: ' + nomeCliente + '\n'
      + '📄 CPF: ' + cpfCliente + '\n'
      + '📱 WhatsApp: ' + telCliente + '\n'
      + '⏰ Entrou em contato agora\n\n'
      + '⚠️ Esse cliente NÃO tem processo cadastrado no sistema.\n'
      + 'Levante os dados e cadastre via /novocaso ou pelo painel.';
    _notificarEquipe(alertaCadastro).catch(()=>{});
    await _salvarSessaoSecretarioWhatsApp(sessao);
    // Continua atendendo normalmente — o prompt da IA sabe que não tem processo
  }

  if(sessao.escalonado && !_estadoSecretarioWhatsApp.ultima_resposta_advogado) {
    return {
      ok: true,
      escalonado: true,
      resposta: 'Já passei seu caso pro Kleuber, tá? Assim que eu conseguir falar com ele, te dou um retorno!'
    };
  }

  if(Number(sessao.perguntas_feitas||0) >= Number(cfg.max_perguntas_cliente||6)) {
    await _salvarSessaoSecretarioWhatsApp(sessao);
    return { ok:true, limite:true, resposta:_MSG_LIMITE_PERGUNTAS };
  }

  const antes = _filtrarRespostaSensivel(mensagem);
  if(antes.bloqueada || _detectarAssuntoProibidoWhats(mensagem)) {
    sessao.escalonado = true;
    sessao.historico.push({ role:'user', text:String(mensagem||''), em:_agoraIso() });
    await _escalarParaAdvogado(
      sessao.processo,
      { ...(sessao.cliente||{}), whatsapp_jid:_normalizarNumeroWhats(numero) },
      'assunto_proibido_ou_sensivel',
      [String(mensagem||'')]
    );
    await _salvarSessaoSecretarioWhatsApp(sessao);
    return { ok:true, escalonado:true, resposta:_MSG_ESCALONAR_DIRETO_DR };
  }

  const contextoProc = sessao.processo ? JSON.stringify({
    numero: sessao.processo.numero || null,
    area: sessao.processo.area || null,
    status: sessao.processo.status || null,
    prazo: sessao.processo.prazo || null,
    proxacao: sessao.processo.proxacao || null
  }) : '{}';
  const historicoTxt = _resumoUltimasMensagensSessao(sessao, 10);
  const system = [
    'Voce e o atendente do escritorio Camargos Advocacia no WhatsApp.',
    'REGRA PRINCIPAL: Converse como um ser humano REAL — igual uma conversa no WhatsApp com um amigo profissional.',
    'Use linguagem natural, coloquial mas educada. Pode usar "vc", "tbm", "pq", contrações normais do dia a dia.',
    'Demonstre empatia REAL — "Entendo sua preocupação, é normal ficar ansioso com isso", "Imagino como deve ser difícil".',
    'Responda de forma CURTA (1-3 frases por mensagem, como num chat real). Ninguém manda textão no WhatsApp.',
    'NUNCA use formato de lista, bullets ou numeração. É uma conversa, não um relatório.',
    'NUNCA diga "Como posso ajudar?" ou frases genéricas de atendimento robótico.',
    'Pode fazer perguntas de volta pro cliente, mostrar interesse genuíno no caso.',
    'Se o cliente mandar "oi", responda algo como "Oi! Tudo bem? Sou do escritório Camargos Advocacia, em que posso te ajudar?".',
    'Chame o cliente pelo nome quando souber.',
    'Se precisar transferir pro Kleuber, diga algo tipo "Vou pedir pro Kleuber te retornar, tá? Assim que eu falar com ele ou com a secretária, a gente te dá um retorno!"',
    'QUANDO NÃO CONSEGUIR RESOLVER: NUNCA diga "não posso ajudar". Diga que vai falar com o Kleuber e pedir pra ele retornar. Exemplo: "Vou passar pro Kleuber e pedir pra ele te retornar, tá bom?"',
    'PROCESSO CADASTRADO: Se CONTEXTO_PROCESSO tiver dados, use para informar o cliente sobre andamento, status, prazo.',
    'SEM PROCESSO (CONTEXTO_PROCESSO vazio/{}): Analise o que o cliente precisa, levante o máximo de informações do caso (tipo do problema, valores, datas, partes envolvidas) pra facilitar o cadastro. Avise o cliente que vai encaminhar pro Kleuber.',
    'SEMPRE ANALISE O CLIENTE: entenda a situação, o tom, a urgência. Passe essas informações pro escalonamento.',
    'Seu tom é: acolhedor, profissional mas descontraído, confiável, humano.',
    'Pode informar somente: '+(cfg.permitido||[]).join(', ')+'.',
    'Assuntos proibidos (NUNCA responda, escalone): '+(cfg.proibido||[]).join(', ')+'.',
    'Se cliente perguntar assunto proibido, responda EXATAMENTE: "'+_MSG_ESCALONAR_DIRETO_DR+'".',
    'Mantenha o cliente calmo e seguro. Se ele estiver nervoso, acolha primeiro, depois informe.'
  ].join('\n');
  const user = [
    'CONTEXTO_PROCESSO:'+contextoProc,
    'DADOS_CLIENTE:'+JSON.stringify({
      nome: sessao.cliente?.nome || '',
      cpf: sessao.cliente?.cpf || '',
      data_nascimento: sessao.cliente?.data_nascimento || ''
    }),
    'HISTORICO:\n'+historicoTxt,
    'MENSAGEM_CLIENTE:\n'+String(mensagem||'')
  ].join('\n\n');

  let resposta = '';
  try {
    resposta = await _chamarAnthropicSecretario([{role:'user', content:user}], system, cfg.modelo_ia);
  } catch(e) {
    return { ok:true, resposta:'Estou com instabilidade no atendimento agora. Vou pedir para a secretaria continuar seu atendimento.' };
  }

  const depois = _filtrarRespostaSensivel(resposta);
  if(depois.bloqueada || _detectarAssuntoProibidoWhats(resposta)) {
    sessao.escalonado = true;
    await _escalarParaAdvogado(
      sessao.processo,
      { ...(sessao.cliente||{}), whatsapp_jid:_normalizarNumeroWhats(numero) },
      'resposta_ia_bloqueada',
      [String(mensagem||''), String(resposta||'')]
    );
    await _salvarSessaoSecretarioWhatsApp(sessao);
    return { ok:true, escalonado:true, resposta:_MSG_ESCALONAR_DIRETO_DR };
  }

  sessao.perguntas_feitas = Number(sessao.perguntas_feitas||0) + 1;
  sessao.ultima_msg = _agoraIso();
  sessao.historico.push({ role:'user', text:String(mensagem||''), em:_agoraIso() });
  sessao.historico.push({ role:'assistant', text:String(depois.resposta||''), em:_agoraIso() });
  if(sessao.historico.length > 30) sessao.historico = sessao.historico.slice(-30);
  await _salvarSessaoSecretarioWhatsApp(sessao);
  return { ok:true, resposta:String(depois.resposta||'').trim() };
}

function _detectarUrgenciaLegal(perfil, texto) {
  const t = _normCasoTxt(texto);
  let nivel = 'normal';
  let alerta = '';
  let risco = '';
  if(/\b(hoje|amanha|amanhã|prazo|audiencia|audiência|intimacao|intimação|liminar|prisao|prisão|flagrante)\b/.test(t)) {
    nivel = 'alta';
    alerta = 'Possível urgência processual detectada';
    risco = 'Prazo/medida urgente possivelmente em curso';
  }
  const m = t.match(/(\d{1,2})\s*(dia|dias)/);
  if(m) {
    const dias = parseInt(m[1], 10);
    if(!isNaN(dias) && dias <= 7) {
      nivel = 'vermelho';
      alerta = 'ALERTA VERMELHO: prazo muito próximo';
      risco = 'Risco prescricional/procedimental iminente (<=7 dias)';
    } else if(!isNaN(dias) && dias <= 15 && nivel !== 'vermelho') {
      nivel = 'alta';
      alerta = 'Prazo relevante identificado';
      risco = 'Necessário atuar rapidamente';
    }
  }
  if(/(prescric|decadenc|vencid|ultimo dia|último dia)/.test(t)) {
    nivel = 'vermelho';
    alerta = 'ALERTA VERMELHO: risco de prescrição/decadência';
    risco = 'Risco prescricional sinalizado pelo cliente';
  }
  perfil.nivel_urgencia = nivel;
  perfil.alerta_urgencia = alerta || perfil.alerta_urgencia || null;
  perfil.risco_prescricional = risco || perfil.risco_prescricional || null;
  return perfil;
}

function _sugerirPerguntasSecretaria(perfil) {
  const base = [
    'Descreva a situacao do cliente com datas e fatos principais.',
    'Solicite ao cliente documentos com prazos/intimacoes e me envie.',
    'Confirme se ja houve tentativa administrativa ou acordo previo.'
  ];
  const tipo = perfil.caso_tipo || '';
  const porArea = {
    trabalhista: ['Solicite ao cliente a CTPS e me envie foto legivel.', 'Solicite holerites e TRCT do cliente.'],
    previdenciario: ['Confirme se o cliente ja fez requerimento no INSS.', 'Solicite indeferimento e CNIS atualizados.'],
    civil: ['Solicite ao cliente contrato ou prova escrita.', 'Solicite conversas/prints com a outra parte.'],
    bancario_cdc: ['Confirme com o cliente o contrato questionado.', 'Solicite extratos/faturas com cobranca indevida.'],
    tributario: ['Descreva qual tributo/autuacao esta em discussao.', 'Solicite notificacao e decisao administrativa.'],
    comercial: ['Confirme se a relacao e entre empresas/socios.', 'Solicite notas e comunicacoes comerciais.'],
    familia: ['Confirme existencia de filhos menores.', 'Solicite decisao/acordo anterior.'],
    penal: ['Confirme se o cliente foi intimado oficialmente.', 'Confirme audiencia/custodia marcada.'],
    administrativo: ['Descreva o ato administrativo a impugnar.', 'Solicite numero do processo administrativo.']
  };
  perfil.perguntas_sugeridas_secretaria = [...base, ...(porArea[tipo] || [])].slice(0, 8);
  return perfil;
}

function _orientarDireitosBasicos(perfil) {
  const tipo = perfil.caso_tipo || '';
  const direitos = [];
  if(tipo === 'trabalhista') direitos.push('Direito a verbas rescisórias e análise de horas extras/FGTS');
  if(tipo === 'previdenciario') direitos.push('Direito à revisão e requerimento adequado no INSS');
  if(tipo === 'familia') direitos.push('Prioridade ao melhor interesse da criança e direito de convivência');
  if(tipo === 'penal') direitos.push('Direito ao silêncio e à ampla defesa');
  if(tipo === 'bancario_cdc') direitos.push('Direito à informação clara e revisão de cláusulas abusivas (CDC)');
  if(!direitos.length) direitos.push('Direito à informação clara, ampla defesa e contraditório');
  perfil.direitos_orientados = [...new Set([...(perfil.direitos_orientados||[]), ...direitos])].slice(0, 6);
  return perfil;
}

function _registrarHistoricoConversa(perfil, papel, texto) {
  if(!perfil.historico_conversa) perfil.historico_conversa = [];
  perfil.historico_conversa.push({
    em: _agoraIso(),
    papel: papel || 'cliente',
    texto: String(texto || '').substring(0, 600)
  });
  if(perfil.historico_conversa.length > 40) perfil.historico_conversa = perfil.historico_conversa.slice(-40);
  return perfil;
}

function _tentarExtrairDadosTextoLivre(perfil, texto) {
  const txt = String(texto || '');
  const mCpf = txt.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
  if(mCpf) {
    const vCpf = _validarCPF(mCpf[0]);
    if(vCpf.valido) { perfil.cpf = vCpf.formatado; perfil.cpf_valido = true; }
  }
  const mCep = txt.match(/\b\d{5}-?\d{3}\b/);
  if(mCep) {
    const vCep = _validarCEP(mCep[0]);
    if(vCep.valido) { perfil.endereco_cep = vCep.formatado; perfil.cep_valido = true; }
  }
  const mTel = txt.match(/(\+?55\s?)?(\(?\d{2}\)?\s?)?\d{4,5}-?\d{4}/);
  if(mTel) {
    const vTel = _validarTelefone(mTel[0]);
    if(vTel.valido) { perfil.telefone = vTel.formatado; perfil.telefone_valido = true; }
  }
  const mEmail = txt.match(/[^\s@]+@[^\s@]+\.[^\s@]{2,}/);
  if(mEmail) {
    const vEmail = _validarEmail(mEmail[0]);
    if(vEmail.valido) { perfil.email = vEmail.formatado; perfil.email_valido = true; }
  }
  const mData = txt.match(/\b\d{2}\/\d{2}\/\d{4}\b/);
  if(mData && !perfil.data_nascimento) {
    const vData = _validarDataBR(mData[0]);
    if(vData.valido) perfil.data_nascimento = vData.formatado;
  }
  return perfil;
}

function _montarPerguntaContextual(perfil) {
  const faltam_pess = _faltantesPessoais(perfil);
  const faltam_prob = _faltantesProbatorios(perfil);
  if(!perfil.lgpd_consentimento) {
    return 'Antes de continuar, solicite ao cliente autorizacao LGPD: "sim, autorizo", e me encaminhe a confirmacao.';
  }
  if(!perfil.caso_descricao || perfil.caso_descricao.length < 30) {
    return 'Descreva a situacao do cliente: fatos, data de inicio e objetivo juridico imediato.';
  }
  if(!perfil.caso_tipo) {
    return 'Confirme a area do caso do cliente: bancario/CDC, tributario, civil, comercial, familia, trabalhista, previdenciario, penal ou administrativo.';
  }
  if(perfil.caso_tipo === 'trabalhista' && !/carteira assinad|ctps|clt/i.test(perfil.caso_descricao||'')) {
    return 'Confirme com o cliente se houve carteira assinada e me envie periodo de admissao e saida.';
  }
  if(faltam_pess.length) {
    return 'Solicite ao cliente os dados pessoais pendentes ou foto legivel dos documentos e me envie.';
  }
  if(faltam_prob.length) {
    const p = faltam_prob[0];
    return 'Solicite ao cliente o documento: '+p.nome+(p.detalhes ? ' ('+p.detalhes+')' : '')+' e me encaminhe.';
  }
  return 'Caso completo para peticao inicial. Deseja que eu prepare o resumo tecnico para o advogado agora?';
}

function _montarRespostaConversacional(perfil) {
  let msg = '';
  if(perfil.nivel_urgencia === 'vermelho') {
    msg += '🔴 Atenção: identifiquei risco de prazo muito próximo. Vou priorizar sua triagem imediatamente.\n\n';
  } else if(perfil.nivel_urgencia === 'alta') {
    msg += '⚠️ Vi sinais de urgência no seu relato. Vamos acelerar para não perder prazo.\n\n';
  }
  const area = perfil.caso_tipo ? _areaNome(perfil.caso_tipo) : null;
  if(area) msg += 'Área identificada: '+area+'.\n';
  if((perfil.direitos_orientados||[]).length) {
    msg += 'Direito importante no seu caso: '+perfil.direitos_orientados[0]+'.\n';
  }
  msg += '\n'+_montarPerguntaContextual(perfil);
  return msg;
}

function _gerarBriefingAdvogado(perfil) {
  const faltam_p = _faltantesPessoais(perfil);
  const faltam_pr = _faltantesProbatorios(perfil);
  const pontosFortes = [];
  const pontosFracos = [];
  if(perfil.documentos_anexos && perfil.documentos_anexos.length >= 3) pontosFortes.push('Cliente já enviou documentação relevante inicial');
  if(perfil.caso_descricao && perfil.caso_descricao.length > 120) pontosFortes.push('Narrativa fática inicial consistente');
  if(perfil.nivel_urgencia === 'vermelho') pontosFracos.push('Prazo crítico/próximo — risco de perecimento');
  if(faltam_p.length) pontosFracos.push('Pendências de qualificação: '+faltam_p.join(', '));
  if(faltam_pr.length) pontosFracos.push('Pendências probatórias: '+faltam_pr.map(x=>x.nome).join(', '));
  return [
    '📌 BRIEFING ATENDENTE JURÍDICO v2',
    '',
    '👤 DADOS PESSOAIS',
    'Nome: '+(perfil.nome||perfil.nome_usuario_canal||perfil.chat_id),
    'CPF: '+(perfil.cpf||'não informado'),
    'RG: '+(perfil.rg||'não informado'),
    'Nascimento: '+(perfil.data_nascimento||'não informado'),
    'Telefone: '+(perfil.telefone||'não informado'),
    'Email: '+(perfil.email||'não informado'),
    '',
    '⚖️ TIPO DE CASO',
    _areaNome(perfil.caso_tipo||'')+' ('+(perfil.caso_tipo||'indefinido')+')',
    '',
    '🧾 RESUMO DOS FATOS',
    (perfil.caso_descricao||'Sem descrição').substring(0,1200),
    '',
    '📎 DOCUMENTOS RECEBIDOS',
    ((perfil.documentos_anexos||[]).map(d=>'- '+d.tipo).join('\n') || '- nenhum'),
    '',
    '✅ PONTOS FORTES',
    (pontosFortes.map(x=>'- '+x).join('\n') || '- sem pontos fortes relevantes por ora'),
    '',
    '⚠️ PONTOS FRACOS',
    (pontosFracos.map(x=>'- '+x).join('\n') || '- sem pontos fracos críticos no momento'),
    '',
    '🧭 SUGESTÃO DE ESTRATÉGIA',
    '- Consolidar prova documental mínima e validar cronologia;',
    '- Definir pedido principal + tutela de urgência se cabível;',
    '- Confirmar competência/rito e mapear risco prescricional: '+(perfil.risco_prescricional||'não identificado')
  ].join('\n');
}

async function _notificarBriefingAdvogado(perfil) {
  if(perfil.status !== 'pronto_peticao' || perfil.briefing_enviado) return perfil;
  const briefing = _gerarBriefingAdvogado(perfil);
  await envTelegram(briefing, null, CHAT_ID).catch(()=>{});
  perfil.briefing_enviado = true;
  return perfil;
}

async function _oferecerAgendamento(perfil, ctx) {
  if(perfil.status !== 'pronto_peticao' || perfil.agendamento_oferecido) return perfil;
  await env('✅ Triagem concluída. Se quiser, já posso agendar atendimento jurídico.\nAcesse: /api/calendario (ou me diga o melhor horário).', ctx);
  perfil.agendamento_oferecido = true;
  return perfil;
}

async function _transcreverAudioWhisper(buffer, mimeType, nomeArquivo) {
  if(!OPENAI_API_KEY) return { ok:false, texto:'', erro:'OPENAI_API_KEY ausente' };
  const boundary = '----lexwhisper'+Date.now();
  const filename = nomeArquivo || ('audio.' + ((mimeType||'audio/ogg').split('/')[1] || 'ogg'));
  const head =
    '--'+boundary+'\r\n' +
    'Content-Disposition: form-data; name="model"\r\n\r\n' +
    'whisper-1\r\n' +
    '--'+boundary+'\r\n' +
    'Content-Disposition: form-data; name="language"\r\n\r\n' +
    'pt\r\n' +
    '--'+boundary+'\r\n' +
    'Content-Disposition: form-data; name="response_format"\r\n\r\n' +
    'json\r\n' +
    '--'+boundary+'\r\n' +
    'Content-Disposition: form-data; name="file"; filename="'+filename+'"\r\n' +
    'Content-Type: '+(mimeType||'audio/ogg')+'\r\n\r\n';
  const tail = '\r\n--'+boundary+'--\r\n';
  const body = Buffer.concat([Buffer.from(head, 'utf8'), buffer, Buffer.from(tail, 'utf8')]);
  return await new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer '+OPENAI_API_KEY,
        'Content-Type': 'multipart/form-data; boundary='+boundary,
        'Content-Length': body.length
      }
    }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const j = d ? JSON.parse(d) : {};
          if(r.statusCode >= 200 && r.statusCode < 300 && j.text) resolve({ ok:true, texto:String(j.text).trim(), erro:'' });
          else resolve({ ok:false, texto:'', erro:(j.error&&j.error.message) || ('HTTP '+r.statusCode) });
        } catch(e) { resolve({ ok:false, texto:'', erro:e.message }); }
      });
    });
    req.on('error', e => resolve({ ok:false, texto:'', erro:e.message }));
    req.write(body);
    req.end();
  });
}

async function _executarFollowupClientesPendentes() {
  try {
    const rows = await sbGet('clientes_pendentes', {}, { limit: 300, order: 'atualizado_em.desc' });
    const agora = Date.now();
    for(const c of rows || []) {
      if(!c || c.status === 'convertido') continue;
      const primeiro = new Date(c.data_primeiro_contato || c.criado_em || c.ultimo_contato || _agoraIso()).getTime();
      const ultimo = new Date(c.ultimo_contato || c.atualizado_em || c.criado_em || _agoraIso()).getTime();
      const diffPrimeiroH = (agora - primeiro) / 3600000;
      const diffH = (agora - ultimo) / 3600000;
      if(diffPrimeiroH >= 24*30) {
        await sbDelete('clientes_pendentes', { chat_id: String(c.chat_id) }).catch(()=>{});
        await envTelegram('LGPD: cliente '+(c.nome||c.chat_id)+' descartado automaticamente apos 30 dias sem resposta.', null, CHAT_ID).catch(()=>{});
        continue;
      } else if(diffPrimeiroH >= 24*5 && !c.perguntou_fechamento) {
        await envTelegram('Vamos fechar acao com este cliente? Aguardando confirmacao.\nCliente: '+(c.nome||c.chat_id)+' | chat '+c.chat_id, null, CHAT_ID).catch(()=>{});
        c.perguntou_fechamento = true;
      } else if(diffH >= 72 && !c.admin_notificado_sumico_72h) {
        await envTelegram('👻 Cliente sem resposta há 72h: '+(c.nome||c.chat_id)+' | chat '+c.chat_id+'.', null, CHAT_ID).catch(()=>{});
        c.admin_notificado_sumico_72h = true;
      } else if(diffH >= 24*10 && !(c.lembrete_docs_10d_enviado)) {
        const nomeProc = c.nome || c.chat_id;
        const docsPend = Array.isArray(c.campos_verificar) && c.campos_verificar.length
          ? c.campos_verificar.slice(0,6).join(', ')
          : (String(c.docs_faltantes || c.docsPendentes || '').trim() || 'documentos pendentes do caso');
        await env(
          'Lembrete de documentação: seguimos aguardando os documentos para avançar no seu caso ('+nomeProc+'). Pendências: '+docsPend+'.',
          { canal: c.canal || 'telegram', chatId: c.chat_id, numero: c.canal==='whatsapp' ? c.chat_id : null }
        );
        c.lembrete_docs_10d_enviado = true;
      } else if(diffH >= 48 && !c.lembrete_48h_enviado) {
        await env('Passando para reforçar: quando puder, me envie os dados/documentos pendentes para eu concluir seu atendimento jurídico 😊', {
          canal: c.canal || 'telegram', chatId: c.chat_id, numero: c.canal==='whatsapp' ? c.chat_id : null
        });
        c.lembrete_48h_enviado = true;
      } else if(diffH >= 24 && !c.lembrete_24h_enviado) {
        await env('Oi! Só lembrando do seu atendimento jurídico. Assim que puder, me responda por aqui que eu sigo com sua triagem.', {
          canal: c.canal || 'telegram', chatId: c.chat_id, numero: c.canal==='whatsapp' ? c.chat_id : null
        });
        c.lembrete_24h_enviado = true;
      }
      await _salvarPerfilCliente(c);
    }
  } catch(e) { console.warn('[followup] erro:', e.message); }
}

async function _enviarEmailBackupDB(info) {
  try {
    const to = process.env.LEX_EMAIL_BACKUP || '';
    const host = process.env.LEX_SMTP_HOST || '';
    const port = parseInt(process.env.LEX_SMTP_PORT || '587', 10);
    const user = process.env.LEX_SMTP_USER || '';
    const pass = process.env.LEX_SMTP_PASS || '';
    if(!to || !host || !user || !pass || !nodemailer) return false;
    const transporter = nodemailer.createTransport({
      host, port, secure: port === 465,
      auth: { user, pass }
    });
    await transporter.sendMail({
      from: user,
      to,
      subject: '[Lex] Alerta de capacidade do banco',
      text:
        'Uso estimado do banco acima de 80%.\n\n' +
        'Detalhes:\n' +
        '- Total clientes_pendentes: '+(info.total||0)+'\n' +
        '- Registros índice arquivo morto: '+(info.indice||0)+'\n' +
        '- Percentual estimado: '+(info.percentual||0)+'%\n' +
        '- Data: '+new Date().toISOString()+'\n\n' +
        'Recomendação: usar /api/arquivo-morto/exportar e /api/arquivo-morto/limpar.'
    });
    return true;
  } catch(e) { console.warn('[backup-email] erro:', e.message); return false; }
}

let _ultimoAlertaCapacidadeDB = 0;
async function _monitorarCapacidadeDB() {
  try {
    const pend = await sbGet('clientes_pendentes', {}, { limit: 5000, order: 'atualizado_em.desc' });
    const idx = await sbGet('arquivo_morto_indice', {}, { limit: 5000, order: 'arquivado_em.desc' });
    const total = (pend||[]).length;
    const totalIndice = (idx||[]).length;
    const capacidadeReferencia = 5000;
    const percentual = Math.round((total / capacidadeReferencia) * 100);
    if(percentual >= 80) {
      const agora = Date.now();
      if((agora - _ultimoAlertaCapacidadeDB) > 24*3600000) {
        await _enviarEmailBackupDB({ total, indice: totalIndice, percentual });
        _ultimoAlertaCapacidadeDB = agora;
      }
    }
  } catch(e) { console.warn('[monitor-db] erro:', e.message); }
}

// Entry-point: chamado quando chega imagem/texto de cliente
async function _cadastradorRecebeu(ctx, tipoEntrada, conteudo) {
  // Só processa se não for admin (admin já usa o Lex normalmente)
  if(String(ctx.chatId) === CHAT_ID) return false;

  const perfil = await _carregarPerfilCliente(ctx.chatId, ctx.canal, ctx.nomeUsuario);

  // Se já foi convertido em processo, não processa mais
  if(perfil.status === 'convertido') return false;

  try {
    perfil.ultimo_contato = _agoraIso();
    perfil.lembrete_24h_enviado = false;
    perfil.lembrete_48h_enviado = false;
    perfil.admin_notificado_sumico_72h = false;
    if(!perfil.lgpd_consentimento && tipoEntrada !== 'texto') {
      await env('Antes de tratar seus documentos/áudios, preciso do seu consentimento LGPD. Responda: "sim, autorizo".', ctx);
      await _salvarPerfilCliente(perfil);
      return true;
    }
    if(tipoEntrada === 'imagem') {
      const dados = await _extrairDadosImagem(conteudo.buffer, conteudo.mime);
      _mesclarDadosExtraidos(perfil, dados.extraido, dados.tipo_documento);
      // Registra o arquivo
      if(!perfil.documentos_anexos) perfil.documentos_anexos = [];
      // Avisa cliente com ack imediato (natural)
      const tipoLegivel = {
        rg:'RG', cpf:'CPF', cnh:'CNH', rg_cpf_unificado:'RG/CPF',
        comprovante_residencia:'comprovante de residência', contrato:'contrato',
        ctps:'CTPS', holerite:'holerite', trct:'TRCT',
        laudo_medico:'laudo médico', cnis:'extrato CNIS',
        indeferimento_inss:'indeferimento do INSS', outro:'documento'
      }[dados.tipo_documento] || 'documento';
      await env(`📸 Recebi seu ${tipoLegivel}. Processando...`, ctx);
      _registrarHistoricoConversa(perfil, 'cliente', '[imagem:'+tipoLegivel+']');
    } else if(tipoEntrada === 'audio') {
      if(!OPENAI_API_KEY) {
        await env('Recebi seu áudio, mas a transcrição automática está desativada no momento. Pode me enviar em texto?', ctx);
        _registrarHistoricoConversa(perfil, 'sistema', '[audio sem transcricao por falta de OPENAI_API_KEY]');
      } else {
        const tr = await _transcreverAudioWhisper(conteudo.buffer, conteudo.mime, conteudo.nome || 'audio.ogg');
        if(!tr.ok || !tr.texto) {
          await env('Tive dificuldade para transcrever seu áudio. Pode reenviar ou digitar em texto?', ctx);
          _registrarHistoricoConversa(perfil, 'sistema', '[falha transcricao audio: '+(tr.erro||'desconhecido')+']');
        } else {
          conteudo = tr.texto;
          _registrarHistoricoConversa(perfil, 'cliente', '[audio transcrito] '+tr.texto.substring(0,500));
          if(!perfil.caso_tipo) {
            const tipoAudio = _detectarTipoCaso(conteudo);
            if(tipoAudio) perfil.caso_tipo = tipoAudio;
          }
          if(conteudo.length > 20) {
            perfil.caso_descricao = (perfil.caso_descricao || '') + ' ' + conteudo.substring(0,500);
            perfil.caso_descricao = perfil.caso_descricao.trim().substring(0,2000);
          }
          _tentarExtrairDadosTextoLivre(perfil, conteudo);
          _detectarUrgenciaLegal(perfil, conteudo);
        }
      }
    } else if(tipoEntrada === 'texto') {
      _registrarHistoricoConversa(perfil, 'cliente', conteudo);
      if(!perfil.lgpd_consentimento) {
        const n = _normCasoTxt(conteudo);
        if(/^(sim|sim autorizo|autorizo|aceito|concordo)/.test(n)) {
          perfil.lgpd_consentimento = true;
          await env('Perfeito, consentimento LGPD registrado. Descreva a situacao do cliente.', ctx);
        } else {
          await env('Antes de coletar dados, preciso do seu consentimento LGPD. Responda: "sim, autorizo".', ctx);
          await _salvarPerfilCliente(perfil);
          return true;
        }
      }
      // Tenta extrair tipo de caso do texto
      if(!perfil.caso_tipo) {
        const tipo = _detectarTipoCaso(conteudo);
        if(tipo) perfil.caso_tipo = tipo;
      }
      // Acumula descrição livre do caso
      if(conteudo.length > 30) {
        perfil.caso_descricao = (perfil.caso_descricao || '') + ' ' + conteudo.substring(0,500);
        perfil.caso_descricao = perfil.caso_descricao.trim().substring(0,2000);
      }
      // Se cliente escreve explicitamente o tipo
      const lc = conteudo.toLowerCase().trim();
      if(/^trabalhist/.test(lc)) perfil.caso_tipo = 'trabalhista';
      else if(/^c[ií]vel|^civil/.test(lc)) perfil.caso_tipo = 'civil';
      else if(/^previdenci/.test(lc)) perfil.caso_tipo = 'previdenciario';
      else if(/^banc/.test(lc) || /cdc/.test(lc)) perfil.caso_tipo = 'bancario_cdc';
      else if(/^tribut/.test(lc)) perfil.caso_tipo = 'tributario';
      else if(/^comerc/.test(lc) || /^empres/.test(lc)) perfil.caso_tipo = 'comercial';
      else if(/^famil/.test(lc)) perfil.caso_tipo = 'familia';
      else if(/^penal/.test(lc) || /^criminal/.test(lc)) perfil.caso_tipo = 'penal';
      else if(/^administ/.test(lc)) perfil.caso_tipo = 'administrativo';
      _tentarExtrairDadosTextoLivre(perfil, conteudo);
      _detectarUrgenciaLegal(perfil, conteudo);
    }

    _sugerirPerguntasSecretaria(perfil);
    _orientarDireitosBasicos(perfil);
    _atualizarStatusPerfil(perfil);
    await _salvarPerfilCliente(perfil);
    await _notificarAdminMarcos(perfil);
    await _notificarBriefingAdvogado(perfil);
    await _oferecerAgendamento(perfil, ctx);

    // Responde ao cliente a próxima ação
    const cobranca = _montarRespostaConversacional(perfil);
    await env(cobranca, ctx);

    logAtividade('juridico', ctx.chatId, 'cadastrador_'+tipoEntrada, perfil.status);
    return true;
  } catch(e) {
    console.warn('cadastrador erro:', e.message);
    await env('Tive um problema ao processar. Pode tentar novamente?', ctx);
    return true;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FIM AGENTE CADASTRADOR
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// AGENTE COBRADOR DE ATUALIZAÇÃO v1 (Forma A - Passivo) - v2.8
// ════════════════════════════════════════════════════════════════════════════
//
// OBJETIVO: quando você dá andamento em algum processo e esquece de mandar
// a peça pro Lex, o Cobrador te lembra.
//
// LÓGICA PASSIVA (não depende de PJe/lex-agente):
//   - Todo processo tem data de última atualização (`atualizado_em`)
//   - Todo processo em andamento (status ATIVO/URGENTE/EM_PREP) tem um ritmo
//     esperado de movimento
//   - Se um processo passou X dias sem nenhum documento novo → alerta
//
// LIMIARES (configuráveis):
//   - URGENTE: 5 dias sem atualização → alerta
//   - ATIVO:   15 dias sem atualização → alerta
//   - EM_PREP: 30 dias sem atualização → alerta
// ════════════════════════════════════════════════════════════════════════════

const COBRADOR_LIMIARES_DIAS = {
  URGENTE: 4,   // ciclo: ATIVO -> 4 dias sem atualizar -> URGENTE
  ATIVO: 4,     // ciclo contínuo de urgência nos setores administrativo/judicial
  EM_PREP: 10   // autuação: cobrar documentos a cada 10 dias
};

// Quantos dias desde a última atividade registrada no processo
function _diasSemAtualizacao(proc) {
  // Pega data mais recente entre: último andamento, atualizado_em, prazo
  let maisRecente = null;
  if(proc.andamentos && proc.andamentos.length) {
    // Formato data BR dd/mm/aaaa no primeiro andamento (mais recente)
    const dataStr = proc.andamentos[0].data;
    if(dataStr && /^\d{2}\/\d{2}\/\d{4}$/.test(dataStr)) {
      const [d,m,a] = dataStr.split('/').map(Number);
      maisRecente = new Date(a, m-1, d);
    }
  }
  if(proc.atualizado_em) {
    const d = new Date(proc.atualizado_em);
    if(!isNaN(d.getTime()) && (!maisRecente || d > maisRecente)) maisRecente = d;
  }
  if(!maisRecente) return null;
  const diff = Date.now() - maisRecente.getTime();
  return Math.floor(diff / (24*60*60*1000));
}

// Retorna lista de processos que precisam ser cobrados
function _processosParaCobrar() {
  const candidatos = [];
  let houveMudancaStatus = false;
  for(const p of processos) {
    const setor = _normalizarSetorProcesso(p?.setor, p?.tipo, p?.area);
    const st = String(p.status||'').toUpperCase();
    const monitora = setor === 'autuacao'
      ? (st === 'EM_PREP' || st === 'ATIVO' || st === 'URGENTE')
      : (st === 'ATIVO' || st === 'URGENTE');
    if(!monitora) continue;
    const limiar = setor === 'autuacao'
      ? COBRADOR_LIMIARES_DIAS.EM_PREP
      : COBRADOR_LIMIARES_DIAS[st];
    if(!limiar) continue;
    const dias = _diasSemAtualizacao(p);
    if(dias === null) continue; // sem data base, pula
    if(setor !== 'autuacao' && dias >= COBRADOR_LIMIARES_DIAS.ATIVO && st !== 'URGENTE') {
      p.status = 'URGENTE';
      p.atualizado_em = new Date().toISOString();
      houveMudancaStatus = true;
    }
    if(dias >= limiar) {
      candidatos.push({
        proc: p,
        dias,
        limiar,
        urgencia: dias >= limiar * 2 ? 'alta' : 'media'
      });
    }
  }
  if(houveMudancaStatus) {
    _bumpProcessos('cobrador_urgencia');
    _persistirProcessosCache().catch(()=>{});
  }
  // Ordena: mais atrasados primeiro
  candidatos.sort((a,b) => b.dias - a.dias);
  return candidatos;
}

// Monta mensagem amigável de cobrança pro admin
function _montarMensagemCobrador(candidatos) {
  if(!candidatos.length) return null;
  let m = '⏰ LEMBRETE — processos sem atualização há tempo:\n\n';
  candidatos.slice(0, 10).forEach(c => {
    const icone = c.urgencia === 'alta' ? '🔴' : '🟡';
    m += `${icone} ${c.proc.nome} — ${c.dias} dias (limite ${c.limiar}d)\n`;
    if(c.proc.numero) m += `   Nº: ${c.proc.numero}\n`;
    if(c.proc.proxacao) m += `   Próxima ação: ${c.proc.proxacao}\n`;
    m += '\n';
  });
  if(candidatos.length > 10) m += `\n...e mais ${candidatos.length - 10} processo(s).\n`;
  m += '\n💡 Tem andamento novo em algum deles? Me manda a peça aqui que eu atualizo.';
  return m;
}

// Variáveis de controle do scheduler
let _cobradorUltimaExecucao = 0;
const COBRADOR_INTERVALO_MS = 24 * 60 * 60 * 1000; // 24h

// Executa o cobrador (chamado manualmente ou por scheduler)
async function _executarCobrador(ctx) {
  try {
    const candidatos = _processosParaCobrar();
    if(!candidatos.length) {
      if(ctx) await env('✅ Todos os processos em dia! Nenhum atraso detectado.', ctx);
      return { rodou: true, candidatos: 0 };
    }
    const msg = _montarMensagemCobrador(candidatos);
    if(ctx) {
      await env(msg, ctx);
    } else {
      // Execução automática: envia pro admin
      await envTelegram(msg, null, CHAT_ID).catch(()=>{});
    }
    _cobradorUltimaExecucao = Date.now();
    logAtividade('juridico', ctx?.chatId || CHAT_ID, 'cobrador_executado', candidatos.length+' processo(s)');
    return { rodou: true, candidatos: candidatos.length };
  } catch(e) {
    console.warn('cobrador erro:', e.message);
    return { rodou: false, erro: e.message };
  }
}

// Scheduler: roda de 24 em 24h verificando
function _agendarCobrador() {
  setInterval(async () => {
    try {
      if(Date.now() - _cobradorUltimaExecucao >= COBRADOR_INTERVALO_MS) {
        console.log('[cobrador] executando verificação diária...');
        await _executarCobrador(null);
      }
    } catch(e) { console.warn('[cobrador] scheduler erro:', e.message); }
  }, 60 * 60 * 1000); // checa a cada 1h
}

// ════════════════════════════════════════════════════════════════════════════
// FIM AGENTE COBRADOR
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// COBRANÇA PIX — Lex cobra clientes pelo WhatsApp com educação
// ════════════════════════════════════════════════════════════════════════════
const _PIX_CONFIG = {
  tipo_chave: 'aleatoria',
  chave: '', // Kleuber vai passar a chave amanhã
  beneficiario: 'KLEUBER MELCHIOR DE SOUZA',
  cidade: 'BRASILIA',
  celular: '61999917171'
};

// Gera código PIX EMV estático (padrão Banco Central do Brasil)
function _gerarPixPayloadBackend(valor, descricao) {
  const chave = _PIX_CONFIG.chave || '';
  if(!chave) return null;
  const nome = (_PIX_CONFIG.beneficiario||'').toUpperCase().substring(0,25).normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const cidade = (_PIX_CONFIG.cidade||'BRASILIA').toUpperCase().substring(0,15).normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const valorStr = valor ? parseFloat(valor).toFixed(2) : '';
  const desc = (descricao||'').substring(0,25).normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  
  function tlv(id,val){const l=val.length.toString().padStart(2,'0');return id+l+val;}
  function crc16(str){
    let crc=0xFFFF;
    for(let i=0;i<str.length;i++){
      crc^=str.charCodeAt(i)<<8;
      for(let j=0;j<8;j++) crc=(crc&0x8000)?((crc<<1)^0x1021):(crc<<1);
      crc&=0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4,'0');
  }
  
  let gui = tlv('00','br.gov.bcb.pix');
  let chaveTlv = tlv('01',chave);
  let descTlv = desc ? tlv('02',desc) : '';
  let merchantAccount = tlv('26', gui+chaveTlv+descTlv);
  
  let payload = '';
  payload += tlv('00','01');
  payload += merchantAccount;
  payload += tlv('52','0000');
  payload += tlv('53','986');
  if(valorStr && parseFloat(valorStr)>0) payload += tlv('54',valorStr);
  payload += tlv('58','BR');
  payload += tlv('59',nome);
  payload += tlv('60',cidade);
  payload += tlv('62', tlv('05','***'));
  payload += '6304';
  
  const crc = crc16(payload);
  return payload + crc;
}

// Lex cobra o cliente com toda educação via WhatsApp
async function _lexCobrarClienteWhatsApp(clienteNome, clienteWhatsapp, valor, referencia) {
  if(!_PIX_CONFIG.chave) {
    await envTelegram('⚠️ Chave PIX não configurada! Use /setpix <chave> para configurar.', null, CHAT_ID).catch(()=>{});
    return { ok: false, erro: 'Chave PIX não configurada' };
  }
  
  const codigo = _gerarPixPayloadBackend(valor, referencia);
  if(!codigo) return { ok: false, erro: 'Erro ao gerar código PIX' };
  
  const primeiroNome = (clienteNome||'').split(' ')[0] || '';
  
  // Monta mensagem educada e profissional
  const msg = (primeiroNome ? primeiroNome + ', ' : '') + 'tudo bem? 😊\n\n'
    + 'Passando pra te lembrar da mensalidade'+(referencia ? ' ref. *'+referencia+'*' : '')+'.\n\n'
    + '💵 *Valor: R$ ' + parseFloat(valor).toFixed(2) + '*\n\n'
    + '📲 *PIX Copia e Cola:*\n'
    + codigo + '\n\n'
    + 'É só copiar o código acima e colar no app do seu banco! Se preferir, pode usar o PIX por chave aleatória ou entrar em contato pelo ' + _PIX_CONFIG.celular + '.\n\n'
    + 'Qualquer dúvida, estou por aqui! 🤝\n'
    + '— Lex, Escritório Camargos Advocacia';
  
  try {
    const jid = clienteWhatsapp.includes('@') ? clienteWhatsapp : (clienteWhatsapp.replace(/\D/g,'') + '@s.whatsapp.net');
    await envWhatsApp(msg, jid);
    _registrarMsgCentral('whatsapp', 'saida', jid, 'Lex (cobrança PIX)', msg);
    
    // Notifica Kleuber
    await envTelegram('💰 *Cobrança enviada!*\n👤 ' + clienteNome + '\n💵 R$ ' + parseFloat(valor).toFixed(2) + '\n📋 ' + (referencia||'—'), null, CHAT_ID).catch(()=>{});
    
    // Salva registro no Supabase
    try {
      await sbReq('POST', 'cobrancas_pix', {
        cliente_nome: clienteNome,
        cliente_whatsapp: clienteWhatsapp,
        valor: parseFloat(valor),
        referencia: referencia || null,
        status: 'enviada',
        criado_em: _agoraIso()
      });
    } catch(e) { /* tabela pode não existir ainda */ }
    
    return { ok: true };
  } catch(e) {
    await envTelegram('⚠️ Erro ao enviar cobrança pra ' + clienteNome + ': ' + e.message, null, CHAT_ID).catch(()=>{});
    return { ok: false, erro: e.message };
  }
}

// Comando /setpix — Kleuber configura a chave PIX via Telegram
// Comando /cobrar <nome> <whatsapp> <valor> <ref> — Kleuber manda Lex cobrar
// Comando /cobrarlote — cobra todos os clientes pendentes
// ════════════════════════════════════════════════════════════════════════════
// PIPELINE UNIFICADA — Telegram E WhatsApp passam por aqui
// ════════════════════════════════════════════════════════════════════════════
//
// ctx = {
//   canal: 'telegram' | 'whatsapp',
//   chatId: string,                    // ID universal (telegram chat_id ou whatsapp jid)
//   threadId: string|null,             // só telegram (group threads)
//   numero: string|null,               // só whatsapp (jid pra responder)
//   nomeUsuario: string,               // pushName/first_name
//   tipoChat: 'private'|'group'|'supergroup'|'channel'
// }
//
// dados = { texto?, arquivo?: {buffer, nome, mime, isPdf}, imagem?: {buffer, mime} }

// ── Registrar mensagens na Central para leitura pelo painel ──
if(!global._centralMensagens) global._centralMensagens = { telegram:[], whatsapp:[] };
function _registrarMsgCentral(canal, direcao, chatId, nome, texto, tipo) {
  if(!global._centralMensagens[canal]) global._centralMensagens[canal] = [];
  global._centralMensagens[canal].push({
    id: Date.now() + '_' + Math.random().toString(36).slice(2,6),
    canal, direcao, chatId: String(chatId), nome: nome||chatId,
    texto: String(texto||'').substring(0, 2000),
    tipo: tipo || 'texto',
    em: new Date().toISOString(),
    lida: direcao === 'saida'
  });
  // Limita a 200 por canal
  if(global._centralMensagens[canal].length > 200) global._centralMensagens[canal] = global._centralMensagens[canal].slice(-200);
}

async function processarMensagem(ctx, dados) {
  const chatId = String(ctx.chatId);
  await inicializarMemoria(chatId, ctx.threadId);
  const mem = getMem(chatId, ctx.threadId);
  const txt = (dados.texto||'').trim();
  const low = txt.toLowerCase();
  const modo = getModoAgente(chatId);
  if(ctx.canal === 'whatsapp') {
    _estadoWhatsApp.ultima_mensagem = new Date().toISOString();
  }

  console.log('MSG ['+ctx.canal+'/'+chatId+'] modo:'+modo+':', txt.substring(0,80)||'[arquivo]');
  logAtividade('juridico', chatId, txt?'mensagem_'+ctx.canal:'arquivo_'+ctx.canal, txt.substring(0,100));

  // Registrar na Central de Mensagens
  _registrarMsgCentral(ctx.canal, 'entrada', chatId, ctx.nomeUsuario||chatId, txt || (dados.imagem ? '[Foto]' : dados.arquivo ? '[Arquivo: '+(dados.arquivo.nome||'')+']' : dados.audio ? '[Áudio]' : '[?]'));

  // Em grupos do Telegram, só responde se mencionado ou comando
  const isGrupo = ctx.tipoChat==='group' || ctx.tipoChat==='supergroup' || ctx.tipoChat==='channel';
  // FIX-09: toLowerCase() — tolerante a @Lex_Alertas_Bot, @LEX_ALERTAS_BOT etc.
  if(isGrupo && ctx.canal==='telegram' && !(txt.toLowerCase().includes('@lex_alertas_bot') || txt.startsWith('/'))) return;

  // Notifica admin quando cliente novo abre conversa (Telegram OU WhatsApp)
  if(modo === 'cliente' && chatId !== CHAT_ID && mem.hist.length === 0) {
    await envTelegram(`📱 NOVO CONTATO (${ctx.canal})\n\n${ctx.nomeUsuario||chatId} (ID: ${chatId})\n\nPara cadastrar: /liberar ${chatId} cliente ${ctx.nomeUsuario||chatId}`, null, CHAT_ID).catch(()=>{});
  }

  // ── AGENTE CADASTRADOR: desvia CLIENTES (modo='cliente' e não admin) ──
  // Cliente manda imagem/áudio/texto → triagem conversacional do Atendente v2
  if(modo === 'cliente' && chatId !== CHAT_ID) {
    if(dados.audio) {
      const processou = await _cadastradorRecebeu(ctx, 'audio', dados.audio);
      if(processou) return;
    }
    if(dados.imagem) {
      const processou = await _cadastradorRecebeu(ctx, 'imagem', dados.imagem);
      if(processou) return;
    }
    if(txt && !txt.startsWith('/')) {
      const processou = await _cadastradorRecebeu(ctx, 'texto', txt);
      if(processou) return;
    }
    // Se não processou (ex: status='convertido'), cai no fluxo normal abaixo
  }

  // ── ARQUIVO (PDF / DOCX / imagem) ──
  if(dados.arquivo) {
    return await _processarArquivo(ctx, mem, dados.arquivo);
  }
  if(dados.imagem) {
    return await _processarImagem(ctx, mem, dados.imagem);
  }

  if(!txt) return;

  // ── COMANDOS ADMINISTRATIVOS (só Telegram admin) ──
  if(ctx.canal === 'telegram' && chatId === CHAT_ID) {
    if(low.startsWith('/liberar ')) {
      const parts = txt.slice(9).trim().split(' ');
      const [idLib, perfilLib='advogado', ...nomeParts] = parts;
      const nomeLib = nomeParts.join(' ')||idLib;
      USUARIOS[idLib] = {nome:nomeLib, perfil:perfilLib, ok:true, historico:[]};
      const emoji = {admin:'👑',advogado:'⚖️',secretaria:'📋',cliente:'👤'}[perfilLib]||'👤';
      await env('✅ Cadastrado!\n'+emoji+' '+nomeLib+' ('+perfilLib+') ID: '+idLib, ctx);
      return;
    }
    if(low.startsWith('/bloquear ')) {
      const id=txt.slice(10).trim();
      if(USUARIOS[id]) USUARIOS[id].ok=false;
      await env('🔒 '+id+' bloqueado.', ctx);
      return;
    }

    // ── COMANDOS DO AGENTE CADASTRADOR (só admin) ──
    if(low === '/clientes' || low === '/clientes_pendentes') {
      try {
        const rows = await sbGet('clientes_pendentes', {}, { limit: 30, order: 'atualizado_em.desc' });
        if(!rows || !rows.length) { await env('Nenhum cliente pendente.', ctx); return; }
        let m = '📋 CLIENTES PENDENTES ('+rows.length+')\n\n';
        const statusEmoji = {
          iniciando:'🆕', coletando_pessoais:'📝', aguardando_caso_tipo:'❓',
          coletando_probatorios:'📎', pronto_peticao:'🎯', convertido:'✅'
        };
        rows.forEach(c => {
          const e = statusEmoji[c.status] || '•';
          const nome = c.nome || c.nome_usuario_canal || c.chat_id;
          const urg = c.nivel_urgencia==='vermelho'?'🔴':(c.nivel_urgencia==='alta'?'⚠️':'');
          m += `${e} ${nome} ${urg} | ${c.caso_tipo||'?'} | ${c.status}\n   chat:${c.chat_id}\n`;
        });
        m += '\nUse /cliente [chat_id] pra detalhar.';
        await env(m, ctx);
      } catch(e) { await env('Erro: '+e.message, ctx); }
      return;
    }
    if(low.startsWith('/cliente ')) {
      const cid = txt.slice(9).trim();
      try {
        const rows = await sbGet('clientes_pendentes', { chat_id: cid }, { limit: 1 });
        if(!rows || !rows[0]) { await env('Cliente '+cid+' não encontrado.', ctx); return; }
        const c = rows[0];
        const faltam_p = _faltantesPessoais(c);
        const faltam_pr = _faltantesProbatorios(c);
        let m = '👤 '+(c.nome||c.nome_usuario_canal||c.chat_id)+'\n';
        m += 'Canal: '+c.canal+' | Status: '+c.status+'\n';
        m += 'Caso: '+(c.caso_tipo||'indefinido')+'\n\n';
        if(c.cpf) m += 'CPF: '+c.cpf+(c.cpf_valido?' ✓':' ⚠')+'\n';
        if(c.rg) m += 'RG: '+c.rg+'\n';
        if(c.data_nascimento) m += 'Nasc: '+c.data_nascimento+'\n';
        if(c.endereco_rua) m += 'End: '+c.endereco_rua+', '+(c.endereco_numero||'?')+' — '+(c.endereco_cidade||'?')+'/'+(c.endereco_uf||'?')+(c.cep_valido?' CEP '+c.endereco_cep:'')+'\n';
        if(c.telefone) m += 'Tel: '+c.telefone+(c.telefone_valido?' ✓':' ⚠')+'\n';
        if(c.email) m += 'Email: '+c.email+'\n';
        if(c.caso_descricao) m += '\n💬 Descrição: '+c.caso_descricao.substring(0,400)+'\n';
        if((c.documentos_anexos||[]).length) m += '\n📎 Docs: '+c.documentos_anexos.map(d=>d.tipo).join(', ')+'\n';
        if(c.nivel_urgencia && c.nivel_urgencia !== 'normal') m += '\n🚨 Urgência: '+c.nivel_urgencia+(c.alerta_urgencia ? ' — '+c.alerta_urgencia : '')+'\n';
        if((c.perguntas_sugeridas_secretaria||[]).length) m += '\n🧠 Sugestões secretaria: '+c.perguntas_sugeridas_secretaria.slice(0,3).join(' | ')+'\n';
        if(c.ultimo_contato) m += '\n🕒 Último contato: '+c.ultimo_contato+'\n';
        if(faltam_p.length) m += '\n❌ Faltam pessoais: '+faltam_p.join(', ')+'\n';
        if(faltam_pr.length) m += '\n📋 Faltam probatórios: '+faltam_pr.map(p=>p.nome).join(', ')+'\n';
        if((c.campos_verificar||[]).length) m += '\n⚠ Verificar: '+c.campos_verificar.join('; ')+'\n';
        if(c.status === 'pronto_peticao') m += '\n➡ /converter '+c.chat_id+' pra virar processo';
        await env(m, ctx);
      } catch(e) { await env('Erro: '+e.message, ctx); }
      return;
    }
    if(low.startsWith('/converter ')) {
      const cid = txt.slice(11).trim();
      try {
        const rows = await sbGet('clientes_pendentes', { chat_id: cid }, { limit: 1 });
        if(!rows || !rows[0]) { await env('Cliente '+cid+' não encontrado.', ctx); return; }
        const c = rows[0];
        const novo = {
          id: Date.now() + Math.floor(Math.random()*1000),
          nome: c.nome || c.nome_usuario_canal,
          numero: '',
          partes: c.nome+' (autor)',
          area: EXIGENCIAS_POR_CASO[c.caso_tipo]?.nome || c.caso_tipo,
          tribunal: '',
          status: 'EM_PREP',
          prazo: '',
          proxacao: 'Elaborar petição inicial',
          descricao: c.caso_descricao || '',
          andamentos: [{ data: new Date().toLocaleDateString('pt-BR'), txt: 'Cliente cadastrado via Lex Cadastrador. Pronto para petição inicial.' }],
          arquivos: (c.documentos_anexos||[]).map(d=>d.tipo+'.jpg'),
          frentes: [],
          provas: [],
          docsFaltantes: _faltantesProbatorios(c).map(p=>p.nome).join('; '),
          cliente_origem_chat: c.chat_id
        };
        processos.push(novo);
        _bumpProcessos('admin_converter');
        await _persistirProcessosCache();
        await enfileirarComando({acao:'criar_processo', dados:novo});
        c.status = 'convertido';
        await _salvarPerfilCliente(c);
        await env('✅ Cliente convertido em processo:\n📋 '+novo.nome+'\nÁrea: '+novo.area+'\n\nEm preparação no Lex.\nUse /peca '+novo.nome+' pra iniciar redação da inicial.', ctx);
      } catch(e) { await env('Erro: '+e.message, ctx); }
      return;
    }
    if(low.startsWith('/esquecer ')) {
      const cid = txt.slice(10).trim();
      try {
        await sbDelete('clientes_pendentes', { chat_id: cid });
        await env('🗑 Dados do cliente '+cid+' removidos (LGPD).', ctx);
      } catch(e) { await env('Erro: '+e.message, ctx); }
      return;
    }

    // ── AGENTE COBRADOR: /cobrador executa verificação manual ──
    if(low === '/cobrador' || low === '/atrasados') {
      await _executarCobrador(ctx);
      return;
    }
  }

  // ── COMANDOS LIDOS POR QUALQUER CANAL ──
  if(low==='/start' || /^(oi|olá|ola|bom dia|boa tarde|boa noite|hello|hey|opa|salve)[\s!?.,]*$/i.test(txt)) {
    return await _responderCumprimento(ctx, mem, txt);
  }

  // /meuid — mostra o Chat ID do Telegram (necessário pra Central de Mensagens)
  if(low==='/meuid' || low==='/meu_id' || low==='/id') {
    await env('🆔 Seu Chat ID: `' + ctx.chatId + '`\n\n📋 Use este número na Central de Mensagens do Lex para enviar mensagens diretamente pelo painel web.', ctx);
    return;
  }

  // ── /setpix <chave> — Kleuber configura a chave PIX via Telegram/WhatsApp ──
  if(/^\/setpix\s+/i.test(txt) && isAdmin(chatId)) {
    const novaChave = txt.replace(/^\/setpix\s+/i, '').trim();
    if(!novaChave) { await env('Use: /setpix <sua-chave-pix-aleatoria>', ctx); return; }
    _PIX_CONFIG.chave = novaChave;
    // Persiste no Supabase
    try { await sbReq('POST', 'config', { chave: 'pix_chave', valor: novaChave }, {}, { onConflict: 'chave', merge: 'valor' }); } catch(e) {}
    await env('✅ Chave PIX configurada!\n\n🔑 Chave: `' + novaChave + '`\n👤 Beneficiário: ' + _PIX_CONFIG.beneficiario + '\n📱 Celular: ' + _PIX_CONFIG.celular + '\n\nAgora pode usar /cobrar para enviar cobranças pelo WhatsApp.', ctx);
    return;
  }

  // ── /cobrar <nome> | <whatsapp> | <valor> | <referência> ──
  if(/^\/cobrar\s+/i.test(txt) && isAdmin(chatId)) {
    const partes = txt.replace(/^\/cobrar\s+/i, '').split('|').map(s => s.trim());
    if(partes.length < 3) {
      await env('📋 *Como usar o /cobrar:*\n\n`/cobrar Nome do Cliente | 61999991234 | 150.00 | Mensalidade Abril/2026`\n\nSepare com `|` (barra):\n1. Nome do cliente\n2. WhatsApp (com DDD)\n3. Valor em R$\n4. Referência (opcional)', ctx);
      return;
    }
    const [nome, whats, valorStr, ref] = partes;
    const valor = parseFloat((valorStr||'').replace(',','.'));
    if(!nome || !whats || isNaN(valor) || valor <= 0) {
      await env('⚠️ Dados inválidos. Use: /cobrar Nome | WhatsApp | Valor | Referência', ctx);
      return;
    }
    const numLimpo = whats.replace(/\D/g,'');
    const jid = (numLimpo.startsWith('55') ? numLimpo : '55'+numLimpo) + '@s.whatsapp.net';
    await env('📤 Enviando cobrança PIX para ' + nome + '...', ctx);
    const result = await _lexCobrarClienteWhatsApp(nome, jid, valor, ref||null);
    if(result.ok) {
      await env('✅ Cobrança enviada pro ' + nome + '!\n💵 R$ ' + valor.toFixed(2) + '\n📱 WhatsApp: ' + whats, ctx);
    } else {
      await env('❌ Falha: ' + (result.erro||'erro desconhecido'), ctx);
    }
    return;
  }

  if(low==='/prazos') { await env(formatPrazos(getPrazos(15)), ctx); return; }
  if(low==='/status') {
    await env('Lex Bot ativo\nIA: OK\nProcessos: '+processos.length+'\nMemória sessões: '+Object.keys(MEMORIA).length+'\n'+horaBrasilia().toLocaleString('pt-BR'), ctx);
    return;
  }
  if(low==='/fila') {
    const emCurso = _analiseEmCurso ? ('em análise: '+_analiseEmCurso.arq.nome+' ('+Math.floor((Date.now()-_analiseEmCurso.iniciadoEm)/1000)+'s)') : 'ocioso';
    const aguardando = _filaAnalises.length;
    const tokensUsados = _tokensUsadosNaJanela();
    const pctUso = Math.round(tokensUsados / RATE_LIMIT_TOKENS_POR_MIN * 100);
    await env('🔄 Fila: '+emCurso+'\n⏳ Aguardando: '+aguardando+(aguardando?' arquivo(s)':'')+'\n📊 Rate limit Anthropic: '+tokensUsados+' / '+RATE_LIMIT_TOKENS_POR_MIN+' tokens ('+pctUso+'%)', ctx);
    return;
  }
  if(low==='/limpar'||low==='/reset') {
    mem.hist=[]; mem.casoAtual=null; mem.dadosColetados={}; mem.aguardando=null;
    await env('Memória desta conversa limpa.', ctx);
    return;
  }

  if(low==='/processos') {
    if(!processos.length) { await env('Nenhum processo carregado.', ctx); return; }
    let m='PROCESSOS ('+processos.length+')\n\n';
    processos.filter(p=>['URGENTE','ATIVO','EM_PREP'].includes(p.status)).slice(0,12).forEach(p=>{
      const icone=p.status==='URGENTE'?'🔴':p.status==='EM_PREP'?'📋':'🟢';
      m+=icone+' '+p.nome+' — '+(p.tribunal||'—')+(p.prazo?' | '+p.prazo:p.prevDist?' | Prev:'+p.prevDist:'')+'\n';
    });
    await env(m, ctx);
    return;
  }

  if(low.startsWith('/processo ')) {
    const arg = txt.replace(/^\/processo\s*/i, '').trim();
    if(!arg) { await env('Uso: /processo [id, numero ou nome].', ctx); return; }
    const argNorm = arg.toLowerCase();
    const proc = processos.find(p =>
      String(p.id||'') === arg ||
      (p.numero && _normCNJ(p.numero).includes(_normCNJ(arg))) ||
      (p.nome && p.nome.toLowerCase().includes(argNorm))
    );
    if(!proc) {
      await env('❌ Processo "'+arg+'" nao encontrado. Use /processos para ver a lista.', ctx);
      return;
    }
    mem.casoAtual = proc.nome || String(proc.id);
    mem.dadosColetados.processo_ativo = {
      id: proc.id || null,
      nome: proc.nome || '',
      numero: proc.numero || '',
      partes: proc.partes || '',
      area: proc.area || '',
      status: proc.status || '',
      andamentos: proc.andamentos || [],
      docs: proc.arquivos || [],
      juiz: proc.juiz_relator || proc.juiz || ''
    };
    salvarMemoria(ctx.chatId, ctx.threadId);
    const ultAnd = (proc.andamentos||[]).slice(0,3).map(a => '- '+(a.data||'')+' '+(a.txt||'')).join('\n') || '- sem andamentos';
    await env(
      '📂 Processo ativo selecionado: '+(proc.nome||proc.id)+
      (proc.numero ? ' ('+proc.numero+')' : '')+
      '\nArea: '+(proc.area||'nao informada')+
      '\nStatus: '+(proc.status||'nao informado')+
      '\nPartes: '+(proc.partes||'nao informadas')+
      '\nJuiz/Relator: '+(proc.juiz_relator||proc.juiz||'nao informado')+
      '\nDocs: '+((proc.arquivos||[]).length)+
      '\nAndamentos recentes:\n'+ultAnd+
      '\n\nO que deseja fazer com este processo?',
      ctx
    );
    return;
  }

  if(low==='/prep'||low==='/preparacao') {
    const prep=processos.filter(p=>p.status==='EM_PREP'||p.status==='AGUARDANDO_APROVACAO');
    if(!prep.length){await env('Nenhum processo em preparação.', ctx);return;}
    let m='📋 EM PREPARAÇÃO ('+prep.length+')\n\n';
    prep.forEach(p=>{
      const status = p.status==='AGUARDANDO_APROVACAO' ? '⏳ AGUARDANDO APROVAÇÃO' : '📝 Em preparação';
      m+='• '+p.nome+' ['+status+']\nPartes: '+p.partes;
      if(p.prevDist){
        const dias=calcDias(p.prevDist);
        m+='\nPrevisão: '+p.prevDist+(dias!==null?' ('+(dias<=0?'VENCIDA':dias+' dias')+')':'');
      }
      if(p.docsFaltantes) m+='\n⚠ Falta: '+p.docsFaltantes;
      m+='\n\n';
    });
    await env(m, ctx);
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // ── AGENTE CADASTRADOR INTELIGENTE — /novocaso (Telegram + WhatsApp) ──
  // Fluxo: Kleuber manda /novocaso → modo intake → envia fotos/textos/áudios
  //        → /pronto (ou 2min silêncio) → IA lê TUDO → cria caso → lista faltantes
  // ════════════════════════════════════════════════════════════════════════

  // ── Sessões de intake ativas (em memória, por chatId) ──
  if(!global._intakeSessoes) global._intakeSessoes = {};

  // Helper: finalizar intake — processa tudo e cria caso
  async function _finalizarIntake(sessao, ctx) {
    const chatId = sessao.chatId;
    try {
      await env('🔄 *Processando cadastro...*\nAnalisando ' + sessao.imagens.length + ' foto(s), ' + sessao.textos.length + ' mensagem(ns)' + (sessao.arquivos.length ? ', ' + sessao.arquivos.length + ' arquivo(s)' : '') + '...', ctx);

      // 1. Extrair dados de TODAS as imagens com Vision
      const dadosImagens = [];
      for (const img of sessao.imagens) {
        try {
          const extraido = await _extrairDadosImagem(img.buffer, img.mime);
          dadosImagens.push(extraido);
        } catch(e) { dadosImagens.push({ tipo_documento:'erro', observacoes: e.message }); }
      }

      // 2. Montar contexto completo pra IA interpretar
      let contextoCompleto = '=== MENSAGENS DO ANALISTA JURÍDICO (KLEUBER) ===\n';
      sessao.textos.forEach((t,i) => contextoCompleto += (i+1) + '. ' + t + '\n');

      if (dadosImagens.length) {
        contextoCompleto += '\n=== DOCUMENTOS EXTRAÍDOS DAS FOTOS ===\n';
        dadosImagens.forEach((d,i) => {
          contextoCompleto += '\nFoto ' + (i+1) + ': ' + (d.tipo_documento||'?') + ' (confiança: ' + (d.confianca||'?') + ')\n';
          if (d.extraido) {
            Object.entries(d.extraido).forEach(([k,v]) => {
              if (v && v !== '') contextoCompleto += '  ' + k + ': ' + v + '\n';
            });
          }
          if (d.campos_ilegiveis && d.campos_ilegiveis.length) contextoCompleto += '  ⚠ Campos ilegíveis: ' + d.campos_ilegiveis.join(', ') + '\n';
          if (d.observacoes) contextoCompleto += '  📝 ' + d.observacoes + '\n';
        });
      }

      if (sessao.arquivos.length) {
        contextoCompleto += '\n=== ARQUIVOS RECEBIDOS ===\n';
        sessao.arquivos.forEach(a => contextoCompleto += '• ' + a.nome + ' (' + a.mime + ')\n');
      }

      // 3. IA interpreta TUDO e monta o caso
      const systemIntake = `Você é o Agente Cadastrador do escritório Camargos Advocacia — setor de AUTUAÇÃO.
Kleuber Melchior (CEO e Analista Jurídico) está cadastrando um caso novo a partir de fotos e descrições.
A OAB nos processos é de Wanderson Farias de Camargos (OAB/MG 118.237).

DINAMISMO OPERACIONAL — você é um FUNCIONÁRIO ESPECIALISTA, não robô:
- LEIA cada documento/foto com atenção TOTAL. Identifique: quem são as partes, qual o órgão, qual a demanda, qual o valor.
- ENTENDA a natureza real do caso pelo CONTEÚDO, não por palavras-chave superficiais.
- CLASSIFIQUE a área corretamente baseado no que o documento REALMENTE DIZ:
  * Receita Federal, CARF, auto de infração, DARF, multa fiscal = TRIBUTÁRIO (administrativo)
  * INSS, BPC/LOAS, aposentadoria, auxílio-doença, benefício negado = PREVIDENCIÁRIO (judicial)
  * CLT, rescisão, horas extras, FGTS, CTPS = TRABALHISTA (judicial)
  * Contrato, indenização, consumidor, banco, cobrança = CÍVEL (judicial)
  * Divórcio, guarda, pensão, inventário = FAMÍLIA (judicial)
  * Crime, BO, denúncia, lesão corporal = CRIMINAL (judicial)
  * Recurso administrativo, PAD, licitação, servidor público, multa administrativa = ADMINISTRATIVO
- Se Kleuber DISSER que é administrativo/judicial, OBEDEÇA — ele é o CEO.
- Se o documento for de Receita Federal/CARF = TRIBUTÁRIO + tipo ADMINISTRATIVO
- Se o documento for de INSS negando benefício = PREVIDENCIÁRIO + tipo JUDICIAL

Analise TODAS as informações (mensagens + dados extraídos das fotos) e retorne SOMENTE JSON puro:
{
  "nome_cliente": "nome completo do cliente",
  "cpf": "só dígitos ou vazio",
  "rg": "número ou vazio",
  "data_nascimento": "dd/mm/aaaa ou vazio",
  "estado_civil": "",
  "profissao": "",
  "endereco": "endereço completo ou vazio",
  "telefone": "",
  "email": "",
  "nome_caso": "título descritivo pro caso (ex: João Silva - Recurso CARF Multa Fiscal)",
  "tipo_acao": "tipo de ação/recurso (ex: Recurso Administrativo, Mandado de Segurança, Ação Ordinária)",
  "tipo_processo": "administrativo|judicial — BASEADO no conteúdo real do documento e na demanda",
  "area": "Tributário|Previdenciário|Trabalhista|Cível|Família|Criminal|Administrativo",
  "partes": "Autor vs Réu (ex: João Silva vs Receita Federal)",
  "resumo_caso": "resumo COMPLETO do caso: o que aconteceu, qual o problema, o que o cliente quer, qual o valor. 3-5 linhas.",
  "valor_causa_estimado": "se mencionado",
  "urgencia": "normal|urgente|critico",
  "motivo_urgencia": "se urgente, por quê",
  "docs_recebidos": ["lista dos docs que JÁ foram enviados"],
  "docs_faltantes": ["lista dos docs que AINDA FALTAM pra essa área"],
  "observacoes": "qualquer detalhe relevante, campos ilegíveis, alertas",
  "demanda_identificada": "descrição em 1 linha do que o cliente quer resolver"
}

REGRAS:
1. Se um dado aparece na foto E no texto, priorize a foto (mais confiável)
2. Se a foto está borrada/cortada, marque em observacoes e coloque o campo como vazio
3. docs_faltantes: baseie-se na ÁREA do caso — liste os documentos obrigatórios que NÃO foram recebidos
4. Checklist por área:
   - Tributário: RG, CPF/CNPJ, auto de infração/CDA, DARF, comprovante endereço, procuração ECAC, recurso anterior se houver
   - Previdenciário: RG, CPF, comprovante residência, CNIS, carta indeferimento, laudos médicos, CTPS
   - Trabalhista: RG, CPF, CTPS (todas as páginas), holerites, TRCT, comprovante residência
   - Cível: RG, CPF, comprovante residência, contrato/doc do caso, provas (fotos, msgs, etc)
   - Família: RG, CPF, certidão casamento/nascimento, comprovante residência, comprovante renda
   - Criminal: RG, CPF, boletim ocorrência, comprovante residência
   - Administrativo: RG, CPF, ato administrativo impugnado, comprovante residência, recurso administrativo se houver
5. NÃO invente dados — se não tem, deixe vazio
6. LEIA o documento inteiro antes de classificar — não chute a área por uma palavra isolada
7. Se Kleuber disser "processo administrativo" ou "recurso administrativo", o tipo_processo É administrativo`;

      const iaResp = await chamarClaudeTexto(contextoCompleto, systemIntake, 1500);
      let dados = null;
      try {
        const jsonMatch = iaResp.match(/\{[\s\S]*\}/);
        if (jsonMatch) dados = JSON.parse(jsonMatch[0]);
      } catch(e) {}

      if (!dados) {
        await env('❌ Não consegui interpretar os dados. Tente novamente com /novocaso e seja mais específico na descrição.', ctx);
        delete global._intakeSessoes[chatId];
        return;
      }

      // 4. Criar caso no Supabase — Em Preparação
      const ehAdmin = isAdvogado(chatId);
      const novoCaso = {
        nome: dados.nome_caso || dados.nome_cliente || 'Caso sem nome',
        tipo: _normalizarTipoProcesso(dados.tipo_processo || dados.tipo || dados.tipo_acao, dados.area),
        setor: 'autuacao',
        area: dados.area || 'Cível',
        partes: dados.partes || '',
        status: ehAdmin ? 'EM_PREP' : 'AGUARDANDO_APROVACAO',
        resumo: dados.resumo_caso || sessao.textos.join(' '),
        nome_cliente: dados.nome_cliente || '',
        cpf_cliente: dados.cpf || '',
        rg_cliente: dados.rg || '',
        data_nascimento: dados.data_nascimento || '',
        estado_civil: dados.estado_civil || '',
        profissao: dados.profissao || '',
        endereco: dados.endereco || '',
        telefone: dados.telefone || '',
        email: dados.email || '',
        valor_causa: dados.valor_causa_estimado || '',
        urgencia: dados.urgencia || 'normal',
        docs_recebidos: JSON.stringify(dados.docs_recebidos || []),
        docs_faltantes: JSON.stringify(dados.docs_faltantes || []),
        observacoes: dados.observacoes || '',
        demanda: dados.demanda_identificada || '',
        tipo_acao: dados.tipo_acao || '',
        criado_por: ctx.canal + '_' + chatId,
        criado_em: new Date().toISOString(),
        previsao: '',
        numero: ''
      };

      const salvo = await sbReq('POST', 'processos', novoCaso, {}, {'Prefer':'return=representation'});

      if (salvo.ok) {
        const casoId = salvo.body && salvo.body[0] ? salvo.body[0].id : '?';
        const docsRecebidos = dados.docs_recebidos || [];
        const docsFaltantes = dados.docs_faltantes || [];

        // ── AUTO-ADICIONAR NA AGENDA ──
        try {
          const contatoAgenda = {
            nome: dados.nome_cliente || '',
            telefone: dados.telefone || '',
            cpf: dados.cpf || '',
            email: dados.email || '',
            processo_id: casoId,
            processo_nome: dados.tipo_acao || novoCaso.nome || '',
            obs: 'Cadastrado via /novocaso em ' + _agoraBrasilia(),
            criado_em: _agoraIso()
          };
          // Salva no Supabase tabela contatos
          await sbReq('POST', 'contatos', contatoAgenda, {}, { onConflict: 'telefone', merge: 'nome,cpf,email,processo_id,processo_nome,obs' }).catch(()=>{});
        } catch(e) { console.warn('[Agenda] Erro ao salvar contato:', e.message); }

        // 5. Mensagem de confirmação completa
        let msg = '✅ *CASO CADASTRADO COM SUCESSO!* (#' + casoId + ')\n\n';
        msg += '👤 *Cliente:* ' + (dados.nome_cliente || '—') + '\n';
        if (dados.cpf) msg += '📄 CPF: ' + dados.cpf + '\n';
        if (dados.rg) msg += '🪪 RG: ' + dados.rg + '\n';
        if (dados.telefone) msg += '📱 Tel: ' + dados.telefone + '\n';
        msg += '\n⚖ *Caso:* ' + (dados.tipo_acao || '—') + '\n';
        msg += '📁 *Área:* ' + (dados.area || '—') + '\n';
        msg += '👥 *Partes:* ' + (dados.partes || '—') + '\n';
        if (dados.urgencia && dados.urgencia !== 'normal') msg += '🚨 *URGÊNCIA:* ' + dados.urgencia.toUpperCase() + ' — ' + (dados.motivo_urgencia||'') + '\n';
        msg += '\n📝 *Resumo:*\n' + (dados.resumo_caso || '—') + '\n';

        if (docsRecebidos.length) {
          msg += '\n✅ *Docs recebidos (' + docsRecebidos.length + '):*\n';
          docsRecebidos.forEach(d => msg += '  ✓ ' + d + '\n');
        }

        if (docsFaltantes.length) {
          msg += '\n⚠ *DOCS QUE AINDA FALTAM (' + docsFaltantes.length + '):*\n';
          docsFaltantes.forEach(d => msg += '  ❌ ' + d + '\n');
          msg += '\n💡 _Envie os documentos faltantes a qualquer momento — o Lex atualiza automaticamente._';
        } else {
          msg += '\n🎯 *Todos os documentos principais recebidos!*';
        }

        if (dados.observacoes) msg += '\n\n📌 *Obs:* ' + dados.observacoes;

        msg += '\n\n' + (ehAdmin ? '✅ Status: EM PREPARAÇÃO' : '⏳ Status: AGUARDANDO APROVAÇÃO DO CEO');

        await env(msg, ctx);

        // 6. Se não é admin, notificar CEO pra aprovar
        if (!ehAdmin) {
          const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || CHAT_ID;
          if (adminChatId) {
            let notif = '🔔 *NOVO CASO PARA APROVAR*\n\n';
            notif += '👤 ' + (dados.nome_cliente||'?') + '\n';
            notif += '⚖ ' + (dados.tipo_acao||'?') + ' (' + (dados.area||'?') + ')\n';
            notif += '👥 ' + (dados.partes||'?') + '\n';
            notif += '📝 ' + (dados.resumo_caso||'').substring(0,200) + '\n';
            notif += '\nCriado por: ' + ctx.canal + ' (' + (ctx.nomeUsuario||chatId) + ')\n';
            notif += '\n/aprovar\\_' + casoId + ' — Aprovar\n/rejeitar\\_' + casoId + ' — Rejeitar\n/detalhes\\_' + casoId + ' — Ver completo';
            try { await envTelegram(notif, null, adminChatId); } catch(e) { console.warn('[Lex] Erro notificando CEO:', e.message); }
          }
        }

        // 7. Logar atividade
        logAtividade('juridico', chatId, 'caso_criado_intake', dados.nome_caso || dados.nome_cliente || 'caso').catch(()=>{});

      } else {
        await env('❌ Erro ao salvar: ' + (salvo.erro || 'erro desconhecido') + '\n\nTente novamente com /novocaso', ctx);
      }

    } catch(e) {
      await env('❌ Erro no agente cadastrador: ' + (e.message || e), ctx);
    }
    delete global._intakeSessoes[chatId];
  }

  // ── Se está em modo intake, acumular dados ──
  if(global._intakeSessoes[String(ctx.chatId)]) {
    const sessao = global._intakeSessoes[String(ctx.chatId)];
    
    // /cancelar — sai do modo intake
    if(low === '/cancelar' || low === 'cancelar') {
      delete global._intakeSessoes[String(ctx.chatId)];
      await env('❌ Cadastro cancelado.', ctx);
      return;
    }

    // /pronto — finaliza e processa
    if(low === '/pronto' || low === 'pronto' || low === '/cadastrar' || low === 'cadastrar') {
      if(sessao.imagens.length === 0 && sessao.textos.length === 0) {
        await env('⚠ Nenhum dado recebido ainda. Envie fotos dos documentos e/ou descreva o caso antes de finalizar.', ctx);
        return;
      }
      clearTimeout(sessao._timeout);
      await _finalizarIntake(sessao, ctx);
      return;
    }

    // Acumular imagem
    if(dados.imagem) {
      sessao.imagens.push(dados.imagem);
      const n = sessao.imagens.length;
      await env('📸 Foto ' + n + ' recebida! Continue enviando ou digite /pronto quando terminar.', ctx);
      // Reset timer de 2min
      clearTimeout(sessao._timeout);
      sessao._timeout = setTimeout(() => {
        _finalizarIntake(sessao, ctx).catch(e => console.warn('[Lex] Auto-intake erro:', e.message));
      }, 120000);
      return;
    }

    // Acumular arquivo (PDF, DOCX)
    if(dados.arquivo) {
      sessao.arquivos.push({ buffer: dados.arquivo.buffer, nome: dados.arquivo.nome, mime: dados.arquivo.mime });
      await env('📎 Arquivo "' + dados.arquivo.nome + '" recebido! Continue ou /pronto.', ctx);
      clearTimeout(sessao._timeout);
      sessao._timeout = setTimeout(() => {
        _finalizarIntake(sessao, ctx).catch(e => console.warn('[Lex] Auto-intake erro:', e.message));
      }, 120000);
      return;
    }

    // Acumular áudio
    if(dados.audio) {
      sessao.textos.push('[ÁUDIO RECEBIDO — transcrição pendente]');
      await env('🎙 Áudio recebido! Continue enviando ou /pronto.', ctx);
      clearTimeout(sessao._timeout);
      sessao._timeout = setTimeout(() => {
        _finalizarIntake(sessao, ctx).catch(e => console.warn('[Lex] Auto-intake erro:', e.message));
      }, 120000);
      return;
    }

    // Acumular texto
    if(txt) {
      sessao.textos.push(txt);
      // Se é uma mensagem curta tipo "pronto", "ok", "é isso" — finaliza
      if(/^(é isso|só isso|tá bom|ta bom|feito|fim|ok|enviei tudo|é só|so isso)$/i.test(txt.trim())) {
        clearTimeout(sessao._timeout);
        await _finalizarIntake(sessao, ctx);
        return;
      }
      await env('📝 Anotado. Continue enviando fotos/docs ou /pronto quando terminar.', ctx);
      clearTimeout(sessao._timeout);
      sessao._timeout = setTimeout(() => {
        _finalizarIntake(sessao, ctx).catch(e => console.warn('[Lex] Auto-intake erro:', e.message));
      }, 120000);
      return;
    }
    return;
  }

  // ── NOVO CASO — /novocaso entra em modo intake ──
  if(low.startsWith('/novocaso')) {
    if(!isEquipe(ctx.chatId)) {
      await env('🔒 Apenas equipe do escritório pode cadastrar casos.', ctx);
      return;
    }
    const descInicial = txt.replace(/^\/novocaso\s*/i, '').trim();
    
    // Cria sessão de intake
    const sessao = {
      chatId: String(ctx.chatId),
      canal: ctx.canal,
      nomeUsuario: ctx.nomeUsuario,
      textos: descInicial ? [descInicial] : [],
      imagens: [],
      arquivos: [],
      criadoEm: new Date().toISOString(),
      _timeout: null
    };

    // Se já veio com imagem junto
    if(dados.imagem) sessao.imagens.push(dados.imagem);
    if(dados.arquivo) sessao.arquivos.push({ buffer: dados.arquivo.buffer, nome: dados.arquivo.nome, mime: dados.arquivo.mime });

    global._intakeSessoes[String(ctx.chatId)] = sessao;

    // Timer de 2min — se ficar em silêncio, finaliza automaticamente
    sessao._timeout = setTimeout(() => {
      _finalizarIntake(sessao, ctx).catch(e => console.warn('[Lex] Auto-intake erro:', e.message));
    }, 120000);

    let bemVindo = '📋 *MODO CADASTRO ATIVADO*\n\n';
    bemVindo += '📸 Envie as fotos dos documentos do cliente\n';
    bemVindo += '📎 Envie PDFs, contratos, laudos\n';
    bemVindo += '💬 Descreva o caso por texto ou áudio\n';
    bemVindo += '🎙 Pode mandar áudio explicando\n\n';
    bemVindo += 'Quando terminar:\n';
    bemVindo += '• Digite /pronto ou "pronto"\n';
    bemVindo += '• Ou aguarde 2 min — cadastro automático\n\n';
    bemVindo += '❌ /cancelar para desistir';
    if(descInicial) bemVindo += '\n\n✅ Descrição inicial recebida: "' + descInicial.substring(0,100) + '"';
    if(dados.imagem) bemVindo += '\n📸 1 foto já recebida!';
    
    await env(bemVindo, ctx);
    return;
  }
  
  // ── APROVAR/REJEITAR/DETALHES caso — /aprovar_ID, /rejeitar_ID, /detalhes_ID ──
  if(low.startsWith('/aprovar_') || low.startsWith('/rejeitar_') || low.startsWith('/detalhes_')) {
    if(!isAdvogado(ctx.chatId)) {
      await env('🔒 Apenas o CEO/admin pode gerenciar casos.', ctx);
      return;
    }
    const casoId = low.replace(/^\/(aprovar|rejeitar|detalhes)_/, '').trim();

    // /detalhes — mostra info completa do caso
    if(low.startsWith('/detalhes_')) {
      try {
        const rows = await sbGet('processos', {id: 'eq.' + casoId}, {limit:1});
        if(rows && rows[0]) {
          const c = rows[0];
          let d = '📋 *DETALHES DO CASO #' + casoId + '*\n\n';
          d += '👤 Cliente: ' + (c.nome_cliente||c.nome||'—') + '\n';
          if(c.cpf_cliente) d += '📄 CPF: ' + c.cpf_cliente + '\n';
          if(c.rg_cliente) d += '🪪 RG: ' + c.rg_cliente + '\n';
          if(c.telefone) d += '📱 Tel: ' + c.telefone + '\n';
          if(c.email) d += '📧 Email: ' + c.email + '\n';
          if(c.endereco) d += '📍 End: ' + c.endereco + '\n';
          d += '\n⚖ Tipo: ' + (c.tipo||'—') + '\n';
          d += '📁 Área: ' + (c.area||'—') + '\n';
          d += '👥 Partes: ' + (c.partes||'—') + '\n';
          d += '🔖 Status: ' + (c.status||'—') + '\n';
          if(c.urgencia && c.urgencia !== 'normal') d += '🚨 Urgência: ' + c.urgencia + '\n';
          d += '\n📝 Resumo:\n' + (c.resumo||'—') + '\n';
          try {
            const docsR = JSON.parse(c.docs_recebidos||'[]');
            const docsF = JSON.parse(c.docs_faltantes||'[]');
            if(docsR.length) { d += '\n✅ Recebidos: ' + docsR.join(', '); }
            if(docsF.length) { d += '\n❌ Faltantes: ' + docsF.join(', '); }
          } catch(e){}
          if(c.observacoes) d += '\n📌 Obs: ' + c.observacoes;
          d += '\n\nCriado: ' + (c.criado_em||'?') + ' por ' + (c.criado_por||'?');
          if(c.status === 'AGUARDANDO_APROVACAO') {
            d += '\n\n/aprovar\\_' + casoId + ' — Aprovar\n/rejeitar\\_' + casoId + ' — Rejeitar';
          }
          await env(d, ctx);
        } else {
          await env('⚠ Caso #' + casoId + ' não encontrado.', ctx);
        }
      } catch(e) { await env('❌ Erro: ' + e.message, ctx); }
      return;
    }

    const aprovar = low.startsWith('/aprovar_');
    const novoStatus = aprovar ? 'EM_PREP' : 'ARQUIVADO';
    
    const r = await sbReq('PATCH', 'processos', {status: novoStatus}, {id: 'eq.' + casoId});
    if (r.ok) {
      await env(aprovar 
        ? '✅ Caso #' + casoId + ' APROVADO — movido para Em Preparação.' 
        : '❌ Caso #' + casoId + ' REJEITADO — arquivado.', ctx);
    } else {
      await env('⚠ Erro ao atualizar caso: ' + (r.erro || 'erro'), ctx);
    }
    return;
  }

  // ── ASSESSOR JURÍDICO SÊNIOR — comando /peca ──
  if(low.startsWith('/peca') || low.startsWith('/peça')) {
    if(!isAdvogado(ctx.chatId)) {
      await env('🔒 Comando /peca restrito a advogados/administradores.', ctx);
      return;
    }
    const arg = txt.replace(/^\/pe[çc]a\s*/i, '').trim();
    if(!arg) {
      await env('Uso: /peca [nome ou número do processo]\n\nEx: /peca Varejão\n\nDepois vou perguntar se vai analisar decisão, petição adversa, ou pedido livre.', ctx);
      return;
    }
    // Tenta localizar o processo
    const norm = arg.toLowerCase();
    const procEncontrado = processos.find(p =>
      p.nome.toLowerCase().includes(norm) ||
      (p.numero && _normCNJ(p.numero).includes(_normCNJ(arg)))
    );
    if(!procEncontrado) {
      await env('❌ Processo "'+arg+'" não encontrado. Use /processos para ver a lista.', ctx);
      return;
    }
    mem.aguardando = 'assessor_tipo_conteudo';
    mem.dadosColetados.assessorProcId = procEncontrado.id;
    salvarMemoria(ctx.chatId, ctx.threadId);
    await env('📂 Processo: '+procEncontrado.nome+(procEncontrado.numero?' ('+procEncontrado.numero+')':'')+
      '\nTribunal: '+(procEncontrado.tribunal||'—')+
      '\n\nSobre o que vamos trabalhar? Responda:\n'+
      '• "decisao" ou cola o texto da decisão → analiso e proponho peça\n'+
      '• "adversa" ou cola a peça adversa → analiso e proponho resposta\n'+
      '• Ou descreva livremente o que precisa (ex: "preciso de ED na omissão sobre X")', ctx);
    return;
  }

  // ── PERÍCIA CONTÁBIL — comando /pericia ──
  if(low.startsWith('/pericia') || low.startsWith('/perícia')) {
    if(!isAdvogado(ctx.chatId)) {
      await env('🔒 Comando /pericia restrito a advogados/administradores.', ctx);
      return;
    }
    const arg = txt.replace(/^\/per[ií]cia\s*/i, '').trim();
    if(!arg) {
      await env('Uso: /pericia [descrição do caso pericial]\n\nEx: /pericia Cálculo de indenização trabalhista com juros compostos\n\nPosso também usar dados de processo: /pericia proc:Varejão descrição', ctx);
      return;
    }
    // Detecta referência a processo
    let proc = null;
    const mProc = arg.match(/^proc:([^\s]+)\s+(.*)$/i);
    let instrucoes = arg;
    if(mProc) {
      const nomeProc = mProc[1];
      instrucoes = mProc[2];
      proc = processos.find(p => p.nome.toLowerCase().includes(nomeProc.toLowerCase()));
    }
    // Chama o módulo pericial (sem cálculos por enquanto — Kleuber fornece via /calc)
    await _assessorPerical(ctx, mem, proc, instrucoes, null);
    return;
  }

  // ── CALCULADORA DETERMINÍSTICA — comando /calc ──
  if(low.startsWith('/calc')) {
    const arg = txt.replace(/^\/calc\s*/i, '').trim();
    if(!arg) {
      await env('Calculadora determinística (sem LLM, resultado exato):\n\n'+
        '/calc simples C=10000 i=1 n=12  → juros simples (C=capital, i=taxa% mensal, n=meses)\n'+
        '/calc composto C=10000 i=1 n=12 → juros compostos\n'+
        '/calc corrige V=5000 idx=15.7   → corrige valor por índice acumulado %\n\n'+
        'Ex: /calc composto C=50000 i=0.5 n=24', ctx);
      return;
    }
    try {
      const parse = (s, k) => { const m = s.match(new RegExp(k+'=([\\-0-9.,]+)')); return m ? parseFloat(m[1].replace(',','.')) : null; };
      const c = parse(arg,'C'), i = parse(arg,'i'), n = parse(arg,'n'), v = parse(arg,'V'), idx = parse(arg,'idx');
      let r;
      if(/^simples/i.test(arg) && c!==null && i!==null && n!==null) {
        r = _calc.jurosSimples(c, i, n);
        await env('📊 JUROS SIMPLES (det.)\n\nCapital: '+_fmtBRL(r.capital)+'\nTaxa: '+r.taxa+'% mensal\nPeríodo: '+r.meses+' meses\n─────\nJuros: '+_fmtBRL(r.juros)+'\nTotal: '+_fmtBRL(r.total), ctx);
      } else if(/^composto/i.test(arg) && c!==null && i!==null && n!==null) {
        r = _calc.jurosCompostos(c, i, n);
        await env('📊 JUROS COMPOSTOS (det.)\n\nCapital: '+_fmtBRL(r.capital)+'\nTaxa: '+r.taxa+'% mensal\nPeríodo: '+r.meses+' meses\n─────\nJuros: '+_fmtBRL(r.juros)+'\nMontante: '+_fmtBRL(r.montante), ctx);
      } else if(/^corrige/i.test(arg) && v!==null && idx!==null) {
        r = _calc.corrigir(v, idx);
        await env('📊 CORREÇÃO MONETÁRIA (det.)\n\nOriginal: '+_fmtBRL(r.original)+'\nÍndice acumulado: '+r.indice+'%\n─────\nCorreção: '+_fmtBRL(r.correcao)+'\nCorrigido: '+_fmtBRL(r.corrigido), ctx);
      } else {
        await env('Formato inválido. Use /calc sem argumentos pra ver exemplos.', ctx);
      }
    } catch(e) {
      await env('❌ Erro no cálculo: '+e.message, ctx);
    }
    return;
  }

  // ── RED TEAM — auto-crítica adversarial ──
  if(low.startsWith('/redteam') || low.startsWith('/red_team')) {
    if(!isAdvogado(ctx.chatId)) {
      await env('🔒 Comando /redteam restrito a advogados/administradores.', ctx);
      return;
    }
    const arg = txt.replace(/^\/red_?team\s*/i, '').trim();
    if(!arg) {
      await env('Uso: /redteam [cole aqui o texto da peça]\n\nVou fazer análise adversarial — o que a parte contrária atacaria.', ctx);
      return;
    }
    // Se tiver processo atual na memória, passa como contexto
    const proc = mem.casoAtual ? processos.find(p=>p.nome===mem.casoAtual) : null;
    await _assessorRedTeam(ctx, arg, proc);
    return;
  }

  if(low==='/ajuda'||low==='/help') {
    let m='COMANDOS PRINCIPAIS\n\n'+
      '📋 /processos — lista\n'+
      '📅 /prazos — prazos críticos\n'+
      '📋 /prep — em preparação\n'+
      '🔄 /status | /fila — status do sistema\n'+
      '🧹 /limpar — reset memória da conversa\n\n'+
      'ASSESSOR JURÍDICO SÊNIOR\n\n'+
      '⚖ /peca [processo] — debate estratégico + redação de peça\n'+
      '🧮 /pericia [descrição] — laudo pericial contábil estruturado\n'+
      '📊 /calc [tipo] [params] — calculadora determinística (juros, correção)\n'+
      '🎯 /redteam [texto peça] — análise adversarial\n\n'+
      'Envie PDF/DOCX/imagem para análise automática.\n'+
      'Processos grandes (500+ páginas) são divididos automaticamente.\n\n'+
      'Cumprimento de prazo: "Cumpri varejão", "Protocolei nathalia"\n'+
      'Ou converse livremente.';
    await env(m, ctx);
    return;
  }

  // ── CUMPRIMENTO DE PRAZO ──
  const palavrasCumprimento = ['cumpri','cumprido','cumpriu','protocolei','protocolo feito','peticionei','petição feita','recurso protocolado','juntei','juntada feita','já fiz','foi feito','foi protocolado','foi enviado','enviamos','distribuí','distribuido'];
  if(palavrasCumprimento.some(p=>low.includes(p)) && processos.length > 0) {
    return await _registrarCumprimento(ctx, mem, txt);
  }

  // ── COMANDOS DE CONTROLE (só advogado/admin, em qualquer canal) ──
  if(isAdvogado(chatId)) {
    const consumido = await _comandosControle(ctx, mem, txt, low);
    if(consumido) return;
  }

  // ── TRIAGEM / CONVERSA INTELIGENTE ──
  return await _conversaInteligente(ctx, mem, txt, low);
}

// ── handlers internos da pipeline ──
async function _responderCumprimento(ctx, mem, txt) {
  const urg = getPrazos(3).filter(a=>a.dias<=3);
  const hora = horaBrasilia().getHours();
  const periodo = hora<12?'manhã':hora<18?'tarde':'noite';
  let ctxPrazos = '';
  if(urg.length) ctxPrazos = '\nPRAZOS URGENTES: '+urg.map(a=>(a.dias<=0?'VENCIDO: ':a.dias+'d: ')+a.nome).join(', ');

  const sys = getSistema(ctx.chatId, mem) + `

CUMPRIMENTO RECEBIDO. Responda naturalmente para o período (${periodo}). Se houver prazo urgente acima, mencione em 1 linha. Senão, responda e AGUARDE. Máximo 2-3 linhas.${ctxPrazos}`;

  try {
    const resp = await ia([{role:'user', content:txt||'oi'}], sys, 200);
    mem.hist.push({role:'user', content:txt||'oi'});
    mem.hist.push({role:'assistant', content:resp});
    salvarMemoria(ctx.chatId, ctx.threadId);
    await env(resp, ctx);
  } catch(e) {
    await env('Erro IA: '+e.message, ctx);
  }
}

async function _registrarCumprimento(ctx, mem, txt) {
  const procMenc = processos.find(p=>
    txt.toLowerCase().includes(p.nome.toLowerCase().substring(0,8)) ||
    (p.numero && txt.includes(p.numero.substring(0,10)))
  );
  if(!procMenc) {
    await env('Registrado. Para atualizar o processo correto, me diz o nome:\nEx: "Cumpri o prazo do Varejão"', ctx);
    return;
  }
  const hoje = horaBrasilia().toLocaleDateString('pt-BR');
  const idx = processos.findIndex(x=>x.id===procMenc.id);
  if(idx<0) return;
  const prazoAnterior = processos[idx].prazo||'';
  processos[idx].prazo=''; processos[idx].prazoReal='';
  if(!processos[idx].andamentos) processos[idx].andamentos=[];
  processos[idx].andamentos.unshift({data:hoje, txt:'Cumprido — '+(prazoAnterior?'prazo era '+prazoAnterior+' — ':'')+txt.substring(0,200)});
  _bumpProcessos(ctx.canal+':'+ctx.chatId);
  await _persistirProcessosCache();
  await lembrarDoCaso(procMenc.nome, 'andamento', 'Cumprido em '+hoje+(prazoAnterior?' (prazo era '+prazoAnterior+')':'')+': '+txt.substring(0,200), ctx.canal);
  await enfileirarComando({acao:'editar_processo', id:procMenc.id, nome:procMenc.nome, dados:{prazo:'', prazoReal:''}});
  logAtividade('juridico', ctx.chatId, 'prazo_cumprido', procMenc.nome+' — '+hoje);
  mem.aguardando='pdf_peticao';
  mem.dadosColetados.processoAguardandoPdf=procMenc.id;
  mem.dadosColetados.processoPdfNome=procMenc.nome;
  salvarMemoria(ctx.chatId, ctx.threadId);
  await env('✅ Registrado — prazo limpo.\n\nProcesso: '+procMenc.nome+'\nData: '+hoje+'\n\nMe manda o PDF da petição quando puder — não esqueço.', ctx);
}

// ═══════════════ INTERCEPTOR INTELIGENTE — Entende linguagem natural sobre processos ═══════════════
async function _detectarIntencaoProcesso(txt, ctx, mem) {
  const txtLow = txt.toLowerCase();
  const palavrasChave = ['processo','andamento','decisão','decisao','publicação','publicacao','julgamento','audiência','audiencia','intimação','intimacao','sentença','sentenca','despacho','recurso','embargo','prazo','atualiza','cadastr','status','urgente','ganho','perdido','arquiv'];
  const temContexto = palavrasChave.some(p => txtLow.includes(p));
  if(!temContexto) return false;
  
  const listaProcs = processos.slice(0,30).map(p => 
    'ID:'+p.id+' | '+p.nome+' | '+p.numero+' | '+(p.cliente||'')+' | Status:'+(p.status||'—')+' | Prazo:'+(p.prazo||'—')
  ).join('\n');
  
  const system = [
    'Você é o Lex, gestor inteligente do escritório Camargos Advocacia.',
    'O CEO Kleuber mandou uma mensagem. Analise se ele quer atualizar, consultar ou agir sobre algum processo.',
    '',
    'PROCESSOS CADASTRADOS:',
    listaProcs || '(nenhum)',
    '',
    'AÇÕES DISPONÍVEIS:',
    '1. ATUALIZAR campo de processo: [ATUALIZAR:id:campo:valor] (campos: status, prazo, juiz, vara, proxacao, observacoes, setor)',
    '2. ADICIONAR andamento: [ANDAMENTO:id:descricao]',
    '3. ADICIONAR prazo: [PRAZO:id:descricao:YYYY-MM-DD:tipo] (tipos: conferencia, julgamento, audiencia, recurso, prazo_fatal)',
    '4. PERGUNTAR se não ficou claro o que ele quer',
    '',
    'REGRAS:',
    '- Identifique o processo pelo nome, número, cliente ou contexto.',
    '- Se encontrou o processo E entendeu a ação: EXECUTE imediatamente com os marcadores + confirme em 1-2 linhas.',
    '- Se encontrou o processo MAS não sabe qual ação: pergunte objetivamente "O que você quer que eu faça no processo X? (atualizar status, registrar andamento, novo prazo...)"',
    '- Se NÃO encontrou o processo: diga qual processo e liste os mais parecidos.',
    '- Cada atualização/andamento gera prazo automático de 5 dias pra conferência.',
    '- EXCEÇÃO: julgamento/audiência — o prazo é a data do julgamento, sem os 5 dias.',
    '- Seja DIRETO, curto, objetivo. Não enrole.',
    '',
    'Responda como o Lex (profissional, direto, confiante).'
  ].join('\n');
  
  try {
    const respIA = await ia([{role:'user', content: txt}], system, 900);
    const acoes = await _processarMarcadoresChat(respIA, 'admin');
    let msgLimpa = respIA.replace(/\[(ATUALIZAR|ANDAMENTO|PRAZO):[^\]]+\]/g, '').trim();
    
    if(acoes.length > 0) {
      const resumoAcoes = acoes.map(a => {
        if(a.tipo==='atualizar') return '✅ '+a.campo+' → '+a.valor;
        if(a.tipo==='andamento') return '✅ Andamento registrado';
        if(a.tipo==='prazo') return '📅 Prazo: '+a.descricao+' — '+a.data;
        if(a.tipo==='prazo_auto') return '⏰ Conferência em 5 dias';
        return '';
      }).filter(Boolean).join('\n');
      msgLimpa = msgLimpa + (msgLimpa ? '\n\n' : '') + resumoAcoes;
    }
    
    if(msgLimpa) {
      await env(msgLimpa, ctx);
      return true;
    }
  } catch(e) {
    console.warn('[Lex] Interceptor inteligente falhou:', e.message);
  }
  return false;
}

async function _comandosControle(ctx, mem, txt, low) {
  const matchAnd = txt.match(/^andamento\s+(.+?):\s*(.+)$/i);
  if(matchAnd) {
    const nomeBusca=matchAnd[1].trim(), textoAnd=matchAnd[2].trim();
    const proc=processos.find(p=>p.nome.toLowerCase().includes(nomeBusca.toLowerCase()));
    if(proc) {
      if(!proc.andamentos) proc.andamentos=[];
      proc.andamentos.unshift({data:horaBrasilia().toLocaleDateString('pt-BR'), txt:textoAnd});
      _bumpProcessos(ctx.canal+':'+ctx.chatId);
      await _persistirProcessosCache();
      await lembrarDoCaso(proc.nome, 'andamento', textoAnd, ctx.canal);
      await enfileirarComando({acao:'add_andamento', id:proc.id, nome:proc.nome, andamento:textoAnd});
      logAtividade('juridico', ctx.chatId, 'andamento_adicionado', proc.nome);
      await env('✅ Andamento em '+proc.nome+':\n'+textoAnd, ctx);
    } else { await env('Processo "'+nomeBusca+'" não encontrado.', ctx); }
    return true;
  }
  // prazo [nome] [dd/mm/aaaa]
  const matchPrazo = txt.match(/^prazo\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})$/i);
  if(matchPrazo) {
    const nomeBusca=matchPrazo[1].trim(), novoPrazo=matchPrazo[2];
    const proc=processos.find(p=>p.nome.toLowerCase().includes(nomeBusca.toLowerCase()));
    if(proc) {
      proc.prazo=novoPrazo;
      _bumpProcessos(ctx.canal+':'+ctx.chatId);
      await _persistirProcessosCache();
      await lembrarDoCaso(proc.nome, 'observacao', 'Prazo atualizado para '+novoPrazo, ctx.canal);
      await enfileirarComando({acao:'atualizar_prazo', id:proc.id, nome:proc.nome, prazo:novoPrazo});
      logAtividade('juridico', ctx.chatId, 'prazo_atualizado', proc.nome+'→'+novoPrazo);
      await env('✅ Prazo: '+proc.nome+' → '+novoPrazo, ctx);
    } else { await env('Processo "'+nomeBusca+'" não encontrado.', ctx); }
    return true;
  }
  // status [nome] [valor]
  const matchSt = txt.match(/^status\s+(.+?)\s+(urgente|ativo|recursal|aguardando|ganho|perdido|arquivado|em_prep)$/i);
  if(matchSt) {
    const nomeBusca=matchSt[1].trim(), novoSt=matchSt[2].toUpperCase();
    const proc=processos.find(p=>p.nome.toLowerCase().includes(nomeBusca.toLowerCase()));
    if(proc) {
      proc.status=novoSt;
      _bumpProcessos(ctx.canal+':'+ctx.chatId);
      await _persistirProcessosCache();
      await enfileirarComando({acao:'editar_processo', id:proc.id, nome:proc.nome, dados:{status:novoSt}});
      await env('✅ Status: '+proc.nome+' → '+novoSt, ctx);
    } else { await env('Processo não encontrado.', ctx); }
    return true;
  }
  return false;
}

async function _conversaInteligente(ctx, mem, txt, low) {
  // ── INTERCEPTOR INTELIGENTE: detecta intenção de atualizar processo em linguagem natural ──
  // Funciona em TODOS os canais: Telegram, WhatsApp, Painel
  const ehAdmin = isAdmin(ctx.chatId) || _isOperadorWhatsApp(_numeroPlanoWhats(ctx.chatId));
  if(!mem.aguardando && ehAdmin) {
    const intentResult = await _detectarIntencaoProcesso(txt, ctx, mem);
    if(intentResult) return;
  }

  // ── HANDLER ASSESSOR — tipo de conteúdo (decisão / adversa / livre) ──
  if(mem.aguardando === 'assessor_tipo_conteudo' && mem.dadosColetados?.assessorProcId) {
    const proc = processos.find(p => p.id === mem.dadosColetados.assessorProcId);
    if(!proc) {
      mem.aguardando = null;
      delete mem.dadosColetados.assessorProcId;
      await env('❌ Processo não encontrado mais. Tente /peca novamente.', ctx);
      return;
    }
    const trim = txt.trim();
    const lc = trim.toLowerCase();
    let tipoConteudo, conteudo;
    if(lc === 'decisao' || lc === 'decisão') {
      tipoConteudo = 'decisao';
      // Usa o último andamento + descrição como "decisão"
      const ultimoAnd = (proc.andamentos||[])[0];
      conteudo = ultimoAnd ? ('Último andamento: '+ultimoAnd.data+' - '+ultimoAnd.txt+'\n\nDescrição do caso: '+(proc.descricao||'')) : (proc.descricao||'(sem conteúdo direto)');
    } else if(lc === 'adversa' || lc.includes('peça adversa') || lc.includes('peca adversa')) {
      tipoConteudo = 'peca_adversa';
      conteudo = '(Kleuber vai colar a peça adversa na próxima mensagem ou já está em algum PDF analisado)';
    } else {
      // Descrição livre de Kleuber
      tipoConteudo = 'pedido_livre';
      conteudo = trim;
    }
    mem.aguardando = null; // o _assessorDiagnostico vai setar o próximo
    await _assessorDiagnostico(ctx, mem, proc, conteudo, tipoConteudo);
    return;
  }

  if(!mem.aguardando && mem.dadosColetados?.processo_ativo) {
    const procAtivo = mem.dadosColetados.processo_ativo;
    const promptCtx = 'Contexto do processo ativo: '+(procAtivo.nome||procAtivo.id||'')+
      (procAtivo.numero ? ' ('+procAtivo.numero+')' : '')+
      '. Area: '+(procAtivo.area||'')+
      '. Status: '+(procAtivo.status||'')+
      '. Partes: '+(procAtivo.partes||'')+
      '. Juiz: '+(procAtivo.juiz||'')+'.';
    const resposta = await ia(
      [{ role:'user', content: promptCtx+'\n\nSolicitacao da secretaria/advogado: '+txt+'\n\nResponda de forma objetiva e tecnica, no contexto deste processo.' }],
      null,
      900
    );
    // Processa marcadores de atualização na resposta
    await _processarMarcadoresChat(resposta, validarToken(getToken({headers:ctx.headers||{}}))||'assessor').catch(()=>{});
    await env(resposta, ctx);
    return;
  }

  // ── HANDLER ASSESSOR — estratégia (Kleuber escolhe direção após diagnóstico) ──
  if(mem.aguardando === 'assessor_estrategia' && mem.dadosColetados?.assessorDiagnostico) {
    const trim = txt.trim();
    if(/^(cancel|cancela|parar|sair)/i.test(trim)) {
      mem.aguardando = null;
      delete mem.dadosColetados.assessorProcId;
      delete mem.dadosColetados.assessorConteudo;
      delete mem.dadosColetados.assessorTipoConteudo;
      delete mem.dadosColetados.assessorDiagnostico;
      await env('Ok, cancelado.', ctx);
      return;
    }
    await _assessorEstrategia(ctx, mem, trim);
    return;
  }

  // ── HANDLER ASSESSOR — autorização final (após estratégia proposta) ──
  if(mem.aguardando === 'assessor_autorizacao' && mem.dadosColetados?.assessorEstrategia) {
    const trim = txt.trim().toLowerCase();
    if(/^(autoriz|pode red|pode escrev|aprovad|ok red|manda bala|vai)/i.test(trim)) {
      mem.aguardando = null;
      await _assessorRedacao(ctx, mem);
      return;
    }
    if(/^(ajust|muda|alter|refaz|refaça|outra)/i.test(trim)) {
      // Volta pra estratégia com novo input
      mem.aguardando = 'assessor_estrategia';
      await env('Ok, me diga o que ajustar que refaço a estratégia.', ctx);
      return;
    }
    if(/^(cancel|parar|sair|n[ãa]o)/i.test(trim)) {
      mem.aguardando = null;
      delete mem.dadosColetados.assessorProcId;
      delete mem.dadosColetados.assessorConteudo;
      delete mem.dadosColetados.assessorTipoConteudo;
      delete mem.dadosColetados.assessorDiagnostico;
      delete mem.dadosColetados.assessorEscolha;
      delete mem.dadosColetados.assessorEstrategia;
      await env('Ok, cancelado.', ctx);
      return;
    }
    await env('Não entendi. Responda: "autoriza" pra redigir, "ajustar" pra mudar, "cancelar" pra sair.', ctx);
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // HANDLER v3.0: CONFIRMAÇÃO 1/2/3 APÓS MATCH ENCONTRADO
  // Kleuber escolhe: 1=NOVO (ignora match), 2=CONFIRMAR andamento, 3=consultoria
  // ════════════════════════════════════════════════════════════════════════
  if(mem.aguardando === 'confirmar_andamento_123' && mem.dadosColetados?.processoMatch) {
    const respRaw = (txt||'').trim();
    const respNum = respRaw.charAt(0); // pega 1º char (tolera "1 ok", "2 confirma", etc)
    const match = mem.dadosColetados.processoMatch;
    const analise = mem.dadosColetados.analisePendente;
    const arq = mem.dadosColetados.arqPendente || {nome:'documento'};

    // Resposta 1 — cadastrar como NOVO ignorando o match
    if(respNum === '1' || /^(novo)\b/i.test(respRaw)) {
      mem.aguardando = null;
      const tipoEscolhido = _inferirTipoProcessoCadastro(analise, respRaw);
      const novo = _cadastrarProcessoNovo(analise, arq, { tipo: tipoEscolhido, setor: 'autuacao' });
      _bumpProcessos(ctx.canal+':'+ctx.chatId);
      await _persistirProcessosCache();
      await _persistirProcessoNaTabela(novo, ctx, 'confirmar_andamento_123');
      await lembrarDoCaso(novo.nome, 'estrategia',
        'Processo cadastrado como NOVO (ignorou match com "'+match.proc_nome+'") a partir de '+arq.nome, ctx.canal);
      await enfileirarComando({acao:'criar_processo', dados:novo});
      logAtividade('juridico', ctx.chatId, 'conf123_opcao_1_novo',
        'ignorou match com '+match.proc_nome+' e cadastrou novo: '+novo.nome);
      mem.casoAtual = novo.nome;
      delete mem.dadosColetados.analisePendente;
      delete mem.dadosColetados.arqPendente;
      delete mem.dadosColetados.processoMatch;
      salvarMemoria(ctx.chatId, ctx.threadId);
      let r = '✅ CADASTRADO como processo NOVO (ignorei o match anterior):\n\n';
      r += 'ID: '+novo.id+'\n';
      r += 'Nº: '+(novo.numero || '(sem CNJ)')+'\n';
      r += 'Nome: '+novo.nome+'\n';
      if(novo.juiz_relator) r += 'Juiz/Relator: '+novo.juiz_relator+'\n';
      if(novo.instancia) r += 'Instância: '+novo.instancia+'\n';
      r += 'Status: '+novo.status+'\n';
      if(novo.prazo) r += 'Prazo: '+novo.prazo+'\n';
      r += '\nAgora você tem 2 processos no Lex (o antigo "'+match.proc_nome+'" continua intacto).';
      await env(r, ctx);
      return;
    }

    // Resposta 2 — CONFIRMAR: atualizar como andamento do processo existente
    if(respNum === '2' || /^(confirma|confirmar|andamento|sim\b)/i.test(respRaw)) {
      mem.aguardando = null;
      const proc = processos.find(p => p.id === match.proc_id);
      if(!proc) {
        delete mem.dadosColetados.analisePendente;
        delete mem.dadosColetados.arqPendente;
        delete mem.dadosColetados.processoMatch;
        await env('⚠ Processo não encontrado mais no Lex. Operação cancelada.', ctx);
        return;
      }
      logAtividade('juridico', ctx.chatId, 'conf123_opcao_2_confirmado',
        proc.nome+' | criterio='+match.criterio);
      await _aplicarAtualizacaoNoProcesso(ctx, mem, arq, analise, proc);
      delete mem.dadosColetados.analisePendente;
      delete mem.dadosColetados.arqPendente;
      delete mem.dadosColetados.processoMatch;
      return;
    }

    // Resposta 3 — só consultoria, não grava nada
    if(respNum === '3' || /^(consultoria|consulta|an[aá]lis|n[aã]o grava|n[aã]o cadastra)/i.test(respRaw)) {
      mem.aguardando = null;
      logAtividade('juridico', ctx.chatId, 'conf123_opcao_3_consultoria',
        'doc='+arq.nome+' match='+match.proc_nome);
      // Memoriza o caso atual pra que perguntas seguintes tenham contexto
      if(match.proc_nome) mem.casoAtual = match.proc_nome;
      delete mem.dadosColetados.analisePendente;
      delete mem.dadosColetados.arqPendente;
      delete mem.dadosColetados.processoMatch;
      salvarMemoria(ctx.chatId, ctx.threadId);
      let r = 'ℹ Modo consultoria. Nenhum cadastro ou atualização feita.\n\n';
      r += 'Processo localizado: "'+match.proc_nome+'" foi mantido como contexto atual.\n';
      r += 'Pode me perguntar sobre o documento, pedir análise estratégica, ou pedir uma peça.';
      await env(r, ctx);
      return;
    }

    // Resposta inválida — repete pergunta (mantém aguardando)
    await env('⚠ Não entendi. Responda 1, 2 ou 3:\n'+
              '1 — É processo NOVO (ignora o match)\n'+
              '2 — CONFIRMAR: é andamento deste processo\n'+
              '3 — Só consultoria (não grava)', ctx);
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // HANDLER v3.0: CONFIRMAÇÃO 1/2/3 QUANDO NÃO HOUVE MATCH
  // Kleuber escolhe: 1=cadastrar NOVO, 2=cancelar, 3=consultoria
  // ════════════════════════════════════════════════════════════════════════
  if(mem.aguardando === 'sem_match_123' && mem.dadosColetados?.analisePendente) {
    const respRaw = (txt||'').trim();
    const respNum = respRaw.charAt(0);
    const analise = mem.dadosColetados.analisePendente;
    const arq = mem.dadosColetados.arqPendente || {nome:'documento'};

    // Resposta 1 — cadastrar como NOVO
    if(respNum === '1' || /^(sim|cadastra|novo|ok|pode)\b/i.test(respRaw)) {
      mem.aguardando = null;
      const tipoEscolhido = _inferirTipoProcessoCadastro(analise, respRaw);
      const novo = _cadastrarProcessoNovo(analise, arq, { tipo: tipoEscolhido, setor: 'autuacao' });
      _bumpProcessos(ctx.canal+':'+ctx.chatId);
      await _persistirProcessosCache();
      await _persistirProcessoNaTabela(novo, ctx, 'sem_match_123');
      await lembrarDoCaso(novo.nome, 'estrategia',
        'Processo cadastrado a partir de '+arq.nome+'. '+(analise.resumo||'').substring(0,300), ctx.canal);
      await enfileirarComando({acao:'criar_processo', dados:novo});
      logAtividade('juridico', ctx.chatId, 'semmatch123_opcao_1_novo', novo.nome);
      mem.casoAtual = novo.nome;
      delete mem.dadosColetados.analisePendente;
      delete mem.dadosColetados.arqPendente;
      delete mem.dadosColetados.melhorCandidato;
      salvarMemoria(ctx.chatId, ctx.threadId);
      let r = '✅ Processo NOVO cadastrado:\n\n';
      r += 'ID: '+novo.id+'\n';
      r += 'Nº: '+(novo.numero || '(sem CNJ)')+'\n';
      r += 'Nome: '+novo.nome+'\n';
      if(novo.partes) r += 'Partes: '+novo.partes+'\n';
      if(novo.tribunal) r += 'Tribunal: '+novo.tribunal+'\n';
      if(novo.juiz_relator) r += 'Juiz/Relator: '+novo.juiz_relator+'\n';
      if(novo.instancia) r += 'Instância: '+novo.instancia+'\n';
      r += 'Status: '+novo.status+'\n';
      if(novo.prazo) r += 'Prazo: '+novo.prazo+'\n';
      if(novo.proxacao) r += 'Próxima ação: '+novo.proxacao+'\n';
      r += '\nJá está salvo no banco e aparece no painel web.';
      await env(r, ctx);
      return;
    }

    // Resposta 2 — cancelar (não cadastrar nada)
    if(respNum === '2' || /^(cancel|n[aã]o cadastra|nao|não)\b/i.test(respRaw)) {
      mem.aguardando = null;
      logAtividade('juridico', ctx.chatId, 'semmatch123_opcao_2_cancelado', arq.nome);
      delete mem.dadosColetados.analisePendente;
      delete mem.dadosColetados.arqPendente;
      delete mem.dadosColetados.melhorCandidato;
      salvarMemoria(ctx.chatId, ctx.threadId);
      await env('❌ Cadastro cancelado. Documento não foi vinculado a nenhum processo nem cadastrado.', ctx);
      return;
    }

    // Resposta 3 — só consultoria
    if(respNum === '3' || /^(consultoria|consulta|an[aá]lis|s[oó] analisa)/i.test(respRaw)) {
      mem.aguardando = null;
      logAtividade('juridico', ctx.chatId, 'semmatch123_opcao_3_consultoria', arq.nome);
      // Define caso atual pelo conteúdo da análise (pra ter contexto em perguntas seguintes)
      if(analise.nome_caso) mem.casoAtual = analise.nome_caso;
      else if(analise.numero_processo) mem.casoAtual = analise.numero_processo;
      delete mem.dadosColetados.analisePendente;
      delete mem.dadosColetados.arqPendente;
      delete mem.dadosColetados.melhorCandidato;
      salvarMemoria(ctx.chatId, ctx.threadId);
      let r = 'ℹ Modo consultoria. Nenhum cadastro feito.\n\n';
      r += 'Você pode me perguntar sobre o documento, pedir análise estratégica, ou fazer outras consultas.';
      if(analise.resumo) r += '\n\n📄 Resumo rápido do doc:\n'+analise.resumo.substring(0,400);
      await env(r, ctx);
      return;
    }

    // Resposta inválida — repete pergunta
    await env('⚠ Não entendi. Responda 1, 2 ou 3:\n'+
              '1 — Cadastrar como processo NOVO\n'+
              '2 — Cancelar (não cadastrar)\n'+
              '3 — Só consultoria (não grava)', ctx);
    return;
  }

  // ── HANDLER AGENTE ROTEADOR: escolha entre candidatos ambíguos ──
  if(mem.aguardando === 'escolher_processo_ambiguo' && mem.dadosColetados?.candidatosAmbiguos) {
    const resp = txt.trim().toUpperCase();
    const candidatos = mem.dadosColetados.candidatosAmbiguos;
    const analise = mem.dadosColetados.analisePendente;
    const arq = mem.dadosColetados.arqPendente || {nome:'documento'};

    // Resposta "NOVO" → cadastra novo processo
    if(/^(NOVO|N)\b/.test(resp)) {
      const tipoEscolhido = _inferirTipoProcessoCadastro(analise, resp);
      const novo = _cadastrarProcessoNovo(analise, arq, { tipo: tipoEscolhido, setor: 'autuacao' });
      _bumpProcessos(ctx.canal+':'+ctx.chatId);
      await _persistirProcessosCache();
      await _persistirProcessoNaTabela(novo, ctx, 'escolher_processo_ambiguo');
      await lembrarDoCaso(novo.nome, 'estrategia',
        'Processo cadastrado manualmente após ambiguidade em '+arq.nome, ctx.canal);
      await enfileirarComando({acao:'criar_processo', dados:novo});
      logAtividade('juridico', ctx.chatId, 'roteador_resolvido_novo', novo.nome+' após ambiguidade');
      mem.aguardando = null;
      mem.casoAtual = novo.nome;
      delete mem.dadosColetados.analisePendente;
      delete mem.dadosColetados.arqPendente;
      delete mem.dadosColetados.candidatosAmbiguos;
      salvarMemoria(ctx.chatId, ctx.threadId);
      await env('✅ CADASTRADO como NOVO: '+novo.nome+(novo.numero?' (Nº '+novo.numero+')':''), ctx);
      return;
    }

    // Resposta "IGNORAR" → limpa sem fazer nada
    if(/^(IGNORAR|IGNORE|NAO|NÃO|CANCELA)\b/.test(resp)) {
      mem.aguardando = null;
      delete mem.dadosColetados.analisePendente;
      delete mem.dadosColetados.arqPendente;
      delete mem.dadosColetados.candidatosAmbiguos;
      salvarMemoria(ctx.chatId, ctx.threadId);
      await env('Ok, só analisei o documento. Não vinculei a nenhum processo.', ctx);
      return;
    }

    // Resposta numérica "1", "2", "3"...
    const num = parseInt(resp, 10);
    if(!isNaN(num) && num >= 1 && num <= candidatos.length) {
      const escolhido = candidatos[num-1];
      const procEscolhido = processos.find(p => p.id === escolhido.proc_id);
      if(procEscolhido) {
        mem.aguardando = null;
        delete mem.dadosColetados.candidatosAmbiguos;
        delete mem.dadosColetados.analisePendente;
        delete mem.dadosColetados.arqPendente;
        // v3.0: como Kleuber JÁ escolheu manualmente o processo, aplicamos direto
        // sem passar pelo 1/2/3 de confirmação (seria redundante)
        if(procEscolhido.numero) analise.numero_processo = procEscolhido.numero;
        logAtividade('juridico', ctx.chatId, 'roteador_resolvido_manual',
          procEscolhido.nome+' escolhido manualmente (opção '+num+' de '+candidatos.length+')');
        salvarMemoria(ctx.chatId, ctx.threadId);
        await env('✅ Vinculando ao: '+procEscolhido.nome+(procEscolhido.numero?' — '+procEscolhido.numero:'')+'\nAtualizando...', ctx);
        return await _aplicarAtualizacaoNoProcesso(ctx, mem, arq, analise, procEscolhido);
      }
    }

    // Resposta inválida — repete instrução
    await env('⚠ Não entendi. Responda: número do candidato (1, 2, 3...), "NOVO" pra cadastrar novo, ou "IGNORAR" pra só analisar.', ctx);
    return;
  }

  // ── HANDLER AGENTE: confirmação de cadastro automático de processo novo ──
  if(mem.aguardando === 'confirmar_cadastro_auto' && mem.dadosColetados?.analisePendente) {
    const ehSim = /^(sim|s|yes|y|ok|pode|cadastra|confirma|vai)\b/i.test(txt.trim());
    const ehNao = /^(n\u00e3o|nao|n|no|cancela|nop)\b/i.test(txt.trim());
    const ehVincular = /^(vincular|vincula|vinc|v)\b/i.test(txt.trim());

    // NOVO: resposta "VINCULAR" quando há melhorCandidato (score baixo) — força vínculo
    if(ehVincular && mem.dadosColetados.melhorCandidato) {
      const cand = mem.dadosColetados.melhorCandidato;
      const procCand = processos.find(p => p.id === cand.proc_id);
      const analise = mem.dadosColetados.analisePendente;
      const arq = mem.dadosColetados.arqPendente || {nome:'documento'};
      if(procCand) {
        mem.aguardando = null;
        delete mem.dadosColetados.melhorCandidato;
        delete mem.dadosColetados.analisePendente;
        delete mem.dadosColetados.arqPendente;
        if(procCand.numero) analise.numero_processo = procCand.numero;
        logAtividade('juridico', ctx.chatId, 'roteador_vincular_forcado',
          procCand.nome+' (score baixo = '+cand.score+' mas usuário confirmou)');
        salvarMemoria(ctx.chatId, ctx.threadId);
        await env('✅ Vinculando (forçado) ao: '+procCand.nome+'\nAtualizando...', ctx);
        // v3.0: aplica direto, sem recursão no agenteAtualizacaoProcessual
        return await _aplicarAtualizacaoNoProcesso(ctx, mem, arq, analise, procCand);
      }
    }

    if(ehSim) {
      const analise = mem.dadosColetados.analisePendente;
      const arq = mem.dadosColetados.arqPendente || {nome:'documento'};
      const tipoEscolhido = _inferirTipoProcessoCadastro(analise, txt);
      const novo = _cadastrarProcessoNovo(analise, arq, { tipo: tipoEscolhido, setor: 'autuacao' });
      _bumpProcessos(ctx.canal+':'+ctx.chatId);
      await _persistirProcessosCache();
      await _persistirProcessoNaTabela(novo, ctx, 'confirmar_cadastro_auto');
      await lembrarDoCaso(novo.nome, 'estrategia',
        'Processo cadastrado automaticamente a partir de '+arq.nome+'. '+(analise.resumo||'').substring(0,300),
        ctx.canal);
      await enfileirarComando({acao:'criar_processo', dados:novo});
      logAtividade('juridico', ctx.chatId, 'agente_cadastrou', novo.nome);
      mem.aguardando = null;
      mem.casoAtual = novo.nome;
      delete mem.dadosColetados.analisePendente;
      delete mem.dadosColetados.arqPendente;
      delete mem.dadosColetados.melhorCandidato;
      salvarMemoria(ctx.chatId, ctx.threadId);
      let r = '✅ CADASTRADO: '+novo.nome+'\n';
      if(novo.numero) r += 'Nº: '+novo.numero+'\n';
      r += 'Status: '+novo.status+'\n';
      if(novo.prazo) r += 'Prazo: '+novo.prazo+'\n';
      if(novo.proxacao) r += 'Próxima ação: '+novo.proxacao+'\n';
      r += '\nO processo agora está no Lex web também.';
      await env(r, ctx);
      return;
    }
    if(ehNao) {
      mem.aguardando = null;
      delete mem.dadosColetados.analisePendente;
      delete mem.dadosColetados.arqPendente;
      delete mem.dadosColetados.melhorCandidato;
      salvarMemoria(ctx.chatId, ctx.threadId);
      await env('Ok, não cadastrei. Só analisei o documento.', ctx);
      return;
    }
    // Nem SIM nem NÃO nem VINCULAR — segue fluxo normal (talvez a pessoa fez outra pergunta)
  }

  mem.hist.push({role:'user', content:txt});
  if(mem.hist.length>30) mem.hist=mem.hist.slice(-30);

  // Recupera memória de longo prazo do caso atual (se houver)
  const memCaso = mem.casoAtual ? await recuperarMemoriaDoCaso(mem.casoAtual, 20) : [];
  const memCasoTexto = memCaso.length
    ? memCaso.map(f=>`[${f.tipo}|${(f.data||'').substring(0,10)}] ${f.texto}`).join('\n')
    : '';

  const ctxProcessos = processos.length
    ? '\n\nPROCESSOS:\n'+processos.map(p=>`ID:${p.id} | ${p.nome} | ${p.status}${p.prazo?' | Prazo:'+p.prazo:''}${p.proxacao?' | Próx:'+p.proxacao:''}`).join('\n')
    : '\n\nSem processos carregados.';

  const sys = getSistema(ctx.chatId, mem, memCasoTexto) + ctxProcessos;

  // FIX-10: handler custas_confirmadas ANTES da IA — evita double-processing
  // (antes estava DEPOIS, fazendo IA responder + peça ser gerada na mesma mensagem)
  if(mem.aguardando && mem.aguardando.startsWith('custas_confirmadas_para_') &&
    (low.includes('sim')||low.includes('pag')||low.includes('recolh'))) {
    const tipoPend = mem.dadosColetados.tipoPecaPendente;
    const procPend = processos.find(p=>p.id===mem.dadosColetados.procPendente)||null;
    mem.aguardando = null;
    delete mem.dadosColetados.tipoPecaPendente;
    delete mem.dadosColetados.procPendente;
    salvarMemoria(ctx.chatId, ctx.threadId);
    await gerarEEnviar(tipoPend, procPend, txt, null,
      tipoPend && tipoPend.includes('inicial'),
      mem.dadosColetados.cliente||null, ctx);
    return;
  }

  try {
    if(txt.length > 80) await env('...', ctx);
    const resposta = await ia(mem.hist, sys, 2500);
    mem.hist.push({role:'assistant', content:resposta});
    salvarMemoria(ctx.chatId, ctx.threadId);

    // Envia em chunks se grande
    if(resposta.length<=3800) {
      await env(resposta, ctx);
    } else {
      const partes=Math.ceil(resposta.length/3800);
      for(let i=0;i<partes;i++){
        await env((partes>1?'('+(i+1)+'/'+partes+') ':'')+resposta.slice(i*3800,(i+1)*3800), ctx);
        if(i<partes-1) await new Promise(r=>setTimeout(r,700));
      }
    }

    // Memória por caso: se há caso em conversa, registra fato resumido
    if(mem.casoAtual && txt.length > 30) {
      await lembrarDoCaso(mem.casoAtual, 'observacao', 'Pergunta: '+txt.substring(0,300), ctx.canal);
    }

    // Detecta pedido de geração de documento
    const pedidoDoc=low.match(/\b(gera|gere|elabora|redige|cria|preciso de|faz|faça)\b/);
    const tiposDoc=['petição inicial','petição simples','contestação','recurso','agravo de instrumento',
      'agravo interno','embargos de declaração','apelação','mandado de segurança','impugnação',
      'manifestação','memoriais','contrarrazões','petição de juntada','substabelecimento',
      'perícia contábil','laudo pericial','perícia técnica','parecer técnico','parecer jurídico',
      'contrato de honorários','contrato','procuração'];
    const tipoEnc=tiposDoc.find(t=>low.includes(t));

    if(pedidoDoc&&tipoEnc&&AUTORIZADOS[ctx.chatId]?.ok) {
      const ehInicial=tipoEnc.includes('inicial');
      const procRel=processos.find(p=>
        txt.toLowerCase().includes(p.nome.toLowerCase().substring(0,8))||
        (p.numero&&txt.includes(p.numero.substring(0,5)))
      );
      const exigeCustas=['petição inicial','mandado de segurança','recurso','agravo de instrumento','apelação'].includes(tipoEnc);
      if(exigeCustas) {
        await env('💰 Antes de gerar: as custas processuais foram recolhidas? Em qual tribunal será distribuída?', ctx);
        mem.aguardando='custas_confirmadas_para_'+tipoEnc;
        mem.dadosColetados.tipoPecaPendente=tipoEnc;
        if(procRel) mem.dadosColetados.procPendente=procRel.id;
        return;
      }
      await gerarEEnviar(tipoEnc, procRel, txt, null, ehInicial, mem.dadosColetados.cliente||null, ctx);
      mem.docsGerados.push({tipo:tipoEnc, data:horaBrasilia().toLocaleDateString('pt-BR')});
    } else if(pedidoDoc&&tipoEnc&&!AUTORIZADOS[ctx.chatId]?.ok) {
      await env('🔒 Geração de documentos restrita ao Administrador.', ctx);
    }
    // FIX-10: handler custas_confirmadas removido daqui — movido para ANTES da IA (acima)

  } catch(e) {
    console.error('Erro IA:', e.message);
    await env('Erro: '+e.message, ctx);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// RATE LIMITING — Token bucket para Anthropic API (janela deslizante 60s)
// ════════════════════════════════════════════════════════════════════════════
//
// PROBLEMA: Anthropic rejeita requisições que excedem 30.000 input tokens/minuto.
// Chunks de 80 páginas consomem ~20k tokens cada → no máximo 1 chunk por 40s.
//
// SOLUÇÃO: mantemos histórico de {timestamp, tokens} dos últimos 60s.
// Antes de cada chamada, verificamos quanto "cabe" na janela. Se não cabe, esperamos.
// ════════════════════════════════════════════════════════════════════════════

const _rateLimitHistorico = []; // [{ts, tokens}]
let _ultimoChunkEnviadoEm = 0;

function _limparHistoricoAntigo() {
  const agora = Date.now();
  const corte = agora - 60000; // 60s exatos (consistente com o cálculo de espera)
  while(_rateLimitHistorico.length > 0 && _rateLimitHistorico[0].ts < corte) {
    _rateLimitHistorico.shift();
  }
}

function _tokensUsadosNaJanela() {
  _limparHistoricoAntigo();
  return _rateLimitHistorico.reduce((s, item) => s + item.tokens, 0);
}

function _registrarUsoTokens(tokens) {
  _rateLimitHistorico.push({ ts: Date.now(), tokens: tokens || CHUNK_TOKENS_ESTIMADOS });
  _ultimoChunkEnviadoEm = Date.now();
}

/**
 * Espera o tempo necessário até ter "slot" livre no rate limit.
 * Combina 2 regras: (1) tokens na janela de 60s, (2) pausa mínima desde último chunk.
 */
async function _esperarSlotAnthropic(tokensEstimados) {
  const tokens = tokensEstimados || CHUNK_TOKENS_ESTIMADOS;

  // Regra 1: pausa mínima desde último chunk
  const desdeUltimoMs = Date.now() - _ultimoChunkEnviadoEm;
  const faltaPausaMin = PAUSA_MIN_ENTRE_CHUNKS_MS - desdeUltimoMs;
  if(faltaPausaMin > 0 && _ultimoChunkEnviadoEm > 0) {
    console.log('[rate-limit] aguardando pausa mínima entre chunks: '+Math.round(faltaPausaMin/1000)+'s');
    await new Promise(r => setTimeout(r, faltaPausaMin));
  }

  // Regra 2: verifica se tokens cabem na janela
  let tentativas = 0;
  while(tentativas < 20) { // safety: no máx 20 iterações (20min de espera teórica)
    const usados = _tokensUsadosNaJanela();
    const disponiveis = RATE_LIMIT_TOKENS_POR_MIN - usados;

    if(disponiveis >= tokens) {
      return; // tem slot
    }

    // Calcula quanto esperar pro token mais antigo sair da janela
    const itemMaisAntigo = _rateLimitHistorico[0];
    const agora = Date.now();
    // Esperar até o item mais antigo sair da janela (ts + 60000 = expira) + 500ms de margem
    const esperaMs = itemMaisAntigo
      ? Math.max(500, (itemMaisAntigo.ts + 60000) - agora + 500)
      : 5000;

    console.log('[rate-limit] tokens na janela: '+usados+'/'+RATE_LIMIT_TOKENS_POR_MIN+', preciso '+tokens+' — aguardando '+Math.round(esperaMs/1000)+'s');
    await new Promise(r => setTimeout(r, esperaMs));
    tentativas++;
  }
  console.warn('[rate-limit] limite de iterações atingido, seguindo mesmo assim');
}

/**
 * Detecta se um erro da Anthropic é rate limit (recuperável com espera).
 */
function _ehErroRateLimit(erro) {
  const msg = String(erro?.message || erro || '').toLowerCase();
  return msg.includes('rate limit') ||
         msg.includes('rate_limit') ||
         msg.includes('excederia o limite') ||
         msg.includes('tokens por minuto') ||
         msg.includes('tokens per minute') ||
         msg.includes('429');
}

// ════════════════════════════════════════════════════════════════════════════
// SPLIT DE PDF GRANDE — suporta processos de qualquer tamanho
// ════════════════════════════════════════════════════════════════════════════
//
// PROBLEMA: API da Anthropic aceita no máximo 100 páginas por chamada.
// Processos judiciais de anos podem ter 500, 2000, 5000 páginas.
//
// SOLUÇÃO: dividir em chunks de PDF_PGS_POR_CHUNK (padrão 80) páginas,
// analisar sequencialmente, consolidar resultado.
//
// STREAMING: PDFs muito grandes (> PDF_STREAM_THRESHOLD_MB) são salvos em /tmp
// durante o split para não estourar os 512MB de RAM do Render Free.
// ════════════════════════════════════════════════════════════════════════════

async function _contarPaginas(buffer) {
  try {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    return pdfDoc.getPageCount();
  } catch(e) {
    console.warn('Erro contando páginas:', e.message);
    return -1;
  }
}

/**
 * Divide um PDF em chunks de N páginas cada.
 * Retorna Array<Buffer>. Se o PDF tem ≤ PDF_MAX_PGS_DIRETO páginas, devolve [bufferOriginal].
 *
 * Para PDFs grandes (> PDF_STREAM_THRESHOLD_MB), escreve os chunks em /tmp e retorna
 * objetos { arquivoTmp: path } em vez de Buffer — o consumidor deve carregar sob demanda.
 */
async function _dividirPDFEmChunks(buffer, opcoes) {
  const opts = opcoes || {};
  const pgsPorChunk = opts.pgsPorChunk || PDF_PGS_POR_CHUNK;
  const maxDireto = opts.maxDireto || PDF_MAX_PGS_DIRETO;
  // Threshold de streaming: default 50MB, ajustável por canal/chamada
  // WhatsApp passa 30MB (arquivos grandes são comuns) pra não estourar RAM
  const streamThreshold = opts.streamThresholdMB || PDF_STREAM_THRESHOLD_MB;

  // Tamanho e decisão de streaming
  const tamMB = buffer.length / (1024*1024);
  const usaStreaming = tamMB > streamThreshold;

  // Tenta contar páginas
  const totalPgs = await _contarPaginas(buffer);

  // Erro de leitura: não é PDF válido ou está corrompido → devolve o buffer original
  // (o analisarDoc vai tentar e retornar erro mais claro)
  if(totalPgs < 0) {
    return [{ buffer, paginas: '?', chunkIdx: 1, totalChunks: 1 }];
  }

  // PDF pequeno: sem split
  if(totalPgs <= maxDireto) {
    return [{ buffer, paginas: totalPgs, chunkIdx: 1, totalChunks: 1 }];
  }

  console.log('[split] PDF '+totalPgs+'pg, '+tamMB.toFixed(1)+'MB → chunks de '+pgsPorChunk+(usaStreaming?' (streaming /tmp)':''));

  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const chunks = [];
  const totalChunks = Math.ceil(totalPgs / pgsPorChunk);
  const sessaoId = Date.now()+'_'+Math.random().toString(36).slice(2,8);

  for(let i = 0; i < totalChunks; i++) {
    const inicio = i * pgsPorChunk;
    const fim = Math.min(inicio + pgsPorChunk, totalPgs);
    const chunkDoc = await PDFDocument.create();
    const indices = [];
    for(let p = inicio; p < fim; p++) indices.push(p);
    const paginas = await chunkDoc.copyPages(pdfDoc, indices);
    paginas.forEach(pg => chunkDoc.addPage(pg));
    const chunkBytes = await chunkDoc.save();
    const chunkBuffer = Buffer.from(chunkBytes);

    if(usaStreaming) {
      const arqTmp = path.join(PDF_TMP_DIR, 'lex_'+sessaoId+'_chunk'+(i+1)+'.pdf');
      fs.writeFileSync(arqTmp, chunkBuffer);
      chunks.push({ arquivoTmp: arqTmp, paginas: fim-inicio, chunkIdx: i+1, totalChunks });
    } else {
      chunks.push({ buffer: chunkBuffer, paginas: fim-inicio, chunkIdx: i+1, totalChunks });
    }
  }

  return chunks;
}

// Libera um chunk (se for streaming, apaga o /tmp)
function _liberarChunk(chunk) {
  if(chunk && chunk.arquivoTmp) {
    try { fs.unlinkSync(chunk.arquivoTmp); } catch(e){ console.warn('[Lex][bot] Erro silenciado:', (e && e.message) ? e.message : e); }
  }
  if(chunk) { chunk.buffer = null; chunk.arquivoTmp = null; }
}

// Carrega buffer do chunk (in-memory ou /tmp)
function _bufferDoChunk(chunk) {
  if(chunk.buffer) return chunk.buffer;
  if(chunk.arquivoTmp) return fs.readFileSync(chunk.arquivoTmp);
  throw new Error('Chunk sem buffer nem arquivo');
}

// ════════════════════════════════════════════════════════════════════════════
// CONSOLIDAÇÃO DE CHUNKS — junta análises parciais em uma única análise
// ════════════════════════════════════════════════════════════════════════════
//
// Cada chunk retorna a mesma estrutura que analisarDoc() retorna pra um PDF pequeno.
// Precisamos consolidar N análises em 1, com regras:
// - numero_processo: primeiro não-vazio que apareça (geralmente o 1º chunk tem a capa)
// - nome_caso, partes, tribunal, area: primeiro não-vazio
// - status, prazo, proxima_acao: último chunk válido (geralmente mais atual)
// - andamentos: união, deduplicados por fingerprint
// - resumo: mescla com resumo global gerado em 1 chamada final
// - eh_decisao / resposta_sugerida: true/set se qualquer chunk indicar
// ════════════════════════════════════════════════════════════════════════════

function _consolidarAnalises(analises, arqNome, totalPaginas) {
  const primeiroNaoVazio = (campo) => {
    for(const a of analises) {
      if(a && a[campo] && String(a[campo]).trim() && String(a[campo]).trim() !== '[A DISTRIBUIR]') return a[campo];
    }
    return '';
  };
  const ultimoNaoVazio = (campo) => {
    for(let i = analises.length-1; i >= 0; i--) {
      const a = analises[i];
      if(a && a[campo] && String(a[campo]).trim()) return a[campo];
    }
    return '';
  };

  // Andamentos consolidados e deduplicados
  const fpAndamentos = new Set();
  const todosAndamentos = [];
  for(const a of analises) {
    const ands = (a && Array.isArray(a.andamentos)) ? a.andamentos : [];
    for(const and of ands) {
      const data = String(and.data||'').replace(/\D/g,'');
      const txt = String(and.txt||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w\s]/g,'').replace(/\s+/g,' ').trim().substring(0,60);
      const fp = data+'|'+txt;
      if(!fpAndamentos.has(fp) && (data||txt)) {
        fpAndamentos.add(fp);
        todosAndamentos.push(and);
      }
    }
  }

  // Ordena andamentos por data desc se possível
  todosAndamentos.sort((a,b) => {
    const da = String(a.data||'').split('/').reverse().join('');
    const db = String(b.data||'').split('/').reverse().join('');
    return db.localeCompare(da);
  });

  // Booleanos consolidados
  const ehDecisao = analises.some(a => a && a.eh_decisao);
  const exigeCustas = analises.some(a => a && a.custas_necessarias);

  // Frentes, documentos, jurisprudência: concatena
  const juntaListas = (campo) => {
    const set = new Set();
    for(const a of analises) {
      const v = a && a[campo];
      if(v) {
        String(v).split(',').map(x=>x.trim()).filter(Boolean).forEach(x=>set.add(x));
      }
    }
    return Array.from(set).join(', ');
  };

  // Resumos de chunks concatenados (a IA refinará depois se necessário)
  const resumos = analises.map((a,i) => a?.resumo ? `[parte ${i+1}] ${a.resumo}` : '').filter(Boolean);
  const resumoConcat = resumos.join('\n\n');

  return {
    tipo: primeiroNaoVazio('tipo') || 'outro',
    numero_processo: primeiroNaoVazio('numero_processo'),
    nome_caso: primeiroNaoVazio('nome_caso') || arqNome.replace(/\.[^.]+$/,'').substring(0,60),
    partes: primeiroNaoVazio('partes'),
    tribunal: primeiroNaoVazio('tribunal'),
    area: primeiroNaoVazio('area'),
    status: ultimoNaoVazio('status') || 'ATIVO',
    prazo: ultimoNaoVazio('prazo'),
    proxima_acao: ultimoNaoVazio('proxima_acao'),
    descricao: primeiroNaoVazio('descricao'),
    frentes: juntaListas('frentes'),
    valor: primeiroNaoVazio('valor'),
    andamentos: todosAndamentos,
    resumo: resumoConcat || primeiroNaoVazio('resumo') || 'Análise consolidada de '+totalPaginas+' páginas em '+analises.length+' partes.',
    eh_decisao: ehDecisao,
    resposta_sugerida: ultimoNaoVazio('resposta_sugerida'),
    custas_necessarias: exigeCustas,
    documentos_necessarios: juntaListas('documentos_necessarios'),
    jurisprudencia: juntaListas('jurisprudencia'),
    _meta: {
      total_paginas: totalPaginas,
      total_chunks: analises.length,
      chunks_com_erro: analises.filter(a => !a || a._erro).length
    }
  };
}

// ════════════════════════════════════════════════════════════════════════════
// ANÁLISE COM SPLIT AUTOMÁTICO — substitui analisarDoc() para PDFs grandes
// ════════════════════════════════════════════════════════════════════════════
async function _analisarDocEmChunks(buffer, isPdf, nome, cbProgresso, opcoes) {
  // Não-PDF: fluxo direto (DOCX, TXT, imagens etc já são pequenos)
  if(!isPdf) return await analisarDoc(buffer, isPdf, nome);

  // Opções por canal: WhatsApp usa streaming mais cedo (arquivos grandes comuns)
  const opts = opcoes || {};
  const canal = opts.canal || 'telegram';
  const streamThresholdMB = canal === 'whatsapp'
    ? parseInt(process.env.PDF_STREAM_THRESHOLD_MB_WPP || '30', 10)
    : PDF_STREAM_THRESHOLD_MB;

  // Divide (ou não, se for pequeno) — passando threshold adaptativo
  const chunks = await _dividirPDFEmChunks(buffer, { streamThresholdMB });

  // Um único chunk: comportamento original, sem overhead (mas COM rate limit)
  if(chunks.length === 1) {
    const b = _bufferDoChunk(chunks[0]);
    // Rate limit mesmo pra chunk único (protege contra N PDFs pequenos seguidos)
    await _esperarSlotAnthropic(CHUNK_TOKENS_ESTIMADOS);
    let tentativas = 0;
    let ultimoErro = null;
    while(tentativas < CHUNK_RETRY_MAX) {
      tentativas++;
      _registrarUsoTokens(CHUNK_TOKENS_ESTIMADOS);
      try {
        const r = await analisarDoc(b, isPdf, nome);
        _liberarChunk(chunks[0]);
        return r;
      } catch(e) {
        ultimoErro = e;
        if(_ehErroRateLimit(e) && tentativas < CHUNK_RETRY_MAX) {
          const esperaMs = BACKOFF_BASE_MS * Math.pow(2, tentativas - 1);
          console.log('[chunk único] rate limit, aguardando '+Math.round(esperaMs/1000)+'s...');
          _rateLimitHistorico.splice(-1, 1);
          await new Promise(r => setTimeout(r, esperaMs));
          await _esperarSlotAnthropic(CHUNK_TOKENS_ESTIMADOS);
          continue;
        }
        _liberarChunk(chunks[0]);
        throw e;
      }
    }
    _liberarChunk(chunks[0]);
    throw ultimoErro || new Error('falha após retries');
  }

  // Múltiplos chunks: processa sequencialmente COM RATE LIMITING
  const totalPaginas = chunks.reduce((s,c)=>s+(c.paginas||0), 0);
  console.log('[analise] '+nome+' — '+chunks.length+' chunks, ~'+totalPaginas+'pg');

  const analisesParciais = [];
  for(let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const nomeChunk = nome.replace(/\.pdf$/i,'')+'_p'+c.chunkIdx+'.pdf';
    let tentativas = 0;
    let sucesso = false;
    let ultimoErro = null;

    while(tentativas < CHUNK_RETRY_MAX && !sucesso) {
      tentativas++;

      // RATE LIMITING: espera slot antes de cada chamada
      await _esperarSlotAnthropic(CHUNK_TOKENS_ESTIMADOS);

      try {
        if(cbProgresso) await cbProgresso({ chunkIdx: c.chunkIdx, total: chunks.length, tentativa: tentativas });
        const b = _bufferDoChunk(c);
        // Registra uso de tokens ANTES de mandar (otimista — se falhar, fica só como "reserva")
        _registrarUsoTokens(CHUNK_TOKENS_ESTIMADOS);
        const r = await Promise.race([
          analisarDoc(b, true, nomeChunk),
          new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout '+CHUNK_TIMEOUT_MS+'ms')), CHUNK_TIMEOUT_MS))
        ]);
        analisesParciais.push(r);
        sucesso = true;
      } catch(e) {
        ultimoErro = e;
        console.warn('[chunk '+c.chunkIdx+'/'+chunks.length+'] tentativa '+tentativas+' erro:', (e.message||'').substring(0,200));

        if(tentativas < CHUNK_RETRY_MAX) {
          // BACKOFF EXPONENCIAL: 30s, 60s, 120s...
          // Se for rate limit, força espera longa pra janela esvaziar
          let esperaMs;
          if(_ehErroRateLimit(e)) {
            esperaMs = BACKOFF_BASE_MS * Math.pow(2, tentativas - 1); // 30s, 60s, 120s
            console.log('[chunk '+c.chunkIdx+'] rate limit detectado, aguardando '+Math.round(esperaMs/1000)+'s antes de retry...');
            // Limpa o histórico de tokens que registramos mas falharam
            // (não perfeito — mas evita super-contagem)
            _rateLimitHistorico.splice(-1, 1); // remove último registro (falhou)
          } else {
            esperaMs = 3000 * tentativas; // 3s, 6s, 9s pra erros não-rate-limit
          }
          await new Promise(r=>setTimeout(r, esperaMs));
        }
      }
    }

    if(!sucesso) {
      // Chunk falhou mesmo com retry. Registra e segue.
      analisesParciais.push({ _erro: ultimoErro?.message || 'falha desconhecida', _chunk: c.chunkIdx });
    }

    _liberarChunk(c);
  }

  const sucessos = analisesParciais.filter(a => !a._erro).length;
  if(sucessos === 0) {
    throw new Error('Falha ao analisar TODOS os '+chunks.length+' chunks. Último erro: '+(analisesParciais[0]?._erro||'desconhecido'));
  }

  const consolidado = _consolidarAnalises(analisesParciais, nome, totalPaginas);
  console.log('[analise] '+nome+' consolidado: '+sucessos+'/'+chunks.length+' chunks OK, '+(consolidado.andamentos?.length||0)+' andamentos únicos');

  return consolidado;
}

// ════════════════════════════════════════════════════════════════════════════
// FILA ASSÍNCRONA DE ANÁLISES
// ════════════════════════════════════════════════════════════════════════════
//
// USUÁRIO manda PDF → entra na fila → responde "📥 Analisando processo..."
// WORKER processa 1 de cada vez → quando termina → envia relatório
//
// Benefícios:
// - Usuário continua conversando enquanto o PDF processa
// - RAM do Render protegida (1 PDF grande por vez)
// - Múltiplos usuários: fila serializa, ninguém é ignorado
// - Multi-tenant ready: cada item tem ctx.chatId que identifica o remetente
// ════════════════════════════════════════════════════════════════════════════

const _filaAnalises = [];
let _workerRodando = false;
let _analiseEmCurso = null; // {ctx, arq, iniciadoEm}

function _posicaoNaFila(ctx, arq) {
  // 0 = está em curso agora; 1+ = posição aguardando
  let pos = 0;
  if(_analiseEmCurso) pos = 1;
  for(let i = 0; i < _filaAnalises.length; i++) {
    pos++;
    if(_filaAnalises[i]._id === arq._filaId) return pos;
  }
  return pos;
}

async function _enfileirarAnalise(ctx, mem, arq, analisePreviaMem) {
  arq._filaId = Date.now()+'_'+Math.random().toString(36).slice(2,8);
  _filaAnalises.push({
    _id: arq._filaId,
    ctx,
    mem,
    arq,
    analisePreviaMem, // guarda flag se estava aguardando PDF pós-cumprimento
    iniciadoEm: Date.now()
  });

  const pos = _posicaoNaFila(ctx, arq);
  logAtividade('juridico', ctx.chatId, 'fila_entrou', arq.nome+' pos:'+pos);

  // Estimativa de tempo baseada no tamanho real (chunks esperados)
  // Cada chunk: ~35s de pausa (rate limit) + ~15s de IA = ~50s. Chunk único: ~20s
  const tamMB = (arq.buffer?.length || 0) / (1024*1024);
  const paginasEstimadas = Math.max(1, Math.round(tamMB * 7)); // heurística: ~7pg/MB pra PDFs judiciais
  const chunksEstimados = paginasEstimadas > PDF_MAX_PGS_DIRETO
    ? Math.ceil(paginasEstimadas / PDF_PGS_POR_CHUNK)
    : 1;
  const tempoEstimadoS = chunksEstimados === 1 ? 20 : chunksEstimados * 50;
  let tempoTxt;
  if(tempoEstimadoS < 60) tempoTxt = '~'+tempoEstimadoS+'s';
  else if(tempoEstimadoS < 1800) tempoTxt = '~'+Math.round(tempoEstimadoS/60)+'min';
  else tempoTxt = '~'+Math.round(tempoEstimadoS/60)+'min (arquivo grande)';

  // Aviso específico pra arquivos MUITO grandes (> 30MB = processo judicial denso)
  const ehGrande = tamMB > 30;
  const prefixoGrande = ehGrande
    ? '📚 Processo grande detectado ('+tamMB.toFixed(1)+'MB, ~'+paginasEstimadas+'pg em '+chunksEstimados+' partes)\n'
    : '';

  let msg;
  if(pos <= 1) {
    msg = prefixoGrande + '📥 Analisando processo ('+tempoTxt+')... pode continuar conversando, te aviso quando terminar.';
  } else {
    msg = prefixoGrande + '📥 Na fila ('+pos+'º lugar, '+tempoTxt+'). Analiso em sequência, te aviso quando terminar.';
  }
  await env(msg, ctx);

  // Chuta o worker (idempotente)
  _iniciarWorkerFila();
}

async function _iniciarWorkerFila() {
  if(_workerRodando) return;
  _workerRodando = true;
  try {
    while(_filaAnalises.length > 0) {
      const item = _filaAnalises.shift();
      _analiseEmCurso = item;
      try {
        await _processarItemFila(item);
      } catch(e) {
        console.error('[worker] erro item '+item._id+':', e.message);
        try { await env('❌ Erro ao analisar '+item.arq.nome+': '+e.message, item.ctx); } catch(_){ console.warn('[Lex][bot] Erro silenciado:', (_ && _.message) ? _.message : _); }
        logAtividade('juridico', item.ctx.chatId, 'fila_erro', item.arq.nome+': '+e.message);
      }
      _analiseEmCurso = null;
    }
  } finally {
    _workerRodando = false;
  }
}

async function _processarItemFila(item) {
  const { ctx, mem, arq, analisePreviaMem } = item;
  const inicio = Date.now();

  // Progresso: manda no MÁXIMO 1 atualização intermediária pra não poluir
  let jaMandouProgresso = false;
  const cbProgresso = async ({ chunkIdx, total }) => {
    if(total <= 3) return;
    // Só avisa uma vez, no meio do processo, se for grande
    if(!jaMandouProgresso && chunkIdx === Math.floor(total/2)) {
      jaMandouProgresso = true;
      await env('⏳ '+arq.nome+': '+chunkIdx+' de '+total+' partes processadas...', ctx).catch(()=>{});
    }
  };

  const analise = await _analisarDocEmChunks(arq.buffer, arq.isPdf, arq.nome, cbProgresso, { canal: ctx.canal });

  // Pós-análise: aplica no caso usando o fluxo certo (idêntico ao original, só mudou de lugar)
  await _aplicarAnaliseNoFluxo(ctx, mem, arq, analise, analisePreviaMem);

  const dur = Math.round((Date.now()-inicio)/1000);
  logAtividade('juridico', ctx.chatId, 'fila_concluido', arq.nome+' em '+dur+'s');
}

// Extrai a lógica pós-análise que estava dentro de _processarArquivo
// (evita duplicação, mantém comportamento idêntico ao v2.1)
async function _aplicarAnaliseNoFluxo(ctx, mem, arq, analise, aguardandoPdfProc) {
  mem.hist.push({role:'user', content:'[Documento: '+arq.nome+']'});

  // FLUXO 1: usuário tinha cumprido prazo e mandou a petição
  if(aguardandoPdfProc) {
    const procId = mem.dadosColetados.processoAguardandoPdf;
    const procNome = mem.dadosColetados.processoPdfNome;
    const idx = processos.findIndex(p=>p.id===procId);
    if(idx>=0) {
      if(analise.andamentos) analise.andamentos.forEach(a=>{
        if(!processos[idx].andamentos) processos[idx].andamentos=[];
        if(!processos[idx].andamentos.find(x=>x.txt===a.txt)) processos[idx].andamentos.unshift(a);
      });
      if(analise.proxima_acao) processos[idx].proxacao=analise.proxima_acao;
      if(analise.prazo) processos[idx].prazo=analise.prazo;
      if(analise.status && analise.status !== 'AGUARDANDO') processos[idx].status=analise.status;
      _bumpProcessos(ctx.canal+':'+ctx.chatId);
      await _persistirProcessosCache();
      await lembrarDoCaso(procNome, 'documento_analisado', arq.nome+': '+(analise.resumo||'').substring(0,500), ctx.canal);
    }
    mem.aguardando = null;
    mem.dadosColetados.processoAguardandoPdf = null;
    mem.dadosColetados.processoPdfNome = null;
    let resp = '✅ Lex atualizado — '+procNome+'\n\n'+(analise.resumo||'Petição registrada.');
    if(analise.prazo) resp += '\nPróximo prazo: '+analise.prazo;
    if(analise.proxima_acao) resp += '\nPróxima ação: '+analise.proxima_acao;
    if(analise._meta?.total_chunks > 1) resp += '\n\n(processado em '+analise._meta.total_chunks+' partes, '+analise._meta.total_paginas+'pg)';
    await env(resp, ctx);
    mem.hist.push({role:'assistant', content:'[Petição registrada em '+procNome+']'});
    salvarMemoria(ctx.chatId, ctx.threadId);
    return;
  }

  // FLUXO 2: documento processual → dispara o AGENTE
  // NOVO: tentar extrair número do processo do NOME DO ARQUIVO também
  const numeroDoArquivo = _extrairCNJDoNome(arq.nome);
  if(numeroDoArquivo && !analise.numero_processo) {
    analise.numero_processo = numeroDoArquivo;
  }
  
  const ehDocProcessual =
    analise.numero_processo ||
    analise.partes ||
    ['decisao','sentenca','despacho','intimacao','peticao_inicial','contestacao','recurso'].includes(analise.tipo);

  if(ehDocProcessual) {
    await agenteAtualizacaoProcessual(ctx, mem, arq, analise);
    mem.hist.push({role:'assistant', content:'[Agente analisou '+arq.nome+' e relatou resultado]'});
    salvarMemoria(ctx.chatId, ctx.threadId);
    return;
  }

  // FLUXO 3: documento avulso (perícia, parecer, contrato sem número)
  let resp = 'ANÁLISE: '+arq.nome+'\n\n'+(analise.resumo||'Documento analisado.');
  if(analise.prazo) {
    const d = calcDias(analise.prazo);
    if(d !== null) {
      if(d<0) resp += '\n\n🔴 PRAZO VENCIDO em '+analise.prazo;
      else if(d===0) resp += '\n\n🚨 PRAZO VENCE HOJE';
      else if(d<=3) resp += '\n\n⚠️ PRAZO URGENTE: '+analise.prazo+' — '+d+' DIA(S)';
      else resp += '\n\nPrazo: '+analise.prazo+' ('+d+' dias)';
    }
  }
  if(analise.custas_necessarias) resp += '\n\n💰 Esta peça pode exigir custas. Foram pagas?';
  if(analise.jurisprudencia) resp += '\n\nJurisprudência:\n'+analise.jurisprudencia;
  if(analise.documentos_necessarios) resp += '\n\nDocumentos para resposta:\n'+analise.documentos_necessarios;
  if(analise._meta?.total_chunks > 1) resp += '\n\n(processado em '+analise._meta.total_chunks+' partes, '+analise._meta.total_paginas+'pg)';

  await env(resp, ctx);
  mem.casoAtual = analise.nome_caso || analise.numero_processo || arq.nome;
  mem.hist.push({role:'assistant', content:'[Análise: '+arq.nome+'. Prazo: '+(analise.prazo||'nenhum')+']'});
  salvarMemoria(ctx.chatId, ctx.threadId);
}

// ════════════════════════════════════════════════════════════════════════════
// AGENTE DE ATUALIZAÇÃO PROCESSUAL — v2.1
// ════════════════════════════════════════════════════════════════════════════
// Fluxo:
//   1. IDENTIFICAÇÃO: extrai número CNJ, faz matching com processos cadastrados
//      (usa 3 estratégias: exato, últimos 10 dígitos, similaridade de partes)
//   2. ANÁLISE COMPARATIVA: compara andamentos do PDF vs andamentos já salvos
//      (usa fingerprint de data+texto pra detectar duplicatas, mesmo com
//       pequenas variações de redação)
//   3. CLASSIFICAÇÃO: separa em [NOVOS], [JÁ EXISTENTES], [POSSÍVEIS DUPLICATAS]
//   4. ATUALIZAÇÃO: aplica só o que é novo, atualiza prazo/status se mudou
//   5. RELATÓRIO: devolve ao advogado o que mudou, em linguagem direta
// ════════════════════════════════════════════════════════════════════════════

// Extrai número CNJ do nome do arquivo (ex: 0001234-55.2026.5.10.0001_peticao.pdf)
function _extrairCNJDoNome(nomeArquivo) {
  if (!nomeArquivo) return null;
  const nome = String(nomeArquivo);
  // Padrão CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO (com ou sem pontos/hífen)
  const padraoCNJ = /(\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4})/;
  const match = nome.match(padraoCNJ);
  if (match) {
    // Normaliza para formato com pontos
    let cnj = match[1].replace(/\D/g, '');
    if (cnj.length === 20) {
      return cnj.slice(0,7)+'-'+cnj.slice(7,9)+'.'+cnj.slice(9,13)+'.'+cnj.slice(13,14)+'.'+cnj.slice(14,16)+'.'+cnj.slice(16,20);
    }
  }
  // Também tenta encontrar só números (sem formatação)
  const padraoNumeros = /(\d{20})/;
  const matchNum = nome.match(padraoNumeros);
  if (matchNum) {
    const cnj = matchNum[1];
    return cnj.slice(0,7)+'-'+cnj.slice(7,9)+'.'+cnj.slice(9,13)+'.'+cnj.slice(13,14)+'.'+cnj.slice(14,16)+'.'+cnj.slice(16,20);
  }
  return null;
}

// Normaliza número CNJ removendo tudo que não é dígito
function _normCNJ(s) {
  return String(s||'').replace(/\D/g,'');
}

// ════════════════════════════════════════════════════════════════════════════
// AGENTE ROTEADOR v1 — Pontuação multi-critério + desambiguação
// ════════════════════════════════════════════════════════════════════════════
//
// Resolve o problema: "Eliane x Wanderson tem 3 processos. Qual é este PDF?"
//
// REGRAS:
// 1. CNJ exato (ou últimos 15 dígitos) → match direto, score 100+
// 2. Sem CNJ: pontua cada candidato por múltiplos critérios
//    - Partes (autor/réu em comum)       até 40 pts
//    - Vara + cidade/comarca              até 30 pts
//    - Tipo de ação                       até 20 pts
//    - Área (cível/trabalhista/etc)       até 10 pts
//    - Valor da causa (±5%)               até 10 pts
// 3. Decide:
//    - Match único com score ≥ 80 → atualiza (pede confirmação visual)
//    - Empate (2+ com score > 60) → PERGUNTA no chat
//    - Nenhum score ≥ 60 → PERGUNTA (cadastrar novo ou vincular manual)
// 4. Registra cada decisão em agente_logs para auditoria
// ════════════════════════════════════════════════════════════════════════════

// Normaliza texto pra comparação (lowercase, sem acentos, só alfanum e espaço)
function _normTexto(s) {
  return String(s||'')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9\s]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

// Extrai palavras relevantes (>= 4 letras, não stopword)
function _palavrasRelevantes(texto) {
  const stop = new Set(['vara','civel','civil','federal','estadual','processo','autos','contra','versus','comarca','tribunal','para','pela','pelo','pelos','pelas','sobre','desde','ante','este','esta','esse','essa','aqui','ali','como','porque','ltda','sociedade','empresa','individual','limitada']);
  return _normTexto(texto).split(/\s+/).filter(w => w.length >= 4 && !stop.has(w));
}

// Score 0-40: quantidade de nomes/palavras de "partes" que coincidem
function _scorePartes(analise, proc) {
  const palavrasAnalise = new Set(_palavrasRelevantes(analise.partes || ''));
  const palavrasProc = new Set([
    ..._palavrasRelevantes(proc.partes || ''),
    ..._palavrasRelevantes(proc.nome || '')
  ]);
  if(palavrasAnalise.size === 0 || palavrasProc.size === 0) return 0;
  let acertos = 0;
  for(const p of palavrasAnalise) if(palavrasProc.has(p)) acertos++;
  // Cada acerto vale 10 pts, cap em 40
  return Math.min(40, acertos * 10);
}

// Score 0-30: vara + cidade/comarca batem
function _scoreVara(analise, proc) {
  const t1 = _normTexto(analise.tribunal || '');
  const t2 = _normTexto(proc.tribunal || '');
  if(!t1 || !t2) return 0;

  // Extrai número da vara (ex: "2ª Vara", "2 vara", "segunda vara")
  const extrairVara = (txt) => {
    const m1 = txt.match(/(\d+)[ao]?\s*vara/);
    if(m1) return m1[1];
    const numerosPalavra = {primeira:'1',segunda:'2',terceira:'3',quarta:'4',quinta:'5',sexta:'6',setima:'7',oitava:'8',nona:'9',decima:'10'};
    for(const [k,v] of Object.entries(numerosPalavra)) if(txt.includes(k+' vara')) return v;
    return null;
  };

  const v1 = extrairVara(t1);
  const v2 = extrairVara(t2);

  // Extrai cidade/UF
  const cidades = ['unai','brasilia','belo horizonte','sao paulo','santo amaro','palmas','silves','bonfinopolis'];
  const cidade1 = cidades.find(c => t1.includes(c));
  const cidade2 = cidades.find(c => t2.includes(c));

  let score = 0;
  if(v1 && v2 && v1 === v2) score += 15;
  if(cidade1 && cidade2 && cidade1 === cidade2) score += 15;
  // Se palavras do tribunal batem (ex: "TJMG", "TRT")
  const palT1 = new Set(_palavrasRelevantes(t1));
  const palT2 = new Set(_palavrasRelevantes(t2));
  let acertos = 0;
  for(const p of palT1) if(palT2.has(p)) acertos++;
  score += Math.min(10, acertos * 3);

  return Math.min(30, score);
}

// Score 0-20: tipo de ação coincide
function _scoreTipo(analise, proc) {
  // Lex hoje não tem "tipo_acao" explícito, então compara tipo do documento + descrição + nome
  const t1 = _normTexto((analise.tipo||'') + ' ' + (analise.descricao||'') + ' ' + (analise.nome_caso||''));
  const t2 = _normTexto((proc.nome||'') + ' ' + (proc.descricao||'') + ' ' + (proc.area||''));
  if(!t1 || !t2) return 0;

  const tiposAcao = [
    'despejo','obrigacao de fazer','obrigacao fazer','execucao','embargos','apelacao',
    'monitoria','cobranca','indenizacao','declaratoria','anulatoria','mandado',
    'peticao inicial','contestacao','recurso','agravo','trabalhista','consumo',
    'familia','divorcio','inventario','alimentos','guarda','usucapiao','possessoria',
    'reintegracao','rescisoria','previdenciaria','tributaria','fiscal','habeas'
  ];

  let score = 0;
  for(const tipo of tiposAcao) {
    const em1 = t1.includes(tipo);
    const em2 = t2.includes(tipo);
    if(em1 && em2) { score += 20; break; } // acerto total
  }
  return Math.min(20, score);
}

// Score 0-10: área (cível, trabalhista, tributário, etc)
function _scoreArea(analise, proc) {
  const a1 = _normTexto(analise.area || '');
  const a2 = _normTexto(proc.area || '');
  if(!a1 || !a2) return 0;
  return a1 === a2 ? 10 : 0;
}

// Score 0-10: valor da causa ±10% (tolerante a OCR)
function _scoreValor(analise, proc) {
  const parseVal = (v) => {
    const s = String(v||'').replace(/[^0-9.,]/g,'').replace(/\./g,'').replace(',','.');
    const n = parseFloat(s);
    return isNaN(n) || n === 0 ? null : n;
  };
  const v1 = parseVal(analise.valor);
  const v2 = parseVal(proc.valor);
  if(!v1 || !v2) return 0;
  const diff = Math.abs(v1 - v2) / Math.max(v1, v2);
  return diff <= 0.1 ? 10 : 0;
}

// Score 0-15: juiz/relator confere — v3.0 — SEMPRE ATIVO (pedido de Kleuber)
// Se um dos lados não tem juiz registrado, retorna 0 (neutro, não penaliza)
function _scoreJuiz(analise, proc) {
  const j1 = _normTexto(analise.juiz_relator || '');
  const j2 = _normTexto(proc.juiz_relator || proc.juiz || '');
  if(!j1 || !j2) return 0;

  // Match exato da string normalizada: mesmo juiz com certeza
  if(j1 === j2) return 15;

  // Match por palavras relevantes (sobrenome ou nome principal)
  // Kleuber: o documento pode trazer "Des. Amauri Pinto Ferreira" e o cadastro
  //          "Amauri Ferreira" — precisa tolerar essa variação.
  const pal1 = new Set(_palavrasRelevantes(j1));
  const pal2 = new Set(_palavrasRelevantes(j2));
  if(pal1.size === 0 || pal2.size === 0) return 0;

  let acertos = 0;
  for(const p of pal1) if(pal2.has(p)) acertos++;

  if(acertos >= 2) return 15;  // 2+ palavras em comum: é o mesmo juiz
  if(acertos === 1) return 8;  // 1 palavra em comum: parcial, suspeita
  return 0;
}

// Score 0-10: instância (grau do processo) confere — v3.0 — SEMPRE ATIVO
function _scoreInstancia(analise, proc) {
  const i1 = _normTexto(analise.instancia || '');
  const i2 = _normTexto(proc.instancia || '');
  if(!i1 || !i2) return 0;

  // Normaliza grafias diversas da mesma instância
  const norm = (s) => {
    if(/1\s*a?\s*instancia|primeiro\s*grau|primeira\s*instancia|vara\s*civel|vara\s*federal|vara\s*do\s*trabalho/.test(s)) return '1a';
    if(/2\s*a?\s*instancia|segundo\s*grau|segunda\s*instancia|camara|desembargador|tjmg|tjsp|tjrs|tjba|trf|trt/.test(s)) return '2a';
    if(/stj|superior\s*tribunal\s*de\s*justica/.test(s)) return 'stj';
    if(/stf|supremo\s*tribunal\s*federal/.test(s)) return 'stf';
    if(/turma\s*recursal/.test(s)) return 'tr';
    if(/juizado\s*especial/.test(s)) return 'je';
    return s;
  };

  return norm(i1) === norm(i2) ? 10 : 0;
}

// Calcula score total + breakdown por critério
// v3.0: score máximo agora é 135 (antes 110). Adicionados juiz (15) + instancia (10).
function _calcularScore(analise, proc) {
  const breakdown = {
    partes: _scorePartes(analise, proc),
    vara: _scoreVara(analise, proc),
    tipo: _scoreTipo(analise, proc),
    juiz: _scoreJuiz(analise, proc),            // v3.0 — SEMPRE ATIVO
    instancia: _scoreInstancia(analise, proc),  // v3.0 — SEMPRE ATIVO
    area: _scoreArea(analise, proc),
    valor: _scoreValor(analise, proc)
  };
  const total = Object.values(breakdown).reduce((s,v)=>s+v, 0);
  return { total, breakdown };
}

/**
 * AGENTE ROTEADOR — retorna decisão estruturada.
 * Resultado possível:
 *   {tipo:'match_cnj', proc, confianca, criterio}
 *   {tipo:'match_score', proc, score, breakdown, confianca}
 *   {tipo:'ambiguo', candidatos:[{proc,score,breakdown}], razao}
 *   {tipo:'sem_match', melhorCandidato:{proc,score,breakdown}|null}
 */
function _agenteRoteador(analise) {
  if(!processos.length) return { tipo:'sem_match', melhorCandidato: null, razao:'banco vazio' };

  const numAnalise = _normCNJ(analise.numero_processo);

  // ── REGRA 1: CNJ exato ──
  if(numAnalise.length >= 15) {
    const exato = processos.find(p => _normCNJ(p.numero) === numAnalise);
    if(exato) return { tipo:'match_cnj', proc:exato, confianca:'certa', criterio:'CNJ exato ('+numAnalise+')' };
  }

  // ── REGRA 2: CNJ por últimos 15 dígitos (tolera erro de OCR) ──
  if(numAnalise.length >= 15) {
    const fim = numAnalise.slice(-15);
    const porFim = processos.find(p => {
      const pn = _normCNJ(p.numero);
      return pn.length >= 15 && pn.slice(-15) === fim;
    });
    if(porFim) return { tipo:'match_cnj', proc:porFim, confianca:'alta', criterio:'CNJ últimos 15 dígitos' };
  }

  // ── REGRA 3: Pontuação multi-critério ──
  // v3.0: score máximo subiu de 110 → 135 (juiz 15 + instancia 10 novos)
  // Thresholds recalibrados proporcionalmente.
  const scoresGerais = processos.map(proc => {
    const s = _calcularScore(analise, proc);
    return { proc, score: s.total, breakdown: s.breakdown };
  });
  scoresGerais.sort((a,b) => b.score - a.score);

  const melhor = scoresGerais[0];
  const segundo = scoresGerais[1] || { score: 0 };

  // Nenhum candidato decente (< 60 = menos de ~45% do máx)
  if(melhor.score < 60) {
    return { tipo:'sem_match', melhorCandidato: melhor.score >= 30 ? melhor : null, razao:'melhor score '+melhor.score+' < 60' };
  }

  // Ambiguidade: 2+ candidatos com score > 60 e diferença pequena
  const candidatosFortes = scoresGerais.filter(x => x.score >= 60);
  const diferenca = melhor.score - segundo.score;
  if(candidatosFortes.length >= 2 && diferenca < 25) {
    return {
      tipo:'ambiguo',
      candidatos: candidatosFortes.slice(0, 4), // máx 4 opções pra não poluir
      razao: candidatosFortes.length+' candidatos próximos (top='+melhor.score+', 2º='+segundo.score+')'
    };
  }

  // Match único confiante (≥ 95 = ~70% do máx)
  if(melhor.score >= 95) {
    return {
      tipo:'match_score',
      proc: melhor.proc,
      score: melhor.score,
      breakdown: melhor.breakdown,
      confianca: melhor.score >= 120 ? 'alta' : 'média'
    };
  }

  // Score 60-94: duvidoso, trata como ambíguo mesmo sem 2º candidato forte
  return {
    tipo:'ambiguo',
    candidatos: [melhor],
    razao: 'único candidato mas score médio ('+melhor.score+') — prefere confirmar'
  };
}

// Formata breakdown de score pra exibir
function _formatBreakdown(b) {
  return Object.entries(b).filter(([,v])=>v>0).map(([k,v])=>k+'='+v).join(', ');
}

// ════════════════════════════════════════════════════════════════════════════
// MATCHING LEGADO (v2.1) — mantido pra compatibilidade, NÃO usado no fluxo novo
// ════════════════════════════════════════════════════════════════════════════
// Faz matching de processo usando 3 estratégias em cascata
function _encontrarProcesso(analise) {
  if(!processos.length) return null;
  const numAnalise = _normCNJ(analise.numero_processo);
  const partesAnalise = String(analise.partes||'').toLowerCase();

  // Estratégia 1: número CNJ completo igual
  if(numAnalise.length >= 15) {
    const exato = processos.find(p => _normCNJ(p.numero) === numAnalise);
    if(exato) return {proc:exato, confianca:'alta', criterio:'número CNJ exato'};
  }

  // Estratégia 2: últimos 10 dígitos do CNJ (tolera erro de leitura)
  if(numAnalise.length >= 10) {
    const fim = numAnalise.slice(-10);
    const porFim = processos.find(p => {
      const pn = _normCNJ(p.numero);
      return pn.length >= 10 && pn.slice(-10) === fim;
    });
    if(porFim) return {proc:porFim, confianca:'alta', criterio:'últimos 10 dígitos CNJ'};
  }

  // Estratégia 3: similaridade de partes (nome que aparece em ambos)
  if(partesAnalise.length > 5) {
    // Extrai palavras relevantes das partes do PDF (4+ letras, não stop word)
    const stop = ['vara','cível','civil','federal','estadual','processo','autos','contra','versus','de','da','do','dos','das','em','e'];
    const palavrasAnalise = partesAnalise.split(/\s+/)
      .filter(w => w.length >= 4 && !stop.includes(w));

    for(const p of processos) {
      const procPartes = String(p.partes||'').toLowerCase();
      const procNome = String(p.nome||'').toLowerCase();
      const matches = palavrasAnalise.filter(w =>
        procPartes.includes(w) || procNome.includes(w)
      );
      // Se 2+ palavras bateram, é um candidato forte
      if(matches.length >= 2) {
        return {proc:p, confianca:'média', criterio:'partes: '+matches.slice(0,3).join(', ')};
      }
    }
  }

  return null;
}

// Gera "digital" de um andamento pra comparação robusta
function _fingerprintAndamento(a) {
  const data = String(a.data||'').replace(/\D/g,'');                       // só dígitos
  const txt = String(a.txt||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')                       // tira acentos
    .replace(/[^\w\s]/g,'')                                                 // tira pontuação
    .replace(/\s+/g,' ').trim()
    .substring(0,100);                                                      // primeiros 100 chars
  return data+'|'+txt;
}

// Compara andamentos novos (do PDF) vs existentes (cadastrados) e classifica
function _classificarAndamentos(novos, existentes) {
  const exist = (existentes||[]).map(_fingerprintAndamento);
  const resultado = {novos:[], duplicatas:[], jaExistentes:[]};

  for(const a of (novos||[])) {
    const fp = _fingerprintAndamento(a);
    if(exist.includes(fp)) {
      resultado.jaExistentes.push(a);
      continue;
    }
    // Checa duplicata parcial (mesma data, texto parecido)
    const mesmaData = exist.filter(e => e.split('|')[0] === fp.split('|')[0]);
    if(mesmaData.length > 0) {
      // Mesma data, texto diferente — pode ser andamento diferente ou variação
      // Usa distância de caracteres pra decidir
      const textoNovo = fp.split('|')[1] || '';
      const dup = mesmaData.find(e => {
        const textoExist = e.split('|')[1] || '';
        return textoNovo.substring(0,30) === textoExist.substring(0,30);
      });
      if(dup) { resultado.duplicatas.push(a); continue; }
    }
    resultado.novos.push(a);
  }
  return resultado;
}

// Cria processo novo quando não houve match nenhum
// v3.0: agora salva juiz_relator e instancia também
function _normalizarTipoProcesso(tipo, areaFallback) {
  const bruto = String(tipo || '').toLowerCase().trim();
  if (bruto === 'administrativo' || bruto === 'admin') return 'administrativo';
  if (bruto === 'judicial' || bruto === 'judiciario') return 'judicial';
  const area = String(areaFallback || '').toLowerCase();
  if (area.includes('administ')) return 'administrativo';
  return 'judicial';
}

function _normalizarSetorProcesso(setor, tipoFallback, areaFallback) {
  const s = String(setor || '').toLowerCase().trim();
  if (s === 'autuacao' || s === 'autuação') return 'autuacao';
  if (s === 'administrativo') return 'administrativo';
  if (s === 'judicial') return 'judicial';
  const tipo = _normalizarTipoProcesso(tipoFallback, areaFallback);
  if (tipo === 'administrativo') return 'administrativo';
  if (tipo === 'judicial') return 'judicial';
  return 'autuacao';
}

function _inferirTipoProcessoCadastro(analise, textoOpcional) {
  const txt = String(textoOpcional || '').toLowerCase();
  if (txt.includes('administrativ')) return 'administrativo';
  if (txt.includes('judicial')) return 'judicial';
  return _normalizarTipoProcesso(analise && analise.tipo, analise && analise.area);
}

async function _persistirProcessoNaTabela(proc, ctx, origem) {
  try {
    const payload = {
      nome: proc.nome || 'Processo sem nome',
      tipo: _normalizarTipoProcesso(proc.tipo, proc.area),
      setor: _normalizarSetorProcesso(proc.setor, proc.tipo, proc.area),
      area: proc.area || '',
      partes: proc.partes || '',
      status: proc.status || 'ATIVO',
      resumo: proc.descricao || '',
      tribunal: proc.tribunal || '',
      juiz_relator: proc.juiz_relator || '',
      instancia: proc.instancia || '',
      prazo: proc.prazo || '',
      proxacao: proc.proxacao || '',
      numero: proc.numero || '',
      valor_causa: proc.valor || '',
      docs_faltantes: proc.docsFaltantes || '',
      criado_por: (ctx && ctx.canal && ctx.chatId) ? (ctx.canal + '_' + ctx.chatId) : String(origem || 'agente'),
      criado_em: proc.criado_em || new Date().toISOString()
    };
    const r = await sbReq('POST', 'processos', payload, {}, {'Prefer':'return=representation'});
    if(!r.ok) {
      console.warn('[Lex][cadastro] falha ao salvar em processos:', r.status, JSON.stringify(r.body||{}).substring(0,200));
      return { ok:false, status:r.status, body:r.body };
    }
    return { ok:true, status:r.status, body:r.body };
  } catch(e) {
    console.warn('[Lex][cadastro] exceção ao salvar em processos:', e.message);
    return { ok:false, status:0, erro:e.message };
  }
}

function _cadastrarProcessoNovo(analise, arq, opcoes) {
  const tipoProcesso = _normalizarTipoProcesso(opcoes && opcoes.tipo, analise && analise.area);
  const setorProcesso = _normalizarSetorProcesso((opcoes && opcoes.setor) || 'autuacao', tipoProcesso, analise && analise.area);
  const novo = {
    id: Date.now() + Math.floor(Math.random()*1000),
    nome: analise.nome_caso || (analise.partes||'Novo processo').substring(0,50),
    tipo: tipoProcesso,
    setor: setorProcesso,
    numero: analise.numero_processo || '',
    partes: analise.partes || '',
    area: analise.area || '',
    tribunal: analise.tribunal || '',
    juiz_relator: analise.juiz_relator || '',   // v3.0 — NOVO
    instancia: analise.instancia || '',          // v3.0 — NOVO
    status: setorProcesso === 'autuacao' ? 'EM_PREP' : (analise.status || 'ATIVO'),
    prazo: analise.prazo || '',
    prazoReal: '',
    prevDist: '',
    proxacao: analise.proxima_acao || '',
    valor: analise.valor || '',
    descricao: analise.descricao || analise.resumo || '',
    frentes: (analise.frentes||'').split(',').map(f=>f.trim()).filter(Boolean),
    provas: [],
    andamentos: analise.andamentos || [],
    arquivos: [arq.nome],
    docsFaltantes: analise.documentos_necessarios || '',
    atualizado_em: new Date().toISOString(),     // v3.0 — timestamp explícito
    criado_em: new Date().toISOString()          // v3.0 — auditoria
  };
  processos.push(novo);
  return novo;
}

// ── O AGENTE propriamente dito ──
async function agenteAtualizacaoProcessual(ctx, mem, arq, analise) {
  // Formata resposta estruturada no estilo que Kleuber pediu:
  //   [CABEÇALHO]  identificação do processo
  //   [ANÁLISE]    o que mudou
  //   [AÇÃO]       o que o Lex fez
  //   [ESTRATÉGIA] orientação + próximos passos

  // NOVO: usa o Agente Roteador v1 (pontuação multi-critério)
  const decisao = _agenteRoteador(analise);

  // Log da decisão do roteador (sempre)
  try {
    await logAtividade('juridico', ctx.chatId, 'roteador_'+decisao.tipo,
      JSON.stringify({
        arq: arq.nome,
        cnj: analise.numero_processo||'',
        partes: (analise.partes||'').substring(0,100),
        proc_id: decisao.proc?.id || null,
        proc_nome: decisao.proc?.nome || null,
        score: decisao.score || null,
        razao: decisao.razao || decisao.criterio || null
      }).substring(0,480));
  } catch(_){ console.warn('[Lex][bot] Erro silenciado:', (_ && _.message) ? _.message : _); }

  // ── CASO A: AMBÍGUO — PERGUNTA pro advogado escolher ──
  if(decisao.tipo === 'ambiguo') {
    mem.aguardando = 'escolher_processo_ambiguo';
    mem.dadosColetados.analisePendente = analise;
    mem.dadosColetados.arqPendente = { nome: arq.nome };
    mem.dadosColetados.candidatosAmbiguos = decisao.candidatos.map(c => ({
      proc_id: c.proc.id,
      proc_nome: c.proc.nome,
      score: c.score
    }));

    let txt = '🤔 Encontrei '+decisao.candidatos.length+' processos possíveis que batem com este documento:\n\n';
    txt += 'DOCUMENTO: '+arq.nome+'\n';
    if(analise.numero_processo) txt += 'CNJ no PDF: '+analise.numero_processo+'\n';
    if(analise.partes) txt += 'Partes: '+analise.partes+'\n';
    if(analise.tribunal) txt += 'Tribunal: '+analise.tribunal+'\n';
    txt += '\nCANDIDATOS:\n';
    decisao.candidatos.forEach((c, i) => {
      const p = c.proc;
      txt += (i+1)+') '+p.nome;
      if(p.numero) txt += ' — '+p.numero;
      if(p.tribunal) txt += ' ('+p.tribunal+')';
      txt += ' — score '+c.score;
      if(c.breakdown) txt += ' ['+_formatBreakdown(c.breakdown)+']';
      txt += '\n';
    });
    txt += '\n➡ Responda com o NÚMERO (1, 2, 3...) do processo correto, "NOVO" se for processo ainda não cadastrado, ou "IGNORAR" pra só analisar sem vincular.';
    await env(txt, ctx);
    return;
  }

  // ── CASO B: SEM MATCH — PERGUNTA 1/2/3 (v3.0, pedido de Kleuber) ──
  if(decisao.tipo === 'sem_match') {
    mem.aguardando = 'sem_match_123';
    mem.dadosColetados.analisePendente = analise;
    mem.dadosColetados.arqPendente = { nome: arq.nome };
    mem.dadosColetados.melhorCandidato = decisao.melhorCandidato ? {
      proc_id: decisao.melhorCandidato.proc.id,
      proc_nome: decisao.melhorCandidato.proc.nome,
      score: decisao.melhorCandidato.score
    } : null;

    let txt = '🆕 Processo NÃO LOCALIZADO no LEX.\n\n';
    txt += 'DOCUMENTO: '+arq.nome+'\n';
    if(analise.numero_processo) txt += 'CNJ: '+analise.numero_processo+'\n';
    if(analise.partes) txt += 'Partes: '+analise.partes+'\n';
    if(analise.tribunal) txt += 'Tribunal: '+analise.tribunal+'\n';
    if(analise.juiz_relator) txt += 'Juiz/Relator: '+analise.juiz_relator+'\n';
    if(analise.instancia) txt += 'Instância: '+analise.instancia+'\n';
    if(analise.area) txt += 'Área: '+analise.area+'\n';
    if(analise.resumo) txt += '\nResumo:\n'+analise.resumo.substring(0,300)+'\n';

    if(decisao.melhorCandidato) {
      const m = decisao.melhorCandidato;
      txt += '\n⚠ Candidato mais próximo (score baixo = '+m.score+'): "'+m.proc.nome+'"';
      if(m.proc.numero) txt += ' — '+m.proc.numero;
    }

    txt += '\n\n➡ Responda:\n';
    txt += '1 — Cadastrar como processo NOVO (responda "1 administrativo" para tipo administrativo)\n';
    txt += '2 — Cancelar (não cadastrar)\n';
    txt += '3 — Só consultoria/explicação (não grava nada)';

    await env(txt, ctx);
    return;
  }

  // ── CASO C: MATCH ENCONTRADO — SEMPRE PERGUNTA 1/2/3 (v3.0, pedido de Kleuber) ──
  // Comportamento anterior (v2.9): atualizava direto quando CNJ exato batia.
  // Comportamento novo (v3.0): SEMPRE exibe os dados do processo localizado
  // e pergunta se é NOVO, CONFIRMAR andamento, ou só consultoria.
  const proc = decisao.proc;
  const criterio = decisao.criterio || ('score '+decisao.score+' ['+_formatBreakdown(decisao.breakdown||{})+']');
  const confianca = decisao.confianca || (decisao.score >= 120 ? 'alta' : 'média');

  // Classifica andamentos antes de perguntar (só pra mostrar no preview)
  const classifPreview = _classificarAndamentos(analise.andamentos, proc.andamentos||[]);

  // Salva estado pendente pro handler 1/2/3 finalizar
  mem.aguardando = 'confirmar_andamento_123';
  mem.dadosColetados.analisePendente = analise;
  mem.dadosColetados.arqPendente = { nome: arq.nome };
  mem.dadosColetados.processoMatch = {
    proc_id: proc.id,
    proc_numero: proc.numero,
    proc_nome: proc.nome,
    criterio: criterio,
    confianca: confianca,
    adicionados_preview: classifPreview.novos.length,
    ja_existentes_preview: classifPreview.jaExistentes.length
  };

  // Último andamento do processo cadastrado (pra exibição)
  const ultimoAnd = (proc.andamentos && proc.andamentos.length)
    ? ((proc.andamentos[0].data||'?')+': '+String(proc.andamentos[0].txt||'').substring(0,150))
    : '(sem andamentos registrados)';

  // Monta a mensagem de confirmação estruturada
  let txt = '✅ Processo LOCALIZADO no LEX:\n\n';
  txt += 'Nº: '+(proc.numero || '(sem CNJ cadastrado)')+'\n';
  txt += 'Nome: '+proc.nome+'\n';
  if(proc.partes) txt += 'Partes: '+proc.partes+'\n';
  if(proc.tribunal) txt += 'Tribunal: '+proc.tribunal+'\n';
  if(proc.juiz_relator) txt += 'Juiz/Relator: '+proc.juiz_relator+'\n';
  if(proc.instancia) txt += 'Instância: '+proc.instancia+'\n';
  if(proc.area) txt += 'Área: '+proc.area+'\n';
  if(proc.status) txt += 'Status: '+proc.status+'\n';
  if(proc.prazo) txt += 'Prazo atual: '+proc.prazo+'\n';
  txt += 'Último andamento: '+ultimoAnd+'\n';
  txt += '\n━━━━━━━━━━━━━━━━━━━━\n';
  txt += 'DOCUMENTO RECEBIDO: '+arq.nome+'\n';
  if(analise.numero_processo) txt += 'CNJ extraído: '+analise.numero_processo+'\n';
  if(analise.partes) txt += 'Partes extraídas: '+analise.partes+'\n';
  if(analise.tribunal) txt += 'Tribunal extraído: '+analise.tribunal+'\n';
  if(analise.juiz_relator) txt += 'Juiz extraído: '+analise.juiz_relator+'\n';
  if(analise.instancia) txt += 'Instância extraída: '+analise.instancia+'\n';
  if(classifPreview.novos.length > 0) {
    txt += '→ '+classifPreview.novos.length+' andamento(s) NOVO(S) neste doc';
    if(classifPreview.jaExistentes.length > 0) txt += ' ('+classifPreview.jaExistentes.length+' já cadastrados)';
    txt += '\n';
  } else if(classifPreview.jaExistentes.length > 0) {
    txt += '→ Todos os '+classifPreview.jaExistentes.length+' andamentos já estão cadastrados (doc sem novidades)\n';
  }
  txt += '\nCritério do match: '+criterio+' (confiança: '+confianca+')\n';
  txt += '\n━━━━━━━━━━━━━━━━━━━━\n';
  txt += '➡ Responda:\n';
  txt += '1 — É processo NOVO (responda "1 administrativo" para tipo administrativo)\n';
  txt += '2 — CONFIRMAR: é andamento deste processo (atualiza cadastro)\n';
  txt += '3 — Só consultoria/explicação (não grava nada)';

  await env(txt, ctx);

  // Log da ação de "aguardando confirmação" pra auditoria
  logAtividade('juridico', ctx.chatId, 'aguardando_conf_123',
    proc.nome+' | criterio='+criterio+' | novos='+classifPreview.novos.length);

  return; // o fluxo continua no handler confirmar_andamento_123 em _conversaInteligente
}

// ════════════════════════════════════════════════════════════════════════════
// APLICA ATUALIZAÇÃO DE ANDAMENTO NO PROCESSO (v3.0)
// Extraído do CASO C antigo. Chamado depois que Kleuber responde "2" no
// fluxo de confirmação 1/2/3 (handler confirmar_andamento_123 abaixo).
// ════════════════════════════════════════════════════════════════════════════
async function _aplicarAtualizacaoNoProcesso(ctx, mem, arq, analise, proc) {
  const idx = processos.findIndex(p => p.id === proc.id);
  if(idx < 0) {
    await env('⚠ Processo não encontrado mais. Operação cancelada.', ctx);
    return;
  }

  // Classifica andamentos (fingerprint dedup)
  const classif = _classificarAndamentos(analise.andamentos, processos[idx].andamentos||[]);

  const setorAtual = _normalizarSetorProcesso(processos[idx].setor, processos[idx].tipo, processos[idx].area);
  const houveMudancaPrazo = analise.prazo && analise.prazo !== processos[idx].prazo;
  const houveMudancaStatus = analise.status && analise.status !== 'AGUARDANDO' && analise.status !== processos[idx].status;
  const houveMudancaAcao = analise.proxima_acao && analise.proxima_acao !== processos[idx].proxacao;

  // Aplica atualizações
  let adicionados = 0;
  if(classif.novos.length > 0) {
    if(!processos[idx].andamentos) processos[idx].andamentos = [];
    for(const a of classif.novos) {
      processos[idx].andamentos.unshift(a);
      adicionados++;
    }
  }
  if(houveMudancaPrazo) processos[idx].prazo = analise.prazo;
  if(houveMudancaStatus) processos[idx].status = analise.status;
  if(houveMudancaAcao) processos[idx].proxacao = analise.proxima_acao;

  // v3.0: preenche juiz/instancia se estavam vazios no cadastro
  if(!processos[idx].juiz_relator && analise.juiz_relator) processos[idx].juiz_relator = analise.juiz_relator;
  if(!processos[idx].instancia && analise.instancia) processos[idx].instancia = analise.instancia;

  // CICLO DE URGÊNCIA:
  // - autuacao: mantém EM_PREP
  // - administrativo/judicial: atualização válida volta para ATIVO
  if(adicionados > 0) {
    if(setorAtual === 'autuacao') {
      processos[idx].status = 'EM_PREP';
    } else {
      processos[idx].status = 'ATIVO';
    }
  }

  // Atualiza arquivos vinculados
  if(!processos[idx].arquivos) processos[idx].arquivos = [];
  if(!processos[idx].arquivos.includes(arq.nome)) processos[idx].arquivos.push(arq.nome);

  // Atualiza timestamp
  processos[idx].atualizado_em = new Date().toISOString();

  const houveAlgumaMudanca = adicionados > 0 || houveMudancaPrazo || houveMudancaStatus || houveMudancaAcao;

  if(houveAlgumaMudanca) {
    _bumpProcessos(ctx.canal+':'+ctx.chatId);
    await _persistirProcessosCache();
    const resumoMemoria = [];
    if(adicionados > 0) resumoMemoria.push(adicionados+' andamento(s) novo(s)');
    if(houveMudancaPrazo) resumoMemoria.push('prazo: '+analise.prazo);
    if(houveMudancaStatus) resumoMemoria.push('status: '+analise.status);
    if(houveMudancaAcao) resumoMemoria.push('próxima ação: '+analise.proxima_acao);
    await lembrarDoCaso(
      proc.nome, 'andamento',
      arq.nome+' → '+resumoMemoria.join(' | '),
      ctx.canal
    );
    await enfileirarComando({
      acao:'editar_processo',
      id:proc.id,
      nome:proc.nome,
      dados:{
        prazo: processos[idx].prazo,
        status: processos[idx].status,
        proxacao: processos[idx].proxacao,
        juiz_relator: processos[idx].juiz_relator,
        instancia: processos[idx].instancia,
        andamentos: processos[idx].andamentos
      }
    });
  } else {
    await lembrarDoCaso(proc.nome, 'documento_analisado',
      arq.nome+' (sem novidades — tudo já estava registrado)',
      ctx.canal);
  }

  logAtividade('juridico', ctx.chatId, 'agente_atualizacao_confirmada',
    proc.nome+': +'+adicionados+' and, '+(houveMudancaPrazo?'prazo,':'')+(houveMudancaStatus?'status,':'')+(houveMudancaAcao?'ação':''));

  // ── MONTA RELATÓRIO ESTRUTURADO ──
  let rel = '📋 '+proc.nome+'\n';
  if(proc.numero) rel += 'Nº: '+proc.numero+'\n';
  if(proc.tribunal) rel += 'Tribunal: '+proc.tribunal+'\n';
  rel += '━━━━━━━━━━━━━━━━━━━━\n';

  if(houveAlgumaMudanca) {
    rel += '✅ ATUALIZADO (confirmado por você)\n\n';
    if(adicionados > 0) {
      rel += '📥 '+adicionados+' andamento(s) novo(s):\n';
      classif.novos.slice(0,3).forEach(a => {
        rel += '  • '+(a.data||'?')+' — '+String(a.txt||'').substring(0,100)+'\n';
      });
      if(classif.novos.length > 3) rel += '  • (+'+(classif.novos.length-3)+' andamentos)\n';
      rel += '\n';
    }
    if(houveMudancaPrazo) rel += '📅 Prazo: '+(proc.prazo||'—')+' → '+analise.prazo+'\n';
    if(houveMudancaStatus) rel += '🔖 Status: '+(proc.status||'—')+' → '+processos[idx].status+'\n';
    if(houveMudancaAcao) rel += '➡ Próxima ação: '+analise.proxima_acao+'\n';
    rel += '\n';
  } else {
    rel += '✓ SEM NOVIDADES — tudo já estava no Lex\n\n';
  }

  if(classif.jaExistentes.length > 0) {
    rel += '↩ '+classif.jaExistentes.length+' andamento(s) já cadastrado(s) — ignorado(s)\n';
  }
  if(classif.duplicatas.length > 0) {
    rel += '⚠ '+classif.duplicatas.length+' andamento(s) com mesma data mas texto diferente — CONFIRA manualmente\n';
  }

  // ── PRAZO URGENTE ──
  if(processos[idx].prazo) {
    const d = calcDias(processos[idx].prazo);
    if(d !== null) {
      rel += '\n';
      if(d < 0) rel += '🔴 PRAZO VENCIDO há '+Math.abs(d)+' dia(s): '+processos[idx].prazo;
      else if(d === 0) rel += '🚨 PRAZO VENCE HOJE: '+processos[idx].prazo;
      else if(d <= 3) rel += '⚠ PRAZO URGENTE — '+d+' DIA(S): '+processos[idx].prazo;
      else rel += 'Prazo: '+processos[idx].prazo+' ('+d+' dias)';
    }
  }

  // ── ANÁLISE ESTRATÉGICA (instrução permanente do Kleuber) ──
  if(analise.eh_decisao || analise.resposta_sugerida) {
    rel += '\n\n━━━ ANÁLISE ESTRATÉGICA ━━━';
    if(analise.resposta_sugerida) rel += '\n💼 Peça sugerida: '+analise.resposta_sugerida;
    if(analise.documentos_necessarios) rel += '\n📎 Documentos necessários: '+analise.documentos_necessarios;
    if(analise.custas_necessarias) rel += '\n💰 Exige custas processuais';
    if(analise.jurisprudencia) rel += '\n⚖ Jurisprudência: '+analise.jurisprudencia;
  }

  await env(rel, ctx);

  // Se é decisão/intimação, oferece gerar resposta
  if(['decisao','sentenca','despacho','intimacao'].includes(analise.tipo) && analise.resposta_sugerida) {
    setTimeout(()=>env('Para gerar a peça: "Gera '+analise.resposta_sugerida+' para '+proc.nome+'"', ctx), 1500);
  }

  mem.casoAtual = proc.nome;
  salvarMemoria(ctx.chatId, ctx.threadId);
}

async function _processarArquivo(ctx, mem, arq) {
  // Guarda o flag se estava aguardando PDF pós-cumprimento (o worker vai precisar)
  const aguardandoPdfProc = mem.aguardando==='pdf_peticao' && mem.dadosColetados?.processoPdfNome;

  // Se estava aguardando PDF específico, limpa o aguardando ANTES de enfileirar
  // (senão se chegar outra msg, memória ainda acha que tá aguardando)
  const analisePreviaMem = aguardandoPdfProc; // passa pro worker

  // Enfileira (responde imediato e processa em background)
  await _enfileirarAnalise(ctx, mem, arq, analisePreviaMem);
}

async function _processarImagem(ctx, mem, img) {
  await env('📷 Analisando imagem...', ctx);
  try {
    const base64 = img.buffer.toString('base64');
    const resposta = await ia([{role:'user', content:[
      {type:'image', source:{type:'base64', media_type:img.mime||'image/jpeg', data:base64}},
      {type:'text', text:'Analise esta imagem juridicamente. Se for decisão, despacho, sentença ou documento processual: identifique tipo, partes, número do processo, conteúdo, prazo e próxima ação. Senão, descreva e como pode ser relevante. Português, objetivo, técnico.'}
    ]}], null, 1500);
    await env(resposta, ctx);
    mem.hist.push({role:'user', content:'[Imagem]'});
    mem.hist.push({role:'assistant', content:'[Análise: '+resposta.substring(0,200)+']'});
    salvarMemoria(ctx.chatId, ctx.threadId);
    if(mem.casoAtual) await lembrarDoCaso(mem.casoAtual, 'observacao', 'Imagem analisada: '+resposta.substring(0,400), ctx.canal);
    logAtividade('juridico', ctx.chatId, 'imagem_analisada', 'OK');
  } catch(e) { await env('Erro ao analisar imagem: '+e.message, ctx); }
}

// ════════════════════════════════════════════════════════════════════════════
// VERSIONAMENTO E PERSISTÊNCIA DOS PROCESSOS (cache Supabase)
// ════════════════════════════════════════════════════════════════════════════
// ── SSE: mapa de clientes conectados (clientId → res) ──
// Usado por /api/sse (leitura) e /api/sync-push (escrita/notificação)
const _sseClientes = new Map();

// Helper: notifica todos clientes SSE com um evento genérico
function _sseNotificar(evento, dados) {
  if(_sseClientes.size === 0) return;
  const linha = 'event: '+evento+'\ndata: '+JSON.stringify({...dados, ts: Date.now()})+'\n\n';
  for(const [cid, cres] of _sseClientes) {
    try { cres.write(linha); }
    catch(e) { _sseClientes.delete(cid); }
  }
}

function _bumpProcessos(quem) {
  processosVersao = Date.now();
  processosUltimoAparelho = quem||'desconhecido';
  _alertarProcessosParados();
  // Notifica clientes SSE sempre que versão muda (ex: sincronizar, upload, comando)
  _sseNotificar('processos_atualizados', {
    versao: processosVersao,
    total: processos.length,
    aparelho: processosUltimoAparelho
  });
}

function _alertarProcessosParados() {
  const hoje = horaBrasilia();
  for(const p of processos || []) {
    if(!p || !['URGENTE','ATIVO','EM_PREP'].includes(String(p.status||'').toUpperCase())) continue;
    let dataRef = null;
    if(Array.isArray(p.andamentos) && p.andamentos.length) {
      const and = p.andamentos[0];
      if(and && and.data) {
        const m = String(and.data).match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if(m) dataRef = new Date(+m[3], +m[2]-1, +m[1]);
      }
    }
    if(!dataRef && p.atualizado_em) {
      const dt = new Date(p.atualizado_em);
      if(!isNaN(dt.getTime())) dataRef = dt;
    }
    if(!dataRef) continue;
    dataRef.setHours(0,0,0,0);
    const base = new Date(hoje.getTime()); base.setHours(0,0,0,0);
    const dias = Math.round((base - dataRef)/(1000*60*60*24));
    if(dias <= 10) continue;
    const ultima = ('0'+dataRef.getDate()).slice(-2)+'/'+('0'+(dataRef.getMonth()+1)).slice(-2)+'/'+dataRef.getFullYear();
    const nome = p.nome || p.numero || 'Processo sem nome';
    const nivel = dias > 30 ? 'CRITICO' : (dias > 20 ? 'URGENTE' : 'ALERTA');
    const msg = (nivel === 'ALERTA' ? '' : nivel+' - ')+'ALERTA: Processo '+nome+' esta parado ha '+dias+' dias. Ultima atualizacao: '+ultima+'. Verificar andamento.';
    const chave = '_ultimo_alerta_parado_'+nivel.toLowerCase();
    const ja = p[chave] ? new Date(p[chave]).getTime() : 0;
    if(!ja || (Date.now() - ja) > 24*60*60*1000) {
      envTelegram(msg, null, CHAT_ID).catch(()=>{});
      p[chave] = new Date().toISOString();
    }
  }
}

async function _persistirProcessosCache() {
  try {
    await sbUpsert('processos_cache', {
      id:'lex_juridico',
      dados: JSON.stringify(processos),
      total: processos.length,
      versao: processosVersao,
      ultimo_aparelho: processosUltimoAparelho,
      atualizado_em: new Date().toISOString()
    }, 'id');
  } catch(e) { console.warn('Cache Supabase erro:', e.message); }
}

// ════════════════════════════════════════════════════════════════════════════
// ADAPTERS — recebem evento Telegram/WhatsApp e chamam processarMensagem
// ════════════════════════════════════════════════════════════════════════════

// ── TELEGRAM adapter ──
async function adapterTelegram(msg) {
  const chatId = String(msg.chat.id);
  const tId = msg.message_thread_id || null;
  const ctx = {
    canal: 'telegram',
    chatId,
    threadId: tId,
    numero: null,
    nomeUsuario: msg.chat.first_name || msg.chat.username || chatId,
    tipoChat: msg.chat.type
  };

  // Imagem
  if(msg.photo || (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/'))) {
    const fileObj = msg.photo ? msg.photo[msg.photo.length-1] : msg.document;
    try {
      const buf = await baixarTelegram(fileObj.file_id);
      return processarMensagem(ctx, {imagem: {buffer:buf, mime:msg.document?.mime_type||'image/jpeg'}});
    } catch(e) { return env('Erro ao baixar imagem: '+e.message, ctx); }
  }

  // Documento
  if(msg.document) {
    const doc = msg.document;
    const nome = doc.file_name||'documento';
    const isPdf = doc.mime_type==='application/pdf' || nome.toLowerCase().endsWith('.pdf');
    const isOk = isPdf || nome.toLowerCase().match(/\.(docx?|txt)$/);
    if(!isOk) { await env('Formato não suportado. Envie PDF, DOCX, TXT ou imagem.', ctx); return; }
    if(doc.file_size > 20971520) {
      await env('📎 Arquivo de '+Math.round(doc.file_size/1048576)+'MB acima do limite do Telegram Bot (20MB).\n\nOpções:\n• Reduzir qualidade do PDF (iPhone: app "PDF Compressor")\n• Enviar em 2-3 arquivos menores — o Lex consolida automaticamente\n• Aguardar ativação do WhatsApp (aceita até 100MB)\n\n💡 Sem limite de páginas — mando o Lex processar PDFs gigantes internamente. A limitação é só do tamanho do arquivo físico no Telegram.', ctx);
      return;
    }
    try {
      const buf = await baixarTelegram(doc.file_id);
      return processarMensagem(ctx, {arquivo: {buffer:buf, nome, mime:doc.mime_type, isPdf}});
    } catch(e) { return env('Erro ao baixar arquivo: '+e.message, ctx); }
  }

  // Áudio/Voz
  if(msg.voice || msg.audio) {
    try {
      const f = msg.voice || msg.audio;
      const buf = await baixarTelegram(f.file_id);
      return processarMensagem(ctx, {audio: {buffer:buf, mime:f.mime_type||'audio/ogg', nome:f.file_name||'audio.ogg'}});
    } catch(e) { return env('Erro ao baixar áudio: '+e.message, ctx); }
  }

  // Texto
  const textoTg = msg.text || '';
  
  // ── /resp <texto> — Operador responde cliente via Telegram (mediação Lex) ──
  if(/^\/resp\s+/i.test(textoTg.trim()) && (isAdmin(chatId) || _isTelegramSecretaria(chatId))) {
    const respTexto = textoTg.trim().replace(/^\/resp\s+/i, '').trim();
    if(!respTexto) return env('Use: /resp <mensagem para o cliente>', ctx);
    const quem = isAdmin(chatId) ? 'kleuber' : 'secretaria';
    const result = await _registrarRespostaAdvogadoWhats(respTexto, quem).catch(()=>({notificados:0}));
    if(result.notificados > 0) {
      return env('✅ Resposta enviada ao cliente (aperfeiçoada pelo Lex).\n' + (quem === 'secretaria' ? 'Kleuber foi notificado.' : ''), ctx);
    } else {
      return env('⚠️ Nenhum cliente aguardando retorno no momento.', ctx);
    }
  }
  
  // ── /autorizo — Operador autoriza orientações sugeridas pelo Lex ──
  if(/^\/(autorizo|pode|manda)/i.test(textoTg.trim()) && isAdmin(chatId)) {
    const foi = await _processarAutorizacaoLex(textoTg).catch(()=>false);
    if(foi) return env('✅ Orientações enviadas ao cliente!', ctx);
    return env('Nenhuma orientação pendente de autorização.', ctx);
  }
  
  return processarMensagem(ctx, {texto: textoTg});
}

// ── EVOLUTION (WhatsApp) adapter ──
async function adapterEvolution(body) {
  const data = body.data || body;
  const msgData = data.message || {};
  const chatIdWpp = data.key?.remoteJid || '';
  const nomeEnv = data.pushName || chatIdWpp.split('@')[0];
  const ctx = {
    canal: 'whatsapp',
    chatId: chatIdWpp,
    threadId: null,
    numero: chatIdWpp,
    nomeUsuario: nomeEnv,
    tipoChat: 'private'
  };

  if(_configRuntime.secretario_whatsapp?.ativo) {
    const numeroPlano = _numeroPlanoWhats(chatIdWpp);
    const operador = _isOperadorWhatsApp(numeroPlano);
    
    if(operador) {
      // ── MENSAGEM DE OPERADOR (Kleuber ou Secretária) ──
      const txtOp = msgData.conversation || msgData.extendedTextMessage?.text || '';
      
      // /novocaso — qualquer operador pode cadastrar
      if(txtOp.trim() && /^\/novocaso/i.test(txtOp.trim())) {
        return processarMensagem(ctx, {texto: txtOp.trim()});
      }
      
      // /configsecretaria <chat_id> — Kleuber configura o Telegram da secretária
      if(operador.perfil === 'admin' && /^\/configsecretaria\s+(\d+)/i.test(txtOp.trim())) {
        const match = txtOp.trim().match(/^\/configsecretaria\s+(\d+)/i);
        if(match) {
          const secChatId = match[1];
          if(!_configRuntime.secretario_whatsapp.operadores) _configRuntime.secretario_whatsapp.operadores = {...SECRETARIO_WHATSAPP_CONFIG.operadores};
          _configRuntime.secretario_whatsapp.operadores.secretaria.telegram_chat_id = secChatId;
          // Salva no Supabase pra persistir
          try { await sbReq('POST', 'config', { chave: 'secretaria_telegram_chat_id', valor: secChatId }, {}, { onConflict: 'chave', merge: 'valor' }); } catch(e) {}
          await envWhatsApp('✅ Secretária configurada! Telegram Chat ID: ' + secChatId + '\nEla vai receber notificações de escalonamento junto com você.', chatIdWpp).catch(()=>{});
          await envTelegram('✅ Secretária configurada no Telegram (Chat ID: ' + secChatId + '). Ela vai receber as notificações de escalonamento.', null, CHAT_ID).catch(()=>{});
          if(secChatId) {
            await envTelegram('👋 Olá! Sou o Lex, assistente do escritório Camargos Advocacia.\n\nVocê foi configurada como secretária. A partir de agora vai receber as notificações de escalonamento dos clientes do WhatsApp.\n\nPode responder com instruções que eu repasso pro cliente!', null, secChatId).catch(()=>{});
          }
          return;
        }
      }
      
      // Modo intake ativo — redireciona tudo pro processarMensagem
      if(global._intakeSessoes && global._intakeSessoes[chatIdWpp]) {
        if(txtOp.trim()) return processarMensagem(ctx, {texto: txtOp.trim()});
        const docMsg2 = msgData.documentMessage || msgData.documentWithCaptionMessage?.message?.documentMessage;
        const imgMsg2 = msgData.imageMessage;
        if(docMsg2 || imgMsg2) {
          const b64 = docMsg2?.base64 || imgMsg2?.base64 || body.base64 || '';
          if(b64) {
            const bufI = Buffer.from(b64, 'base64');
            if(imgMsg2) return processarMensagem(ctx, {imagem: {buffer:bufI, mime:imgMsg2.mimetype||'image/jpeg'}});
            return processarMensagem(ctx, {arquivo: {buffer:bufI, nome:docMsg2?.fileName||'doc.pdf', mime:docMsg2?.mimetype||'application/pdf'}});
          }
        }
        return;
      }
      
      if(txtOp.trim()) {
        // Autorização de orientações — só admin pode
        if(operador.pode_autorizar) {
          const foiAutorizacao = await _processarAutorizacaoLex(txtOp).catch(()=>false);
          if(foiAutorizacao) return;
        }
        
        // Resposta para cliente escalado — qualquer operador pode
        if(operador.pode_responder) {
          // Se secretária está respondendo, avisa Kleuber no Telegram
          if(operador.perfil === 'secretaria') {
            const pendentes = _estadoSecretarioWhatsApp.escalonamentos_memoria.filter(x => !x.resolvido);
            if(pendentes.length > 0) {
              await envTelegram('📨 *Secretária respondeu cliente escalado:*\n"' + txtOp.substring(0, 200) + '"', null, CHAT_ID).catch(()=>{});
            }
          }
          await _registrarRespostaAdvogadoWhats(txtOp, operador.nome).catch(()=>{});
        }
      }
      return;
    }
  }

  // Texto
  const textoWpp = msgData.conversation || msgData.extendedTextMessage?.text || '';
  if(textoWpp.trim()) {
    if(_configRuntime.secretario_whatsapp?.ativo) {
      const sessao = await _carregarSessaoSecretarioWhatsApp(chatIdWpp, null);
      const out = await _conversarWhatsAppCliente(chatIdWpp, textoWpp, sessao);
      if(out && out.ok && out.resposta) {
        await envWhatsApp(out.resposta, chatIdWpp).catch(()=>{});
        return;
      }
    }
    return processarMensagem(ctx, {texto: textoWpp});
  }

  // Documento ou imagem
  const docMsg = msgData.documentMessage || msgData.documentWithCaptionMessage?.message?.documentMessage;
  const imgMsg = msgData.imageMessage;

  if(docMsg || imgMsg) {
    const nomeArq = docMsg?.fileName || (imgMsg && 'foto_whatsapp.jpg') || 'arquivo.pdf';
    const mimeType = docMsg?.mimetype || imgMsg?.mimetype || 'application/pdf';
    const base64 = docMsg?.base64 || imgMsg?.base64 || body.base64 || '';

    if(!base64) {
      await env('📱 '+nomeEnv+' enviou '+nomeArq+'\n⚠️ Configure "base64: true" na Evolution API.', ctx);
      await envTelegram('📱 WhatsApp '+nomeEnv+' enviou arquivo sem base64: '+nomeArq, null, CHAT_ID).catch(()=>{});
      return;
    }

    const buf = Buffer.from(base64, 'base64');
    const tamMB = buf.length / (1024*1024);

    // LIMITE WHATSAPP: 100MB (protocolo da Meta, não há como contornar)
    if(tamMB > 100) {
      await env('📎 Arquivo de '+tamMB.toFixed(1)+'MB acima do limite do WhatsApp (100MB).\n\nOpções:\n• Reduzir qualidade do PDF (compressor online)\n• Enviar em 2-3 arquivos menores — o Lex consolida automaticamente\n• Enviar pelo painel web do Lex (sem limite)', ctx);
      await envTelegram('📱 WhatsApp '+nomeEnv+' tentou mandar '+nomeArq+' ('+tamMB.toFixed(1)+'MB) — acima do limite', null, CHAT_ID).catch(()=>{});
      return;
    }

    // AVISO DE ARQUIVO GRANDE: > 30MB demora muito, informa o usuário
    if(tamMB > 30 && docMsg) {
      const pgsEstimadas = Math.round(tamMB * 7); // heurística ~7pg/MB
      const chunksEstimados = Math.ceil(pgsEstimadas / PDF_PGS_POR_CHUNK);
      const tempoMin = Math.round(chunksEstimados * 40 / 60);
      console.log('[wpp] arquivo grande: '+nomeArq+' '+tamMB.toFixed(1)+'MB ~'+pgsEstimadas+'pg ~'+chunksEstimados+'chunks ~'+tempoMin+'min');
    }

    if(imgMsg && !docMsg) {
      return processarMensagem(ctx, {imagem: {buffer:buf, mime:mimeType}});
    }
    const isPdf = mimeType.includes('pdf') || nomeArq.toLowerCase().endsWith('.pdf');
    return processarMensagem(ctx, {arquivo: {buffer:buf, nome:nomeArq, mime:mimeType, isPdf}});
  }

  // Áudio: transcrição via Whisper e segue fluxo normal de texto
  if(msgData.audioMessage) {
    const a = msgData.audioMessage;
    const base64Audio = a.base64 || a.audioBase64 || data.base64 || '';
    if(!base64Audio) {
      await envTelegram('📱 '+nomeEnv+' enviou áudio sem payload base64.', null, CHAT_ID).catch(()=>{});
      await env('Recebi seu áudio, mas não consegui baixar o conteúdo. Pode reenviar ou digitar?', ctx);
      return;
    }
    const audioBuf = Buffer.from(base64Audio, 'base64');
    await processarMensagem(ctx, {audio: {buffer:audioBuf, mime:a.mimetype||'audio/ogg', nome:'audio_whatsapp.ogg'}});
    return;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// POLLING TELEGRAM
// ════════════════════════════════════════════════════════════════════════════
async function poll() {
  try {
    const data = await httpsGet('https://api.telegram.org/bot'+TK+'/getUpdates?offset='+(lastUpdateId+1)+'&timeout=30&allowed_updates=["message","channel_post","edited_message"]');
    if(data.ok && data.result?.length) {
      for(const u of data.result) {
        lastUpdateId = u.update_id;
        const msg = u.message || u.channel_post;
        if(msg) await adapterTelegram(msg).catch(e=>console.error('Erro Telegram:', e.message));
      }
    }
  } catch(e) { console.error('Poll:', e.message); }
  setTimeout(poll, 3000);
}

// ════════════════════════════════════════════════════════════════════════════
// SERVIDOR HTTP + API REST
// ════════════════════════════════════════════════════════════════════════════
function lerBody(req) {
  return new Promise((res,rej)=>{
    let d='';
    req.on('data', c=>{d+=c; if(d.length>10*1024*1024) rej(new Error('Payload grande'));});
    req.on('end', ()=>{try{res(JSON.parse(d));}catch(e){res({});}});
    req.on('error', rej);
  });
}
// ── CORS seguro: só aceita origens confiáveis ──
const ORIGENS_PERMITIDAS = [
  'https://lexjuridico.vercel.app',
  'https://www.lexjuridico.vercel.app',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];
function _corsOrigin(req) {
  const origin = req.headers.origin || req.headers.referer || '';
  const found = ORIGENS_PERMITIDAS.find(o => origin.startsWith(o));
  return found || ORIGENS_PERMITIDAS[0]; // nunca retorna '*'
}
function corsHeaders(req) {
  return {
    'Access-Control-Allow-Origin': _corsOrigin(req),
    'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type,Authorization,X-Aparelho-Id',
    'Access-Control-Allow-Credentials':'true',
    'Content-Type':'application/json'
  };
}

// Rate limit no login — max 5 tentativas por IP em 15min
if(!global._loginAttempts) global._loginAttempts = new Map();
function _checkLoginRate(ip) {
  const now = Date.now();
  const key = String(ip||'unknown');
  const entry = global._loginAttempts.get(key) || { count:0, first:now };
  // Reset janela de 15min
  if(now - entry.first > 15*60*1000) { entry.count = 0; entry.first = now; }
  entry.count++;
  global._loginAttempts.set(key, entry);
  // Limpa entradas velhas a cada 100 checks
  if(global._loginAttempts.size > 100) {
    for(const [k,v] of global._loginAttempts) {
      if(now - v.first > 15*60*1000) global._loginAttempts.delete(k);
    }
  }
  return entry.count <= 5;
}

if(!global._tokensRevogados) global._tokensRevogados = new Set();
if(!global._sessaoAtividade) global._sessaoAtividade = new Map();

function gerarToken(perfil) {
  const ts = Date.now();
  const sig = CRYPTO.createHmac('sha256', AUTH_SECRET).update(perfil+'|'+ts).digest('hex').slice(0,16);
  return Buffer.from(JSON.stringify({p:perfil,ts,sig})).toString('base64url');
}
function validarToken(token) {
  try {
    if(!token) return null;
    if(global._tokensRevogados && global._tokensRevogados.has(token)) return null;
    const { p, ts, sig } = JSON.parse(Buffer.from(token,'base64url').toString());
    const esperado = CRYPTO.createHmac('sha256', AUTH_SECRET).update(p+'|'+ts).digest('hex').slice(0,16);
    if(sig !== esperado) return null;
    if(!PERMS[p]) return null;
    const agora = Date.now();
    // Se token está registrado na sessão, checa inatividade
    const ultimo = global._sessaoAtividade ? global._sessaoAtividade.get(token) : null;
    if(ultimo) {
      if(agora - ultimo > AUTH_IDLE_MS) {
        global._sessaoAtividade.delete(token);
        return null;
      }
    } else {
      // Token NÃO está na sessão (servidor reiniciou ou primeiro acesso)
      // Aceita se a assinatura é válida E o token não é mais velho que AUTH_IDLE_MS
      if(agora - ts > AUTH_IDLE_MS) return null;
    }
    // Registra/atualiza atividade
    if(!global._sessaoAtividade) global._sessaoAtividade = new Map();
    global._sessaoAtividade.set(token, agora);
    return p;
  } catch(e) { return null; }
}
function getToken(req) {
  // 1. Tenta header Authorization
  const auth = req.headers['authorization'] || '';
  if(auth.startsWith('Bearer ')) return auth.slice(7);
  // 2. Tenta query parameter ?token= (necessário para SSE/EventSource que não suporta headers)
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const tk = urlObj.searchParams.get('token');
    if(tk) return tk;
  } catch(e) {}
  return null;
}


// PATCH BOT FINAL: helpers faltantes
function notificarTodosSSE(evento, dados) {
  if (typeof _sseNotificar === 'function') {
    _sseNotificar(evento, dados);
    return;
  }
  if (typeof _sseClientes === 'undefined' || !_sseClientes || _sseClientes.size === 0) return;
  const linha = 'event: ' + evento + '\ndata: ' + JSON.stringify({ ...(dados || {}), ts: Date.now() }) + '\n\n';
  for (const [cid, cres] of _sseClientes) {
    try { cres.write(linha); } catch (e) { _sseClientes.delete(cid); }
  }
}

function _calcTempoMin(inicioMs, fimMs, ultimoHeartbeatMs, idleTimeoutMin) {
  const ini = Number(inicioMs || 0);
  const fim = Number(fimMs || Date.now());
  const ultimo = Number(ultimoHeartbeatMs || fim);
  const idleMs = Number((idleTimeoutMin || 10) * 60000);
  if (!ini || !Number.isFinite(ini) || !Number.isFinite(fim) || !Number.isFinite(ultimo)) return 0;
  if (fim <= ini) return 0;
  const fimEfetivo = Math.min(fim, ultimo + idleMs);
  if (fimEfetivo <= ini) return 0;
  return Math.max(0, Math.round((fimEfetivo - ini) / 60000));
}

function _extrairTextoPdf(pdfBase64) {
  try {
    if (!pdfBase64 || typeof pdfBase64 !== 'string') return '';
    const semPrefixo = pdfBase64.replace(/^data:application\/pdf;base64,?/i, '');
    const buf = Buffer.from(semPrefixo, 'base64');
    const bruto = buf.toString('latin1');
    const blocos = bruto.match(/[\x20-\x7E\xA0-\xFF]{3,}/g) || [];
    const txt = blocos.join(' ').replace(/\s+/g, ' ').trim();
    return txt.substring(0, 120000);
  } catch (e) {
    return '';
  }
}

const ETAPAS_PIPELINE = {
  INTAKE: 'intake',
  ANALISE: 'analise',
  RELATORIO: 'relatorio',
  APROVACAO: 'aprovacao',
  ELABORACAO: 'elaboracao',
  REVISAO_1: 'revisao_1',
  REANALISE: 'reanalise',
  REVISAO_2: 'revisao_2',
  LIBERACAO: 'liberacao',
  ARQUIVO: 'arquivo'
};
const MAX_CICLOS_REANALISE = 3;

function _normalizarAreaPipeline(area) {
  const t = _normTexto(area || '');
  if(!t) return 'civil';
  if(t.includes('trab')) return 'trabalhista';
  if(t.includes('trib')) return 'tributario';
  if(t.includes('famil')) return 'familia';
  if(t.includes('penal') || t.includes('criminal')) return 'penal';
  if(t.includes('prev')) return 'previdenciario';
  if(t.includes('admin')) return 'administrativo';
  if(t.includes('banc') || t.includes('cdc')) return 'bancario_cdc';
  return 'civil';
}

function _pipelineEstadoPadrao(processo) {
  const areaChave = _normalizarAreaPipeline(processo?.area);
  const cat = CATALOGO_PECAS[areaChave] || CATALOGO_PECAS.civil;
  return {
    etapa_atual: ETAPAS_PIPELINE.INTAKE,
    area: areaChave,
    tipo_peca: cat?.tipos?.[0] || 'declaratoria',
    intake: null,
    analise_texto: '',
    relatorio_texto: '',
    estrategia_aprovada: '',
    feedback_revisao: '',
    ciclos_reanalise: 0,
    peca_versao: 0,
    peca_texto: '',
    arquivos: null,
    atualizado_em: new Date().toISOString()
  };
}

function _obterPipelineEstado(processo) {
  if(!processo.pipeline_estado || typeof processo.pipeline_estado !== 'object') {
    processo.pipeline_estado = _pipelineEstadoPadrao(processo);
  }
  if(!processo.pipeline_estado.area) processo.pipeline_estado.area = _normalizarAreaPipeline(processo.area);
  if(!processo.pipeline_estado.etapa_atual) processo.pipeline_estado.etapa_atual = ETAPAS_PIPELINE.INTAKE;
  if(typeof processo.pipeline_estado.ciclos_reanalise !== 'number') processo.pipeline_estado.ciclos_reanalise = 0;
  if(typeof processo.pipeline_estado.peca_versao !== 'number') processo.pipeline_estado.peca_versao = 0;
  return processo.pipeline_estado;
}

function _formatarDocsPipeline(docs) {
  const arr = Array.isArray(docs) ? docs : [];
  return arr.map((d, i) => {
    if(typeof d === 'string') return (i+1)+'. '+d;
    return (i+1)+'. '+(d?.nome || d?.name || d?.tipo || 'documento_'+(i+1));
  });
}

function _extrairInputPipeline(input) {
  const obj = (input && typeof input === 'object') ? input : { texto: String(input || '') };
  const fatos = String(obj.fatos || obj.descricao || obj.texto || '').trim();
  const documentos = Array.isArray(obj.documentos) ? obj.documentos : (Array.isArray(obj.docs) ? obj.docs : []);
  return { fatos, documentos, bruto: obj };
}

async function _coletarDadosImagemPipeline(documentos) {
  const saida = [];
  for(const d of (documentos || [])) {
    const mime = String(d?.mime || d?.mimeType || '');
    const base64 = d?.base64 || d?.conteudo_base64 || '';
    const ehImagem = mime.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(String(d?.nome||''));
    if(!ehImagem || !base64) continue;
    try {
      const buffer = Buffer.from(base64, 'base64');
      const extraido = await _extrairDadosImagem(buffer, mime || 'image/jpeg');
      saida.push({ nome: d?.nome || 'imagem', mime, extraido });
    } catch(e) {
      saida.push({ nome: d?.nome || 'imagem', mime, erro: e.message });
    }
  }
  return saida;
}

function _extrairTipoPecaDaAnalise(texto, areaChave) {
  const t = _normTexto(texto || '');
  const catalogo = CATALOGO_PECAS[areaChave] || CATALOGO_PECAS.civil;
  for(const tp of (catalogo.tipos || [])) {
    const normTp = _normTexto(tp).replace(/_/g,' ');
    if(t.includes(normTp) || t.includes(tp)) return tp;
  }
  return catalogo?.tipos?.[0] || 'declaratoria';
}

function _montarRelatorioEstrategico(analise) {
  const txt = String(analise || '').trim();
  return [
    'RELATORIO ESTRATEGICO DO CASO',
    '',
    txt,
    '',
    'Aprova esta estrategia? Quer ajustar algo?'
  ].join('\n');
}

async function _rodarAnalisePipeline(processo, estado, ajustesTxt) {
  const intake = estado.intake || {};
  const fatos = intake.fatos || processo.descricao || '';
  const listaDocs = _formatarDocsPipeline(intake.documentos || processo.arquivos || []);
  const area = estado.area || _normalizarAreaPipeline(processo.area);
  const promptAnalise =
`Voce e um advogado senior com 20 anos de experiencia. Analise este caso com rigor critico.
Fatos: ${fatos || '(nao informado)'}
Documentos: ${listaDocs.length ? listaDocs.join('; ') : '(sem documentos listados)'}
Area identificada: ${area}
${ajustesTxt ? ('Ajustes do advogado: '+ajustesTxt) : ''}

Analise:
1. LEGISLACAO APLICAVEL: cite artigos especificos
2. JURISPRUDENCIA: cite decisoes REAIS e verificaveis
3. PONTOS FORTES do caso
4. PONTOS FRACOS e riscos
5. PROBABILIDADE DE EXITO (0-100%) com justificativa
6. ESTRATEGIA RECOMENDADA
7. TIPO DE PECA RECOMENDADA
8. DOCUMENTOS QUE FALTAM
9. PRAZOS PRESCRICIONAIS
10. VALOR ESTIMADO DA CAUSA`;
  const analiseTexto = await ia([{role:'user', content:promptAnalise}], null, 2800);
  estado.analise_texto = analiseTexto;
  estado.relatorio_texto = _montarRelatorioEstrategico(analiseTexto);
  estado.tipo_peca = _extrairTipoPecaDaAnalise(analiseTexto, area);
}

async function _elaborarPecaPipeline(processo, estado) {
  const area = estado.area || _normalizarAreaPipeline(processo.area);
  const cat = CATALOGO_PECAS[area] || CATALOGO_PECAS.civil;
  const tipoPeca = estado.tipo_peca || cat.tipos?.[0] || 'declaratoria';
  const promptElaboracao =
`Voce e um advogado especialista em ${area}. Elabore ${tipoPeca} com qualidade STJ/STF.
REGRAS INEGOCIAVEIS:
- Minimo 8 paginas
- Contraditorio: fechar TODAS as portas pra argumentos adversos
- Jurisprudencia: REAL e verificavel, que NOS AJUDE
- NAO bater na Sumula 7 do STJ
- Sacadas estrategicas: so quando necessario, sem escancarar
- Trechos jurisprudenciais com linguagem MODIFICADA (nao copia/cola)
- Formatacao profissional
- Fundamentacao legal exaustiva

Caso: ${JSON.stringify({
  nome: processo.nome || '',
  numero: processo.numero || '',
  partes: processo.partes || '',
  area: processo.area || area,
  descricao: processo.descricao || '',
  fatos: estado?.intake?.fatos || '',
  docs: _formatarDocsPipeline(estado?.intake?.documentos || processo.arquivos || [])
})}
Estrategia aprovada: ${estado.estrategia_aprovada || estado.analise_texto || ''}
Legislacao: ${(cat.legislacao_base || []).join('; ')}
Jurisprudencia: ${estado.analise_texto || ''}`;
  const peca = await ia([{role:'user', content:promptElaboracao}], null, 4000);
  estado.peca_texto = peca;
  estado.peca_versao = Number(estado.peca_versao || 0) + 1;
}

async function _persistirPipelineProcesso(processo, estado) {
  processo.pipeline_estado = { ...(estado || {}), atualizado_em: new Date().toISOString() };
  processo.atualizado_em = new Date().toISOString();
  _bumpProcessos('pipeline:'+String(processo.id||processo.nome||''));
  await _persistirProcessosCache();
}

async function _esclarecerDuvida(processo, pergunta) {
  const estado = _obterPipelineEstado(processo);
  const cat = CATALOGO_PECAS[estado.area] || CATALOGO_PECAS.civil;
  const prompt =
`Voce e um advogado senior. Responda a duvida com fundamentacao tecnica objetiva.
Caso: ${processo.nome || ''} | Numero: ${processo.numero || ''} | Area: ${processo.area || estado.area}
Peca atual: ${estado.peca_texto || '(ainda nao gerada)'}
Analise estrategica: ${estado.analise_texto || ''}
Legislacao base: ${(cat.legislacao_base || []).join('; ')}
Tribunais de referencia: ${(cat.tribunais || []).join('; ')}
Pergunta do advogado: ${String(pergunta || '').trim()}

Responda com:
1) fundamento legal
2) fundamento jurisprudencial
3) risco residual e mitigacao
4) se necessario, ajuste textual sugerido para a peca.`;
  return await ia([{role:'user', content:prompt}], null, 1600);
}

async function _pipelineElaboracao(processo, etapa, input, acao) {
  const estado = _obterPipelineEstado(processo);
  const etapaSolicitada = String(etapa || estado.etapa_atual || ETAPAS_PIPELINE.INTAKE).toLowerCase();
  const acaoNorm = _normTexto(acao || input?.acao || '');
  const dados = _extrairInputPipeline(input);

  if(etapaSolicitada === ETAPAS_PIPELINE.INTAKE) {
    const extraidos = await _coletarDadosImagemPipeline(dados.documentos);
    estado.intake = {
      fatos: dados.fatos || processo.descricao || '',
      documentos: dados.documentos || [],
      imagens_extraidas: extraidos,
      recebido_em: new Date().toISOString()
    };
    estado.etapa_atual = ETAPAS_PIPELINE.ANALISE;
    await _persistirPipelineProcesso(processo, estado);
    return {
      proxima_etapa: ETAPAS_PIPELINE.ANALISE,
      mensagem: 'Intake concluido. Caso e documentos organizados. Posso iniciar a analise tecnica agora.'
    };
  }

  if(etapaSolicitada === ETAPAS_PIPELINE.ANALISE) {
    const ajustes = String(dados.bruto?.ajustes || dados.bruto?.feedback || estado.feedback_revisao || '').trim();
    await _rodarAnalisePipeline(processo, estado, ajustes);
    estado.etapa_atual = ETAPAS_PIPELINE.RELATORIO;
    await _persistirPipelineProcesso(processo, estado);
    return {
      proxima_etapa: ETAPAS_PIPELINE.RELATORIO,
      mensagem: 'Analise concluida. Relatorio estrategico pronto para validacao do advogado.'
    };
  }

  if(etapaSolicitada === ETAPAS_PIPELINE.RELATORIO) {
    estado.etapa_atual = ETAPAS_PIPELINE.APROVACAO;
    await _persistirPipelineProcesso(processo, estado);
    return {
      proxima_etapa: ETAPAS_PIPELINE.APROVACAO,
      mensagem: estado.relatorio_texto || 'Relatorio pronto. Aprova esta estrategia? Quer ajustar algo?',
      perguntas: ['Aprova a estrategia?', 'Quer ajustar pontos de risco, pedidos ou tese principal?']
    };
  }

  if(etapaSolicitada === ETAPAS_PIPELINE.APROVACAO) {
    if(acaoNorm.includes('aprovar')) {
      estado.estrategia_aprovada = dados.fatos || estado.analise_texto;
      estado.etapa_atual = ETAPAS_PIPELINE.ELABORACAO;
      await _persistirPipelineProcesso(processo, estado);
      return { proxima_etapa: ETAPAS_PIPELINE.ELABORACAO, mensagem: 'Estrategia aprovada. Iniciando elaboracao da peca.' };
    }
    if(acaoNorm.includes('ajustar')) {
      estado.feedback_revisao = dados.fatos || String(dados.bruto?.ajustes || '').trim();
      estado.etapa_atual = ETAPAS_PIPELINE.ANALISE;
      await _persistirPipelineProcesso(processo, estado);
      return { proxima_etapa: ETAPAS_PIPELINE.ANALISE, mensagem: 'Ajustes recebidos. Vou reanalisar o caso com as orientacoes do advogado.' };
    }
    return { proxima_etapa: ETAPAS_PIPELINE.APROVACAO, mensagem: 'Informe a acao: aprovar ou ajustar.' };
  }

  if(etapaSolicitada === ETAPAS_PIPELINE.ELABORACAO) {
    await _elaborarPecaPipeline(processo, estado);
    estado.etapa_atual = ETAPAS_PIPELINE.REVISAO_1;
    await _persistirPipelineProcesso(processo, estado);
    return {
      proxima_etapa: ETAPAS_PIPELINE.REVISAO_1,
      mensagem: 'Peca elaborada (versao '+estado.peca_versao+'). Revise e envie perguntas ou ajustes.'
    };
  }

  if(etapaSolicitada === ETAPAS_PIPELINE.REVISAO_1) {
    if(acaoNorm.includes('perguntar')) {
      const resp = await _esclarecerDuvida(processo, dados.fatos || dados.bruto?.pergunta || '');
      await _persistirPipelineProcesso(processo, estado);
      return { proxima_etapa: ETAPAS_PIPELINE.REVISAO_1, mensagem: resp };
    }
    if(acaoNorm.includes('ajustar')) {
      estado.feedback_revisao = dados.fatos || String(dados.bruto?.ajustes || '').trim();
      estado.etapa_atual = ETAPAS_PIPELINE.REANALISE;
      await _persistirPipelineProcesso(processo, estado);
      return { proxima_etapa: ETAPAS_PIPELINE.REANALISE, mensagem: 'Feedback registrado. Iniciando reanalise e reforco argumentativo.' };
    }
    if(acaoNorm.includes('aprovar')) {
      estado.etapa_atual = ETAPAS_PIPELINE.REVISAO_2;
      await _persistirPipelineProcesso(processo, estado);
      return { proxima_etapa: ETAPAS_PIPELINE.REVISAO_2, mensagem: 'Versao aprovada na revisao 1. Segue para validacao final (revisao 2).' };
    }
    return { proxima_etapa: ETAPAS_PIPELINE.REVISAO_1, mensagem: 'Na revisao 1, use acao: perguntar, ajustar ou aprovar.' };
  }

  if(etapaSolicitada === ETAPAS_PIPELINE.REANALISE) {
    if(estado.ciclos_reanalise >= MAX_CICLOS_REANALISE) {
      estado.etapa_atual = ETAPAS_PIPELINE.LIBERACAO;
      await _persistirPipelineProcesso(processo, estado);
      return { proxima_etapa: ETAPAS_PIPELINE.LIBERACAO, mensagem: 'Limite de 3 ciclos de reanalise atingido. Fluxo forçado para liberacao.' };
    }
    const promptReanalise =
`Reescreva e fortaleça a peça jurídica abaixo com base no feedback do advogado.
Feedback: ${estado.feedback_revisao || '(sem feedback textual)'}
Peça atual (versao ${estado.peca_versao || 1}):
${estado.peca_texto || ''}

Objetivos:
- fechar lacunas argumentativas
- reforcar jurisprudencia util e verificavel
- ajustar riscos de sumulas/restricoes
- manter coerencia tecnica`;
    estado.peca_texto = await ia([{role:'user', content: promptReanalise}], null, 3800);
    estado.peca_versao = Number(estado.peca_versao || 0) + 1;
    estado.ciclos_reanalise = Number(estado.ciclos_reanalise || 0) + 1;
    estado.etapa_atual = ETAPAS_PIPELINE.REVISAO_2;
    await _persistirPipelineProcesso(processo, estado);
    return { proxima_etapa: ETAPAS_PIPELINE.REVISAO_2, mensagem: 'Reanalise concluida. Versao '+estado.peca_versao+' pronta para revisao final.' };
  }

  if(etapaSolicitada === ETAPAS_PIPELINE.REVISAO_2) {
    if(acaoNorm.includes('aprovar')) {
      estado.etapa_atual = ETAPAS_PIPELINE.LIBERACAO;
      await _persistirPipelineProcesso(processo, estado);
      return { proxima_etapa: ETAPAS_PIPELINE.LIBERACAO, mensagem: 'Validacao final aprovada. Preparando liberacao dos arquivos.' };
    }
    if(acaoNorm.includes('ajustar')) {
      if(Number(estado.ciclos_reanalise || 0) >= MAX_CICLOS_REANALISE) {
        estado.etapa_atual = ETAPAS_PIPELINE.LIBERACAO;
        await _persistirPipelineProcesso(processo, estado);
        return { proxima_etapa: ETAPAS_PIPELINE.LIBERACAO, mensagem: 'Limite de reanalises atingido (3 ciclos). Fluxo forçado para liberacao.' };
      }
      estado.feedback_revisao = dados.fatos || String(dados.bruto?.ajustes || '').trim();
      estado.etapa_atual = ETAPAS_PIPELINE.REANALISE;
      await _persistirPipelineProcesso(processo, estado);
      return { proxima_etapa: ETAPAS_PIPELINE.REANALISE, mensagem: 'Solicitacao de ajuste aceita. Retornando para reanalise.' };
    }
    return { proxima_etapa: ETAPAS_PIPELINE.REVISAO_2, mensagem: 'Na revisao final, use acao: aprovar ou ajustar.' };
  }

  if(etapaSolicitada === ETAPAS_PIPELINE.LIBERACAO) {
    const titulo = 'Peca_'+(processo.nome || processo.numero || 'processo');
    const arquivos = {
      pdf: {
        endpoint: '/api/pipeline/download?processo_id='+encodeURIComponent(String(processo.id||''))+'&formato=pdf',
        metodo: 'GET',
        nome: _nomeArquivoSeguro(titulo, '.pdf')
      },
      docx: {
        endpoint: '/api/pipeline/download?processo_id='+encodeURIComponent(String(processo.id||''))+'&formato=docx',
        metodo: 'GET',
        nome: _nomeArquivoSeguro(titulo, '.docx')
      }
    };
    estado.arquivos = arquivos;
    estado.etapa_atual = ETAPAS_PIPELINE.ARQUIVO;
    await _persistirPipelineProcesso(processo, estado);
    return {
      proxima_etapa: ETAPAS_PIPELINE.ARQUIVO,
      mensagem: 'Peca finalizada! Baixe em PDF ou DOCX.',
      arquivos
    };
  }

  if(etapaSolicitada === ETAPAS_PIPELINE.ARQUIVO) {
    if(!Array.isArray(processo.pecas)) processo.pecas = [];
    processo.pecas.unshift({
      versao: estado.peca_versao || 1,
      data: new Date().toISOString(),
      tipo: estado.tipo_peca || 'peticao',
      autor: 'Lex',
      conteudo: estado.peca_texto || '',
      area: estado.area || _normalizarAreaPipeline(processo.area)
    });
    estado.etapa_atual = ETAPAS_PIPELINE.ARQUIVO;
    await _persistirPipelineProcesso(processo, estado);
    return { proxima_etapa: ETAPAS_PIPELINE.ARQUIVO, mensagem: 'Peca arquivada no processo com versionamento e auditoria.' };
  }

  return { proxima_etapa: estado.etapa_atual, mensagem: 'Etapa nao reconhecida no pipeline.' };
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const CORS = corsHeaders(req);
  if(req.method==='OPTIONS') { res.writeHead(204, corsHeaders(req)); res.end(); return; }
  if(url==='/' || url==='/health' || url==='/api/ping') {
    res.writeHead(200, {
      'Content-Type':'text/plain',
      'Access-Control-Allow-Origin': _corsOrigin(req),
      'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type,Authorization,X-Aparelho-Id'
    });
    res.end('Lex OK');
    return;
  }

  // ── AUTH ──
  if(url==='/api/login' && req.method==='POST') {
    try {
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
      if(!_checkLoginRate(clientIp)) {
        res.writeHead(429, corsHeaders(req));
        res.end(JSON.stringify({error:'Muitas tentativas. Aguarde 15 minutos.'}));
        return;
      }
      const b = await lerBody(req);
      if(!b.perfil || !b.senha) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Perfil e senha obrigatorios'})); return; }
      
      // Busca senha válida (env var → Supabase → setup mode)
      const senhaCorreta = await obterSenhaValida(b.perfil);
      
      if(!senhaCorreta) {
        // Nenhuma senha configurada — primeira vez: CONFIGURA automaticamente
        console.log('[Lex] Primeira configuração de senha para perfil:', b.perfil);
        const salvo = await salvarSenhaSupabase(b.perfil, b.senha);
        if(!salvo) {
          res.writeHead(500,corsHeaders(req));
          res.end(JSON.stringify({error:'Senha nao configurada. Erro ao salvar no Supabase. Configure SENHA_ADMIN nas vars de ambiente do Render.'}));
          return;
        }
        // Senha configurada com sucesso — prossegue com login
        console.log('[Lex] Senha configurada e salva no Supabase para', b.perfil);
      } else if(b.senha !== senhaCorreta) {
        res.writeHead(401,corsHeaders(req));
        res.end(JSON.stringify({error:'Senha incorreta'}));
        return;
      }
      
      const token = gerarToken(b.perfil);
      global._sessaoAtividade.set(token, Date.now());
      _registrarTempoUso(b.perfil, 'login', Date.now()).catch(e=>
        console.warn('[tempo] falha ao registrar login automático:', e.message));
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({ok:true, token, perfil:b.perfil, ...PERMS[b.perfil]}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }
  
  // ── TROCAR SENHA (autenticado) ──
  if(url==='/api/trocar-senha' && req.method==='POST') {
    try {
      const perfil = validarToken(getToken(req));
      if(!perfil) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const b = await lerBody(req);
      if(!b.novaSenha || b.novaSenha.length < 4) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'Nova senha deve ter pelo menos 4 caracteres'})); return; }
      const salvo = await salvarSenhaSupabase(perfil, b.novaSenha);
      if(!salvo) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:'Erro ao salvar senha'})); return; }
      res.writeHead(200,corsHeaders(req)); res.end(JSON.stringify({ok:true, msg:'Senha alterada com sucesso'}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url==='/api/perfil' && req.method==='GET') {
    const perfil = validarToken(getToken(req));
    if(!perfil) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
    res.writeHead(200, corsHeaders(req)); res.end(JSON.stringify({perfil, ...PERMS[perfil]}));
    return;
  }

  if(url==='/api/trocar-senha' && req.method==='POST') {
    try {
      const perfilAtual = validarToken(getToken(req));
      if(!perfilAtual) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      const b = await lerBody(req);
      if(perfilAtual !== 'admin' && b.perfilAlvo !== perfilAtual) { res.writeHead(403,corsHeaders(req)); res.end(JSON.stringify({error:'Sem permissão'})); return; }
      if(!SENHAS_WEB[b.perfilAlvo]) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'Perfil inválido'})); return; }
      if(perfilAtual !== 'admin' && b.senhaAtual !== SENHAS_WEB[b.perfilAlvo]) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Senha atual incorreta'})); return; }
      if(!b.novaSenha || b.novaSenha.length<6) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'Senha curta (mín 6)'})); return; }
      
      // Atualizar em memória
      SENHAS_WEB[b.perfilAlvo] = b.novaSenha;
      
      // Tentar persistir no Supabase (tabela config)
      try {
        await sbReq('POST', 'config', {
          chave: 'SENHA_' + b.perfilAlvo.toUpperCase(),
          valor: b.novaSenha,
          atualizado_em: new Date().toISOString()
        });
      } catch(e) {
        console.warn('[Trocar Senha] Nao foi possivel persistir no Supabase:', e.message);
        // Continua mesmo sem persistir - funciona em memória
      }
      
      _auditarAcao(perfilAtual, 'trocar_senha', {perfil: b.perfilAlvo});
      res.writeHead(200,corsHeaders(req)); res.end(JSON.stringify({ok:true, msg:'Senha alterada. NOTA: Se o servidor reiniciar, a senha pode voltar ao valor original das variaveis de ambiente.'}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // SYNC POR VERSÃO (corrige iPhone/notebook desatualizados)
  // ════════════════════════════════════════════════════════════════════════
  //
  // GET /api/sync-status?clientVersao=N → diz se cliente está atualizado
  //   Resposta: {servidorVersao, total, precisa_baixar:bool, ultimo_aparelho}
  //
  // GET /api/processos → retorna {processos, versao, ultimo_aparelho}
  //
  // POST /api/sincronizar → body {processos, clientVersao, aparelhoId}
  //   - Se clientVersao < servidorVersao: REJEITA (cliente está desatualizado, deve baixar primeiro)
  //   - Se clientVersao >= servidorVersao: aceita e bumpa versão

  if(url==='/api/sync-status' && req.method==='GET') {
    const u = new URL(req.url, 'http://x');
    const clientVersao = parseInt(u.searchParams.get('clientVersao')||'0', 10);
    res.writeHead(200, corsHeaders(req));
    res.end(JSON.stringify({
      servidorVersao: processosVersao,
      total: processos.length,
      precisa_baixar: clientVersao < processosVersao,
      ultimo_aparelho: processosUltimoAparelho
    }));
    return;
  }

  // ═══ DIAGNÓSTICO: testa IA + agente vivo + deps — remover depois ═══
  if(url==='/api/diagnostico' && req.method==='GET') {
    const diag = { ts: new Date().toISOString(), checks: {} };
    try {
      // 1. API Key presente?
      diag.checks.api_key = AK ? 'presente ('+AK.substring(0,10)+'...)' : 'AUSENTE';
      // 2. Modelo
      diag.checks.modelo = 'claude-opus-4-20250514';
      // 3. Agente vivo carregado?
      diag.checks.agente_vivo = lex_agente_vivo ? 'carregado' : 'NAO CARREGADO';
      diag.checks.agente_vivo_tratarRota = (lex_agente_vivo && typeof lex_agente_vivo.tratarRota === 'function') ? 'OK' : 'FALHA';
      // 4. Processos
      diag.checks.processos_count = processos.length;
      // 5. Testa chamada real à IA
      try {
        const testeResp = await ia([{role:'user',content:'Diga apenas: OK FUNCIONANDO'}], 'Responda em 2 palavras.', 50);
        diag.checks.ia_teste = 'OK: ' + (testeResp||'').substring(0,100);
      } catch(eIa) {
        diag.checks.ia_teste = 'ERRO: ' + String(eIa.message||eIa).substring(0,300);
      }
      // 6. sbReq funciona?
      try {
        const sbTest = await sbReq('GET', 'processos', null, { limit: 1 });
        diag.checks.supabase = 'OK (status '+(sbTest.status||'?')+')';
      } catch(eSb) {
        diag.checks.supabase = 'ERRO: ' + String(eSb.message||eSb).substring(0,200);
      }
      diag.status = 'diagnostico_completo';
    } catch(eGeral) {
      diag.status = 'erro_geral';
      diag.erro = String(eGeral.message||eGeral).substring(0,500);
    }
    res.writeHead(200, corsHeaders(req));
    res.end(JSON.stringify(diag, null, 2));
    return;
  }

  if(url==='/api/processos' && req.method==='GET') {
    // FIX-11: rota protegida — sem token retorna 401
    const pfProc = validarToken(getToken(req));
    if(!pfProc) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
    try {
      const sbRows = await sbReq('GET', 'processos', null, { order:'criado_em.desc', limit:'2000' });
      if(sbRows && sbRows.ok && Array.isArray(sbRows.body) && sbRows.body.length) {
        const mapa = new Map();
        (processos||[]).forEach(p => mapa.set(String(p.id), p));
        for(const row of sbRows.body) {
          const idKey = String(row.id);
          const atual = mapa.get(idKey) || {};
          mapa.set(idKey, {
            ...atual,
            id: (row.id != null && !isNaN(Number(row.id))) ? Number(row.id) : (atual.id != null ? atual.id : row.id),
            nome: row.nome || atual.nome || 'Processo sem nome',
            tipo: _normalizarTipoProcesso(row.tipo || atual.tipo, row.area || atual.area),
            numero: row.numero || atual.numero || '',
            partes: row.partes || atual.partes || '',
            area: row.area || atual.area || '',
            tribunal: row.tribunal || atual.tribunal || '',
            juiz_relator: row.juiz_relator || atual.juiz_relator || '',
            instancia: row.instancia || atual.instancia || '',
            status: row.status || atual.status || 'ATIVO',
            prazo: row.prazo || atual.prazo || '',
            proxacao: row.proxacao || atual.proxacao || '',
            valor: row.valor_causa || atual.valor || '',
            descricao: row.resumo || atual.descricao || '',
            docsFaltantes: row.docs_faltantes || atual.docsFaltantes || '',
            atualizado_em: row.atualizado_em || atual.atualizado_em || new Date().toISOString(),
            criado_em: row.criado_em || atual.criado_em || new Date().toISOString(),
            andamentos: atual.andamentos || [],
            arquivos: atual.arquivos || []
          });
        }
        processos = Array.from(mapa.values());
      }
    } catch(e) {
      console.warn('[Lex][api/processos] fallback memoria por erro Supabase:', e.message);
    }
    res.writeHead(200, corsHeaders(req));
    res.end(JSON.stringify({
      processos,
      total: processos.length,
      versao: processosVersao,
      ultimo_aparelho: processosUltimoAparelho
    }));
    return;
  }

  // POST /api/pipeline { processo_id, etapa?, input?, acao? }
  if(url==='/api/pipeline' && req.method==='POST') {
    try {
      const pfPipe = validarToken(getToken(req));
      if(!pfPipe) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      const b = await lerBody(req);
      const processoId = String(b.processo_id || '').trim();
      if(!processoId) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'processo_id obrigatório'})); return; }
      const proc = processos.find(p => String(p.id) === processoId);
      if(!proc) { res.writeHead(404,corsHeaders(req)); res.end(JSON.stringify({error:'Processo não encontrado'})); return; }

      const estadoAtual = _obterPipelineEstado(proc);
      // Sem etapa e sem acao => consulta estado atual do pipeline
      if(!b.etapa && !b.acao) {
        res.writeHead(200, corsHeaders(req));
        res.end(JSON.stringify({
          etapa_atual: estadoAtual.etapa_atual,
          mensagem: 'Estado atual do pipeline recuperado.',
          arquivos: estadoAtual.arquivos || null,
          perguntas: estadoAtual.etapa_atual === ETAPAS_PIPELINE.APROVACAO
            ? ['Aprova esta estrategia?', 'Quer ajustar algo?']
            : (estadoAtual.etapa_atual === ETAPAS_PIPELINE.REVISAO_1
                ? ['Tem duvidas sobre fundamentos?', 'Quer ajustes especificos na peca?']
                : null)
        }));
        return;
      }

      const etapaExec = String(b.etapa || estadoAtual.etapa_atual || ETAPAS_PIPELINE.INTAKE).toLowerCase();
      const out = await _pipelineElaboracao(proc, etapaExec, b.input || {}, b.acao || '');
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({
        etapa_atual: out.proxima_etapa || _obterPipelineEstado(proc).etapa_atual,
        mensagem: out.mensagem || 'Pipeline atualizado.',
        arquivos: out.arquivos || null,
        perguntas: out.perguntas || null
      }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // GET /api/pipeline/download?processo_id=...&formato=pdf|docx
  if(url==='/api/pipeline/download' && req.method==='GET') {
    try {
      const pfPipeDl = validarToken(getToken(req));
      if(!pfPipeDl) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      const u = new URL(req.url, 'http://x');
      const processoId = String(u.searchParams.get('processo_id') || '').trim();
      const formato = String(u.searchParams.get('formato') || 'pdf').toLowerCase();
      if(!processoId) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'processo_id obrigatório'})); return; }
      if(!['pdf','docx'].includes(formato)) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'formato deve ser pdf|docx'})); return; }
      const proc = processos.find(p => String(p.id) === processoId);
      if(!proc) { res.writeHead(404,corsHeaders(req)); res.end(JSON.stringify({error:'Processo não encontrado'})); return; }
      const estado = _obterPipelineEstado(proc);
      const conteudo = String(estado.peca_texto || '').trim();
      if(!conteudo) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'Peça ainda não gerada no pipeline'})); return; }
      const titulo = 'Peca_'+(proc.nome || proc.numero || 'processo');

      if(formato === 'pdf') {
        const pdfBuf = await _gerarPecaPdfBuffer(titulo, conteudo, 'peticao');
        const nome = _nomeArquivoSeguro(titulo, '.pdf');
        res.writeHead(200, { 'Content-Type':'application/pdf', 'Content-Disposition':'attachment; filename="' + nome + '"', ...corsHeaders(req) });
        res.end(pdfBuf);
        return;
      }
      const docxBuf = _gerarDocxBufferPeca(titulo, conteudo, 'peticao');
      const nome = _nomeArquivoSeguro(titulo, '.docx');
      res.writeHead(200, {
        'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition':'attachment; filename="' + nome + '"',
        ...corsHeaders(req)
      });
      res.end(docxBuf);
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url==='/api/sincronizar' && req.method==='POST') {
    try {
      // FIX-12: rota protegida — previne sobrescrita não-autorizada
      const pfSync = validarToken(getToken(req));
      if(!pfSync) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      const b = await lerBody(req);
      if(!Array.isArray(b.processos)) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'processos[] obrigatório'})); return; }
      const aparelhoId = req.headers['x-aparelho-id'] || b.aparelhoId || 'desconhecido';
      const clientVersao = parseInt(b.clientVersao||0, 10);

      // ⬇ ANTI-OVERWRITE: cliente desatualizado NÃO sobrescreve
      if(clientVersao > 0 && clientVersao < processosVersao) {
        res.writeHead(409, corsHeaders(req));
        res.end(JSON.stringify({
          error: 'Sua cópia está desatualizada. Baixe a versão do servidor primeiro.',
          servidorVersao: processosVersao,
          clientVersao,
          ultimo_aparelho: processosUltimoAparelho,
          processos // devolve a versão correta para o cliente atualizar local
        }));
        return;
      }

      processos = b.processos;
      _bumpProcessos(aparelhoId);
      notificarTodosSSE('processos_atualizados', { aparelho: aparelhoId, versao: processosVersao, total: processos.length });
      await _persistirProcessosCache();
      console.log('SYNC <-', aparelhoId, '| total:', processos.length, '| nova versão:', processosVersao);
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({ok:true, total:processos.length, versao:processosVersao}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // FILA DE COMANDOS PERSISTENTE
  // ════════════════════════════════════════════════════════════════════════
  if(url==='/api/comandos' && req.method==='GET') {
    try {
      const cmds = await buscarComandosPendentes();
      const rowIds = cmds.map(c=>c._row_id).filter(Boolean);
      // Marca como entregues APÓS responder (evita perda em caso de erro de rede)
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({comandos: cmds.map(c=>{const {_row_id,...rest}=c;return rest;})}));
      // Confirma entrega (assíncrono, não bloqueia resposta)
      if(rowIds.length) marcarComandosEntregues(rowIds).catch(()=>{});
      // Limpa fallback RAM
      global._cmdsRam = [];
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // CHAT / ANÁLISE / GERAÇÃO via web (autenticado)
  // ════════════════════════════════════════════════════════════════════════
  // ═══ TESTE VIVO (temporário) — simula /api/vivo/conversar sem auth ═══
  if(url==='/api/teste-vivo' && req.method==='GET') {
    try {
      if(!lex_agente_vivo) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({erro:'lex_agente_vivo NAO CARREGADO'})); return; }
      const fakeBody = { mensagem: 'Diga apenas OK FUNCIONANDO', historico: [] };
      const fakeReq = Object.assign(Object.create(req), { method: 'POST' });
      const fakeDeps = {
        req: fakeReq, res, body: fakeBody, perfil: {p:'admin'}, processos, CORS: corsHeaders(req),
        ANTHROPIC_KEY: AK, https, lerBody,
        sbGet: (t,q)=>sbReq('GET',t,null,q), sbReq,
        sbUpsert: async (tabela, dados, conflito) => { return sbReq('POST', tabela, dados, {}, { onConflict: conflito || 'id', merge: Object.keys(dados).join(',') }); },
        sbPatch: async (tabela, dados, filtro) => { return sbReq('PATCH', tabela, dados, filtro); },
        _processarMarcadoresChat, _notificarEquipe,
        helpers: { validarToken, getToken, lerBody, notificarTodosSSE }
      };
      await lex_agente_vivo.tratarRota(req, res, '/api/vivo/conversar', fakeDeps);
    } catch(e) {
      if(!res.writableEnded) { res.writeHead(500, corsHeaders(req)); res.end(JSON.stringify({erro:e.message, stack:(e.stack||'').substring(0,500)})); }
    }
    return;
  }

  // ═══ TESTE CHAT PÚBLICO (temporário) ═══
  if(url==='/api/teste-ia' && req.method==='GET') {
    try {
      const resp = await ia([{role:'user',content:'Diga: Lex funcionando perfeitamente'}], 'Responda em 1 frase curta.', 100);
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({ok:true, resposta:resp}));
    } catch(e) {
      res.writeHead(500, corsHeaders(req));
      res.end(JSON.stringify({ok:false, erro:e.message}));
    }
    return;
  }

  if(url==='/api/chat' && req.method==='POST') {
    try {
      const tk = getToken(req);
      if(!validarToken(tk)) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      const b = await lerBody(req);
      if(!b.messages) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'messages obrigatório'})); return; }
    const sysPrompt = b.system || sysAssessor(null, null);
    const txt = await ia(b.messages, sysPrompt, b.maxTokens||4096);
      // Pós-processamento: marcadores de atualização de processo
      const acoes = await _processarMarcadoresChat(txt);
      res.writeHead(200,corsHeaders(req)); res.end(JSON.stringify({resposta:txt, text:txt, acoes_executadas:acoes}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url==='/api/analisar' && req.method==='POST') {
    try {
      const tk = getToken(req);
      if(!validarToken(tk)) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      const b = await lerBody(req);
      if(!b.base64) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'base64 obrigatório'})); return; }
      const buf = Buffer.from(b.base64,'base64');
      const isPdf = (b.mimeType||'').includes('pdf') || (b.nome||'').toLowerCase().endsWith('.pdf');
      // FIX-07: usa _analisarDocEmChunks para PDFs grandes (>100 páginas)
      const analise = await _analisarDocEmChunks(buf, isPdf, b.nome||'documento', null, {});
      res.writeHead(200,corsHeaders(req)); res.end(JSON.stringify(analise));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url==='/api/gerar' && req.method==='POST') {
    try {
      const tk = getToken(req);
      const pf = validarToken(tk);
      if(!pf) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      if(pf==='secretaria') { res.writeHead(403,corsHeaders(req)); res.end(JSON.stringify({error:'Sem permissão'})); return; }
      const b = await lerBody(req);
      if(!b.tipo) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'tipo obrigatório'})); return; }
      const memCaso = b.processo ? await recuperarMemoriaDoCaso(b.processo.nome, 30) : [];
      const texto = await gerarDoc(b.tipo, b.processo||null, b.instrucoes||'', b.dadosProf||null, b.ehInicial||false, b.dadosCliente||null, memCaso);
      res.writeHead(200,corsHeaders(req)); res.end(JSON.stringify({texto}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // MEMÓRIA POR CASO — CRUD e EXPORT pra Obsidian
  // ════════════════════════════════════════════════════════════════════════
  
  // PATCH BOT FINAL: rota delegada para agente vivo (todas as sub-rotas /api/vivo/*)
  if((url==='/api/agente-vivo' || url.startsWith('/api/vivo')) && lex_agente_vivo && typeof lex_agente_vivo.tratarRota === 'function') {
    try {
      const pfAgv = validarToken(getToken(req));
      if(!pfAgv) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const bodyAgv = req.method === 'POST' ? await lerBody(req) : {};
      const vivoUrl = url === '/api/agente-vivo' ? '/api/vivo/conversar' : url;
      const out = await lex_agente_vivo.tratarRota(req, res, vivoUrl, {
        req, res, body: bodyAgv, perfil: pfAgv, processos, CORS,
        ANTHROPIC_KEY: AK, https, lerBody,
        sbGet: (t,q)=>sbReq('GET',t,null,q),
        sbReq,
        sbUpsert: async (tabela, dados, conflito) => {
          return sbReq('POST', tabela, dados, {}, { onConflict: conflito || 'id', merge: Object.keys(dados).join(',') });
        },
        sbPatch: async (tabela, dados, filtro) => {
          return sbReq('PATCH', tabela, dados, filtro);
        },
        _processarMarcadoresChat,
        _notificarEquipe,
        helpers: { validarToken, getToken, lerBody, notificarTodosSSE }
      });
      if(typeof out !== 'undefined' && !res.writableEnded) {
        res.writeHead(200, corsHeaders(req));
        res.end(JSON.stringify(out));
      }
    } catch(e) { if(!res.writableEnded) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); } }
    return;
  }

  // PATCH BOT FINAL: documentos
  if(url==='/api/documentos/upload' && req.method==='POST') {
    try {
      const pfDoc = validarToken(getToken(req));
      if(!pfDoc) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const b = await lerBody(req);
      if(!b || !b.pdf_base64) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'pdf_base64 obrigatorio'})); return; }
      const texto = _extrairTextoPdf(b.pdf_base64);
      const docId = CRYPTO.randomUUID ? CRYPTO.randomUUID() : CRYPTO.randomBytes(16).toString('hex');
      await sbReq('POST', 'documentos_processo', {
        id: docId,
        processo: b.processo || null,
        titulo: b.titulo || 'documento.pdf',
        tipo: b.tipo || 'pdf',
        texto_extraido: texto,
        criado_por: pfDoc,
        criado_em: new Date().toISOString()
      }, null, null);
      res.writeHead(200,corsHeaders(req));
      res.end(JSON.stringify({ok:true, id:docId, texto_chars:texto.length}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url.startsWith('/api/documentos/buscar') && req.method==='GET') {
    try {
      const pfDocB = validarToken(getToken(req));
      if(!pfDocB) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const u = new URL(req.url, 'http://x');
      const processo = u.searchParams.get('processo');
      const q = (u.searchParams.get('q') || '').trim();
      const limit = Math.min(parseInt(u.searchParams.get('limit') || '50', 10), 200);
      const filtros = {
        order: 'criado_em.desc',
        limit: String(limit),
        select: 'id,processo,titulo,tipo,criado_em,criado_por,texto_extraido'
      };
      if(processo) filtros.processo = 'eq.' + processo;
      let rows = await sbReq('GET', 'documentos_processo', null, filtros, null) || [];
      if(q) {
        const qq = q.toLowerCase();
        rows = rows.filter(r => (String(r.titulo||'').toLowerCase().includes(qq) || String(r.texto_extraido||'').toLowerCase().includes(qq)));
      }
      res.writeHead(200,corsHeaders(req));
      res.end(JSON.stringify({total: rows.length, documentos: rows}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url.startsWith('/api/documentos/do-processo/') && req.method==='GET') {
    try {
      const pfDocP = validarToken(getToken(req));
      if(!pfDocP) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const processoId = decodeURIComponent(url.split('/').pop() || '');
      if(!processoId) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'id do processo obrigatorio'})); return; }
      const rows = await sbReq('GET', 'documentos_processo', null, {
        processo: 'eq.' + processoId,
        order: 'criado_em.desc',
        select: 'id,processo,titulo,tipo,criado_em,criado_por,texto_extraido'
      }, null) || [];
      res.writeHead(200,corsHeaders(req));
      res.end(JSON.stringify({processo: processoId, total: rows.length, documentos: rows}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // PATCH BOT FINAL: logins por dia
  if(url.startsWith('/api/tempo/logins') && req.method==='GET') {
    try {
      const pfLg = validarToken(getToken(req));
      if(!pfLg) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const u = new URL(req.url, 'http://x');
      const perfilConsulta = u.searchParams.get('perfil') || pfLg;
      if(perfilConsulta !== pfLg && pfLg !== 'admin') {
        res.writeHead(403,corsHeaders(req)); res.end(JSON.stringify({error:'Sem permissao'})); return;
      }
      const dias = Math.min(parseInt(u.searchParams.get('dias')||'30', 10), 365);
      const hj = horaBrasilia();
      const dtIni = new Date(hj);
      dtIni.setDate(hj.getDate() - (dias - 1));
      const ini = dtIni.getFullYear()+'-'+String(dtIni.getMonth()+1).padStart(2,'0')+'-'+String(dtIni.getDate()).padStart(2,'0');
      let rows = [];
      try {
        const sbResult = await sbReq('GET', 'tempo_uso', null, {
          perfil: 'eq.' + perfilConsulta,
          data: 'gte.' + ini,
          select: 'data,hora_inicio',
          order: 'data.asc'
        }, null);
        rows = Array.isArray(sbResult) ? sbResult : [];
      } catch(sbErr) {
        console.warn('[tempo/logins] Supabase erro (tabela pode nao existir):', sbErr.message);
        rows = [];
      }
      const porDia = {};
      for(const r of rows) {
        const d = r.data || '';
        if(!porDia[d]) porDia[d] = 0;
        porDia[d] += 1;
      }
      const logins = Object.keys(porDia).sort().map(d => ({ data: d, logins: porDia[d] }));
      res.writeHead(200,corsHeaders(req));
      res.end(JSON.stringify({perfil: perfilConsulta, dias, total: rows.length, logins}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

if(url==='/api/memoria' && req.method==='GET') {
    try {
      const u = new URL(req.url, 'http://x');
      const caso = u.searchParams.get('caso');
      if(!caso) {
        const todas = await recuperarTodaMemoria();
        res.writeHead(200,corsHeaders(req)); res.end(JSON.stringify({casos:todas}));
        return;
      }
      const fatos = await recuperarMemoriaDoCaso(caso, 100);
      res.writeHead(200,corsHeaders(req)); res.end(JSON.stringify({caso, fatos}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url==='/api/memoria' && req.method==='POST') {
    try {
      const tk = getToken(req);
      if(!validarToken(tk)) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      const b = await lerBody(req);
      if(!b.caso || !b.texto) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'caso e texto obrigatórios'})); return; }
      const ok = await lembrarDoCaso(b.caso, b.tipo||'observacao', b.texto, b.fonte||'web');
      res.writeHead(ok?200:500,CORS); res.end(JSON.stringify({ok}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // GET /api/memoria-export → markdown completo (para você importar no Obsidian)
  if(url==='/api/memoria-export' && req.method==='GET') {
    try {
      const todas = await recuperarTodaMemoria();
      let md = `# LEX — Memória de Casos\n\n*Exportado em ${new Date().toLocaleString('pt-BR')}*\n\n---\n\n`;
      for(const c of todas) {
        md += `## ${c.caso_nome}\n\n*Última atualização: ${new Date(c.atualizado_em).toLocaleString('pt-BR')}*\n\n`;
        const fatos = c.fatos || [];
        const porTipo = {};
        fatos.forEach(f => {
          const t = f.tipo||'observacao';
          if(!porTipo[t]) porTipo[t] = [];
          porTipo[t].push(f);
        });
        for(const tipo of Object.keys(porTipo)) {
          md += `### ${tipo}\n\n`;
          porTipo[tipo].forEach(f => {
            const data = f.data ? new Date(f.data).toLocaleDateString('pt-BR') : '';
            md += `- ${data ? `**${data}** — ` : ''}${f.texto}${f.fonte?` *(via ${f.fonte})*`:''}\n`;
          });
          md += '\n';
        }
        md += '---\n\n';
      }
      res.writeHead(200, {'Content-Type':'text/markdown; charset=utf-8', 'Content-Disposition':'attachment; filename="lex-memoria.md"', ...corsHeaders(req)});
      res.end(md);
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // WEBHOOK WHATSAPP — agora delega 100% pra pipeline unificada
  // ════════════════════════════════════════════════════════════════════════
  if(url==='/api/webhook-whatsapp' && req.method==='POST') {
    try {
      const b = await lerBody(req);
      // Resposta 200 imediata (Evolution não retentar), processa async
      res.writeHead(200, corsHeaders(req)); res.end(JSON.stringify({ok:true, recebido:true}));
      adapterEvolution(b).catch(e=>console.error('WhatsApp adapter erro:', e.message));
    } catch(e) {
      res.writeHead(200, corsHeaders(req)); // sempre 200 pra Evolution não retentar
      res.end(JSON.stringify({ok:false, erro:e.message}));
    }
    return;
  }

  // GET /api/fila — status da fila de análises assíncronas
  if(url==='/api/fila' && req.method==='GET') {
    try {
      const tokensUsados = _tokensUsadosNaJanela();
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({
        em_curso: _analiseEmCurso ? {
          arquivo: _analiseEmCurso.arq.nome,
          canal: _analiseEmCurso.ctx.canal,
          iniciado_em: _analiseEmCurso.iniciadoEm,
          duracao_s: Math.floor((Date.now()-_analiseEmCurso.iniciadoEm)/1000)
        } : null,
        aguardando: _filaAnalises.length,
        itens_aguardando: _filaAnalises.map(i => ({
          arquivo: i.arq.nome,
          canal: i.ctx.canal,
          enfileirado_em: i.iniciadoEm
        })),
        rate_limit: {
          tokens_usados: tokensUsados,
          tokens_max: RATE_LIMIT_TOKENS_POR_MIN,
          percentual: Math.round(tokensUsados / RATE_LIMIT_TOKENS_POR_MIN * 100),
          chunks_historico: _rateLimitHistorico.length
        }
      }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url==='/api/whatsapp/configurar' && req.method==='POST') {
    try {
      const pfW = validarToken(getToken(req));
      if(!pfW) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const b = await lerBody(req);
      const ativo = !!b.ativo;
      const numero = b.numero ? _normalizarNumeroWhats(b.numero) : null;
      _configRuntime.whatsapp = {
        ..._configRuntime.whatsapp,
        ativo,
        numero,
        api_url: b.api_url || _configRuntime.whatsapp.api_url || null,
        webhook_secret: b.webhook_secret || _configRuntime.whatsapp.webhook_secret || null,
        atualizado_em: new Date().toISOString()
      };
      await _salvarConfigPersistida('whatsapp', _configRuntime.whatsapp);
      if(ativo && numero) await _inicializarConexaoWhatsApp();
      if(!ativo) await _desconectarWhatsApp();
      res.writeHead(200,corsHeaders(req));
      res.end(JSON.stringify({
        ok:true,
        ativo: _configRuntime.whatsapp.ativo,
        numero: _configRuntime.whatsapp.numero,
        conectado: _estadoWhatsApp.conectado,
        ultima_mensagem: _estadoWhatsApp.ultima_mensagem
      }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url==='/api/whatsapp/status' && req.method==='GET') {
    try {
      const cfgW = await _carregarConfigPersistida('whatsapp', WHATSAPP_CONFIG);
      _configRuntime.whatsapp = {..._configRuntime.whatsapp, ...cfgW};
      res.writeHead(200,corsHeaders(req));
      res.end(JSON.stringify({
        ativo: !!_configRuntime.whatsapp.ativo,
        numero: _configRuntime.whatsapp.numero,
        conectado: !!_estadoWhatsApp.conectado,
        ultima_mensagem: _estadoWhatsApp.ultima_mensagem
      }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url==='/api/whatsapp/mensagem' && req.method==='POST') {
    try {
      const b = await lerBody(req);
      const numero = _normalizarNumeroWhats(b.numero || '');
      const mensagem = String(b.mensagem || '').trim();
      const tipo = String(b.tipo || 'texto').toLowerCase();
      if(!numero || !mensagem) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({ok:false,error:'numero e mensagem obrigatorios'})); return; }
      if(tipo !== 'texto') {
        res.writeHead(200,corsHeaders(req));
        res.end(JSON.stringify({ok:true, resposta:'No momento o secretario processa somente mensagens de texto.'}));
        return;
      }
      const sessao = await _carregarSessaoSecretarioWhatsApp(numero, null);
      const out = await _conversarWhatsAppCliente(numero, mensagem, sessao);
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({
        ok: !!out?.ok,
        resposta: out?.resposta || '',
        escalonado: !!out?.escalonado,
        perguntas_feitas: sessao.perguntas_feitas || 0
      }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({ok:false,error:e.message})); }
    return;
  }

  if(url==='/api/whatsapp/sessoes' && req.method==='GET') {
    try {
      const pf = validarToken(getToken(req));
      if(!pf) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const rows = await sbGet('whatsapp_sessoes', {}, { limit: 300, order: 'ultima_msg.desc' });
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({
        ok: true,
        total: (rows||[]).length,
        sessoes: (rows||[]).map(s => ({
          numero: s.numero,
          cliente_id: s.cliente_id || null,
          perguntas_feitas: s.perguntas_feitas || 0,
          inicio: s.inicio || null,
          ultima_msg: s.ultima_msg || null,
          escalonado: !!s.escalonado
        }))
      }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({ok:false,error:e.message})); }
    return;
  }

  if(url==='/api/whatsapp/escalonamentos' && req.method==='GET') {
    try {
      const pf = validarToken(getToken(req));
      if(!pf) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const itens = _estadoSecretarioWhatsApp.escalonamentos_memoria.filter(x => !x.resolvido);
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({
        ok: true,
        total_pendentes: itens.length,
        pendentes: itens.map(i => ({
          id: i.id,
          criado_em: i.criado_em,
          motivo: i.motivo,
          cliente: {
            nome: i?.cliente?.nome || null,
            cpf: i?.cliente?.cpf || null,
            whatsapp: i?.cliente?.whatsapp_jid || i?.cliente?.telefone || null
          },
          processo: {
            numero: i?.processo?.numero || null,
            area: i?.processo?.area || i?.cliente?.caso_tipo || null,
            fase: i?.processo?.status || null
          },
          ultimas_5_msgs: Array.isArray(i.conversa) ? i.conversa.slice(-5) : []
        }))
      }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({ok:false,error:e.message})); }
    return;
  }

  if(url==='/api/whatsapp/webhook' && req.method==='POST') {
    try {
      const b = await lerBody(req);
      const secCfg = _configRuntime.whatsapp.webhook_secret || '';
      const secReq = String(req.headers['x-webhook-secret'] || '');
      if(secCfg && secReq !== secCfg) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({ok:false,error:'assinatura invalida'})); return; }
      _estadoWhatsApp.ultima_mensagem = new Date().toISOString();
      res.writeHead(200, corsHeaders(req)); res.end(JSON.stringify({ok:true, recebido:true}));
      const data = b.data || b;
      const remoto = data.key?.remoteJid || data.from || data.numero || '';
      const nomeRem = data.pushName || data.nome || (String(remoto).split('@')[0] || 'Cliente');
      const numeroPlano = _numeroPlanoWhats(remoto);
      const cliente = await _resolverClientePorNumero(numeroPlano);
      if(cliente && !_whatsSaudados.has(numeroPlano)) {
        _whatsSaudados.add(numeroPlano);
        _whatsReconhecidos.set(numeroPlano, true);
        await envWhatsApp('Ola '+(cliente.nome||nomeRem)+'! Como posso ajudar hoje?', remoto).catch(()=>{});
      } else if(!cliente && !_whatsSaudados.has(numeroPlano)) {
        _whatsSaudados.add(numeroPlano);
        await envWhatsApp('Ola! Vou iniciar seu atendimento e cadastro rapido. Pode me dizer seu nome completo?', remoto).catch(()=>{});
      }
      adapterEvolution(b).catch(e=>console.error('WhatsApp webhook erro:', e.message));
    } catch(e) {
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({ok:false, erro:e.message}));
    }
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // ── CENTRAL DE MENSAGENS — Ler e Enviar Telegram/WhatsApp pelo Lex ──
  // ════════════════════════════════════════════════════════════════════════

  // Log de mensagens em memória (últimas 200 por canal)
  if(!global._centralMensagens) global._centralMensagens = { telegram:[], whatsapp:[] };

  // GET /api/mensagens — lista mensagens recentes de ambos os canais
  if(url==='/api/mensagens' && req.method==='GET') {
    try {
      const pf = validarToken(getToken(req));
      if(!pf) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const params = new URL('http://x'+req.url).searchParams;
      const canal = params.get('canal') || 'todos'; // telegram, whatsapp, todos
      const limite = Math.min(parseInt(params.get('limite')||'50'), 200);
      let msgs = [];
      if(canal === 'telegram' || canal === 'todos') msgs = msgs.concat((global._centralMensagens.telegram||[]).slice(-limite));
      if(canal === 'whatsapp' || canal === 'todos') msgs = msgs.concat((global._centralMensagens.whatsapp||[]).slice(-limite));
      msgs.sort((a,b) => new Date(b.em) - new Date(a.em));
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({ ok:true, total:msgs.length, mensagens:msgs.slice(0,limite) }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // GET /api/contatos — lista contatos da agenda
  if(url==='/api/contatos' && req.method==='GET') {
    try {
      const pf = validarToken(getToken(req));
      if(!pf) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autorizado'})); return; }
      const r = await sbReq('GET', 'contatos', null, { order: 'nome.asc' });
      res.writeHead(200,{...corsHeaders(req),'Content-Type':'application/json'});
      res.end(JSON.stringify(r.body||[]));
    } catch(e) { res.writeHead(200,{...corsHeaders(req),'Content-Type':'application/json'}); res.end('[]'); }
    return;
  }

  // POST /api/contatos — salvar contato na agenda
  if(url==='/api/contatos' && req.method==='POST') {
    try {
      const pf = validarToken(getToken(req));
      if(!pf) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autorizado'})); return; }
      const b = await lerBody(req);
      const r = await sbReq('POST', 'contatos', b, {}, { onConflict: 'telefone', merge: 'nome,cpf,email,processo_id,processo_nome,obs' });
      res.writeHead(200,{...corsHeaders(req),'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:true}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // POST /api/mensagens/enviar — envia mensagem pelo Telegram ou WhatsApp
  if(url==='/api/mensagens/enviar' && req.method==='POST') {
    try {
      const pf = validarToken(getToken(req));
      if(!pf || pf === 'secretaria') { res.writeHead(403,corsHeaders(req)); res.end(JSON.stringify({error:'Sem permissao'})); return; }
      const b = await lerBody(req);
      const canal = String(b.canal||'').toLowerCase();
      const destino = String(b.destino||b.numero||b.chat_id||'').trim();
      const texto = String(b.texto||b.mensagem||'').trim();
      if(!canal || !destino || !texto) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'canal, destino e texto obrigatorios'})); return; }

      let enviado = false;
      if(canal === 'telegram') {
        try {
          await envTelegram(texto, null, destino);
          enviado = true;
          _registrarMsgCentral('telegram', 'saida', destino, 'Kleuber (Lex)', texto);
        } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:'Erro Telegram: '+e.message})); return; }
      } else if(canal === 'whatsapp') {
        try {
          await envWhatsApp(texto, destino);
          enviado = true;
          _registrarMsgCentral('whatsapp', 'saida', destino, 'Kleuber (Lex)', texto);
        } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:'Erro WhatsApp: '+e.message})); return; }
      } else {
        res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'canal deve ser telegram ou whatsapp'})); return;
      }

      res.writeHead(200,corsHeaders(req));
      res.end(JSON.stringify({ok:true, enviado, canal, destino}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // GET /api/mensagens/contatos — lista contatos/conversas ativas
  if(url==='/api/mensagens/contatos' && req.method==='GET') {
    try {
      const pf = validarToken(getToken(req));
      if(!pf) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      // Agrupa msgs por remetente/destinatário
      const contatos = new Map();
      for(const canal of ['telegram','whatsapp']) {
        for(const m of (global._centralMensagens[canal]||[])) {
          const key = canal + ':' + (m.chatId || m.destino);
          if(!contatos.has(key)) {
            contatos.set(key, { canal, chatId: m.chatId||m.destino, nome: m.nome||m.chatId||m.destino, ultimaMsg: m.em, totalMsgs: 0, naoLidas: 0 });
          }
          const c = contatos.get(key);
          c.totalMsgs++;
          if(m.em > c.ultimaMsg) { c.ultimaMsg = m.em; c.nome = m.nome || c.nome; }
          if(m.direcao === 'entrada' && !m.lida) c.naoLidas++;
        }
      }
      const lista = [...contatos.values()].sort((a,b) => new Date(b.ultimaMsg) - new Date(a.ultimaMsg));
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({ ok:true, contatos: lista }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url==='/api/pje/configurar' && req.method==='POST') {
    try {
      const pfP = validarToken(getToken(req));
      if(!pfP) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const b = await lerBody(req);
      const oab = String(b.oab_numero||'').trim().toUpperCase();
      if(oab && !_validarOab(oab)) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'Formato OAB invalido. Use XXXXXX/UF'})); return; }
      const tribunais = Array.isArray(b.tribunais) ? b.tribunais : (Array.isArray(b.tribunais_favoritos) ? b.tribunais_favoritos : []);
      _configRuntime.pje = {
        ..._configRuntime.pje,
        ativo: true,
        oab_numero: oab || null,
        oab_nome: b.oab_nome || null,
        tribunais_favoritos: tribunais,
        auto_consulta: (typeof b.auto_consulta==='boolean') ? b.auto_consulta : _configRuntime.pje.auto_consulta,
        certificado_tipo: 'A3',
        atualizado_em: new Date().toISOString()
      };
      await _salvarConfigPersistida('pje', _configRuntime.pje);
      res.writeHead(200,corsHeaders(req));
      res.end(JSON.stringify({ok:true, config:_configRuntime.pje}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url==='/api/pje/conectar' && req.method==='POST') {
    try {
      const pfP = validarToken(getToken(req));
      if(!pfP) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const cfgP = await _carregarConfigPersistida('pje', PJE_CONFIG);
      _configRuntime.pje = {..._configRuntime.pje, ...cfgP};
      const tribunais = (_configRuntime.pje.tribunais_favoritos||[]).length ? _configRuntime.pje.tribunais_favoritos : ['TJSP','TRT-2','TRF-3'];
      res.writeHead(200,corsHeaders(req));
      res.end(JSON.stringify({
        ok:true,
        conectado:false,
        modo:'navegador',
        certificado_tipo:'A3',
        mensagem:'O certificado A3 e login PJe devem ocorrer no navegador do usuario.',
        orientacao:'Abra o PJe no navegador, faca login com token A3 e mantenha sessao ativa. O bot consulta andamentos publicos pela DATAJUD.',
        tribunais
      }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url.startsWith('/api/pje/andamentos') && req.method==='GET') {
    try {
      const pfP = validarToken(getToken(req));
      if(!pfP) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const u = new URL(req.url, 'http://x');
      let processo_numero = u.searchParams.get('processo_numero') || u.searchParams.get('processo') || '';
      // Fallback: se recebeu processo_id sem numero, buscar no array processos
      if(!processo_numero) {
        const pid = u.searchParams.get('processo_id');
        if(pid) {
          const proc = processos.find(p => String(p.id) === String(pid));
          if(proc && proc.numero) processo_numero = proc.numero;
        }
      }
      if(!processo_numero) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'processo_numero obrigatorio (ou processo_id de processo com numero cadastrado)'})); return; }
      const trib = u.searchParams.get('tribunal') || _extrairTribunalDoProcesso(processo_numero);
      const r = await _buscarAndamentosDatajud(processo_numero, trib);
      const ultima = r.movimentacoes[0] || null;
      const chave = String(processo_numero);
      const assinatura = ultima ? (ultima.data+'|'+ultima.tipo+'|'+ultima.texto) : '';
      const antigo = _pjeMovCache[chave];
      const nova = !!(assinatura && antigo && assinatura !== antigo);
      _pjeMovCache[chave] = assinatura || antigo || '';
      if(nova && ultima) {
        await envTelegram('MOVIMENTACAO: Processo '+processo_numero+' - '+(ultima.tipo||'Movimentacao')+' em '+(ultima.data||new Date().toISOString()), null, CHAT_ID).catch(()=>{});
      }
      res.writeHead(200,corsHeaders(req));
      res.end(JSON.stringify({
        ok:r.ok,
        processo_numero,
        tribunal:r.tribunal,
        movimentacoes:r.movimentacoes,
        nova_movimentacao:nova,
        erro:r.erro||null
      }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url==='/api/pje/sincronizar' && req.method==='POST') {
    try {
      const pfP = validarToken(getToken(req));
      if(!pfP) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const varredura = await _varrerAndamentosPjeAgora();
      res.writeHead(200,corsHeaders(req));
      res.end(JSON.stringify({
        ok:true,
        processos: processos.filter(p=>p.numero).map(p => ({
          id:p.id,
          nome:p.nome,
          numero:p.numero,
          tribunal:p.tribunal || _extrairTribunalDoProcesso(p.numero),
          ultimoAndamento:(p.andamentos&&p.andamentos[0]) ? p.andamentos[0].txt : ''
        })),
        resumo: 'Monitorados: '+varredura.monitorados+' | Novidades: '+varredura.novidades,
        novasIntimacoes: varredura.alertas.map(a => ({ nome:a.processo.nome, numero:a.processo.numero })),
        ultimo_check: varredura.ultimo_check
      }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // GET /api/relatorio
  if(url==='/api/relatorio' && req.method==='GET') {
    try {
      const hoje = horaBrasilia().toLocaleDateString('pt-BR');
      const logs = await sbGet('agente_logs', {});
      const doDia = logs.filter(l=>new Date(l.criado_em).toLocaleDateString('pt-BR')===hoje);
      res.writeHead(200,corsHeaders(req));
      res.end(JSON.stringify({
        total_hoje: doDia.length,
        total_geral: logs.length,
        uptime: Math.floor(process.uptime()),
        sessoes: Object.keys(MEMORIA).length,
        processos: processos.length,
        versao_processos: processosVersao,
        ultimo_aparelho: processosUltimoAparelho,
        escritorio: ESCRITORIO.nome
      }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }


  // [PATCH_PECAS_DOWNLOAD_ENDPOINTS]
  // POST /api/pecas/gerar-pdf {titulo, conteudo, tipo: peticao|pericia}
  if((url==='/api/pecas/gerar-pdf' || url==='/api/gerar-pdf') && req.method==='POST') {
    try {
      const pfPecaPdf = validarToken(getToken(req));
      if(!pfPecaPdf) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      const b = await lerBody(req);
      const tipo = String((b.tipo || 'peticao')).toLowerCase();
      if(!['peticao','pericia'].includes(tipo)) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'tipo deve ser peticao|pericia'})); return; }
      const titulo = String(b.titulo || (tipo==='pericia' ? 'Laudo Pericial' : 'Peça Jurídica'));
      const conteudo = String(b.conteudo || '').trim();
      if(!conteudo) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'conteudo obrigatório'})); return; }
      const pdfBuf = await _gerarPecaPdfBuffer(titulo, conteudo, tipo);
      const nome = _nomeArquivoSeguro(titulo, '.pdf');
      res.writeHead(200, { 'Content-Type':'application/pdf', 'Content-Disposition':'attachment; filename="' + nome + '"', ...corsHeaders(req) });
      res.end(pdfBuf);
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // POST /api/pecas/gerar-docx {titulo, conteudo, tipo: peticao|pericia}
  if((url==='/api/pecas/gerar-docx' || url==='/api/gerar-docx') && req.method==='POST') {
    try {
      const pfPecaDocx = validarToken(getToken(req));
      if(!pfPecaDocx) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      const b = await lerBody(req);
      const tipo = String((b.tipo || 'peticao')).toLowerCase();
      if(!['peticao','pericia'].includes(tipo)) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'tipo deve ser peticao|pericia'})); return; }
      const titulo = String(b.titulo || (tipo==='pericia' ? 'Laudo Pericial' : 'Peça Jurídica'));
      const conteudo = String(b.conteudo || '').trim();
      if(!conteudo) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'conteudo obrigatório'})); return; }
      const docxBuf = _gerarDocxBufferPeca(titulo, conteudo, tipo);
      const nome = _nomeArquivoSeguro(titulo, '.docx');
      res.writeHead(200, {
        'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition':'attachment; filename="' + nome + '"',
        ...corsHeaders(req)
      });
      res.end(docxBuf);
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // POST /api/docx — fallback simples
  if(url==='/api/docx' && req.method==='POST') {
    try {
      const b = await lerBody(req);
      if(!b.texto) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'texto obrigatório'})); return; }
      const buf = Buffer.from(b.texto, 'utf8');
      res.writeHead(200, {
        'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition':'attachment; filename="peticao.docx"',
        ...corsHeaders(req)
      });
      res.end(buf);
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // NOVA FUNC 1: SSE — Server-Sent Events para push em tempo real
  // GET /api/sse → stream de eventos; cliente recebe notificações instantâneas
  // quando qualquer processo muda ou comando chega
  // ════════════════════════════════════════════════════════════════════════
  if(url==='/api/sse' && req.method==='GET') {
    // SSE: valida token com regra relaxada (assinatura válida, sem check de idle)
    // porque EventSource reconecta automaticamente e token pode ter sido criado há >30min
    const tkSse = getToken(req);
    let pfSse = null;
    try {
      if(tkSse) {
        const { p, ts, sig } = JSON.parse(Buffer.from(tkSse,'base64url').toString());
        const esperado = CRYPTO.createHmac('sha256', AUTH_SECRET).update(p+'|'+ts).digest('hex').slice(0,16);
        if(sig === esperado && PERMS[p]) {
          pfSse = p;
          // Registra atividade (mantém sessão viva pra outras rotas)
          if(!global._sessaoAtividade) global._sessaoAtividade = new Map();
          global._sessaoAtividade.set(tkSse, Date.now());
        }
      }
    } catch(e) {}
    if(!pfSse) { res.writeHead(401,corsHeaders(req)); res.end('data: {"error":"Não autenticado"}\n\n'); return; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': _corsOrigin(req),
      'Access-Control-Allow-Headers': 'Authorization,Content-Type'
    });
    const clientId = Date.now() + '_' + Math.random().toString(36).slice(2);
    _sseClientes.set(clientId, res);
    console.log('[SSE] Cliente conectado:', clientId, '| total:', _sseClientes.size);
    // Envia estado inicial
    res.write('event: conectado\ndata: '+JSON.stringify({
      ok: true, clientId,
      processos: processos.length,
      versao: processosVersao,
      ts: Date.now()
    })+'\n\n');
    // Heartbeat a cada 25s para manter conexão viva (proxies matam após 30s sem dados)
    const hbInterval = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch(e) { clearInterval(hbInterval); }
    }, 25000);
    req.on('close', () => {
      clearInterval(hbInterval);
      _sseClientes.delete(clientId);
      console.log('[SSE] Cliente desconectado:', clientId, '| restantes:', _sseClientes.size);
    });
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // NOVA FUNC 2: Refresh de token — /api/auth/refresh
  // POST /api/auth/refresh desativado: senha obrigatória a cada acesso
  // ════════════════════════════════════════════════════════════════════════
  if(url==='/api/auth/refresh' && req.method==='POST') {
    res.writeHead(410, CORS);
    res.end(JSON.stringify({ error:'Refresh desativado. Faça login novamente com senha.' }));
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // NOVA FUNC 3: Sync-Push — /api/sync-push
  // POST /api/sync-push → aceita mudanças, persiste e notifica todos os
  // outros aparelhos via SSE instantaneamente
  // ════════════════════════════════════════════════════════════════════════
  if(url==='/api/sync-push' && req.method==='POST') {
    try {
      const pfPush = validarToken(getToken(req));
      if(!pfPush) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      const b = await lerBody(req);
      if(!Array.isArray(b.processos)) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'processos[] obrigatório'})); return; }
      const aparelhoId = req.headers['x-aparelho-id'] || b.aparelhoId || 'web';
      const clientVersao = parseInt(b.clientVersao||0, 10);
      if(clientVersao > 0 && clientVersao < processosVersao) {
        res.writeHead(409, corsHeaders(req));
        res.end(JSON.stringify({
          error: 'Versão desatualizada. Baixe antes de enviar.',
          servidorVersao: processosVersao, clientVersao,
          processos
        }));
        return;
      }
      processos = b.processos;
      _bumpProcessos(aparelhoId);
      await _persistirProcessosCache();
      // Notifica TODOS os clientes SSE conectados imediatamente
      const evento = JSON.stringify({
        tipo: 'processos_atualizados',
        aparelho: aparelhoId,
        versao: processosVersao,
        total: processos.length,
        ts: Date.now()
      });
      let notificados = 0;
      for(const [cid, cres] of _sseClientes) {
        try { cres.write('event: processos_atualizados\ndata: '+evento+'\n\n'); notificados++; }
        catch(e) { _sseClientes.delete(cid); }
      }
      console.log('[sync-push]', aparelhoId, '| processos:', processos.length,
        '| versão:', processosVersao, '| SSE notificados:', notificados);
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({ ok: true, versao: processosVersao, total: processos.length, notificados }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url==='/api/calendario' && req.method==='GET') {
    try {
      const pfCal = validarToken(getToken(req));
      if(!pfCal) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      const eventos = _coletarEventosCalendario();
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({ ok:true, total:eventos.length, eventos }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url.startsWith('/api/arquivo-morto/exportar') && req.method==='GET') {
    try {
      const pfAm = validarToken(getToken(req));
      if(!pfAm) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      const u = new URL(req.url, 'http://x');
      const tipo = u.searchParams.get('tipo') || 'todos';
      let rows = await sbGet('clientes_pendentes', {}, { limit: 1000, order: 'atualizado_em.desc' });
      if(tipo === 'finalizados') rows = rows.filter(r => ['pronto_peticao','convertido'].includes(r.status));
      if(tipo === 'inativos') rows = rows.filter(r => {
        const dt = new Date(r.ultimo_contato || r.atualizado_em || r.criado_em || Date.now()).getTime();
        return (Date.now() - dt) > 30*24*3600000;
      });
      const payload = {
        meta: { tipo, exportado_em: new Date().toISOString(), total: rows.length, versao:'arquivo-morto-v1' },
        dados: rows
      };
      const jsonBuf = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
      const zipBuf = _zipStorePeca([{ nome:'clientes_pendentes.json', data: jsonBuf }]);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename=\"arquivo_morto_'+Date.now()+'.zip\"',
        ...corsHeaders(req)
      });
      res.end(zipBuf);
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url==='/api/arquivo-morto/limpar' && req.method==='POST') {
    try {
      const pfAmL = validarToken(getToken(req));
      if(!pfAmL || pfAmL!=='admin') { res.writeHead(403,corsHeaders(req)); res.end(JSON.stringify({error:'Sem permissão'})); return; }
      const b = await lerBody(req);
      const tipo = b.tipo || 'inativos';
      const rows = await sbGet('clientes_pendentes', {}, { limit: 1000, order: 'atualizado_em.desc' });
      let alvo = rows;
      if(tipo === 'finalizados') alvo = rows.filter(r => ['pronto_peticao','convertido'].includes(r.status));
      if(tipo === 'inativos') alvo = rows.filter(r => {
        const dt = new Date(r.ultimo_contato || r.atualizado_em || r.criado_em || Date.now()).getTime();
        return (Date.now() - dt) > 30*24*3600000;
      });
      let removidos = 0;
      for(const c of alvo) {
        await sbUpsert('arquivo_morto_indice', {
          id_indice: 'cli_'+String(c.chat_id),
          chat_id: String(c.chat_id),
          nome: c.nome || c.nome_usuario_canal || '',
          caso_tipo: c.caso_tipo || '',
          status_original: c.status || '',
          ultimo_contato: c.ultimo_contato || c.atualizado_em || c.criado_em || null,
          resumo: (c.caso_descricao || '').substring(0,500),
          arquivado_em: new Date().toISOString()
        }, 'id_indice');
        await sbDelete('clientes_pendentes', { chat_id: String(c.chat_id) });
        removidos++;
      }
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({ ok:true, tipo, removidos }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url.startsWith('/api/arquivo-morto/consultar') && req.method==='GET') {
    try {
      const pfAmC = validarToken(getToken(req));
      if(!pfAmC) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      const u = new URL(req.url, 'http://x');
      const q = _normTexto(u.searchParams.get('q') || '');
      const rows = await sbGet('arquivo_morto_indice', {}, { limit: 1000, order: 'arquivado_em.desc' });
      const filtrados = !q ? rows : rows.filter(r => _normTexto((r.nome||'')+' '+(r.resumo||'')+' '+(r.caso_tipo||'')).includes(q));
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({ ok:true, total: filtrados.length, resultados: filtrados.slice(0,100) }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if(url==='/api/arquivo-morto/restaurar' && req.method==='POST') {
    try {
      const pfAmR = validarToken(getToken(req));
      if(!pfAmR || pfAmR!=='admin') { res.writeHead(403,corsHeaders(req)); res.end(JSON.stringify({error:'Sem permissão'})); return; }
      const b = await lerBody(req);
      if(!b.zipBase64) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'zipBase64 obrigatório'})); return; }
      const zipBuf = Buffer.from(String(b.zipBase64), 'base64');
      const arqJson = _extrairZipEntry(zipBuf, 'clientes_pendentes.json') || _extrairZipEntry(zipBuf, 'arquivo_morto.json');
      if(!arqJson) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'ZIP inválido: JSON não encontrado'})); return; }
      const json = arqJson.toString('utf8');
      const payload = JSON.parse(json);
      const dados = Array.isArray(payload?.dados) ? payload.dados : [];
      let restaurados = 0;
      for(const c of dados) {
        if(!c || !c.chat_id) continue;
        await sbUpsert('clientes_pendentes', c, 'chat_id');
        restaurados++;
      }
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({ ok:true, restaurados }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // CONTROLE DE TEMPO DE USO — 3 endpoints
  // Tabela Supabase 'tempo_uso': perfil, data, hora_inicio, hora_fim, minutos_ativos
  // Frontend envia heartbeat a cada 60s enquanto usuário estiver ativo.
  // ════════════════════════════════════════════════════════════════════════

  // POST /api/tempo/registrar — registra login, logout ou heartbeat
  if(url==='/api/tempo/registrar' && req.method==='POST') {
    try {
      const pfTempo = validarToken(getToken(req));
      if(!pfTempo) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      const b = await lerBody(req);
      const acao = b.acao; // 'login' | 'logout' | 'heartbeat'
      const perfilAlvo = b.perfil || pfTempo;
      // Apenas admin pode registrar por outro perfil
      if(perfilAlvo !== pfTempo && pfTempo !== 'admin') {
        res.writeHead(403,corsHeaders(req)); res.end(JSON.stringify({error:'Sem permissão'})); return;
      }
      if(!['login','logout','heartbeat'].includes(acao)) {
        res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'acao deve ser login|logout|heartbeat'})); return;
      }
      const resultado = await _registrarTempoUso(perfilAlvo, acao, b.timestamp || Date.now());
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({ ok: true, acao, ...resultado }));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // GET /api/tempo/resumo?perfil=secretaria — tempo hoje, semana e mês
  if(url.startsWith('/api/tempo/resumo') && req.method==='GET') {
    try {
      const pfRs = validarToken(getToken(req));
      if(!pfRs) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      const u = new URL(req.url, 'http://x');
      const perfilConsulta = u.searchParams.get('perfil') || pfRs;
      if(perfilConsulta !== pfRs && pfRs !== 'admin') {
        res.writeHead(403,corsHeaders(req)); res.end(JSON.stringify({error:'Sem permissão'})); return;
      }
      const resumo = await _resumoTempoUso(perfilConsulta);
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify(resumo));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // GET /api/tempo/historico?perfil=secretaria&dias=30 — histórico detalhado
  if(url.startsWith('/api/tempo/historico') && req.method==='GET') {
    try {
      const pfHist = validarToken(getToken(req));
      if(!pfHist) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      const u = new URL(req.url, 'http://x');
      const perfilConsulta = u.searchParams.get('perfil') || pfHist;
      const dias = Math.min(parseInt(u.searchParams.get('dias')||'30', 10), 365);
      if(perfilConsulta !== pfHist && pfHist !== 'admin') {
        res.writeHead(403,corsHeaders(req)); res.end(JSON.stringify({error:'Sem permissão'})); return;
      }
      const historico = await _historicoTempoUso(perfilConsulta, dias);
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify(historico));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // NOVA FUNC 4: Motor de Sacadas Jurídicas — /api/sacadas-juridicas
  // POST /api/sacadas-juridicas { texto, area, tribunal }
  // Analisa jurisprudência buscando EXCEÇÕES, distinguishing, votos vencidos
  // que viraram maioria, e mudanças recentes de entendimento
  // ════════════════════════════════════════════════════════════════════════
  if(url==='/api/sacadas-juridicas' && req.method==='POST') {
    try {
      const pfSj = validarToken(getToken(req));
      if(!pfSj) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      if(pfSj==='secretaria') { res.writeHead(403,corsHeaders(req)); res.end(JSON.stringify({error:'Sem permissão'})); return; }
      const b = await lerBody(req);
      if(!b.texto) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'texto obrigatório'})); return; }
      const sacadas = await _motorSacardasJuridicas(b.texto, b.area||'', b.tribunal||'', b.processo||null);
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify(sacadas));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  // NOVA FUNC 5: Perfil Psicológico do Juiz — /api/perfil-juiz
  // POST /api/perfil-juiz { nomeJuiz, tribunal, processoId? }
  // Analisa padrão decisório e monta perfil: conservador/inovador,
  // formalista/flexível, detalhista/resumido, receptividade por área
  // ════════════════════════════════════════════════════════════════════════
  if(url==='/api/perfil-juiz' && req.method==='POST') {
    try {
      const pfJuiz = validarToken(getToken(req));
      if(!pfJuiz) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      if(pfJuiz==='secretaria') { res.writeHead(403,corsHeaders(req)); res.end(JSON.stringify({error:'Sem permissão'})); return; }
      const b = await lerBody(req);
      if(!b.nomeJuiz) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'nomeJuiz obrigatório'})); return; }
      const perfil = await _analisarPerfilJuiz(b.nomeJuiz, b.tribunal||'', b.processoId||null, b.decisoes||null);
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify(perfil));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PROGNÓSTICO POR PROCESSO — /api/prognostico
  // POST { processo_id:number } → estimativa realista via IA
  // ════════════════════════════════════════════════════════════════════════════
  if(url==='/api/prognostico' && req.method==='POST') {
    try {
      const pfProg = validarToken(getToken(req));
      if(!pfProg) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Não autenticado'})); return; }
      if(pfProg==='secretaria') { res.writeHead(403,corsHeaders(req)); res.end(JSON.stringify({error:'Sem permissão'})); return; }
      const b = await lerBody(req);
      const pid = Number(b && b.processo_id);
      if(!pid) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'processo_id obrigatório'})); return; }
      const processo = processos.find(p => Number(p.id) === pid);
      if(!processo) { res.writeHead(404,corsHeaders(req)); res.end(JSON.stringify({error:'Processo não encontrado'})); return; }
      const prognostico = await _gerarPrognosticoRealista(processo);
      res.writeHead(200, corsHeaders(req));
      res.end(JSON.stringify({ ok:true, processo_id: pid, prognostico }));
    } catch(e) {
      res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message}));
    }
    return;
  }

  // POST /api/notificar-telegram — envia mensagem customizada pro Telegram admin
  if(url==='/api/notificar-telegram' && req.method==='POST') {
    try {
      const pfTg = validarToken(getToken(req));
      if(!pfTg || pfTg !== 'admin') { res.writeHead(403,corsHeaders(req)); res.end(JSON.stringify({error:'Somente admin pode enviar notificacoes'})); return; }
      const b = await lerBody(req);
      if(!b.mensagem || typeof b.mensagem !== 'string' || !b.mensagem.trim()) {
        res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'mensagem obrigatoria'})); return;
      }
      if(!TK) { res.writeHead(503,CORS); res.end(JSON.stringify({error:'TELEGRAM_TOKEN nao configurado no servidor'})); return; }
      await envTelegram(b.mensagem.trim(), null, b.chat_id || CHAT_ID);
      res.writeHead(200,corsHeaders(req)); res.end(JSON.stringify({ok:true, msg:'Notificacao enviada via Telegram'}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // POST /api/revogar — Revogar token/sessão
  if(url==='/api/revogar' && req.method==='POST') {
    try {
      const tk = getToken(req);
      if(!tk || !validarToken(tk)) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Token invalido'})); return; }
      if(!global._tokensRevogados) global._tokensRevogados = new Set();
      global._tokensRevogados.add(tk);
      res.writeHead(200,corsHeaders(req)); res.end(JSON.stringify({ok:true, msg:'Sessao revogada'}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // POST /api/refresh-token — Renovar token JWT
  if(url==='/api/refresh-token' && req.method==='POST') {
    try {
      const tk = getToken(req);
      const perfil = validarToken(tk);
      if(!perfil) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Token invalido ou expirado'})); return; }
      const novoToken = gerarToken(perfil);
      res.writeHead(200,corsHeaders(req)); res.end(JSON.stringify({ok:true, token:novoToken, perfil}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // POST /api/tempo-uso/login — Registrar momento de login
  if(url==='/api/tempo-uso/login' && req.method==='POST') {
    try {
      const pf = validarToken(getToken(req));
      if(!pf) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const b = await lerBody(req);
      if(!global._tempoUsoRegistros) global._tempoUsoRegistros = [];
      global._tempoUsoRegistros.push({perfil:pf, tipo:'login', ts:Date.now(), data:new Date().toISOString().slice(0,10)});
      res.writeHead(200,corsHeaders(req)); res.end(JSON.stringify({ok:true}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // POST /api/tempo-uso — Registrar heartbeat de tempo de uso
  if(url==='/api/tempo-uso' && req.method==='POST') {
    try {
      const pf = validarToken(getToken(req));
      if(!pf) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const b = await lerBody(req);
      if(!global._tempoUsoRegistros) global._tempoUsoRegistros = [];
      global._tempoUsoRegistros.push({perfil:pf, tipo:'heartbeat', ts:Date.now(), data:new Date().toISOString().slice(0,10), minutos:b.minutos||1});
      res.writeHead(200,corsHeaders(req)); res.end(JSON.stringify({ok:true}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // GET /api/tempo-uso/relatorio — Relatório de tempo de uso
  if(url.startsWith('/api/tempo-uso/relatorio') && req.method==='GET') {
    try {
      const pf = validarToken(getToken(req));
      if(!pf) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const u2 = new URL(req.url, 'http://localhost');
      const perfilFiltro = u2.searchParams.get('perfil') || pf;
      const regs = (global._tempoUsoRegistros||[]).filter(r=>r.perfil===perfilFiltro);
      const porDia = {};
      for(const r of regs) {
        if(!porDia[r.data]) porDia[r.data] = {logins:0, minutos:0};
        if(r.tipo==='login') porDia[r.data].logins++;
        if(r.tipo==='heartbeat') porDia[r.data].minutos += (r.minutos||1);
      }
      const dias = Object.keys(porDia).sort().map(d=>({data:d,...porDia[d]}));
      res.writeHead(200,corsHeaders(req)); res.end(JSON.stringify({ok:true, perfil:perfilFiltro, total:regs.length, dias}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // POST /api/jurisprudencia — Buscar jurisprudência via IA
  if(url==='/api/jurisprudencia' && req.method==='POST') {
    try {
      const pf = validarToken(getToken(req));
      if(!pf) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const b = await lerBody(req);
      if(!b.tema && !b.area) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'tema ou area obrigatorio'})); return; }
      const sysJuris = 'Você é um pesquisador jurídico expert. Busque jurisprudência REAL e VERIFICÁVEL sobre o tema solicitado. NUNCA invente decisões, números de processo ou ementas. Se não tiver certeza, diga que não encontrou. Formate: Tribunal, Número, Relator, Data, Ementa resumida, e como se aplica ao caso. Foque em STJ, STF, TST e TRFs. Priorize decisões recentes (últimos 5 anos).';
      const msgs = [{role:'user', content:`Busque jurisprudência sobre: ${b.tema||''} | Área: ${b.area||'geral'} | Tribunal preferencial: ${b.tribunal||'todos'} | Contexto adicional: ${b.contexto||'nenhum'}`}];
      const txt = await ia(msgs, sysJuris, 4096);
      res.writeHead(200,corsHeaders(req)); res.end(JSON.stringify({ok:true, resposta:txt, tema:b.tema, area:b.area}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // POST /api/gestor/chat — Chat do gestor com Opus 4.7 e contexto de processos
  if(url==='/api/gestor/chat' && req.method==='POST') {
    try {
      const pf = validarToken(getToken(req));
      if(!pf) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const b = await lerBody(req);
      if(!b.messages || !Array.isArray(b.messages)) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'messages obrigatorio'})); return; }
      const resumoProcs = processos.slice(0,30).map(p=>`[${p.id}] ${p.titulo||p.nome||'?'} (${p.area||'?'}) - ${p.status||'?'} - Cliente: ${p.cliente||'?'}`).join('\n');
      const sysGestor = sysAssessor(null, null) + '\n\n## Processos ativos no escritório:\n' + (resumoProcs || '(nenhum processo cadastrado)') + '\n\nVocê tem acesso direto aos dados acima. Responda como gestor do escritório.';
      const txt = await ia(b.messages, sysGestor, b.maxTokens||4096);
      res.writeHead(200,corsHeaders(req)); res.end(JSON.stringify({ok:true, resposta:txt, text:txt}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // POST /api/processo/atualizar — Atualizar campos de um processo individual
  if(url==='/api/processo/atualizar' && req.method==='POST') {
    try {
      const pf = validarToken(getToken(req));
      if(!pf) { res.writeHead(401,corsHeaders(req)); res.end(JSON.stringify({error:'Nao autenticado'})); return; }
      const b = await lerBody(req);
      if(!b.processo_id) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'processo_id obrigatorio'})); return; }
      // BACKUP antes de atualizar
      _backupProcesso(b.processo_id, 'atualizacao_api');
      const idx = processos.findIndex(p=>String(p.id)===String(b.processo_id));
      if(idx===-1) { res.writeHead(404,corsHeaders(req)); res.end(JSON.stringify({error:'Processo nao encontrado'})); return; }
      const camposPermitidos = ['titulo','area','status','cliente','descricao','numero','valor_causa','juiz','vara','proxacao','prazo','prazoReal','observacoes'];
      const atualizados = [];
      for(const campo of camposPermitidos) {
        if(b[campo] !== undefined) { processos[idx][campo] = b[campo]; atualizados.push(campo); }
      }
      if(b.prazos && Array.isArray(b.prazos)) { processos[idx].prazos = b.prazos; atualizados.push('prazos'); }
      if(b.andamentos && Array.isArray(b.andamentos)) { processos[idx].andamentos = b.andamentos; atualizados.push('andamentos'); }
      // AUDITORIA
      _auditarAcao(pf, 'processo_atualizar_api', {processo_id:b.processo_id, campos:atualizados});
      res.writeHead(200,corsHeaders(req)); res.end(JSON.stringify({ok:true, processo_id:b.processo_id, atualizados, msg:'Processo atualizado com sucesso'}));
    } catch(e) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // ═══════════════════════════════════════════════════════════════════
  // FEATURE: POST /api/exportar-dados-cliente — Export LGPD (ZIP)
  // ═══════════════════════════════════════════════════════════════════
  if(url==='/api/exportar-dados-cliente' && req.method==='POST') {
    try {
      const pf = validarToken(getToken(req));
      if(!pf || pf!=='admin') { res.writeHead(403,corsHeaders(req)); res.end(JSON.stringify({error:'Somente admin pode exportar dados'})); return; }
      const b = await lerBody(req);
      const clienteNome = (b.cliente_nome||b.cliente||'').trim().toLowerCase();
      const clienteId = b.cliente_id ? String(b.cliente_id) : '';
      if(!clienteNome && !clienteId) { res.writeHead(400,corsHeaders(req)); res.end(JSON.stringify({error:'cliente_nome ou cliente_id obrigatorio'})); return; }

      // Filtrar processos do cliente
      const procsCliente = processos.filter(p => {
        if(clienteId && String(p.id)===clienteId) return true;
        if(clienteId && String(p.cliente_id)===clienteId) return true;
        const nome = (p.cliente||p.nome||'').toLowerCase();
        return clienteNome && nome.includes(clienteNome);
      });

      if(procsCliente.length===0) { res.writeHead(404,corsHeaders(req)); res.end(JSON.stringify({error:'Nenhum processo encontrado para este cliente'})); return; }

      // Montar ZIP
      const zip = new JSZip();
      zip.file('processos.json', JSON.stringify(procsCliente, null, 2));

      const todosAndamentos = [];
      const todosPrazos = [];
      for(const p of procsCliente) {
        if(Array.isArray(p.andamentos)) todosAndamentos.push(...p.andamentos.map(a=>({...a, processo_id:p.id, processo_titulo:p.titulo})));
        if(Array.isArray(p.prazos)) todosPrazos.push(...p.prazos.map(z=>({...z, processo_id:p.id, processo_titulo:p.titulo})));
      }
      zip.file('andamentos.json', JSON.stringify(todosAndamentos, null, 2));
      zip.file('prazos.json', JSON.stringify(todosPrazos, null, 2));
      zip.file('README.txt', [
        'EXPORTACAO DE DADOS - LEX JURIDICO',
        '===================================',
        'Cliente: ' + (clienteNome || clienteId),
        'Data da exportacao: ' + new Date().toISOString(),
        'Total de processos: ' + procsCliente.length,
        'Total de andamentos: ' + todosAndamentos.length,
        'Total de prazos: ' + todosPrazos.length,
        '',
        'Arquivos:',
        '- processos.json: Todos os processos do cliente com dados completos',
        '- andamentos.json: Historico de andamentos de todos os processos',
        '- prazos.json: Todos os prazos e audiencias',
        '',
        'Conforme LGPD (Lei 13.709/2018), Art. 18, V - Direito a portabilidade dos dados.',
        'Estes dados pertencem ao cliente e podem ser transferidos para outro escritorio.'
      ].join('\n'));

      const zipBuf = await zip.generateAsync({type:'nodebuffer'});
      res.writeHead(200, {...corsHeaders(req), 'Content-Type':'application/zip', 'Content-Disposition':'attachment; filename="dados_cliente.zip"', 'Content-Length':zipBuf.length});
      res.end(zipBuf);
    } catch(e) { if(!res.writableEnded) { res.writeHead(500,corsHeaders(req)); res.end(JSON.stringify({error:e.message})); } }
    return;
  }

  // POST /api/analisar-documento-estrategico — Analise profunda de PDF processual (ate 5000 folhas)
  if(url==='/api/analisar-documento-estrategico' && req.method==='POST'){
    try{
      const pf=validarToken(getToken(req));
      if(!pf){res.writeHead(401,corsHeaders(req));res.end(JSON.stringify({error:'Nao autenticado'}));return;}
      const b=await lerBody(req);
      if(!b.processo_id){res.writeHead(400,corsHeaders(req));res.end(JSON.stringify({error:'processo_id obrigatorio'}));return;}
      const proc=processos.find(p=>String(p.id)===String(b.processo_id));
      if(!proc){res.writeHead(404,corsHeaders(req));res.end(JSON.stringify({error:'Processo nao encontrado'}));return;}
      if(!b.documento_base64){res.writeHead(400,corsHeaders(req));res.end(JSON.stringify({error:'documento_base64 obrigatorio'}));return;}
      
      const buffer=Buffer.from(b.documento_base64,'base64');
      const pagEst=Math.max(1,Math.round(buffer.length/(1024*1024)*7));
      if(pagEst>PDF_MAX_PGS_TOTAL){
        res.writeHead(400,corsHeaders(req));res.end(JSON.stringify({error:`Documento muito grande: ~${pagEst} pg. Limite: ${PDF_MAX_PGS_TOTAL} folhas`}));return;
      }
      
      _auditarAcao(pf,'analise_estrategica_iniciada',{processo_id:b.processo_id,tipo_doc:b.tipo_documento||'decisao',paginas:pagEst});
      _backupProcesso(b.processo_id,'pre_analise_estrategica');
      
      res.writeHead(202,CORS);res.end(JSON.stringify({
        ok:true,
        msg:`Analise estrategica iniciada. Documento: ~${pagEst} paginas. Pode levar ate ${Math.ceil(pagEst/50)*2} minutos.`,
        processo_id:b.processo_id,
        status:'processando',
        paginas_estimadas:pagEst
      }));
      
      _processarAnaliseEstrategicaAsync(b.processo_id,proc,b,pf);
    }catch(e){if(!res.writableEnded){res.writeHead(500,corsHeaders(req));res.end(JSON.stringify({error:e.message}));}}
    return;
  }

  res.writeHead(404, CORS);
  res.end(JSON.stringify({error:'Not found'}));
});

// ═══════════════════════════════════════════════════════════════════
// FEATURE: Processar marcadores de ação no chat do assessor
// Formato: [ATUALIZAR:processo_id:campo:valor] [ANDAMENTO:processo_id:descricao] [PRAZO:processo_id:descricao:data:tipo]
// ═══════════════════════════════════════════════════════════════════
async function _processarMarcadoresChat(texto, perfil='assessor') {
  if(!texto) return [];
  const acoes = [];
  const hoje = new Date().toISOString().slice(0,10);
  const em5dias = new Date(Date.now() + 5*86400000).toISOString().slice(0,10);
  
  // [ATUALIZAR:ID:campo:valor]
  const regAtu = /\[ATUALIZAR:(\d+):(\w+):([^\]]+)\]/g;
  let m;
  while((m = regAtu.exec(texto)) !== null) {
    const idx = processos.findIndex(p=>String(p.id)===m[1]);
    if(idx!==-1) {
      const camposValidos = ['status','titulo','juiz','vara','proxacao','observacoes','area','cliente','prazo','setor'];
      if(camposValidos.includes(m[2])) {
        _backupProcesso(m[1], 'atualizacao_assessor_chat');
        if(m[2] === 'setor') processos[idx][m[2]] = _normalizarSetorProcesso(m[3], processos[idx]?.tipo, processos[idx]?.area);
        else processos[idx][m[2]] = m[3];
        processos[idx].atualizado_em = new Date().toISOString();
        acoes.push({tipo:'atualizar', processo_id:m[1], campo:m[2], valor:m[3], ok:true});
        _auditarAcao(perfil, 'atualizar_processo', {processo_id:m[1], campo:m[2], valor:m[3]});
        // ── PERSISTIR NO SUPABASE ──
        try {
          const updateData = {};
          updateData[m[2]] = m[3];
          await sbReq('PATCH', 'processos', updateData, { id: 'eq.' + m[1] });
        } catch(e) { console.warn('[Lex] Erro persisting update:', e.message); }
        
        // ── AUTO-PRAZO 5 DIAS para conferência (exceto se é julgamento) ──
        if(m[2] !== 'prazo') {
          if(!Array.isArray(processos[idx].prazos)) processos[idx].prazos = [];
          const novoPz = {id:Date.now(), descricao:'Conferir atualização: '+m[2]+' → '+m[3], data:em5dias, tipo:'conferencia', status:'pendente'};
          processos[idx].prazos.push(novoPz);
          // Atualiza prazo principal do processo
          // Atualiza prazo principal APENAS se não tinha prazo (conferência não sobrescreve prazo real)
          if(!processos[idx].prazo) {
            processos[idx].prazo = em5dias.split('-').reverse().join('/');
            try { await sbReq('PATCH', 'processos', { prazo: processos[idx].prazo }, { id: 'eq.' + m[1] }); } catch(e) {}
          }
          acoes.push({tipo:'prazo_auto', processo_id:m[1], descricao:'Conferência em 5 dias', data:em5dias, ok:true});
        }
      }
    }
  }
  // [ANDAMENTO:ID:descricao]
  const regAnd = /\[ANDAMENTO:(\d+):([^\]]+)\]/g;
  while((m = regAnd.exec(texto)) !== null) {
    const idx = processos.findIndex(p=>String(p.id)===m[1]);
    if(idx!==-1) {
      if(!Array.isArray(processos[idx].andamentos)) processos[idx].andamentos = [];
      _backupProcesso(m[1], 'novo_andamento_assessor');
      const novoAnd = {id:Date.now(), data:hoje, descricao:m[2], tipo:'atualizacao_assessor'};
      processos[idx].andamentos.push(novoAnd);
      const setor = _normalizarSetorProcesso(processos[idx]?.setor, processos[idx]?.tipo, processos[idx]?.area);
      processos[idx].status = setor === 'autuacao' ? 'EM_PREP' : 'ATIVO';
      processos[idx].atualizado_em = new Date().toISOString();
      acoes.push({tipo:'andamento', processo_id:m[1], descricao:m[2], ok:true});
      _auditarAcao(perfil, 'adicionar_andamento', {processo_id:m[1], descricao:m[2]});
      // ── PERSISTIR andamento no Supabase ──
      try {
        await sbReq('POST', 'andamentos', { processo_id: parseInt(m[1]), data: hoje, descricao: m[2], tipo: 'atualizacao_assessor' });
      } catch(e) {}
      // ── AUTO-PRAZO 5 DIAS para conferência ──
      if(!Array.isArray(processos[idx].prazos)) processos[idx].prazos = [];
      processos[idx].prazos.push({id:Date.now()+1, descricao:'Conferir andamento: '+m[2].substring(0,50), data:em5dias, tipo:'conferencia', status:'pendente'});
      acoes.push({tipo:'prazo_auto', processo_id:m[1], descricao:'Conferência em 5 dias', data:em5dias, ok:true});
    }
  }
  // [PRAZO:ID:descricao:data:tipo]
  const regPz = /\[PRAZO:(\d+):([^:]+):([^:]+):([^\]]+)\]/g;
  while((m = regPz.exec(texto)) !== null) {
    const idx = processos.findIndex(p=>String(p.id)===m[1]);
    if(idx!==-1) {
      if(!Array.isArray(processos[idx].prazos)) processos[idx].prazos = [];
      _backupProcesso(m[1], 'novo_prazo_assessor');
      const novoPz = {id:Date.now(), descricao:m[2], data:m[3], tipo:m[4], status:'pendente'};
      processos[idx].prazos.push(novoPz);
      acoes.push({tipo:'prazo', processo_id:m[1], descricao:m[2], data:m[3], ok:true});
      _auditarAcao(perfil, 'adicionar_prazo', {processo_id:m[1], descricao:m[2], data:m[3]});
      // ── PERSISTIR prazo no Supabase ──
      try {
        await sbReq('POST', 'prazos', { processo_id: parseInt(m[1]), descricao: m[2], data: m[3], tipo: m[4], status: 'pendente' });
        // Atualiza prazo principal se este é mais próximo
        const prazoAtual = processos[idx].prazo ? new Date(processos[idx].prazo.split('/').reverse().join('-')) : new Date('2099-01-01');
        const prazoNovo = new Date(m[3]);
        if(prazoNovo < prazoAtual) {
          processos[idx].prazo = m[3].split('-').reverse().join('/');
          await sbReq('PATCH', 'processos', { prazo: processos[idx].prazo }, { id: 'eq.' + m[1] });
        }
      } catch(e) {}
      
      // ── Se é JULGAMENTO: registrar na agenda e calendário ──
      if(m[4] && /julgamento|audiencia|sessao/i.test(m[4])) {
        try {
          await sbReq('POST', 'eventos_calendario', {
            processo_id: parseInt(m[1]),
            titulo: m[2],
            data: m[3],
            tipo: m[4],
            processo_nome: processos[idx]?.nome || ''
          });
        } catch(e) {}
        // Notifica equipe sobre julgamento
        const nomeProc = processos[idx]?.nome || 'Processo #'+m[1];
        _notificarEquipe('📅 *JULGAMENTO AGENDADO*\n\n📁 '+nomeProc+'\n📆 Data: '+m[3]+'\n📝 '+m[2]+'\n\n⚠️ Marcado no calendário e nos prazos.').catch(()=>{});
      }
    }
  }
  return acoes;
}

// ═══════════════════════════════════════════════════════════════════
// FEATURE: Horários de notificação Telegram (08:00, 12:00, 17:00)
// ═══════════════════════════════════════════════════════════════════
if(!global._filaNotificacoes) global._filaNotificacoes = [];

function _dentroHorarioNotificacao() {
  const agora = new Date();
  const h = agora.getHours();
  const m = agora.getMinutes();
  const totalMin = h * 60 + m;
  // Janelas: 07:50-08:10, 11:50-12:10, 16:50-17:10
  if(totalMin >= 470 && totalMin <= 490) return true;  // 07:50-08:10
  if(totalMin >= 710 && totalMin <= 730) return true;  // 11:50-12:10
  if(totalMin >= 1010 && totalMin <= 1030) return true; // 16:50-17:10
  return false;
}

function envTelegramAgendado(msg, opts, chatId) {
  if(_dentroHorarioNotificacao()) {
    return envTelegram(msg, opts, chatId);
  } else {
    global._filaNotificacoes.push({msg, opts, chatId: chatId||CHAT_ID, ts:Date.now()});
    return Promise.resolve({ok:true, enfileirado:true});
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SISTEMA DE AUDITORIA, BACKUP E PERSISTÊNCIA (CRÍTICO)
// ════════════════════════════════════════════════════════════════════════════

// Sistema 1: Auditoria de ações críticas
if(!global._auditoria) global._auditoria = [];
async function _auditarAcao(perfil, acao, dados) {
  const registro = {
    ts: Date.now(),
    data: new Date().toISOString(),
    perfil: perfil || 'desconhecido',
    acao: acao,
    dados: JSON.stringify(dados || {}),
    ip: null // IP seria preenchido se disponível no req
  };
  global._auditoria.push(registro);
  // Limitar a 1000 registros em memória
  if(global._auditoria.length > 1000) global._auditoria.shift();
  // Tentar salvar no Supabase (não bloqueia se falhar)
  try {
    await sbReq('POST', 'auditoria', registro);
  } catch(e) { /* Fallback: mantém só em memória */ }
}

// Sistema 2: Backup automático antes de atualizações
if(!global._backupsProcessos) global._backupsProcessos = [];
function _backupProcesso(processo_id, motivo) {
  const proc = processos.find(p => String(p.id) === String(processo_id));
  if(!proc) return null;
  const backup = {
    ts: Date.now(),
    data: new Date().toISOString(),
    processo_id: processo_id,
    motivo: motivo || 'atualizacao',
    dados: JSON.parse(JSON.stringify(proc)) // Deep copy
  };
  global._backupsProcessos.push(backup);
  // Manter só os últimos 100 backups
  if(global._backupsProcessos.length > 100) global._backupsProcessos.shift();
  return backup;
}

// Sistema 3: Persistência de mensagens Telegram/WhatsApp
if(!global._mensagensChat) global._mensagensChat = [];
async function _salvarMensagemChat(plataforma, direcao, chatId, mensagem, processo_id, metadados) {
  const registro = {
    ts: Date.now(),
    data: new Date().toISOString(),
    plataforma: plataforma, // 'telegram' ou 'whatsapp'
    direcao: direcao, // 'enviada' ou 'recebida'
    chat_id: chatId,
    mensagem: String(mensagem || '').substring(0, 4000),
    processo_id: processo_id || null,
    metadados: JSON.stringify(metadados || {})
  };
  global._mensagensChat.push(registro);
  // Limitar a 2000 mensagens em memória
  if(global._mensagensChat.length > 2000) global._mensagensChat.shift();
  // Tentar salvar no Supabase
  try {
    await sbReq('POST', 'mensagens_chat', registro);
  } catch(e) { /* Fallback: mantém só em memória */ }
}

// Wrapper para envTelegram com persistência
const _envTelegramOriginal = envTelegram;
envTelegram = async function(texto, tId, chatId) {
  // Salvar antes de enviar
  await _salvarMensagemChat('telegram', 'enviada', chatId || CHAT_ID, texto, null, {thread_id: tId});
  return _envTelegramOriginal(texto, tId, chatId);
};

// Flush da fila de notificações a cada 5 minutos
setInterval(async () => {
  if(_dentroHorarioNotificacao() && global._filaNotificacoes.length > 0) {
    const fila = [...global._filaNotificacoes];
    global._filaNotificacoes = [];
    for(const item of fila) {
      try { await envTelegram(item.msg, item.opts, item.chatId); } catch(e) { console.warn('[Fila Telegram] Erro:', e.message); }
    }
    console.log(`[Fila Telegram] ${fila.length} notificacoes enviadas no horario`);
  }
}, 5 * 60 * 1000);

server.listen(process.env.PORT||3000, async () => {
  // VALIDACAO DE SEGURANCA NO STARTUP
  const errosSeguranca = [];
  
  // 1. Tentar carregar senhas do Supabase (sobrescreve env vars se existir)
  try {
    const configs = await sbReq('GET', 'config', null, {select: 'chave,valor'});
    if(Array.isArray(configs)) {
      for(const cfg of configs) {
        if(cfg.chave === 'SENHA_ADMIN' && cfg.valor) {
          SENHAS_WEB.admin = cfg.valor;
          console.log('[SEGURANCA] Senha admin carregada do Supabase');
        }
        if(cfg.chave === 'SENHA_SECRETARIA' && cfg.valor) {
          SENHAS_WEB.secretaria = cfg.valor;
          console.log('[SEGURANCA] Senha secretaria carregada do Supabase');
        }
        if(cfg.chave === 'secretaria_telegram_chat_id' && cfg.valor) {
          if(!_configRuntime.secretario_whatsapp.operadores) _configRuntime.secretario_whatsapp.operadores = {...SECRETARIO_WHATSAPP_CONFIG.operadores};
          _configRuntime.secretario_whatsapp.operadores.secretaria.telegram_chat_id = String(cfg.valor);
          console.log('[MULTI-OP] Secretária Telegram Chat ID carregado:', cfg.valor);
        }
        if(cfg.chave === 'pix_chave' && cfg.valor) {
          _PIX_CONFIG.chave = String(cfg.valor);
          console.log('[PIX] Chave PIX carregada do Supabase');
        }
      }
    }
  } catch(e) {
    console.warn('[SEGURANCA] Nao foi possivel carregar senhas do Supabase:', e.message);
  }
  
  // 2. Verificar senhas configuradas
  if(!SENHAS_WEB.admin) errosSeguranca.push('SENHA_ADMIN nao configurada');
  if(!SENHAS_WEB.secretaria) errosSeguranca.push('SENHA_SECRETARIA nao configurada');
  if(SENHAS_WEB.admin?.length < 8) errosSeguranca.push('SENHA_ADMIN muito curta (min 8 caracteres)');
  
  // 3. Verificar ANTHROPIC_KEY
  if(!process.env.ANTHROPIC_KEY) errosSeguranca.push('ANTHROPIC_KEY nao configurada');
  else if(!process.env.ANTHROPIC_KEY.startsWith('sk-ant-')) errosSeguranca.push('ANTHROPIC_KEY formato invalido');
  
  // 4. Verificar Supabase
  if(!process.env.SUPABASE_URL) errosSeguranca.push('SUPABASE_URL nao configurada');
  if(!process.env.SUPABASE_KEY) errosSeguranca.push('SUPABASE_KEY nao configurada');
  
  // 5. Verificar Telegram (opcional mas alerta)
  if(!process.env.TELEGRAM_TOKEN) console.warn('[SEGURANCA] TELEGRAM_TOKEN nao configurado - notificacoes desativadas');
  
  if(errosSeguranca.length > 0) {
    console.error('[SEGURANCA] ERROS CRITICOS ENCONTRADOS:');
    errosSeguranca.forEach(e => console.error('  - ' + e));
    console.error('[SEGURANCA] O sistema funcionara com funcionalidades limitadas.');
  } else {
    console.log('[SEGURANCA] Todas as credenciais validadas com sucesso');
  }
  
  console.log('HTTP+API porta', process.env.PORT||3000);
});

// ════════════════════════════════════════════════════════════════════════════
// ALERTAS AUTOMÁTICOS
// ════════════════════════════════════════════════════════════════════════════
const HORARIOS_NORMAIS = [8, 12, 17];
const HORA_LIMITE = 18;

async function enviarAlertas() {
  const urg = getPrazos(5);
  const prep = getProcPrep();
  if(!urg.length && !prep.length) return;
  const msgs = [];
  if(urg.length) {
    let m = '⏰ ALERTAS DE PRAZO\n\n';
    urg.forEach(p => {
      if(p.dias<0) m += '🔴 VENCIDO há '+Math.abs(p.dias)+'d: '+p.nome+'\n';
      else if(p.dias===0) m += '🚨 VENCE HOJE: '+p.nome+'\nAção: '+(p.proxacao||'verificar')+'\n\n';
      else if(p.dias===1) m += '⚠️ AMANHÃ: '+p.nome+' ('+p.prazo+')\n';
      else m += '📅 '+p.dias+'d: '+p.nome+' ('+p.prazo+')\n';
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
  for(const m of msgs) await envTelegram(m);
}

function agendarProximoAlerta() {
  const agora = horaBrasilia();
  const hora = agora.getHours();
  const min = agora.getMinutes();
  const venceHoje = getPrazos(0).filter(p=>p.dias===0);
  let proxHora = null;
  if(venceHoje.length > 0) {
    if(hora < HORA_LIMITE) proxHora = hora + 1;
  } else {
    proxHora = HORARIOS_NORMAIS.find(h=>h>hora||(h===hora&&min<1))||null;
  }
  if(proxHora !== null) {
    const ms = ((proxHora-hora)*60-min)*60000;
    setTimeout(async()=>{await enviarAlertas();agendarProximoAlerta();}, ms);
    console.log('Próximo alerta às '+proxHora+'h ('+Math.round(ms/60000)+'min)');
  } else {
    const amanha = new Date(); amanha.setDate(amanha.getDate()+1); amanha.setHours(8,0,0,0);
    const ms = amanha - agora;
    setTimeout(async()=>{await enviarAlertas();agendarProximoAlerta();}, ms);
  }
}

setTimeout(()=>{enviarAlertas();agendarProximoAlerta();}, 2*60*1000);
setInterval(_executarFollowupClientesPendentes, 60*60*1000);
setTimeout(()=>{ _executarFollowupClientesPendentes().catch(()=>{}); }, 3*60*1000);
setInterval(_monitorarCapacidadeDB, 6*60*60*1000);
setTimeout(()=>{ _monitorarCapacidadeDB().catch(()=>{}); }, 5*60*1000);
const _PJE_VARREDURA_HORAS = Math.max(1, parseInt(process.env.PJE_SCAN_HOURS || String(_PJE_INTERVALO_PADRAO_HORAS), 10));
setInterval(async ()=>{
  try {
    const cfgP = await _carregarConfigPersistida('pje', PJE_CONFIG);
    _configRuntime.pje = {..._configRuntime.pje, ...cfgP};
    if(!_configRuntime.pje.ativo || !_configRuntime.pje.auto_consulta) return;
    const out = await _varrerAndamentosPjeAgora();
    if(out.novidades > 0) {
      await envTelegram('PJe auto-consulta: '+out.novidades+' movimentacao(oes) nova(s).', null, CHAT_ID).catch(()=>{});
    }
  } catch(e) { console.warn('[pje] varredura automatica falhou:', e.message); }
}, _PJE_VARREDURA_HORAS * 60 * 60 * 1000);
setTimeout(async ()=>{
  try {
    _configRuntime.whatsapp = await _carregarConfigPersistida('whatsapp', WHATSAPP_CONFIG);
    _configRuntime.secretario_whatsapp = await _carregarConfigPersistida('secretario_whatsapp', SECRETARIO_WHATSAPP_CONFIG);
    _configRuntime.pje = await _carregarConfigPersistida('pje', PJE_CONFIG);
    if(_configRuntime.whatsapp.ativo && _configRuntime.whatsapp.numero) await _inicializarConexaoWhatsApp();
  } catch(e) { console.warn('[config] carga inicial falhou:', e.message); }
}, 2000);

// ════════════════════════════════════════════════════════════════════════════
// SUPERVISÃO
// ════════════════════════════════════════════════════════════════════════════
async function publicarStatusCEO() {
  try {
    const hoje = new Date().toLocaleDateString('pt-BR');
    await sbUpsert('lex_status', {
      agente_id: 'lex_ceo',
      data: hoje,
      processos_total: processos.length,
      urgentes: processos.filter(p=>p.status==='URGENTE').length,
      em_preparacao: processos.filter(p=>p.status==='EM_PREP').length,
      prazos_criticos: getPrazos(3).filter(p=>p.dias<=3).length,
      sessoes_ativas: Object.keys(MEMORIA).length,
      uptime: Math.floor(process.uptime()),
      versao_processos: processosVersao,
      atualizado_em: new Date().toISOString()
    }, 'agente_id');
  } catch(e){ console.warn('[Lex][bot] Erro silenciado:', (e && e.message) ? e.message : e); }
}
setInterval(publicarStatusCEO, 60*60*1000);

// ════════════════════════════════════════════════════════════════════════════
// INIT / BOOT
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=================================');
console.log('LEX ASSESSOR JURÍDICO IA v3.0');
console.log('=================================');
console.log('🏢 ESCRITÓRIO DIGITAL:');
Lex.listar().forEach(a => {
  const icone = a.status === 'pronto' ? '✅' : a.status === 'pendente' ? '⏳' : '🔴';
  console.log('   '+icone+' '+a.nome+' — '+a.descricao.substring(0,60));
});
console.log('---------------------------------');
console.log('⚖ Funções Lex: /peca /pericia /calc /redteam');
console.log('🧮 Calc determinística + validadores CPF/CEP');
console.log('Split PDF: >'+PDF_MAX_PGS_DIRETO+'pg → chunks de '+PDF_PGS_POR_CHUNK+'pg');
console.log('Rate limit Anthropic: '+RATE_LIMIT_TOKENS_POR_MIN+' tokens/min');
console.log('Canais: Telegram + WhatsApp (paritários)');
console.log('Supabase:', SB_URL ? 'OK' : 'NÃO CONFIGURADO');
console.log('Evolution:', EVO_URL ? 'OK' : 'NÃO CONFIGURADO');
console.log('Porta:', process.env.PORT||3000);
console.log('=================================\n');

// Agenda verificação automática do Cobrador (24h)
_agendarCobrador();

// ════════════════════════════════════════════════════════════════════════════
// REGISTRO DE FUNCIONÁRIOS (v2.9) — instanciar classes e registrar no Lex
// ════════════════════════════════════════════════════════════════════════════
//
// Cada classe é uma FACHADA para as funções existentes. Não duplica código,
// só formaliza a interface. Isso preserva 100% da compatibilidade.

class AgenteRoteador extends AgenteBase {
  constructor() {
    super({
      nome: 'Roteador',
      descricao: 'Identifica qual processo é qual entre os cadastrados. Resolve casos com partes iguais (ex: Eliane x 3 processos).',
      status: 'pronto',
      ferramentas: ['identificarProcesso', 'calcularScore']
    });
  }
  identificarProcesso(analise) { return _agenteRoteador(analise); }
  calcularScore(analise, proc) { return _calcularScore(analise, proc); }
}

class AgenteCadastrador extends AgenteBase {
  constructor() {
    super({
      nome: 'Cadastrador/Autuação',
      descricao: 'Opera no setor de Autuação: recebe novos clientes, abre caso em EM_PREP e cobra documentos pendentes.',
      status: 'pronto',
      ferramentas: ['receber', 'carregarPerfil', 'faltantesPessoais', 'faltantesProbatorios']
    });
  }
  async receber(ctx, tipo, conteudo) { return await _cadastradorRecebeu(ctx, tipo, conteudo); }
  async carregarPerfil(chatId, canal, nomeUsuario) { return await _carregarPerfilCliente(chatId, canal, nomeUsuario); }
  faltantesPessoais(perfil) { return _faltantesPessoais(perfil); }
  faltantesProbatorios(perfil) { return _faltantesProbatorios(perfil); }
}

class AgenteCobrador extends AgenteBase {
  constructor() {
    super({
      nome: 'Cobrador',
      descricao: 'Monitora processos atrasados. Limiares: URGENTE 6d, ATIVO 15d, EM_PREP 30d. Notifica Kleuber via scheduler 24h.',
      status: 'pronto',
      ferramentas: ['executar', 'listarAtrasados', 'diasSemAtualizacao']
    });
  }
  async executar(ctx) { return await _executarCobrador(ctx); }
  listarAtrasados() { return _processosParaCobrar(); }
  diasSemAtualizacao(proc) { return _diasSemAtualizacao(proc); }
}

class AgenteAssessor extends AgenteBase {
  constructor() {
    super({
      nome: 'Assessor',
      descricao: 'Redige peças jurídicas via diálogo 3 turnos (diagnóstico→estratégia→autorização). 7 regras inegociáveis (estabilidade, debate, julgador, jurisprudência real, CPC, adversarial).',
      status: 'pronto',
      ferramentas: ['diagnostico', 'estrategia', 'redacao', 'redTeam']
    });
  }
  async diagnostico(ctx, mem, proc, conteudo, tipoConteudo) { return await _assessorDiagnostico(ctx, mem, proc, conteudo, tipoConteudo); }
  async estrategia(ctx, mem, escolha) { return await _assessorEstrategia(ctx, mem, escolha); }
  async redacao(ctx, mem) { return await _assessorRedacao(ctx, mem); }
  async redTeam(ctx, pecaTexto, proc) { return await _assessorRedTeam(ctx, pecaTexto, proc); }
}

class AgentePericial extends AgenteBase {
  constructor() {
    super({
      nome: 'Pericial',
      descricao: 'Elabora laudo pericial contábil (NBC TP 01) com calculadora determinística. Respostas aos quesitos, metodologia, memória de cálculo.',
      status: 'pronto',
      ferramentas: ['gerarLaudo', 'calcular']
    });
  }
  async gerarLaudo(ctx, mem, proc, instrucoes, calculos) { return await _assessorPerical(ctx, mem, proc, instrucoes, calculos); }
  calcular(tipo, params) {
    if(tipo==='simples') return _calc.jurosSimples(params.C, params.i, params.n);
    if(tipo==='composto') return _calc.jurosCompostos(params.C, params.i, params.n);
    if(tipo==='corrige') return _calc.corrigir(params.V, params.idx);
    throw new Error('Tipo de cálculo desconhecido: '+tipo);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// AGENTE PJe (NOVO na v2.9) — esqueleto pronto pra integração futura
// ════════════════════════════════════════════════════════════════════════════
//
// ARQUITETURA:
//   1. lex-agente.js (Playwright no PC do Wanderson) consulta PJe com A3
//   2. Quando detecta andamento novo, envia POST para o Lex (endpoint abaixo)
//   3. Este agente recebe, valida, e reporta evento ao Lex
//   4. Lex muda o processo correspondente para URGENTE (6d) e avisa Kleuber
//
// ENDPOINT A IMPLEMENTAR no servidor Express: POST /api/pje/andamento
// (adicionar quando lex-agente.js estiver pronto)

class AgentePJe extends AgenteBase {
  constructor() {
    super({
      nome: 'PJe',
      descricao: 'Consulta PJe via Playwright (no PC do Wanderson) e detecta andamentos novos não informados ao Lex. Muda processo para URGENTE automaticamente.',
      status: 'pendente',  // pendente até lex-agente.js estar testado
      ferramentas: ['receberAndamento', 'marcarUrgente']
    });
  }

  // Chamado quando o lex-agente.js detecta andamento novo
  // dados: { cnj, andamento_texto, data, tribunal }
  async receberAndamento(dados) {
    console.log('[AgentePJe] andamento recebido: '+dados.cnj);
    // Localiza o processo via Agente Roteador (reaproveita classificação)
    const analiseSimulada = {
      numero_processo: dados.cnj,
      partes: dados.partes || '',
      tribunal: dados.tribunal || ''
    };
    const match = _agenteRoteador(analiseSimulada);
    if(match.tipo === 'match_cnj' || match.tipo === 'match_score') {
      this.marcarUrgente(match.proc, dados);
      this.registrarEvento('andamento_detectado', {
        proc_id: match.proc.id, proc_nome: match.proc.nome, dados
      });
      // Reporta ao Lex
      await Lex.receberEvento('PJe', 'andamento_detectado', {
        proc: match.proc, dados
      });
      // Notifica Kleuber diretamente
      try {
        await envTelegram(
          '🏛️ ANDAMENTO NOVO DETECTADO NO PJE\n\n'+
          '📋 '+match.proc.nome+'\n'+
          (match.proc.numero ? 'Nº: '+match.proc.numero+'\n' : '')+
          (dados.data ? 'Data: '+dados.data+'\n' : '')+
          '\n📝 '+(dados.andamento_texto||'(texto não fornecido)').substring(0,400)+'\n'+
          '\n⚠ Processo agora URGENTE (6 dias).\n'+
          'Me manda a peça quando puder.',
          null, CHAT_ID
        ).catch(()=>{});
      } catch(_){ console.warn('[Lex][bot] Erro silenciado:', (_ && _.message) ? _.message : _); }
      return { sucesso: true, proc_nome: match.proc.nome };
    }
    console.warn('[AgentePJe] andamento não casou com processo: '+dados.cnj);
    return { sucesso: false, motivo: 'processo não encontrado no Lex' };
  }

  // Muda status do processo para URGENTE e adiciona andamento
  marcarUrgente(proc, dados) {
    const idx = processos.findIndex(p => p.id === proc.id);
    if(idx < 0) return;
    processos[idx].status = 'URGENTE';
    // Prazo de 6 dias a partir de hoje
    const d = new Date();
    d.setDate(d.getDate() + 6);
    processos[idx].prazo = String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
    // Adiciona andamento
    if(!processos[idx].andamentos) processos[idx].andamentos = [];
    processos[idx].andamentos.unshift({
      data: new Date().toLocaleDateString('pt-BR'),
      txt: '[PJe] '+(dados.andamento_texto||'Andamento detectado automaticamente').substring(0,300)
    });
    _bumpProcessos('pje');
    _persistirProcessosCache().catch(()=>{});
  }
}

// Instanciar e registrar todos os funcionários
Lex.registrar(new AgenteRoteador());
Lex.registrar(new AgenteCadastrador());
Lex.registrar(new AgenteCobrador());
Lex.registrar(new AgenteAssessor());
Lex.registrar(new AgentePericial());
Lex.registrar(new AgentePJe());

// ════════════════════════════════════════════════════════════════════════════
// NOVA FUNC 4: MOTOR DE SACADAS JURÍDICAS
// Analisa um texto de jurisprudência/decisão buscando:
//   - Exceções a súmulas e entendimentos dominantes
//   - Distinguishing (distinção de casos por fatos concretos)
//   - Votos vencidos que se tornaram maioria posteriormente
//   - Mudanças de entendimento recentes (overruling / superação)
//   - Argumentos de defesa não óbvios
// ════════════════════════════════════════════════════════════════════════════
async function _motorSacardasJuridicas(texto, area, tribunal, processo) {
  const ctxProcesso = processo
    ? `\n\nCONTEXTO DO PROCESSO:\nNome: ${processo.nome||'—'}\nÁrea: ${processo.area||area}\nTribunal: ${processo.tribunal||tribunal}\nStatus: ${processo.status||'—'}\nDescrição: ${processo.descricao||'—'}`
    : '';
  const prompt = `Você é um assessor jurídico sênior especializado em encontrar "sacadas jurídicas" — argumentos não-óbvios, exceções a entendimentos dominantes, e viradas jurisprudenciais que podem mudar o resultado de um caso.

ÁREA: ${area||'não informada'}
TRIBUNAL: ${tribunal||'não informado'}
${ctxProcesso}

TEXTO/JURISPRUDÊNCIA A ANALISAR:
${texto.substring(0, 12000)}

Analise profundamente e responda em JSON com a estrutura:
{
  "excecoes_sumulas": [{"sumula":"número/enunciado", "excecao":"descrição da exceção aplicável", "fundamento":"base legal/doutrinária"}],
  "distinguishing": [{"caso_geral":"regra geral", "fato_distintivo":"o que diferencia o caso concreto", "argumento":"como usar isso na defesa/ataque"}],
  "votos_vencidos_viraram_maioria": [{"tese":"tese que era vencida", "quando_mudou":"estimativa", "status_atual":"majoritária/crescente/isolada"}],
  "mudancas_recentes": [{"entendimento_antigo":"o que prevalecia antes", "entendimento_novo":"o que prevalece agora", "marco":"decisão/lei que mudou", "impacto_caso":"como afeta este caso"}],
  "argumentos_nao_obvios": [{"argumento":"descrição", "fundamento":"base", "risco":"eventual risco de usar", "potencial":"alto/médio/baixo"}],
  "estrategia_recomendada": "síntese em 3-5 linhas da melhor estratégia processual aproveitando as sacadas identificadas",
  "nivel_oportunidade": "alto/médio/baixo",
  "resumo_executivo": "2-3 linhas para o advogado decidir se vale a pena aprofundar"
}`;

  const txt = await ia([{role:'user', content: prompt}], null, 3500);
  const m = txt.replace(/```json|```/g,'').trim().match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : txt); }
  catch(e) {
    return {
      erro_parse: true,
      texto_bruto: txt.substring(0, 2000),
      estrategia_recomendada: txt.substring(0, 500)
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// NOVA FUNC 5: PERFIL PSICOLÓGICO DO JUIZ
// Analisa padrão decisório de um juiz/relator e monta perfil estratégico:
//   - Postura: conservador / inovador / pragmático
//   - Estilo: formalista / flexível / principiológico
//   - Extensão: detalhista / resumido / técnico
//   - Receptividade por área do direito
//   - Pontos de atenção para petições direcionadas
// ════════════════════════════════════════════════════════════════════════════
async function _analisarPerfilJuiz(nomeJuiz, tribunal, processoId, decisoesTexto) {
  // Busca processos com esse juiz no banco local para enriquecer contexto
  const processosDoJuiz = processos.filter(p =>
    p.juiz_relator && _normTexto(p.juiz_relator).includes(_normTexto(nomeJuiz))
  );
  const ctxLocal = processosDoJuiz.length > 0
    ? `\n\nPROCESSOS COM ESTE JUIZ (${processosDoJuiz.length} encontrado(s) no banco local):\n`
      + processosDoJuiz.slice(0,5).map(p =>
        `- ${p.nome} | ${p.area||'—'} | Status: ${p.status} | Resultado: ${p.resultado||'pendente'} | Desc: ${(p.descricao||'').substring(0,120)}`
      ).join('\n')
    : '';
  const ctxDecisoes = decisoesTexto
    ? `\n\nDECISÕES FORNECIDAS PARA ANÁLISE:\n${decisoesTexto.substring(0, 8000)}`
    : '';

  const prompt = `Você é um estrategista jurídico especializado em "judicial profiling" — análise do perfil decisório de magistrados para otimizar estratégias processuais.

MAGISTRADO: ${nomeJuiz}
TRIBUNAL: ${tribunal||'não informado'}
${ctxLocal}
${ctxDecisoes}

Com base nas informações disponíveis (processos locais, decisões fornecidas, e seu conhecimento geral sobre magistrados brasileiros), elabore um perfil estratégico detalhado.

Responda em JSON:
{
  "nome": "${nomeJuiz}",
  "tribunal": "${tribunal||'não informado'}",
  "postura_geral": "conservador|inovador|pragmático|imprevisível",
  "estilo_decisorio": "formalista|flexível|principiológico|casuístico",
  "extensao_decisoes": "detalhista|resumido|técnico|narrativo",
  "receptividade_por_area": {
    "civil": "alta|média|baixa|desconhecida",
    "criminal": "alta|média|baixa|desconhecida",
    "trabalhista": "alta|média|baixa|desconhecida",
    "previdenciario": "alta|média|baixa|desconhecida",
    "familia": "alta|média|baixa|desconhecida",
    "administrativo": "alta|média|baixa|desconhecida"
  },
  "pontos_fortes_para_peticionar": ["argumento que este juiz costuma acolher", "..."],
  "pontos_de_atencao": ["o que evitar neste juízo", "..."],
  "perfil_em_liminares": "deferente|restritivo|criterioso|impulsivo",
  "perfil_em_recursos": "manutenção|reforma|técnico",
  "linguagem_recomendada": "como redigir petições para este magistrado",
  "estrategia_ouro": "a sacada principal para ter sucesso neste juízo",
  "nivel_confianca_perfil": "alto|médio|baixo",
  "base_analise": "local+decisoes|só_local|só_conhecimento_geral",
  "advertencia": "aviso de limitações da análise se nível de confiança for baixo"
}`;

  const txt = await ia([{role:'user', content: prompt}], null, 3000);
  const m = txt.replace(/```json|```/g,'').trim().match(/\{[\s\S]*\}/);
  try {
    const perfil = JSON.parse(m ? m[0] : txt);
    // Enriquece com dados locais
    perfil._processos_locais_encontrados = processosDoJuiz.length;
    perfil._gerado_em = new Date().toLocaleString('pt-BR');
    return perfil;
  } catch(e) {
    return {
      nome: nomeJuiz,
      tribunal,
      erro_parse: true,
      texto_bruto: txt.substring(0, 2000),
      _gerado_em: new Date().toLocaleString('pt-BR')
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PROGNÓSTICO REALISTA DE PROCESSO
// Usa IA para estimar chance de êxito, risco financeiro e recomendação
// com postura crítica (evitar otimismo injustificado).
// ════════════════════════════════════════════════════════════════════════════
async function _gerarPrognosticoRealista(processo) {
  const ands = (processo.andamentos||[]).slice(0,8).map(a=>`${a.data||''}: ${a.txt||''}`).join('\n') || 'Sem andamentos relevantes cadastrados.';
  const docs = (processo.provas||[]).slice(0,10).join('; ') || 'Sem provas/listas de documentos cadastradas.';
  const frentes = (processo.frentes||[]).slice(0,8).join('; ') || 'Sem teses/frentes estruturadas.';
  const valorBase = Number(processo.valor)||0;
  const prazoDias = processo.prazo ? (()=>{ try {
    const [d,m,a] = String(processo.prazo).split('/').map(Number);
    if(!d||!m||!a) return null;
    const dt = new Date(a,m-1,d); const hoje = new Date(); hoje.setHours(0,0,0,0);
    return Math.ceil((dt-hoje)/86400000);
  } catch(e){ return null; } })() : null;

  const prompt = `Você é um analista jurídico sênior, extremamente realista e crítico.
Sua missão é estimar prognóstico processual SEM viés otimista.

REGRAS:
- Se o caso estiver fraco, diga explicitamente que está fraco.
- Probabilidade de êxito deve refletir risco real (não marketing).
- Considere documentação, fase, tribunal, juiz, prazos e qualidade das teses.
- Responda SOMENTE JSON válido.

PROCESSO:
ID: ${processo.id}
Nome: ${processo.nome||''}
Área: ${processo.area||''}
Tribunal: ${processo.tribunal||''}
Status atual: ${processo.status||''}
Número CNJ: ${processo.numero||''}
Partes: ${processo.partes||''}
Juiz/Relator cadastrado: ${processo.juiz_relator||'não cadastrado'}
Descrição estratégica: ${(processo.descricao||'').substring(0,1200)}
Frentes/Teses: ${frentes}
Provas/Docs: ${docs}
Andamentos recentes:
${ands}
Valor da causa (se houver): ${valorBase}
Dias para prazo/prescrição informado no cadastro: ${prazoDias==null?'não informado':prazoDias}

Retorne EXATAMENTE:
{
  "probabilidade_exito": 0-100,
  "valor_estimado_ganho": number,
  "valor_risco_perda": number,
  "reducao_danos": number,
  "fatores_positivos": ["..."],
  "fatores_risco": ["..."],
  "recomendacao": "texto curto e objetivo",
  "fase_atual": "texto",
  "prescricao_dias": number,
  "jurisprudencia_favoravel": true/false,
  "jurisprudencia_percentual": number,
  "documentacao_status": "completa|parcial|faltando",
  "perfil_juiz": "texto curto",
  "argumentos_fortes": ["..."],
  "argumentos_fracos": ["..."]
}`;

  const txt = await ia([{role:'user', content: prompt}], null, 2400);
  const m = String(txt||'').replace(/```json|```/g,'').trim().match(/\{[\s\S]*\}/);
  let j = null;
  try { j = JSON.parse(m ? m[0] : txt); } catch(e) { console.warn('[Lex][bot] Erro silenciado:', (e && e.message) ? e.message : e); }

  if(!j || typeof j!=='object') {
    const heur = Math.max(8, Math.min(92,
      48
      + ((processo.provas||[]).length>=3 ? 12 : (processo.provas||[]).length?4:-10)
      + ((processo.andamentos||[]).length>=4 ? 8 : 0)
      - (processo.status==='URGENTE' ? 14 : 0)
      - (processo.status==='RECURSAL' ? 6 : 0)
      - (prazoDias!=null && prazoDias<90 ? 12 : 0)
    ));
    const vr = Math.max(1200, Math.round((valorBase||18000) * 0.08));
    const vg = Math.max(0, Math.round(valorBase||22000));
    return {
      probabilidade_exito: Math.round(heur),
      valor_estimado_ganho: vg,
      valor_risco_perda: vr,
      reducao_danos: Math.max(0, Math.round((valorBase||22000)*0.45)),
      fatores_positivos: (processo.provas||[]).length ? ['Há documentação/provas registradas.'] : [],
      fatores_risco: [
        (processo.status==='URGENTE'?'Prazo crítico pode prejudicar estratégia.':'Risco processual ordinário da demanda.'),
        'Estimativa fallback por indisponibilidade de saída estruturada da IA.'
      ],
      recomendacao: 'Reforçar prova documental e atacar o ponto fraco central antes do próximo ato processual.',
      fase_atual: processo.status==='RECURSAL' ? 'Recursal' : (processo.status==='EM_PREP' ? 'Preparação' : 'Conhecimento'),
      prescricao_dias: prazoDias==null ? 999 : prazoDias,
      jurisprudencia_favoravel: heur>=60,
      jurisprudencia_percentual: heur>=60 ? 62 : 38,
      documentacao_status: (processo.provas||[]).length>=3 ? 'completa' : ((processo.provas||[]).length ? 'parcial' : 'faltando'),
      perfil_juiz: processo.juiz_relator ? `Juiz cadastrado: ${processo.juiz_relator}` : 'Sem perfil de juiz cadastrado',
      argumentos_fortes: (processo.frentes||[]).slice(0,3),
      argumentos_fracos: ['Necessidade de consolidar prova e jurisprudência específica do tribunal']
    };
  }

  const norm = {
    probabilidade_exito: Math.max(0, Math.min(100, Number(j.probabilidade_exito)||0)),
    valor_estimado_ganho: Math.max(0, Number(j.valor_estimado_ganho)||0),
    valor_risco_perda: Math.max(0, Number(j.valor_risco_perda)||0),
    reducao_danos: Math.max(0, Number(j.reducao_danos)||0),
    fatores_positivos: Array.isArray(j.fatores_positivos)?j.fatores_positivos:[],
    fatores_risco: Array.isArray(j.fatores_risco)?j.fatores_risco:[],
    recomendacao: String(j.recomendacao||'Revisar estratégia e robustecer provas.'),
    fase_atual: String(j.fase_atual||'Não informada'),
    prescricao_dias: Number.isFinite(Number(j.prescricao_dias)) ? Number(j.prescricao_dias) : (prazoDias==null?999:prazoDias),
    jurisprudencia_favoravel: !!j.jurisprudencia_favoravel,
    jurisprudencia_percentual: Math.max(0, Math.min(100, Number(j.jurisprudencia_percentual)||0)),
    documentacao_status: ['completa','parcial','faltando'].includes(String(j.documentacao_status||'')) ? String(j.documentacao_status) : ((processo.provas||[]).length>=3 ? 'completa' : ((processo.provas||[]).length ? 'parcial' : 'faltando')),
    perfil_juiz: String(j.perfil_juiz || (processo.juiz_relator ? `Juiz cadastrado: ${processo.juiz_relator}` : 'Sem perfil de juiz cadastrado')),
    argumentos_fortes: Array.isArray(j.argumentos_fortes)?j.argumentos_fortes:[],
    argumentos_fracos: Array.isArray(j.argumentos_fracos)?j.argumentos_fracos:[]
  };

  if(norm.valor_estimado_ganho===0 && valorBase>0) norm.valor_estimado_ganho = Math.round(valorBase * (norm.probabilidade_exito/100));
  if(norm.valor_risco_perda===0) norm.valor_risco_perda = Math.max(1200, Math.round((valorBase||22000)*0.08));
  if(norm.reducao_danos===0) norm.reducao_danos = Math.max(0, Math.round((valorBase||22000)*0.4));
  return norm;
}

// ════════════════════════════════════════════════════════════════════════════
// CONTROLE DE TEMPO DE USO — funções de backend
// Tabela Supabase 'tempo_uso':
//   perfil TEXT, data DATE, hora_inicio TIMESTAMPTZ,
//   hora_fim TIMESTAMPTZ, minutos_ativos INTEGER
//
// Lógica de sessão:
//   - login → cria registro com hora_inicio, hora_fim=null, minutos_ativos=0
//   - heartbeat (a cada 60s) → atualiza hora_fim + recalcula minutos_ativos
//   - logout → atualiza hora_fim + recalcula minutos_ativos, fecha sessão
// ════════════════════════════════════════════════════════════════════════════

// Cache em memória das sessões abertas: Map<perfil, {id, hora_inicio, data}>
const _sessoesAbertas = new Map();

// Formata data como YYYY-MM-DD no fuso Brasil
function _dataHojeBrasilia() {
  const h = horaBrasilia();
  return h.getFullYear()+'-'+String(h.getMonth()+1).padStart(2,'0')+'-'+String(h.getDate()).padStart(2,'0');
}

// POST /api/tempo/registrar → chama esta função
async function _registrarTempoUso(perfil, acao, tsMs) {
  const agora = new Date(tsMs || Date.now());
  const agoraIso = agora.toISOString();
  const dataHoje = _dataHojeBrasilia();

  if(acao === 'login') {
    // Fecha sessão anterior aberta (caso o usuário não tenha feito logout)
    if(_sessoesAbertas.has(perfil)) {
      const ant = _sessoesAbertas.get(perfil);
      const mins = _calcTempoMin(new Date(ant.hora_inicio).getTime(), tsMs || Date.now(), ant.ultimo_heartbeat_ms || (tsMs || Date.now()), 10);
      try {
        await sbReq('PATCH', 'tempo_uso', {
          hora_fim: agoraIso,
          minutos_ativos: Math.max(0, mins)
        }, { id: 'eq.'+ant.id }, null);
      } catch(e) { console.warn('[tempo] falha ao fechar sessão anterior:', e.message); }
      _sessoesAbertas.delete(perfil);
    }
    // Cria novo registro de sessão
    const novoId = CRYPTO.randomUUID ? CRYPTO.randomUUID() :
      CRYPTO.randomBytes(16).toString('hex');
    try {
      await sbReq('POST', 'tempo_uso', {
        id: novoId,
        perfil,
        data: dataHoje,
        hora_inicio: agoraIso,
        hora_fim: null,
        minutos_ativos: 0
      }, null, null);
      _sessoesAbertas.set(perfil, { id: novoId, hora_inicio: agoraIso, data: dataHoje, ultimo_heartbeat_ms: tsMs || Date.now() });
      console.log('[tempo] login:', perfil, 'sessão:', novoId);
    } catch(e) {
      console.warn('[tempo] falha ao criar sessão:', e.message);
    }
    return { sessao_iniciada: agoraIso };
  }

  if(acao === 'heartbeat' || acao === 'logout') {
    let sessao = _sessoesAbertas.get(perfil);
    // Se não há sessão em memória, busca a última aberta no Supabase
    if(!sessao) {
      try {
        const rows = await sbReq('GET', 'tempo_uso', null,
          { perfil: 'eq.'+perfil, hora_fim: 'is.null', order: 'hora_inicio.desc', limit: '1' }, null);
        if(rows && rows[0]) {
          sessao = { id: rows[0].id, hora_inicio: rows[0].hora_inicio, data: rows[0].data, ultimo_heartbeat_ms: Date.now() };
          _sessoesAbertas.set(perfil, sessao);
        }
      } catch(e) { console.warn('[tempo] falha ao buscar sessão aberta:', e.message); }
    }
    if(!sessao) {
      // Nenhuma sessão aberta — pode ser heartbeat após reinício do server; cria uma
      if(acao === 'heartbeat') {
        return await _registrarTempoUso(perfil, 'login', tsMs);
      }
      return { aviso: 'Nenhuma sessão aberta encontrada' };
    }
    const mins = Math.round((agora - new Date(sessao.hora_inicio)) / 60000);
    const patch = { hora_fim: agoraIso, minutos_ativos: Math.max(0, mins) };
    try {
      await sbReq('PATCH', 'tempo_uso', patch, { id: 'eq.'+sessao.id }, null);
    } catch(e) { console.warn('[tempo] falha ao atualizar sessão:', e.message); }
    if(acao === 'logout') {
      _sessoesAbertas.delete(perfil);
      console.log('[tempo] logout:', perfil, mins+'min');
    }
    return { minutos_ativos: mins, hora_fim: agoraIso };
  }

  return { aviso: 'ação não reconhecida: '+acao };
}

// GET /api/tempo/resumo → retorna totais hoje / semana / mês
async function _resumoTempoUso(perfil) {
  const hj = horaBrasilia();
  const dataHoje = _dataHojeBrasilia();
  // Início da semana (segunda-feira)
  const diaSemana = hj.getDay() === 0 ? 6 : hj.getDay() - 1; // 0=seg
  const inicioSemana = new Date(hj);
  inicioSemana.setDate(hj.getDate() - diaSemana);
  const dataSemana = inicioSemana.getFullYear()+'-'+
    String(inicioSemana.getMonth()+1).padStart(2,'0')+'-'+
    String(inicioSemana.getDate()).padStart(2,'0');
  // Início do mês
  const dataInicioMes = hj.getFullYear()+'-'+String(hj.getMonth()+1).padStart(2,'0')+'-01';

  async function somarMinutos(dataInicio, dataFim) {
    try {
      const rows = await sbReq('GET', 'tempo_uso', null, {
        perfil: 'eq.'+perfil,
        data: 'gte.'+dataInicio,
        data2: dataFim ? 'lte.'+dataFim : undefined,
        select: 'minutos_ativos'
      }, null);
      if(!rows || !rows.length) return 0;
      return rows.reduce((acc, r) => acc + (r.minutos_ativos||0), 0);
    } catch(e) { return 0; }
  }

  const [minsHoje, minsSemana, minsMes] = await Promise.all([
    somarMinutos(dataHoje, dataHoje),
    somarMinutos(dataSemana, dataHoje),
    somarMinutos(dataInicioMes, dataHoje)
  ]);

  // Verifica se há sessão ativa agora
  const sessaoAtiva = _sessoesAbertas.has(perfil);
  const sessaoInfo = sessaoAtiva ? _sessoesAbertas.get(perfil) : null;
  const minsAtivoAgora = sessaoInfo
    ? Math.round((Date.now() - new Date(sessaoInfo.hora_inicio)) / 60000)
    : 0;

  return {
    perfil,
    gerado_em: new Date().toLocaleString('pt-BR'),
    sessao_ativa: sessaoAtiva,
    minutos_ativos_agora: minsAtivoAgora,
    hoje: {
      data: dataHoje,
      minutos: minsHoje + (sessaoAtiva ? minsAtivoAgora : 0),
      horas_formatado: _formatarHorasMinutos(minsHoje + (sessaoAtiva ? minsAtivoAgora : 0))
    },
    semana: {
      inicio: dataSemana,
      minutos: minsSemana,
      horas_formatado: _formatarHorasMinutos(minsSemana)
    },
    mes: {
      inicio: dataInicioMes,
      minutos: minsMes,
      horas_formatado: _formatarHorasMinutos(minsMes)
    }
  };
}

// GET /api/tempo/historico → retorna registros dia a dia
async function _historicoTempoUso(perfil, dias) {
  const hj = horaBrasilia();
  const dataFim = _dataHojeBrasilia();
  const dataInicio = new Date(hj);
  dataInicio.setDate(hj.getDate() - (dias - 1));
  const dataInicioStr = dataInicio.getFullYear()+'-'+
    String(dataInicio.getMonth()+1).padStart(2,'0')+'-'+
    String(dataInicio.getDate()).padStart(2,'0');

  let rows = [];
  try {
    rows = await sbReq('GET', 'tempo_uso', null, {
      perfil: 'eq.'+perfil,
      data: 'gte.'+dataInicioStr,
      order: 'hora_inicio.desc'
    }, null) || [];
  } catch(e) { console.warn('[tempo] falha ao buscar histórico:', e.message); }

  // Agrupa por data para o resumo diário
  const porDia = {};
  for(const r of rows) {
    const d = r.data;
    if(!porDia[d]) porDia[d] = { data: d, minutos_total: 0, sessoes: 0 };
    porDia[d].minutos_total += (r.minutos_ativos||0);
    porDia[d].sessoes += 1;
  }
  const resumo_diario = Object.values(porDia)
    .sort((a,b) => b.data.localeCompare(a.data))
    .map(d => ({ ...d, horas_formatado: _formatarHorasMinutos(d.minutos_total) }));

  return {
    perfil,
    periodo: { inicio: dataInicioStr, fim: dataFim, dias },
    total_registros: rows.length,
    resumo_diario,
    registros_detalhados: rows.map(r => ({
      id: r.id,
      data: r.data,
      hora_inicio: r.hora_inicio,
      hora_fim: r.hora_fim,
      minutos_ativos: r.minutos_ativos,
      duracao_formatada: _formatarHorasMinutos(r.minutos_ativos||0),
      sessao_aberta: !r.hora_fim
    })),
    gerado_em: new Date().toLocaleString('pt-BR')
  };
}

// Formata minutos como "2h 35min" ou "45min"
function _formatarHorasMinutos(mins) {
  if(!mins || mins <= 0) return '0min';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if(h === 0) return m+'min';
  if(m === 0) return h+'h';
  return h+'h '+m+'min';
}

async function bootInicio() {
  try {
    const cache = await sbGet('processos_cache', {id:'lex_juridico'});
    if(cache && cache[0] && cache[0].dados) {
      // FIX-08: Supabase retorna JSONB como objeto JS; JSON.parse só se for string
      const dadosRaw = cache[0].dados;
      processos = typeof dadosRaw === 'string' ? JSON.parse(dadosRaw) : dadosRaw;
      processosVersao = cache[0].versao || Date.now();
      processosUltimoAparelho = cache[0].ultimo_aparelho || 'cache';
      console.log('Boot: '+processos.length+' processos carregados (versão '+processosVersao+')');
    }
  } catch(e) { console.log('Cache vazio ou inacessível.'); }

  const urg = getPrazos(3).filter(a=>a.dias<=3);
  if(urg.length) {
    const avisos = urg.map(a=>(a.dias<0?'🔴 VENCIDO: ':a.dias===0?'🚨 HOJE: ':'⚠️ '+a.dias+'d: ')+a.nome).join('\n');
    await envTelegram('Sistema ativo. '+processos.length+' processos.\n\n'+avisos);
  }
  poll();
}
bootInicio();

// ════════════════════════════════════════════════════════════════════════════
// EXPORT pra testes
// ════════════════════════════════════════════════════════════════════════════
if(require.main !== module) {
  module.exports = {
    _normalizarCasoId,
    calcDias,
    formatPrazos,
    gerarToken,
    validarToken,
    _contarPaginas,
    _dividirPDFEmChunks,
    _consolidarAnalises,
    _bufferDoChunk,
    _liberarChunk,
    _tokensUsadosNaJanela,
    _registrarUsoTokens,
    _limparHistoricoAntigo,
    _esperarSlotAnthropic,
    _ehErroRateLimit,
    _rateLimitHistorico,
    _agenteRoteador,
    _calcularScore,
    _scorePartes,
    _scoreVara,
    _scoreTipo,
    _scoreArea,
    _scoreValor,
    _scoreJuiz,
    _scoreInstancia,
    _cadastrarProcessoNovo,
    _aplicarAtualizacaoNoProcesso,
    _normTexto,
    _palavrasRelevantes,
    _calc,
    _fmtBRL,
    _sysAssessorSenior,
    _validarCPF,
    _validarCEP,
    _validarTelefone,
    _validarEmail,
    _validarDataBR,
    SECRETARIO_WHATSAPP_CONFIG,
    _verificarIdentidadeCliente,
    _conversarWhatsAppCliente,
    _escalarParaAdvogado,
    _filtrarRespostaSensivel,
    _detectarTipoCaso,
    _faltantesPessoais,
    _faltantesProbatorios,
    _atualizarStatusPerfil,
    _perfilClienteNovo,
    _mesclarDadosExtraidos,
    EXIGENCIAS_POR_CASO,
    _diasSemAtualizacao,
    _processosParaCobrar,
    _montarMensagemCobrador,
    COBRADOR_LIMIARES_DIAS,
    Lex,
    AgenteBase,
    AgenteRoteador,
    AgenteCadastrador,
    AgenteCobrador,
    AgenteAssessor,
    AgentePericial,
    AgentePJe,
    PDF_PGS_POR_CHUNK,
    PDF_MAX_PGS_DIRETO,
    PDF_STREAM_THRESHOLD_MB,
    RATE_LIMIT_TOKENS_POR_MIN,
    CHUNK_TOKENS_ESTIMADOS,
    PAUSA_MIN_ENTRE_CHUNKS_MS,
    BACKOFF_BASE_MS,
    _sseClientes,
    _sseNotificar,
    _motorSacardasJuridicas,
    _analisarPerfilJuiz
    ,_transcreverAudioWhisper
    ,_executarFollowupClientesPendentes
    ,_gerarBriefingAdvogado
    ,_monitorarCapacidadeDB
  };
}

// ════════════════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN — salva dados antes de encerrar (FIX-13)
// Evita perda de processos em memória ao reiniciar no Render/PM2
// ════════════════════════════════════════════════════════════════════════════
async function _gracefulShutdown(signal) {
  console.log('[Lex] '+signal+' recebido. Salvando dados...');
  const t = setTimeout(()=>{ console.error('[Lex] Timeout no shutdown.'); process.exit(1); }, 10000);
  try { await _persistirProcessosCache(); console.log('[Lex] Processos salvos.'); }
  catch(e) { console.warn('[Lex] Falha ao salvar processos:', e.message); }
  clearTimeout(t);
  console.log('[Lex] Shutdown completo.');
  process.exit(0);
}

function _toIsoDataBr(dataBr) {
  if(!dataBr) return '';
  const s = String(dataBr).trim();
  // Formato BR: dd/mm/yyyy
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if(m) return `${m[3]}-${m[2]}-${m[1]}`;
  // Formato ISO: yyyy-mm-dd (já está correto)
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if(iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Formato ISO com T: 2026-04-22T20:00:00Z
  const isoT = s.match(/(\d{4})-(\d{2})-(\d{2})T/);
  if(isoT) return `${isoT[1]}-${isoT[2]}-${isoT[3]}`;
  return '';
}

function _coletarEventosCalendario() {
  const eventos = [];
  for(const p of processos) {
    if(p.prazo) {
      eventos.push({
        tipo: 'prazo',
        data: _toIsoDataBr(p.prazo),
        titulo: p.nome || p.titulo,
        descricao: 'Prazo processual',
        processo_id: p.id
      });
    }
    if(p.prazoReal) {
      eventos.push({
        tipo: 'prazo_real',
        data: _toIsoDataBr(p.prazoReal),
        titulo: p.nome || p.titulo,
        descricao: 'Prazo real',
        processo_id: p.id
      });
    }
    if(p.proxacao) {
      eventos.push({
        tipo: 'tarefa',
        data: _toIsoDataBr(p.prazo) || new Date().toISOString().slice(0,10),
        titulo: p.nome || p.titulo,
        descricao: String(p.proxacao),
        processo_id: p.id
      });
    }
    // Coletar prazos do array p.prazos (integração calendário ↔ prazos do processo)
    const prazosArr = Array.isArray(p.prazos) ? p.prazos : [];
    for(const pz of prazosArr) {
      if(!pz || !pz.data) continue;
      eventos.push({
        tipo: pz.tipo || 'prazo',
        data: _toIsoDataBr(pz.data),
        titulo: (p.nome || p.titulo) + ' — ' + (pz.descricao || 'Prazo'),
        descricao: pz.descricao || 'Prazo do processo',
        status_prazo: pz.status || 'pendente',
        processo_id: p.id,
        prazo_id: pz.id || null
      });
    }
    const ands = Array.isArray(p.andamentos) ? p.andamentos : [];
    for(const a of ands.slice(0,20)) {
      const txt = String(a?.txt||a?.descricao||'');
      const low = txt.toLowerCase();
      if(low.includes('lembrete') || low.includes('audi') || low.includes('sessão') || low.includes('sessao') || low.includes('pericia') || low.includes('perícia')) {
        eventos.push({
          tipo: 'lembrete',
          data: _toIsoDataBr(a?.data) || new Date().toISOString().slice(0,10),
          titulo: p.nome || p.titulo,
          descricao: txt.substring(0,220),
          processo_id: p.id
        });
      }
    }
  }
  return eventos
    .filter(e=>e.data)
    .sort((a,b)=>String(a.data).localeCompare(String(b.data)));
}

// ════════════════════════════════════════════════════════════════════════════
// ANALISE ESTRATEGICA DE DOCUMENTOS PROCESSUAIS (ATE 5000 FOLHAS)
// Endpoint: POST /api/analisar-documento-estrategico
// ════════════════════════════════════════════════════════════════════════════

async function _processarAnaliseEstrategicaAsync(processoId,proc,dados,perfil){
  try{
    const buffer=Buffer.from(dados.documento_base64,'base64');
    const tipoDoc=dados.tipo_documento||'decisao';
    const sysPrompt=`Voce e assessor juridico senior especializado em analise estrategica. Analise o documento e encontre VULNERABILIDADES, FALHAS, PORTAS DE ENTRADA.

ESTRUTURA DA ANALISE:
1. RESUMO EXECUTIVO (2-3 paragrafos)
2. ANALISE ESTRATEGICA DETALHADA:
   a) PONTOS FORTES DA POSICAO ADVERSA - Argumentos solidos, fundamentacao correta
   b) VULNERABILIDADES E FALHAS - Erros de fundamentacao, contradicoes, omissoes, interpretacao errada
   c) PORTAS DE ENTRADA PARA CONTRA-ATAQUE - Argumentos, precedentes, nulidades a arguir
   d) ANALISE DO JUIZ/TRIBUNAL - Onde acerta, onde erra, tendencia, risco de reforma
3. ESTRATEGIA RECOMENDADA - Proximos passos, pecas, prazos criticos
4. FUNDAMENTACAO JURIDICA - Artigos, sumulas, jurisprudencia STJ/STF aplicavel

REGRAS: Seja tecnico, preciso, cirurgico. Nao invente jurisprudencia. Identifique contradicoes. Aponte vulnerabilidades a reforma. Sugira sacadas estrategicas nao obvias.`;

    let analiseCompleta='';
    const isPdf=dados.nome?.toLowerCase().endsWith('.pdf')||dados.mimetype==='application/pdf';
    const pagEst=Math.max(1,Math.round(buffer.length/(1024*1024)*7));
    
    if(pagEst<=PDF_MAX_PGS_DIRETO){
      const texto=await extrairTextoPDF(buffer,isPdf);
      analiseCompleta=await ia([{role:'user',content:`ANALISE ESTRATEGICA\n\nTipo: ${tipoDoc}\nProcesso: ${proc.numero||proc.titulo}\nPartes: ${proc.partes||proc.cliente}\n\nTEXTO DO DOCUMENTO:\n${texto.substring(0,150000)}`}],sysPrompt,4096);
    }else{
      const chunks=await splitPDFEmChunks(buffer,{pgsPorChunk:PDF_PGS_POR_CHUNK,maxDireto:PDF_MAX_PGS_DIRETO});
      const analisesParciais=[];
      for(let i=0;i<chunks.length;i++){
        const textoChunk=await extrairTextoPDF(chunks[i],isPdf);
        const analiseChunk=await ia([{role:'user',content:`ANALISE ESTRATEGICA - PARTE ${i+1}/${chunks.length}\n\nTipo: ${tipoDoc}\nProcesso: ${proc.numero||proc.titulo}\n\nTEXTO DESTA PARTE:\n${textoChunk.substring(0,80000)}`}],sysPrompt+'\n\nESTA E APENAS UMA PARTE DO DOCUMENTO. Foque em vulnerabilidades especificas desta secao.',3000);
        analisesParciais.push(analiseChunk);
        if(i<chunks.length-1)await new Promise(r=>setTimeout(r,PAUSA_MIN_ENTRE_CHUNKS_MS));
      }
      analiseCompleta=await ia([{role:'user',content:`SINTESE DAS ANALISES PARCIAIS:\n\n${analisesParciais.join('\n\n---\n\n')}\n\nCrie uma analise estrategica unificada, consolidando as vulnerabilidades encontradas em todas as partes.`}],sysPrompt,4096);
    }
    
    if(!proc.analises_estrategicas)proc.analises_estrategicas=[];
    proc.analises_estrategicas.push({
      id:Date.now(),
      data:new Date().toISOString(),
      tipo_documento:tipoDoc,
      analise:analiseCompleta,
      paginas_estimadas:pagEst,
      analisado_por:perfil
    });
    
    if(!Array.isArray(proc.andamentos))proc.andamentos=[];
    proc.andamentos.unshift({
      id:Date.now(),
      data:new Date().toISOString().slice(0,10),
      descricao:`Analise estrategica concluida: ${tipoDoc} (~${pagEst} pg)`,
      tipo:'analise_estrategica'
    });
    
    _auditarAcao(perfil,'analise_estrategica_concluida',{processo_id:processoId,tipo_doc:tipoDoc,paginas:pagEst});
    _sseNotificar('analise_estrategica_concluida',{
      ok:true,
      processo_id:processoId,
      tipo_documento:tipoDoc,
      paginas:pagEst,
      resumo:analiseCompleta.substring(0,500)+'...'
    });
    
    if(perfil==='admin'){
      await envTelegramAgendado(`[ANALISE ESTRATEGICA] ✅ CONCLUIDA\n\nProcesso: ${processoId}\nTipo: ${tipoDoc}\nPaginas: ~${pagEst}`);
    }
  }catch(e){
    console.error('[Analise Estrategica] Erro:',e);
    _sseNotificar('analise_estrategica_concluida',{erro:true,msg:e.message});
  }
}

process.on('SIGTERM', ()=> _gracefulShutdown('SIGTERM'));
process.on('SIGINT',  ()=> _gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err)=> { console.error('[Lex] ERRO NÃO CAPTURADO:', err); });
process.on('unhandledRejection', (r)=> { console.error('[Lex] PROMISE REJEITADA:', r); });
