'use strict';

// QUEM PEDIU PARA NÃO RECEBER MAIS MENSAGENS — a regra num lugar só.
//
// Adaptado de DeskcommCRM (lib/opt-out/deteccao.ts) — MIT, Copyright (c) 2026 Rafael Melgaço.
// Reescrito em CommonJS, só português, e ajustado ao escritório de advocacia.
//
// A regra: verbo de cessação + OBJETO DE COMUNICAÇÃO ("pare de me mandar", "não quero mais
// receber", "me tira da lista"), ou a palavra SOZINHA ("PARE", "STOP"). Nunca a palavra
// solta no meio da frase: "tem como parar a cobrança?", "posso sair mais cedo da audiência?"
// e "ele não me manda mais a pensão" NÃO são pedido de saída.
//
// Dois níveis:
// - INEQUÍVOCO (ehPedidoDeOptOut): o LEX para as mensagens AUTOMÁTICAS ao contato (lembretes,
//   avisos de espera) e avisa o advogado. Só o advogado desfaz (/liberar).
// - PROVÁVEL (ehOptOutProvavel): "me deixa em paz", "cancelar" sozinho — o LEX não responde
//   sozinho e passa ao advogado, que decide.
// Em escritório, "cancelar" e "remover" sozinhos podem ser sobre audiência, consulta ou
// documento; por isso aqui são PROVÁVEIS, não inequívocos.
// Responder ao advogado/cliente quando o próprio cliente volta a escrever continua normal: o
// bloqueio vale para mensagens que o LEX tomaria a iniciativa de mandar.

function normalizarTexto(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const PALAVRAS_INEQUIVOCAS = new Set(['stop', 'parar', 'pare', 'sair', 'descadastrar', 'descadastro', 'unsubscribe']);
const PALAVRAS_PROVAVEIS = new Set(['cancelar', 'remover', 'chega', 'basta']);

const VERBOS_DE_COMUNICACAO =
  'mandar|manda|mande|mandem|enviar|envia|envie|enviem|receber|recebe|escrever|escreve|' +
  'chamar|chama|ligar|liga|perturbar|perturba|encher|enche|insistir|insiste|' +
  'contate|contatem|chame|chamem|ligue|liguem|escreva|escrevam|perturbe|perturbem';

// Depois de "não me", forma que DESCREVE alguém ("ele não me escreve mais") e não pede nada.
const FORMAS_DESCRITIVAS_DEPOIS_DE_ME = 'recebe|escreve|perturba|enche|insiste';

// O que se pede para parar não é a mensagem: pedido, cobrança, pensão, processo, link…
const OBJETOS_NAO_COMUNICATIVOS =
  'pedido|pedidos|encomenda|encomendas|pacote|pacotes|entrega|entregas|' +
  'fatura|faturas|boleto|boletos|cobranca|cobrancas|produto|produtos|' +
  'pensao|pensoes|dinheiro|parcela|parcelas|documento|documentos|intimacao|intimacoes|' +
  'citacao|citacoes|processo|processos|link|links|audio|audios|video|videos|foto|fotos|' +
  'arquivo|arquivos|contrato|contratos|comprovante|comprovantes|recibo|recibos|' +
  'audiencia|audiencias|valor|valores|acordo|acordos';

const DETERMINANTES_DE_OBJETO =
  'o|a|os|as|meu|minha|meus|minhas|seu|sua|seus|suas|esse|essa|esses|essas|nesse|nessa';

const LISTAS_DE_ENVIO =
  'contatos?|transmissao|envios?|mensagens|disparos?|divulgacao|promocoes|ofertas|whatsapp|zap|voces|vcs';

// "me tira da lista de espera / de audiência" não é descadastro.
const FREIO_DE_LISTA_QUALIFICADA = `(?!\\s+de\\s+(?!(?:${LISTAS_DE_ENVIO})\\b))`;

const PRONOMES_DE_SUJEITO = 'ele|ela|eles|elas|aquele|aquela|aqueles|aquelas';
const DETERMINANTES_DE_SUJEITO =
  'o|a|os|as|meu|minha|meus|minhas|seu|sua|seus|suas|esse|essa|esses|essas|' +
  'nesse|nessa|do|da|dos|das|nosso|nossa|nossos|nossas|dele|dela|deles|delas';
const NAO_ABREM_SUJEITO =
  'de|da|do|das|dos|em|no|na|nos|nas|que|para|pra|pro|ate|desde|partir|apartir|' +
  'partindo|com|por|pelo|pela|ao|aos|e|mas|ja|quando|como|se|sem|entao|apos|logo|porque|' +
  'senhor|senhora|sr|sra|deus|amor|querido|querida|moco|moca|doutor|doutora|dr|dra';

// "meu ex não me manda mais…", "ele não me liga mais" — terceira pessoa contando um fato.
const SUJEITO_EXPLICITO_DE_TERCEIRA_PESSOA =
  '(?<=(?:^|[.!?,;:])\\s*(?:' +
  `(?:${PRONOMES_DE_SUJEITO})\\b\\s*(?:(?!(?:${NAO_ABREM_SUJEITO})\\b)[a-z]+\\s+){0,2}|` +
  `(?:${DETERMINANTES_DE_SUJEITO})\\b\\s*(?:(?!(?:${NAO_ABREM_SUJEITO})\\b)[a-z]+\\s+){1,2}` +
  ')nao\\s+me\\s+)';

// Pedido de troca de canal ("não me liga mais, só por WhatsApp") não é pedido de saída.
const SO_POR_OUTRO_CANAL = '(?![^.!?|]*\\b(?:so|somente|apenas)\\s+(?:por|pelo|pela|no|na|via)\\b)';
// O que vem depois do pedido não pode ser outro objeto ("…mais o processo", "…mais de senhora").
const SEM_OUTRO_OBJETO = `(?!\\s+de\\b)(?!\\s+(?:${DETERMINANTES_DE_OBJETO})?\\s*(?:${OBJETOS_NAO_COMUNICATIVOS})\\b)`;
// Fim do pedido: pontuação, fim do texto ou separador de mensagens agrupadas.
const FIM = '\\s*(?:[.!,;]|$)';
const OBJETOS_DE_COMUNICACAO =
  'mensagem|mensagens|msg|msgs|nada|isso|lembrete|lembretes|aviso|avisos|notificac\\w*|propaganda|propagandas|promoc\\w*|zap|whatsapp';

const FRASES_INEQUIVOCAS = [
  // "pare de me mandar mensagem" — ordem dirigida ao escritório, no início da frase ou depois
  // de "por favor/pode". Nunca "ele não para de me ligar" (relato de assédio de terceiro).
  new RegExp(
    `(?:^|[.!?,;:|]\\s*|\\bpor\\s+favor\\s+|\\bfavor\\s+|\\bpodem?\\s+|\\bvoces\\s+podem\\s+)` +
      `(?:pare|parem|para)\\s+de\\s+(?:me\\s+)?(?:${VERBOS_DE_COMUNICACAO})\\b${SEM_OUTRO_OBJETO}${SO_POR_OUTRO_CANAL}`, 'u'),
  new RegExp(`\\b(?:quero|queria|gostaria\\s+de|preciso)\\s+parar\\s+de\\s+receber\\b${SEM_OUTRO_OBJETO}`, 'u'),
  new RegExp(`\\bquero\\s+que\\s+(?:voces|vcs)\\s+parem\\s+de\\s+(?:me\\s+)?(?:${VERBOS_DE_COMUNICACAO})\\b${SEM_OUTRO_OBJETO}`, 'u'),
  // "não quero (mais) receber mensagens / nada" — o objeto tem de ser a comunicação, ou nada.
  new RegExp(`\\bnao\\s+(?:quero|desejo|gostaria)\\s+(?:de\\s+)?(?:mais\\s+)?receber\\s+(?:mais\\s+)?(?:(?:essas?|esses?|suas?|seus?)\\s+)?(?:${OBJETOS_DE_COMUNICACAO})\\b`, 'u'),
  new RegExp(`\\bnao\\s+(?:quero|desejo|gostaria)\\s+(?:de\\s+)?(?:mais\\s+)?receber(?:\\s+mais)?${FIM}`, 'u'),
  /\bnao\s+quero\s+mais\s+(?:mensagem|mensagens|nada\s+de\s+voces|contato(?!\s+com\b)(?=\s*(?:[.!,;|]|$)))/u,
  /\bnao\s+quero\s+mais\s+ser\s+(?:incomodad[oa]|perturbad[oa])\b/u,
  new RegExp(
    `\\bnao\\s+me\\s+(?!(?:${FORMAS_DESCRITIVAS_DEPOIS_DE_ME})\\b)` +
      `(?!(?=${SUJEITO_EXPLICITO_DE_TERCEIRA_PESSOA})(?:manda|chama|liga|envia)\\s+mais\\b)` +
      `(?:${VERBOS_DE_COMUNICACAO})\\s+mais\\b${SEM_OUTRO_OBJETO}${SO_POR_OUTRO_CANAL}`, 'u'),
  new RegExp(`(?:^|[.!?,;:|]\\s*)nao\\s+(?:me\\s+)?(?:mande|mandem|envie|enviem)\\s+mais(?:\\s+(?:${OBJETOS_DE_COMUNICACAO}))?${FIM}`, 'u'),
  new RegExp(
    '\\b(?:nao\\s+(?:entre|entrem)\\s+(?:mais\\s+)?|nao\\s+(?:volte|voltem)\\s+a\\s+entrar\\s+|' +
      '(?:^|[.!?,;:|]\\s*)(?:par|deix)(?:ar|a|e|em)\\s+de\\s+entrar\\s+)em\\s+contato\\b' +
      '(?!\\s+(?:com|pel[oa]|via)\\b|\\s+por\\s+(?!(?:aqui|est[ea]|ess[ea])\\b))', 'u'),
  new RegExp(
    '\\bme\\s+(?:tira|tire|tirem|tirar|remove|remova|removam|remover|retira|retire|retirar|' +
      'exclui|exclua|excluir|apaga|apague|apagar)\\s+(?:da|dessa|desta|de\\s+sua|da\\s+sua)\\s+lista\\b' +
      FREIO_DE_LISTA_QUALIFICADA, 'u'),
  new RegExp(`\\bsair\\s+d(?:a|essa|esta)\\s+lista\\b${FREIO_DE_LISTA_QUALIFICADA}`, 'u'),
  // "me descadastra" — nunca "me descadastrei do gov.br / do INSS / do Bolsa Família".
  /\bme\s+descadastr(?:a|e|em|ar|em|em)\b(?!\s+(?:do|da|dos|das|no|na|nos|nas|de|meu|minha)\b)/u
];

const FRASES_PROVAVEIS = [
  /\bme\s+deix[ae]m?\s+(?:em\s+paz|quieto|quieta)\b/u,
  /\bja\s+(?:disse|falei)\s+que\s+nao\s+(?:quero|tenho\s+interesse)\b/u,
  /\bnao\s+(?:me\s+)?interessa\s+mais\b/u,
  /(?:^|[.!?,;:|]\s*)par[ae]m?\s+com\s+isso\b/u,
  /(?:^|[.!?,;:|]\s*)(?:pode|podem)\s+parar\s*(?:[.!,;|]|$)/u,
  /(?:^|[.!?,;:|]\s*)(?:pare|parem|stop)\s+(?:por\s+favor|please)\s*(?:[.!,;|]|$)/u
];

function palavraIsolada(normalizado) {
  return normalizado.replace(/[^a-z]/g, '');
}

function nivelDeUmaMensagem(texto) {
  const normalizado = normalizarTexto(String(texto || '').trim());
  if (!normalizado) return null;
  const palavra = palavraIsolada(normalizado);
  if (PALAVRAS_INEQUIVOCAS.has(palavra) || FRASES_INEQUIVOCAS.some(re => re.test(normalizado))) return 'inequivoco';
  if (PALAVRAS_PROVAVEIS.has(palavra) || FRASES_PROVAVEIS.some(re => re.test(normalizado))) return 'provavel';
  return null;
}

// 'inequivoco' | 'provavel' | null. Mensagens agrupadas pela recepção ("PARE | obrigado")
// são conferidas uma a uma: a palavra sozinha numa delas conta.
function nivelDeSaida(texto) {
  const partes = String(texto || '').split(/\s\|\s/);
  const niveis = partes.map(nivelDeUmaMensagem);
  if (niveis.includes('inequivoco')) return 'inequivoco';
  if (niveis.includes('provavel')) return 'provavel';
  return null;
}

function ehPedidoDeOptOut(texto) { return nivelDeSaida(texto) === 'inequivoco'; }
function ehOptOutProvavel(texto) { return nivelDeSaida(texto) !== null; }

module.exports = {normalizarTexto, ehPedidoDeOptOut, ehOptOutProvavel, nivelDeSaida};
