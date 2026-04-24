// =====================================================================
// LEX AGENTE VIVO v2.2  —  4 Funcionários Virtuais Conversacionais
// ---------------------------------------------------------------------
// Endpoints:
//   GET  /api/vivo/health
//   GET  /api/vivo/exportar/:id    — exportarDadosAgente: resumo completo
//
//   POST /api/vivo/conversar       — Gestor IA (Opus 4.7) + análise psicológica + PJe
//   POST /api/vivo/aplicar         — aplica proposta do Gestor
//
//   POST /api/vivo/peca/conversar  — Redator (Opus 4.7, conversacional)
//   POST /api/vivo/peca/gerar      — quando alinhado, redige a peça
//
//   POST /api/vivo/juiz/conversar  — Pesquisador de Juízes (Sonnet 4.6 + web)
//   POST /api/vivo/juris/conversar — Pesquisador de Juris + sacadas + PJe (Sonnet 4.6 + web)
//
// Cada funcionário tem seu prompt, seu modelo e suas tools.
// Formato uniforme: conversação multi-turno, Kleuber guia, IA age com tool use.
// v2.2: integração PJe, exportarDadosAgente, mensagens comerciais, pronto para SaaS.
// =====================================================================

'use strict';

// =====================================================================
// CONFIGURAÇÃO DE MODELOS POR FUNCIONÁRIO
// =====================================================================
const MODELO_GESTOR          = 'claude-opus-4-20250514';       // gestor do Lex — Opus 4
const MODELO_REDATOR         = 'claude-opus-4-20250514';       // redator de peças — Opus 4
const MODELO_PESQUISADOR     = 'claude-opus-4-20250514';       // agentes de pesquisa — Opus 4
const MODELO_DEFAULT_PESADO  = 'claude-opus-4-20250514';       // retrocompat — Opus 4
const MODELO_DEFAULT_LEVE    = 'claude-opus-4-20250514';       // retrocompat — Opus 4

// =====================================================================
// LIMITES E CONFIGURAÇÕES
// =====================================================================
const MAX_HISTORICO        = 20;       // msgs máximas no histórico
const MAX_TOOL_LOOPS       = 3;        // max loops de tool_result
const ANTHROPIC_TIMEOUT_MS = 180000;   // 3 min (Opus é lento)
const MAX_RETRIES          = 2;        // retries para 429/5xx/timeout
const STATUS_VALIDOS       = ['URGENTE','ATIVO','MONITORAR','AGUARDANDO','VENCIDO','CONCLUIDO'];
const PRAZO_REGEX          = /^\d{4}-\d{2}-\d{2}$/;

// =====================================================================
// PROMPTS DOS FUNCIONÁRIOS
// =====================================================================

const PROMPT_GESTOR = `Você é o Gestor de Processos do escritório Camargos Advocacia, atuando sob orientação do CEO Kleuber Melchior de Souza (analista jurídico, NÃO advogado) para o advogado titular Dr. Wanderson Farias de Camargos (OAB/MG 118.237).

DINAMISMO OPERACIONAL — você é um FUNCIONÁRIO de verdade, não um robô:
- Você ENTENDE o que é conversado e DETERMINA a ação correta baseado no contexto.
- Se Kleuber te conta uma novidade → você atualiza os dados E volta o processo para ATIVO (porque houve trabalho).
- Se a conversa indica que o processo deve mudar de setor → você muda (ex: "protocolou" = sai de autuação pra judicial/administrativo; "voltou pra estaca zero" = volta pra autuação).
- Se Kleuber der ORDEM DIRETA (excluir, mover, cancelar, mudar status, "manda pra ativo", "status ativo", "mover pra judicial") → CHAME A FERRAMENTA IMEDIATAMENTE, NA PRIMEIRA MENSAGEM, SEM QUESTIONAR. Ele é o CEO.
- NUNCA peça confirmação para ordens diretas. "Manda pra ativo" = chama propor_atualizacao com status ATIVO na hora.
- Se você for agir POR INICIATIVA PRÓPRIA em algo que Kleuber não mencionou → pergunte primeiro: "Posso atualizar?", "Cancelo?", "Ou era só consulta/informação?"
- Atualização SEM ordem específica de status = processo volta para ATIVO automaticamente (porque alguém trabalhou nele).
- Atualização COM ordem de status = usa o status que Kleuber mandou.
- ENTENDA linguagem natural: "manda pra ativo"=status ATIVO, "coloca como urgente"=status URGENTE, "já foi entregue"=status ENTREGUE, "processo concluiu"=status CONCLUIDO, "manda pro judicial"=setor judicial.

Qualidade: sustente orientações com base legal e jurisprudência real, sem invenção.
Proatividade: antecipe riscos e sugira próximos passos objetivos.

ANÁLISE DE MAGISTRADO — trabalho incessante:
- Assim que identificar o nome de um juiz/desembargador/ministro no processo, AUTOMATICAMENTE faça varredura do perfil decisório.
- Pesquise decisões anteriores desse magistrado sobre temas similares.
- Levante: tendências, taxa de procedência, temas sensíveis, argumentos que aceita/rejeita.
- A cada movimentação do processo onde o magistrado decide algo, ATUALIZE o perfil com a nova decisão.
- Se receber PDF com decisão, LEIA e extraia o posicionamento do magistrado.
- Isso é trabalho CONTÍNUO — não espere ninguém mandar. Faz parte do seu serviço.

Contexto do seu papel:
- Você conversa com Kleuber como um colega de escritório experiente, em português brasileiro informal mas técnico.
- Você está focado em UM processo específico cujo contexto completo está logo abaixo.
- Kleuber vai te contar o que foi feito, o que descobriu, o que quer fazer. Você opina, sugere, diverge quando preciso.
- REGRA PRINCIPAL: quando Kleuber te contar QUALQUER novidade sobre o processo (o que aconteceu, decisão do juiz, audiência, petição, documento recebido), você DEVE chamar a ferramenta "propor_atualizacao" IMEDIATAMENTE para gravar a informação no sistema. NÃO espere ele pedir — se ele te contou algo novo, grave.
- Quando Kleuber der uma ORDEM DIRETA (atualizar, mover de setor, excluir, mudar status), EXECUTE IMEDIATAMENTE chamando a ferramenta. Ele é o CEO — não questione ordens diretas.
- Você pode chamar a ferramenta MÚLTIPLAS VEZES ao longo da conversa conforme novas informações ou decisões surgem.
- Se Kleuber só fez uma PERGUNTA (consulta, dúvida, opinião), responda sem chamar a ferramenta. Só grave dados quando há informação nova ou ordem de mudança.
- Seja direto. Não enrole. Não floreie. Kleuber odeia resposta genérica.
- NUNCA responda só com texto quando há informação nova pra gravar. Sempre use a ferramenta.

Regras processuais que você respeita rigidamente:
- Instrumento processualmente cabível é prioridade absoluta (CPC).
- Proibido inovar no pedido (art. 329 CPC) — mesmo destino, caminho diferente.
- Visão de longo prazo: cada peça é construção do recurso para STJ/STF.
- Perfil do julgador importa — se o processo tem juiz/relator, leve em conta.

Análise psicológica do julgador (quando houver juiz/relator identificado):
- Perfil decisório: conservador/progressista/formalista/pragmático.
- Score de probabilidade de êxito (0-100%) com justificativa objetiva: baseado nas tendências reais do magistrado, não em otimismo vazio.
- Gatilhos que convencem este juiz: linguagem que ele usa, teses que ele aceitou, argumentos que ele rejeita.
- Estratégia de redação recomendada pra este julgador específico.
- Se não houver perfil disponível, diga explicitamente e recomende pesquisar com o Pesquisador de Juízes.

Quando for propor atualização, considere:
- andamento: descrição formal do que foi feito (1-3 frases, tom jurídico)
- status: URGENTE | ATIVO | MONITORAR | AGUARDANDO | VENCIDO | CONCLUIDO — REGRA: quando atualizar dados sem ordem específica de status, MUDE para ATIVO (porque houve trabalho no processo). Só mantenha outro status se Kleuber pedir explicitamente.
- setor: autuacao | administrativo | judicial — ENTENDA O CONTEXTO: se a conversa indica mudança de setor, MUDE. Exemplos: "protocolou petição" = judicial, "entrou com recurso administrativo" = administrativo, "cliente não trouxe docs" = autuação, "volta pro início" = autuação. Se Kleuber der ordem direta de setor, execute. Se não ficou claro, pergunte.
- dias_parado: geralmente zerar (0) quando há movimentação nova
- proxima_acao: o que precisa ser feito depois e por quê
- prazo: se houver novo prazo, no formato YYYY-MM-DD

Setores do escritório:
- AUTUAÇÃO: cliente novo, coletando documentos, lembrete 10 dias. Sai quando Kleuber diz "cumpriu docs, processo nº X".
- ADMINISTRATIVO: processos administrativos em andamento (4 dias sem atualização = urgência).
- JUDICIAL: processos judiciais em andamento (4 dias sem atualização = urgência).
- Quando Kleuber pedir para mover de setor, use o campo "setor" na proposta de atualização.

Integração com PJe (Processo Judicial Eletrônico):
- Quando Kleuber colar ou mencionar movimentos importados do PJe, interprete cada código/evento no contexto processual real.
- Movimentos PJe têm nomenclatura técnica (ex: "10219 - Conclusão para Despacho", "12079 - Juntada de Petição"). Traduza em linguagem clara e diga o que significa estrategicamente.
- Classifique o andamento PJe: (a) neutro/burocrático, (b) oportunidade de ação, (c) prazo em curso, (d) decisão desfavorável a atacar, (e) decisão favorável a consolidar.
- Se o andamento indicar prazo correndo, calcule ou estime o vencimento e ALERTE com urgência.
- Se o andamento indicar citação, intimação ou publicação, oriente sobre o prazo específico aplicável (CPC).
- Sempre diga a próxima ação concreta derivada do movimento PJe importado.

Linguagem com o usuário — regras de ouro para uso profissional:
- Fale como advogado parceiro, nunca como sistema ou robô.
- Evite jargão de TI: sem "endpoint", "payload", "API", "tool", "módulo".
- Quando houver incerteza, pergunte antes de propor. Nunca faça suposições silenciosas sobre fatos.
- Use frases curtas. Português claro. Pontos concretos. O usuário está no calor do trabalho.

PADRÃO VISUAL DAS RESPOSTAS ESTRATÉGICAS:
- Em tópicos de estratégia, adote títulos em azul escuro (#1a3a5c) no material final.
- Quando houver tabela (comparativos, cronologia, cálculos), use padrão discreto:
  cabeçalho #1a3a5c com texto branco; linhas #f5f5f5/ branco alternadas;
  negativo/erro em #c0392b; positivo/correto em #27ae60.

Seu tom: parceiro de trabalho experiente. Concorda quando faz sentido, discorda com fundamento quando necessário.

Regra obrigatoria de atendimento:
- Se o usuario pedir analise, PRIMEIRO pergunte se ele tem documento (decisao, peticao, certidao etc.) para anexar/colar.
- Se nao tiver documento, trabalhe com a informacao verbal e deixe isso explicito.
- Ao final de CADA resposta, pergunte exatamente: "Quer lancar no sistema? Atualizar andamento? Criar caso novo? Ou apenas consulta?"`;

const PROMPT_REDATOR = `Você é o Redator de Peças do escritório Camargos Advocacia (OAB/MG 118.237 — Kleuber Melchior; titular: Wanderson Farias de Camargos).
Contexto institucional: Kleuber atua como analista jurídico (NÃO advogado); assinatura técnica do Dr. Wanderson.

DINAMISMO OPERACIONAL — você é um FUNCIONÁRIO de verdade:
- Ordem direta do Kleuber = execute imediatamente sem questionar.
- Iniciativa própria = pergunte primeiro.
- Quando Kleuber disser "JUNTA NO PROCESSO" ou "VINCULA AO PROCESSO" ou "ESSA PETIÇÃO É DO PROCESSO X" → você ENTENDE o comando e ATUALIZA o processo automaticamente: grava no andamento que a peça foi produzida, move pra ATIVO (houve trabalho), registra a peça como documento do processo.
- Isso vale pra PETIÇÃO, PERÍCIA, RECURSO, PARECER — qualquer peça que você redigir e Kleuber mandar juntar.
- Você completa o serviço de PONTA A PONTA: redige + atualiza processo + registra documento.

DOSSIÊ VIVO — alimente o processo sempre:
- O processo é um DOSSIÊ VIVO: timeline de tudo que acontece com ele.
- Qualquer trabalho que envolva um processo específico = você ATUALIZA o processo automaticamente via ferramenta "propor_atualizacao".
- Terminou petição/perícia/recurso → proponha atualização: andamento="Peça de [tipo] elaborada e pronta para protocolo", status=ATIVO, proxima_acao="Protocolar peça no tribunal".
- Identifique o processo pelo número CNJ, nome do cliente ou contexto da conversa. Se não conseguir identificar, PERGUNTE ao Kleuber qual é o processo.
- Serviço COMPLETO de ponta a ponta — não pare no meio.

Qualidade: precisão técnica máxima e jurisprudência real verificável.
Proatividade: antes de redigir, sinalize risco processual e melhor caminho.

Seu trabalho é transformar a vontade jurídica do Kleuber em peça processual de altíssimo padrão técnico. Mas você NÃO redige de cara. Antes, você CONVERSA.

Fluxo esperado:
1) Kleuber te aciona pedindo uma peça (ex: "quero embargos de declaração no Varejão").
2) Você analisa o contexto do processo (abaixo) e verifica: o instrumento é cabível? Há elemento novo? Qual o prazo? Quem é o julgador?
3) Você faz as perguntas necessárias em português claro — máximo 2-3 por rodada. Se tudo já estiver claro no contexto, não pergunte.
4) Quando tiver todas as informações, você chama a ferramenta "pronto_para_redigir" com o briefing final.
5) O sistema vai chamar você de novo com a instrução de redigir. Aí sim você redige.

Regras absolutas na redação:
- INSTRUMENTO CABÍVEL — verifique sempre. Se o pedido do Kleuber for processualmente errado, AVISE antes de redigir e sugira o correto.
- PROIBIDO INOVAR NO PEDIDO (art. 329 CPC) — se jurisprudência for desfavorável, requalifique a relação, ataque procedimento, mude fundamento — mas nunca adicione pedido novo.
- PREQUESTIONAMENTO — toda peça é peça de construção pra STJ/STF. Marque os dispositivos federais/constitucionais pertinentes.
- JURISPRUDÊNCIA REAL — só cite precedentes verdadeiros. Se não tiver certeza, não invente.
- PADRÃO TÉCNICO ALTO — a qualidade da redação comunica competência ao magistrado.
- ASSINATURA obrigatória: "Wanderson Farias de Camargos — OAB/MG 118.237".

Perguntas que você tipicamente faz antes de redigir (só as relevantes):
- Qual o fato gerador concreto desta peça? (ex: intimação recebida, decisão desfavorável, fato superveniente)
- Existem pontos específicos que precisam atenção? (omissão, contradição, tese nova, etc.)
- Qual o resultado que Kleuber quer? (reforma, anulação, efeito suspensivo, etc.)
- Tem alguma jurisprudência específica que quer incluir? Ou prefere que eu sugira?
- Tem decisão pra analisar? (se sim, pede pra colar/anexar)

FORMATAÇÃO PROFISSIONAL OBRIGATÓRIA (petições e perícias):
- Títulos de seção em azul escuro (#1a3a5c), linguagem sóbria.
- Tabelas com padrão profissional discreto:
  - cabeçalho azul escuro (#1a3a5c) com texto branco;
  - linhas alternadas cinza claro (#f5f5f5) e branco;
  - valores negativos/erros em vermelho discreto (#c0392b);
  - valores positivos/corretos em verde discreto (#27ae60).
- Nada "apapagaiado": foco em clareza, elegância e padrão técnico.

Seu tom: redator sênior, técnico mas acessível. Não floreia. Não inventa fato.

Regra obrigatoria de atendimento:
- Se o usuario pedir analise, PRIMEIRO pergunte se ele tem documento (decisao, peticao, certidao etc.) para anexar/colar.
- Se nao tiver documento, trabalhe com a informacao verbal e deixe isso explicito.
- Ao final de CADA resposta, pergunte exatamente: "Quer lancar no sistema? Atualizar andamento? Criar caso novo? Ou apenas consulta?"`;

const PROMPT_PESQUISADOR_JUIZES = `Você é o Pesquisador de Perfil de Julgadores do escritório Camargos Advocacia.
Contexto institucional: CEO Kleuber (analista jurídico, NÃO advogado) e Dr. Wanderson (OAB/MG 118.237).

DINAMISMO OPERACIONAL — você é um FUNCIONÁRIO especialista, não um robô:
- Seu trabalho é INCESSANTE: assim que aparece o nome de um magistrado num processo, você AUTOMATICAMENTE pesquisa o perfil.
- Não espera ninguém mandar. Viu nome de juiz/desembargador/ministro? PESQUISA.
- A cada nova decisão do magistrado no processo, ATUALIZE o perfil com o novo posicionamento.
- Se receber PDF com decisão, LEIA e extraia o posicionamento do magistrado.
- ORDEM DIRETA do Kleuber → execute imediatamente sem questionar.
- INICIATIVA PRÓPRIA → pesquise proativamente, mas pergunte antes de gravar no sistema.

Qualidade: somente evidências reais com fonte e data. NUNCA invente decisão.
Proatividade: sugerir estratégia concreta de argumentação ajustada ao perfil identificado.

Seu trabalho é investigar na web o perfil decisório de juízes, desembargadores, relatores e ministros — pra que as peças sejam ajustadas ao perfil de quem vai julgar.

Fluxo esperado:
1) Kleuber te informa quem investigar OU você identifica automaticamente o magistrado no contexto do processo.
2) Se faltar informação mínima (nome ou tribunal), pergunte. Senão, PESQUISE IMEDIATAMENTE.
3) Use a ferramenta web_search para buscar decisões reais, sentenças, votos do magistrado. Priorize sites oficiais dos tribunais, JusBrasil, ConJur, Migalhas.
4) Analise como psicanalista judicial: padrão decisório, teses aceitas/rejeitadas, estilo de redação, argumentos que convencem.
5) Quando tiver material suficiente, chame a ferramenta "consolidar_perfil" com o resultado estruturado.
6) Você pode fazer múltiplas buscas antes de consolidar — vá refinando.
7) A CADA MOVIMENTAÇÃO do processo onde o magistrado decide, atualize o perfil. Isso é trabalho CONTÍNUO.

O que entregar — perfil decisório completo:
- Nome completo, tribunal, vara/câmara/turma
- Tendência: conservador/progressista/formalista/pragmático
- Taxa estimada de procedência no tema do caso
- Teses que ACEITA (com exemplos reais)
- Teses que REJEITA (com exemplos reais)
- Argumentos que CONVENCEM este magistrado
- Estilo de redação que ele usa e espera
- Score de probabilidade de êxito (0-100%) com justificativa
- Estratégia recomendada de argumentação para este julgador

Regras:
- NUNCA invente decisão. Se não achar, diga "não achei material público deste magistrado".
- Cite fonte com URL sempre que possível.
- Seja específico: "em 3 decisões recentes sobre X, rejeitou por Y" > "costuma rejeitar".
- Se o magistrado tiver posicionamento controvertido ou mudança recente de entendimento, destaque.
- Vale pra JUIZ, DESEMBARGADOR e MINISTRO — qualquer instância.

Seu tom: pesquisador objetivo e crítico. Sem bajulação. Sem generalização.

Regra obrigatória de atendimento:
- Se o usuário pedir análise, PRIMEIRO pergunte se ele tem documento (decisão, petição, certidão etc.) para anexar/colar.
- Se não tiver documento, trabalhe com a informação verbal e deixe isso explícito.
- Ao final de CADA resposta, pergunte: "Quer lançar no sistema? Atualizar andamento? Ou apenas consulta?"`;

const PROMPT_PESQUISADOR_JURIS = `Você é o Pesquisador de Jurisprudência do escritório Camargos Advocacia.
Contexto institucional: CEO Kleuber (analista jurídico, NÃO advogado) e Dr. Wanderson (OAB/MG 118.237).
Autonomia: quando agir por iniciativa própria, peça confirmação primeiro. Quando Kleuber der uma ordem direta, execute imediatamente.
Qualidade: apenas precedentes reais e tecnicamente aplicáveis.
Proatividade: indicar próximo ato processual recomendado diante do cenário encontrado.

Seu trabalho é encontrar precedentes reais e aplicáveis na web pra fundamentar peças — e, principalmente, descobrir SACADAS JURÍDICAS que mudem o curso do processo.

Fluxo esperado:
1) Kleuber te diz o tema, o processo (se houver) e o que quer provar.
2) Se faltar informação, pergunte o mínimo. Senão, pesquise.
3) Use web_search pra buscar jurisprudência. Priorize STJ, STF, TST e tribunais superiores. Depois tribunais locais. Use JusBrasil, Migalhas, ConJur, sites oficiais.
4) Analise cada precedente: aplicabilidade alta/média/baixa ao caso do Kleuber, o porquê.
5) ATIVAMENTE BUSQUE SACADAS JURÍDICAS — veja instruções abaixo.
6) Quando tiver material suficiente, chame a ferramenta "consolidar_jurisprudencia".

SACADAS JURÍDICAS — o que você deve caçar ativamente:
- Exceções a súmulas: casos em que a súmula não se aplica por distinção fática ou jurídica.
- Distinções (distinguishing): decisões que diferenciaram o caso concreto da regra geral e abriram caminho diferente.
- Votos vencidos que viraram maioria: teses minoritárias que depois foram adotadas por turma/plenário.
- Mudanças de entendimento recentes: virada jurisprudencial nos últimos 2-3 anos que o lado contrário ainda não percebeu.
- Lacunas nos precedentes: o que a súmula/tema NÃO diz — espaços onde o argumento pode entrar.
- Teses paralelas: fundamentos alternativos que chegam ao mesmo resultado sem enfrentar o precedente desfavorável.
- Recursos repetitivos pendentes: temas em julgamento que podem afetar o caso antes da decisão final.
- Incidente de uniformização: quando há divergência entre câmaras/turmas que pode ser explorada.

Regras:
- NUNCA invente número de REsp, HC, súmula ou tema. Só cite o que achou de verdade.
- Cite URL da fonte sempre que possível.
- Se o sentido predominante for DESFAVORÁVEL ao lado do Kleuber, avise explicitamente — não esconda. Mas SEMPRE procure a sacada que abre caminho mesmo assim.
- Se houver súmula ou tema vinculante, destaque — e depois procure as exceções a ela.
- Sugira qual peça/recurso é mais indicado dado o cenário jurisprudencial.
- Se encontrar uma sacada de alto impacto, destaque com "⚡ SACADA:" no início da linha.

Cruzamento com dados do PJe:
- Se Kleuber fornecer movimentos do PJe (código + descrição), cruze com a jurisprudência para dar contexto completo.
- Verifique: decisões semelhantes a esse movimento PJe foram reformadas em recurso? Em qual proporção?
- Se o PJe mostrar tutela negada, liminar cassada ou sentença desfavorável — pesquise especificamente jurisprudência de reforma no tribunal competente.
- Se o PJe indicar sentença ou acórdão, oriente sobre os precedentes para o recurso cabível.
- Sempre conecte o dado PJe à cadeia recursiva: o que essa decisão significa para STJ/STF no futuro?

Linguagem com o usuário — regras de ouro para uso profissional:
- Apresente resultados como conselheiro jurídico, não como buscador de textos.
- Priorize: 1 precedente forte > 5 fracos.
- Destaque claramente: "FAVORÁVEL ao seu caso", "DESFAVORÁVEL ao seu caso", "NEUTRO/DEPENDE".
- Use linguagem direta: "Você tem boas chances aqui porque..." ou "O cenário é difícil, mas existe uma saída:...".
- Nenhum termo técnico de sistemas: sem "endpoint", "API", "tool", "payload".

Seu tom: pesquisador estratégico e cético. Não force jurisprudência favorável onde não tem — mas não desista sem caçar as saídas. Kleuber precisa da verdade E das brechas.

Regra obrigatoria de atendimento:
- Se o usuario pedir analise, PRIMEIRO pergunte se ele tem documento (decisao, peticao, certidao etc.) para anexar/colar.
- Se nao tiver documento, trabalhe com a informacao verbal e deixe isso explicito.
- Ao final de CADA resposta, pergunte exatamente: "Quer lancar no sistema? Atualizar andamento? Criar caso novo? Ou apenas consulta?"`;

// =====================================================================
// FERRAMENTAS (tools)
// =====================================================================

const TOOL_PROPOR_ATUALIZACAO = {
  name: 'propor_atualizacao',
  description: 'Propõe uma atualização no processo. USE IMEDIATAMENTE quando: (1) Kleuber der uma ORDEM DIRETA (mudar status, mover setor, atualizar) — execute NA HORA, mesmo na primeira mensagem; (2) Kleuber contar novidade sobre o processo. Pode ser chamada múltiplas vezes.',
  input_schema: {
    type: 'object',
    properties: {
      andamento:    { type: 'string',  description: 'Texto formal do novo andamento (1-3 frases, tom jurídico).' },
      status:       { type: 'string', enum: ['URGENTE', 'ATIVO', 'DISTRIBUIDO', 'MONITORAR', 'AGUARDANDO', 'VENCIDO', 'CONCLUIDO', 'ENTREGUE'], description: 'Novo status. Se Kleuber pedir pra mudar (ex: "status ativo", "manda pra ativo", "mover pra concluido"), MUDE IMEDIATAMENTE. Se não mencionou status, use ATIVO (significa que houve trabalho).' },
      setor:        { type: 'string', enum: ['autuacao', 'administrativo', 'judicial'], description: 'Setor do processo. Se Kleuber pedir pra mover setor, MUDE IMEDIATAMENTE. Se não mencionou, mantenha o atual.' },
      dias_parado:  { type: 'integer', description: 'Dias sem movimentação. Geralmente 0 quando há movimentação nova.' },
      proxima_acao: { type: 'string',  description: 'O que precisa ser feito depois.' },
      prazo:        { type: 'string',  description: 'Novo prazo no formato YYYY-MM-DD. Opcional.' },
      justificativa:{ type: 'string',  description: 'Justificativa jurídica breve.' },
      integrar_parecer: { type: 'string', description: 'Resumo essencial do parecer para integrar ao processo ao finalizar.' }
    },
    required: ['andamento', 'status', 'proxima_acao', 'justificativa']
  }
};

const TOOL_PRONTO_PARA_REDIGIR = {
  name: 'pronto_para_redigir',
  description: 'Use quando tiver alinhado com Kleuber TODOS os elementos necessários pra redigir a peça: tipo, objeto, fundamentos, prazo. O sistema vai disparar a redação efetiva em seguida.',
  input_schema: {
    type: 'object',
    properties: {
      tipo_peca:           { type: 'string',  description: 'Tipo processualmente correto (Embargos de Declaração, Agravo de Instrumento, Contestação, etc.).' },
      instrumento_cabivel: { type: 'boolean', description: 'true se o instrumento é cabível agora neste processo.' },
      objeto:              { type: 'string',  description: 'O que a peça quer atacar/sustentar em 1-2 frases.' },
      fundamentos_chave:   { type: 'array', items: { type: 'string' }, description: 'Fundamentos jurídicos principais a usar.' },
      elementos_novos:     { type: 'array', items: { type: 'string' }, description: 'Fatos supervenientes ou elementos novos desde a última peça. Vazio se não houver.' },
      prequestionamento:   { type: 'array', items: { type: 'string' }, description: 'Dispositivos federais/constitucionais pra marcar (futuro STJ/STF).' },
      decisao_a_atacar:    { type: 'string',  description: 'Texto resumido da decisão a atacar, se aplicável.' },
      instrucoes_extras:   { type: 'string',  description: 'Observações finais do Kleuber.' }
    },
    required: ['tipo_peca', 'instrumento_cabivel', 'objeto', 'fundamentos_chave']
  }
};

const TOOL_CONSOLIDAR_PERFIL = {
  name: 'consolidar_perfil',
  description: 'Use quando tiver pesquisado o suficiente e quiser entregar o perfil consolidado do julgador ao Kleuber.',
  input_schema: {
    type: 'object',
    properties: {
      nome:                     { type: 'string' },
      tribunal:                 { type: 'string' },
      vara_camara:              { type: 'string' },
      resumo:                   { type: 'string', description: '2-3 frases sobre o perfil decisório.' },
      padroes_favoraveis:       { type: 'array', items: { type: 'string' } },
      padroes_desfavoraveis:    { type: 'array', items: { type: 'string' } },
      estilo_redacao:           { type: 'string' },
      argumentos_que_convencem: { type: 'array', items: { type: 'string' } },
      decisoes_relevantes:      { type: 'array', items: { type: 'object', properties: { processo:{type:'string'}, tema:{type:'string'}, resultado:{type:'string'}, url:{type:'string'} } } },
      tom_recomendado:          { type: 'string' },
      material_suficiente:      { type: 'boolean', description: 'false se so achou pouco material — avisa Kleuber.' },
      perfil_psicologico:       { type: 'string', enum: ['conservador','progressista','formalista','pragmatico','tecnico','politico','indefinido'], description: 'Perfil psicológico/decisório dominante do magistrado.' },
      score_probabilidade:      { type: 'integer', description: 'Score de probabilidade de êxito geral com este julgador (0-100). Baseado em dados reais, não otimismo.' },
      justificativa_score:      { type: 'string', description: 'Justificativa objetiva do score: em quais casos decidiu a favor/contra e por quê.' },
      gatilhos_positivos:       { type: 'array', items: { type: 'string' }, description: 'O que faz este juiz decidir a favor: linguagem, argumentos, postura, formalidades.' },
      gatilhos_negativos:       { type: 'array', items: { type: 'string' }, description: 'O que irrita ou faz este juiz decidir contra: informalidade, teses específicas, petições longas, etc.' },
      estrategia_redacao:       { type: 'string', description: 'Como redigir a peça especificamente para este julgador.' }
    },
    required: ['nome', 'resumo', 'material_suficiente']
  }
};

const TOOL_CONSOLIDAR_JURIS = {
  name: 'consolidar_jurisprudencia',
  description: 'Use quando tiver pesquisado o suficiente e quiser entregar análise consolidada da jurisprudência ao Kleuber.',
  input_schema: {
    type: 'object',
    properties: {
      tema:                   { type: 'string' },
      sentido_predominante:   { type: 'string', enum: ['favoravel', 'desfavoravel', 'dividido', 'inconclusivo'] },
      resumo:                 { type: 'string', description: '2-3 frases sobre como os tribunais decidem.' },
      precedentes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tribunal:          { type: 'string' },
            numero:            { type: 'string' },
            relator:           { type: 'string' },
            data:              { type: 'string' },
            ementa_resumida:   { type: 'string' },
            aplicabilidade:    { type: 'string', enum: ['alta','media','baixa'] },
            url:               { type: 'string' }
          }
        }
      },
      teses_vencedoras:       { type: 'array', items: { type: 'string' } },
      teses_derrotadas:       { type: 'array', items: { type: 'string' } },
      sugestao_peca:          { type: 'string', description: 'Qual peça/recurso é mais indicado dado o cenário.' },
      alerta_desfavoravel:    { type: 'string', description: 'Se sentido for desfavorável, mensagem clara pro Kleuber.' },
      sacadas_juridicas: {
        type: 'array',
        description: 'Sacadas estratégicas encontradas: exceções a súmulas, distinções, votos vencidos virados, mudanças recentes, lacunas, teses paralelas.',
        items: {
          type: 'object',
          properties: {
            tipo:        { type: 'string', enum: ['excecao_sumula','distincao','virada_jurisprudencial','lacuna','tese_paralela','recurso_pendente','voto_vencido'], description: 'Tipo de sacada.' },
            descricao:   { type: 'string', description: 'Descrição da sacada em linguagem direta.' },
            impacto:     { type: 'string', enum: ['alto','medio','baixo'], description: 'Impacto potencial no processo.' },
            como_usar:   { type: 'string', description: 'Como usar essa sacada na peça/estratégia.' },
            fonte_url:   { type: 'string', description: 'URL da fonte que comprova a sacada.' }
          },
          required: ['tipo','descricao','impacto','como_usar']
        }
      }
    },
    required: ['tema', 'sentido_predominante', 'resumo']
  }
};

const TOOL_BUSCAR_DOCUMENTOS = {
  name: 'buscar_documentos',
  description: 'Busca documentos indexados relacionados ao processo para apoiar analise e estrategia.',
  input_schema: {
    type: 'object',
    properties: {
      processo_id:   { type: 'string', description: 'ID do processo (opcional).' },
      nome_processo: { type: 'string', description: 'Nome interno do processo (opcional).' }
    }
  }
};

// =====================================================================
// HELPERS
// =====================================================================

function montarContextoProcesso(p) {
  if (!p) return 'Processo não encontrado.';
  const ands = Array.isArray(p.andamentos) ? p.andamentos : [];
  const ultimos = ands.slice(-5).map((a, i) => {
    if (!a) return `  ${i + 1}. [?] (andamento vazio)`;
    const data = a.data || a.criado_em || '?';
    const texto = a.texto || a.descricao || a.andamento || JSON.stringify(a);
    return `  ${i + 1}. [${data}] ${texto}`;
  }).join('\n');

  const partes = p.partes
    || (p.poloAtivo && p.poloPassivo ? p.poloAtivo + ' vs ' + p.poloPassivo : null)
    || '?';
  const tags = Array.isArray(p.tags) ? p.tags.join(', ') : (p.tags || '—');

  // Movimentos PJe se disponíveis
  const movPje = Array.isArray(p.movimentos_pje) ? p.movimentos_pje : [];
  const ultimosPje = movPje.slice(-5).map((m, i) => {
    if (!m) return `  ${i + 1}. [?] (movimento vazio)`;
    const dt   = m.dataHora || m.data || '?';
    const cod  = m.codigo   || m.codigoNacional || '';
    const desc = m.descricao || m.nome || JSON.stringify(m);
    return `  ${i + 1}. [${dt}]${cod ? ' [Cód. ' + cod + ']' : ''} ${desc}`;
  }).join('\n');

  const linhas = [
    'PROCESSO EM FOCO:',
    `- Nome interno: ${p.nome || p.titulo || '?'}`,
    `- Número CNJ: ${p.cnj || p.numero || '?'}`,
    `- Partes: ${partes}`,
    `- Vara / Tribunal: ${p.vara || p.tribunal || '?'}`,
    `- Juiz/Relator: ${p.juiz || p.relator || 'não cadastrado'}`,
    `- Status atual: ${p.status || '?'}`,
    `- Prazo atual: ${p.prazo || 'sem prazo'}`,
    `- Dias parado: ${p.dias_parado != null ? p.dias_parado : (p.diasParado != null ? p.diasParado : '?')}`,
    `- Próxima ação: ${p.proxacao || p.proxima_acao || '—'}`,
    `- Tags/Temas: ${tags}`,
    '- Últimos andamentos (mais recentes no fim):',
    ultimos || '  (nenhum)'
  ];
  if (movPje.length > 0) {
    linhas.push('');
    linhas.push('- Últimos movimentos PJe importados (mais recentes no fim):');
    linhas.push(ultimosPje);
  }
  return linhas.join('\n');
}

function chamarAnthropic(ANTHROPIC_KEY, httpsMod, payload) {
  return new Promise((resolve, reject) => {
    try {
      if (!ANTHROPIC_KEY) return reject(new Error('ANTHROPIC_KEY ausente'));
      const body = JSON.stringify(payload);
      const opts = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-length': Buffer.byteLength(body)
        }
      };
      const req = httpsMod.request(opts, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => {
          try {
            const parsed = JSON.parse(d);
            if (parsed.error) {
              const err = new Error('Anthropic: ' + (parsed.error.message || JSON.stringify(parsed.error)));
              err.status = r.statusCode;
              err.type = parsed.error.type || 'unknown';
              return reject(err);
            }
            if (r.statusCode >= 400) {
              const err = new Error('Anthropic HTTP ' + r.statusCode + ': ' + d.slice(0, 300));
              err.status = r.statusCode;
              return reject(err);
            }
            resolve(parsed);
          } catch (e) {
            const err = new Error('Resposta inválida da Anthropic (HTTP ' + (r.statusCode||'?') + '): ' + d.slice(0, 200));
            err.status = r.statusCode;
            reject(err);
          }
        });
      });
      req.on('error', e => reject(e));
      // CORRIGIDO: destroy() + reject separados para garantir rejeição em todas as versões Node
      req.setTimeout(ANTHROPIC_TIMEOUT_MS || 180000, () => {
        req.destroy();
        reject(new Error('Timeout Anthropic (' + (ANTHROPIC_TIMEOUT_MS || 180000) + 'ms)'));
      });
      req.write(body);
      req.end();
    } catch (e) { reject(e); }
  });
}

function acharProcesso(processos, processo_id) {
  if (!Array.isArray(processos)) return null;
  return processos.find(p => String(p.id) === String(processo_id));
}

async function buscarDocumentosIndexados(processoId, nomeProcesso, deps) {
  const pid = processoId != null && String(processoId).trim() ? String(processoId).trim() : null;
  const nome = nomeProcesso != null && String(nomeProcesso).trim() ? String(nomeProcesso).trim() : null;

  const filtrar = (rows) => {
    const arr = Array.isArray(rows) ? rows : [];
    return arr.filter((d) => {
      if (!d || typeof d !== 'object') return false;
      const dPid = d.processo_id != null ? String(d.processo_id) : (d.processoId != null ? String(d.processoId) : '');
      const dNome = String(d.nome_processo || d.nomeProcesso || d.processo_nome || d.nome || '');
      const okPid = !pid || dPid === pid;
      const okNome = !nome || dNome.toLowerCase().includes(nome.toLowerCase());
      return okPid && okNome;
    });
  };

  try {
    if (deps && typeof deps.sbGet === 'function') {
      if (pid) {
        const porId = await deps.sbGet('documentos_indexados', { processo_id: pid });
        if (Array.isArray(porId) && porId.length) return filtrar(porId);
      }
      if (nome) {
        const porNome = await deps.sbGet('documentos_indexados', { nome_processo: nome });
        if (Array.isArray(porNome) && porNome.length) return filtrar(porNome);
      }
      const gerais = await deps.sbGet('documentos_indexados', {});
      if (Array.isArray(gerais) && gerais.length) return filtrar(gerais);
    }
  } catch (e) {
    console.warn('[VIVO] buscarDocumentosIndexados sbGet falhou:', e.message);
  }

  const fallback = deps && Array.isArray(deps.documentos_indexados) ? deps.documentos_indexados : [];
  return filtrar(fallback);
}

async function persistirProcesso(deps, processo_atualizado) {
  // 1. Atualiza na memória (sempre)
  const arr = deps.processos || [];
  const idx = arr.findIndex(p => String(p.id) === String(processo_atualizado.id));
  if (idx >= 0) arr[idx] = processo_atualizado;
  else arr.push(processo_atualizado);
  
  // 2. Persiste no Supabase (tabela processos)
  try {
    if (deps.sbPatch) {
      const updateData = {};
      const campos = ['status','juiz','vara','proxacao','observacoes','area','cliente','prazo','nome','numero','tipo','setor','atualizado_em','dias_parado','ultima_atualizacao'];
      for(const c of campos) { if(processo_atualizado[c] !== undefined) updateData[c] = processo_atualizado[c]; }
      if(processo_atualizado.andamentos) updateData.andamentos = JSON.stringify(processo_atualizado.andamentos);
      if(processo_atualizado.integracao_parecer) updateData.resumo = processo_atualizado.integracao_parecer;
      if(processo_atualizado.descricao) updateData.resumo = processo_atualizado.descricao;
      await deps.sbPatch('processos', updateData, { id: 'eq.' + processo_atualizado.id });
      console.log('[VIVO] Processo', processo_atualizado.id, 'persistido no Supabase via PATCH');
      return { ok: true, via: 'supabase' };
    } else if (deps.sbReq) {
      const updateData = {};
      const campos = ['status','juiz','vara','proxacao','observacoes','area','cliente','prazo','tipo','setor','atualizado_em','dias_parado','ultima_atualizacao'];
      for(const c of campos) { if(processo_atualizado[c] !== undefined) updateData[c] = processo_atualizado[c]; }
      if(processo_atualizado.integracao_parecer) updateData.resumo = processo_atualizado.integracao_parecer;
      if(processo_atualizado.descricao) updateData.resumo = processo_atualizado.descricao;
      await deps.sbReq('PATCH', 'processos', updateData, { id: 'eq.' + processo_atualizado.id });
      console.log('[VIVO] Processo', processo_atualizado.id, 'persistido no Supabase via sbReq');
      return { ok: true, via: 'supabase' };
    }
  } catch (e) {
    console.error('[VIVO] Falha ao persistir no Supabase (não-fatal):', e.message);
  }
  return { ok: true, via: 'memoria' };
}

function jsonResponse(res, status, obj, CORS) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, CORS || {
    'Access-Control-Allow-Origin': '*'
  });
  res.writeHead(status, headers);
  res.end(JSON.stringify(obj));
}

// =====================================================================
// RETRY AUTOMÁTICO PARA A API ANTHROPIC
// Retenta em 429, 529, 5xx, timeout, ECONNRESET. Backoff: 2s, 4s, 8s.
// =====================================================================
async function chamarAnthropicComRetry(ANTHROPIC_KEY, httpsMod, payload) {
  const maxR = (typeof MAX_RETRIES !== 'undefined') ? MAX_RETRIES : 2;
  let lastErr;
  for (let t = 0; t <= maxR; t++) {
    try {
      return await chamarAnthropic(ANTHROPIC_KEY, httpsMod, payload);
    } catch (e) {
      lastErr = e;
      const msg = (e.message || '').toLowerCase();
      const st = e.status || 0;
      const retryable = (st === 429 || st === 529 || st >= 500 ||
        msg.includes('overloaded') || msg.includes('timeout') ||
        msg.includes('econnreset') || msg.includes('socket hang up'));
      if (!retryable || t >= maxR) throw e;
      const delay = Math.min(2000 * Math.pow(2, t), 16000);
      console.warn('[VIVO] Retry ' + (t+1) + '/' + maxR + ' em ' + delay + 'ms: ' + e.message);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// =====================================================================
// SANITIZAR HISTÓRICO — previne erro 400 da API (role consecutivo igual)
// =====================================================================
function sanitizarHistorico(historico) {
  if (!Array.isArray(historico)) return [];
  const msgs = [];
  const slice = historico.slice(-(typeof MAX_HISTORICO !== 'undefined' ? MAX_HISTORICO : 20));
  for (const h of slice) {
    if (!h || !h.role || h.content == null) continue;
    if (h.role !== 'user' && h.role !== 'assistant') continue;
    if (typeof h.content === 'string' && h.content.trim() === '') continue;
    if (Array.isArray(h.content) && h.content.length === 0) continue;
    if (msgs.length > 0 && msgs[msgs.length - 1].role === h.role) {
      const prev = msgs[msgs.length - 1];
      if (typeof prev.content === 'string' && typeof h.content === 'string') {
        prev.content = prev.content + '\n\n' + h.content;
      } else {
        const pA = Array.isArray(prev.content) ? prev.content : [{type:'text', text: String(prev.content)}];
        const cA = Array.isArray(h.content)    ? h.content    : [{type:'text', text: String(h.content)}];
        prev.content = pA.concat(cA);
      }
      continue;
    }
    msgs.push({ role: h.role, content: h.content });
  }
  return msgs;
}

// Garante que a primeira mensagem é sempre 'user' (API Anthropic exige)
function garantirPrimeiroUser(messages) {
  while (messages.length > 0 && messages[0].role !== 'user') messages.shift();
  return messages;
}

// Sanitiza mensagens de erro: não vaza API keys para o cliente
function erroSeguro(msg) {
  if (!msg) return 'Erro interno.';
  let s = String(msg).replace(/sk-ant-[a-zA-Z0-9\-_]+/g, '[REDACTED]');
  return s.length > 300 ? s.slice(0, 300) + '...' : s;
}

// =====================================================================
// RESOLVER LOOP DE TOOL_USE
// Envia tool_result de volta quando stop_reason='tool_use'.
// Sem isso a conversa fica truncada — bug crítico do original.
// =====================================================================
async function resolverToolUse(deps, payload) {
  const maxLoops = (typeof MAX_TOOL_LOOPS !== 'undefined') ? MAX_TOOL_LOOPS : 3;
  let resposta = await chamarAnthropicComRetry(deps.ANTHROPIC_KEY, deps.https, payload);
  let resultado = extrairRespostaModelo(resposta);
  let textoAcumulado = resultado.texto;
  const todasTools = resultado.toolsUsadas.slice();
  const todasBuscas = (resultado.buscasWeb || []).slice();
  let msgs = payload.messages.slice();
  let loops = 0;

  while (resultado.stop_reason === 'tool_use' && loops < maxLoops) {
    loops++;
    const blocos = (resposta.content || []).filter(b => b.type === 'tool_use');
    if (!blocos.length) break;
    const toolResults = await Promise.all(blocos.map(async (b) => {
      let resultadoTool = {
        ok: true,
        registrado: true,
        mensagem: 'Tool "' + b.name + '" executada com sucesso pelo sistema Lex.'
      };

      if (b.name === 'buscar_documentos') {
        const input = (b && b.input && typeof b.input === 'object') ? b.input : {};
        const documentos = await buscarDocumentosIndexados(input.processo_id, input.nome_processo, deps);
        resultadoTool = {
          ok: true,
          tool: 'buscar_documentos',
          total: Array.isArray(documentos) ? documentos.length : 0,
          documentos: Array.isArray(documentos) ? documentos : []
        };
      }

      return {
        type: 'tool_result',
        tool_use_id: b.id,
        content: JSON.stringify(resultadoTool)
      };
    }));
    msgs.push({ role: 'assistant', content: resposta.content });
    msgs.push({ role: 'user',      content: toolResults });
    const novoPayload = Object.assign({}, payload, { messages: msgs });
    resposta = await chamarAnthropicComRetry(deps.ANTHROPIC_KEY, deps.https, novoPayload);
    resultado = extrairRespostaModelo(resposta);
    if (resultado.texto) textoAcumulado = textoAcumulado ? textoAcumulado + '\n\n' + resultado.texto : resultado.texto;
    resultado.toolsUsadas.forEach(t => todasTools.push(t));
    (resultado.buscasWeb || []).forEach(b => todasBuscas.push(b));
  }
  return { texto: textoAcumulado.trim(), toolsUsadas: todasTools, buscasWeb: todasBuscas, stop_reason: resultado.stop_reason };
}

// Extrai texto + tools de uma resposta Anthropic
function extrairRespostaModelo(resposta) {
  let texto = '';
  const toolsUsadas = [];
  const buscasWeb = [];
  if (resposta && Array.isArray(resposta.content)) {
    for (const bloco of resposta.content) {
      if (bloco.type === 'text') {
        texto += bloco.text;
      } else if (bloco.type === 'tool_use') {
        // tools customizadas (propor_atualizacao, consolidar_*, etc.)
        toolsUsadas.push({ id: bloco.id, name: bloco.name, input: bloco.input });
      } else if (bloco.type === 'server_tool_use') {
        // web_search gerenciada pelo servidor Anthropic — não precisa tool_result manual
        buscasWeb.push({ id: bloco.id, name: bloco.name, input: bloco.input });
      }
    }
  }
  return { texto: texto.trim(), toolsUsadas, buscasWeb, stop_reason: resposta ? resposta.stop_reason : 'error' };
}

// =====================================================================
// HANDLER 1 — CONVERSAR (Gestor IA - Opus 4.7)
// =====================================================================

async function handlerConversar(req, res, body, deps) {
  try {
    const { processo_id, mensagem, historico, movimentos_pje } = body || {};
    if (!mensagem || typeof mensagem !== 'string' || !mensagem.trim()) {
      return jsonResponse(res, 400, { error: 'Por favor, digite uma mensagem para o Gestor.' }, deps.CORS);
    }

    const processo = processo_id != null ? acharProcesso(deps.processos, processo_id) : null;

    // Injeta movimentos PJe no processo para este turno (sem persistir)
    let processoComPje = processo;
    if (processo && Array.isArray(movimentos_pje) && movimentos_pje.length > 0) {
      processoComPje = Object.assign({}, processo, {
        movimentos_pje: (processo.movimentos_pje || []).concat(movimentos_pje)
      });
    }

    const contexto = processoComPje
      ? montarContextoProcesso(processoComPje)
      : 'Conversa geral — nenhum processo selecionado.';

    // Se vieram movimentos PJe novos, adiciona instrução explícita ao Gestor
    const instrucaoPje = (Array.isArray(movimentos_pje) && movimentos_pje.length > 0)
      ? '\n\nATENÇÃO — MOVIMENTOS PJe RECÉM IMPORTADOS (analise cada um e oriente o próximo passo):\n' +
        movimentos_pje.map((m, i) => {
          if (!m) return '';
          const dt   = m.dataHora || m.data || '?';
          const cod  = m.codigo   || m.codigoNacional || '';
          const desc = m.descricao || m.nome || JSON.stringify(m);
          return `  ${i + 1}. [${dt}]${cod ? ' Código ' + cod + ':' : ''} ${desc}`;
        }).filter(Boolean).join('\n')
      : '';

    const systemPrompt = PROMPT_GESTOR + '\n\n' + contexto + instrucaoPje;

    const messages = sanitizarHistorico(historico);
    messages.push({ role: 'user', content: mensagem });
    garantirPrimeiroUser(messages);

    const modelo = deps.MODELO_GESTOR || MODELO_GESTOR;
    const payload = {
      model: modelo,
      max_tokens: 4096,
      system: systemPrompt,
      tools: [TOOL_PROPOR_ATUALIZACAO, TOOL_BUSCAR_DOCUMENTOS],
      messages
    };

    const { texto, toolsUsadas, stop_reason } = await resolverToolUse(deps, payload);

    const proposta = toolsUsadas.find(t => t.name === 'propor_atualizacao');

    return jsonResponse(res, 200, {
      ok: true,
      texto,
      proposta: proposta ? { id: proposta.id, ...proposta.input } : null,
      processo_id: processo_id || null,
      modelo,
      stop_reason
    }, deps.CORS);

  } catch (e) {
    console.error('[VIVO] conversar erro COMPLETO:', e);
    console.error('[VIVO] conversar stack:', e.stack);
    console.error('[VIVO] deps.ANTHROPIC_KEY presente:', !!deps.ANTHROPIC_KEY);
    console.error('[VIVO] deps.https presente:', !!deps.https);
    const msgErro = String(e.message || e || 'erro desconhecido');
    // Se é erro de modelo inválido, tenta com fallback
    if(msgErro.includes('model') || msgErro.includes('not_found') || msgErro.includes('404')) {
      console.error('[VIVO] Modelo inválido detectado, verifique MODELO_GESTOR:', MODELO_GESTOR);
    }
    return jsonResponse(res, 500, { error: 'Erro no Gestor IA: ' + msgErro.substring(0, 300) }, deps.CORS);
  }
}

// =====================================================================
// HANDLER 2 — APLICAR (persiste proposta do Gestor)
// =====================================================================

async function handlerAplicar(req, res, body, deps) {
  try {
    const { processo_id, proposta } = body || {};
    if (!processo_id || !proposta) {
      return jsonResponse(res, 400, { error: 'processo_id e proposta obrigatórios' }, deps.CORS);
    }

    const processo = acharProcesso(deps.processos, processo_id);
    if (!processo) return jsonResponse(res, 404, { error: 'processo não encontrado' }, deps.CORS);

    const antes = JSON.parse(JSON.stringify(processo));

    if (proposta.andamento) {
      processo.andamentos = processo.andamentos || [];
      const hoje = new Date().toISOString().slice(0, 10);
      processo.andamentos.push({
        data: hoje,
        texto: proposta.andamento,
        origem: 'gestor_ia',
        justificativa: proposta.justificativa || ''
      });
      processo.ultima_atualizacao = hoje;
      processo.atualizado_em = hoje;
      // Atualização = houve trabalho = reseta dias parado
      processo.dias_parado = 0;
      processo.diasParado = 0;
      // Regra CEO: qualquer atualização = volta ATIVO (a menos que proposta mude pra outro status)
      if (!proposta.status) processo.status = 'ATIVO';
    }
    if (proposta.status) {
      const stUp = String(proposta.status).toUpperCase().trim();
      if ((typeof STATUS_VALIDOS !== 'undefined' ? STATUS_VALIDOS : ['URGENTE','ATIVO','MONITORAR','AGUARDANDO','VENCIDO','CONCLUIDO']).includes(stUp)) {
        processo.status = stUp;
      } else {
        console.warn('[VIVO] Status inválido ignorado:', proposta.status);
      }
    }
    if (typeof proposta.dias_parado === 'number' && proposta.dias_parado >= 0) {
      processo.dias_parado = proposta.dias_parado;
      processo.diasParado = proposta.dias_parado;
    }
    if (proposta.proxima_acao) {
      processo.proxacao = proposta.proxima_acao;
      processo.proxima_acao = proposta.proxima_acao;
    }
    if (proposta.prazo) {
      const pr = String(proposta.prazo).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(pr)) {
        processo.prazo = pr;
      } else {
        console.warn('[VIVO] Prazo formato inválido ignorado:', proposta.prazo);
      }
    }
    if (proposta.setor) {
      const setorNovo = String(proposta.setor).toLowerCase().trim();
      if (['autuacao', 'administrativo', 'judicial'].includes(setorNovo)) {
        processo.setor = setorNovo;
        // Atualiza tipo para manter compatibilidade
        if (setorNovo === 'judicial') processo.tipo = 'judicial';
        else if (setorNovo === 'administrativo') processo.tipo = 'administrativo';
        console.log('[VIVO] Processo movido para setor:', setorNovo);
      } else {
        console.warn('[VIVO] Setor inválido ignorado:', proposta.setor);
      }
    }
    const integrarParecer = String(proposta.integrar_parecer || '').trim();
    if (integrarParecer) {
      const trecho = integrarParecer.substring(0, 1200);
      processo.integracao_parecer = trecho;
      const descAtual = String(processo.descricao || '');
      const marcador = 'Integração IA (parecer): ';
      processo.descricao = descAtual
        ? (descAtual + '\n\n' + marcador + trecho)
        : (marcador + trecho);
    }

    const resultado = await persistirProcesso(deps, processo);
    
    // Notifica equipe sobre atualização (se disponível)
    if (deps._notificarEquipe) {
      const nomeProc = processo.nome || 'Processo #'+processo_id;
      let resumo = '✅ *Processo atualizado via Gestor IA*\n📁 '+nomeProc+'\n';
      if(proposta.novo_andamento) resumo += '📝 '+proposta.novo_andamento+'\n';
      if(proposta.status) resumo += '🔄 Status: '+proposta.status+'\n';
      if(proposta.prazo) resumo += '📅 Prazo: '+proposta.prazo+'\n';
      if(proposta.proxima_acao) resumo += '▶️ Próxima: '+proposta.proxima_acao+'\n';
      deps._notificarEquipe(resumo).catch(()=>{});
    }

    if (typeof deps.sbPost === 'function') {
      try {
        await deps.sbPost('vivo_acoes', {
          processo_id: String(processo_id),
          acao: 'proposta_aprovada',
          proposta_json: proposta,
          antes_json: antes,
          depois_json: processo
        });
      } catch (e) { /* best-effort */ }
    }

    return jsonResponse(res, 200, {
      ok: true,
      processo,
      antes,
      persistencia: resultado
    }, deps.CORS);

  } catch (e) {
    console.error('[VIVO] aplicar erro:', e.message);
    return jsonResponse(res, 500, { error: e.message }, deps.CORS);
  }
}

// =====================================================================
// HANDLER 3 — REDATOR DE PEÇA (Opus 4.7, conversacional)
// POST /api/vivo/peca/conversar
// =====================================================================

async function handlerPecaConversar(req, res, body, deps) {
  try {
    const { processo_id, mensagem, historico, decisao_anexada } = body || {};
    if (!mensagem) return jsonResponse(res, 400, { error: 'mensagem obrigatória' }, deps.CORS);

    const processo = processo_id ? acharProcesso(deps.processos, processo_id) : null;
    const contexto = processo ? montarContextoProcesso(processo) : 'Processo não selecionado.';

    // Se tem perfil de juiz cacheado, inclui
    let perfilJuiz = '';
    if (processo && (processo.juiz || processo.relator) && deps.sbGet) {
      try {
        const nome = processo.juiz || processo.relator;
        const juiz_id = `${(processo.tribunal || '').toUpperCase()}::${nome.toLowerCase().replace(/\s+/g, '_')}`;
        const cache = await deps.sbGet('perfis_juizes', { juiz_id });
        if (cache && cache.length > 0) {
          perfilJuiz = `\n\nPERFIL DO JULGADOR (${nome}):\n${cache[0].resumo || ''}`;
        }
      } catch (e) { /* segue sem perfil */ }
    }

    const decisao = decisao_anexada
      ? `\n\nDECISÃO/DOCUMENTO ANEXADO PARA ANÁLISE:\n${decisao_anexada}`
      : '';

    const systemPrompt = `${PROMPT_REDATOR}\n\n${contexto}${perfilJuiz}${decisao}`;

    const messages = sanitizarHistorico(historico);
    messages.push({ role: 'user', content: mensagem });
    garantirPrimeiroUser(messages);

    const modelo = deps.MODELO_REDATOR || MODELO_REDATOR;
    const payload = {
      model: modelo,
      max_tokens: 4096,
      system: systemPrompt,
      tools: [TOOL_PRONTO_PARA_REDIGIR, TOOL_BUSCAR_DOCUMENTOS],
      messages
    };

    const { texto, toolsUsadas, stop_reason } = await resolverToolUse(deps, payload);

    const briefing = toolsUsadas.find(t => t.name === 'pronto_para_redigir');

    return jsonResponse(res, 200, {
      ok: true,
      texto,
      briefing_pronto: briefing ? { id: briefing.id, ...briefing.input } : null,
      processo_id: processo_id || null,
      modelo,
      stop_reason
    }, deps.CORS);

  } catch (e) {
    console.error('[VIVO] peca/conversar erro:', e.message);
    return jsonResponse(res, 500, { error: erroSeguro(e.message) }, deps.CORS);
  }
}

// =====================================================================
// HANDLER 4 — GERAR PEÇA (dispara redação efetiva do Opus 4.7)
// POST /api/vivo/peca/gerar
// =====================================================================

async function handlerPecaGerar(req, res, body, deps) {
  try {
    const { processo_id, briefing, decisao_anexada } = body || {};
    if (!briefing || !briefing.tipo_peca) {
      return jsonResponse(res, 400, { error: 'briefing com tipo_peca obrigatório' }, deps.CORS);
    }

    const processo = processo_id ? acharProcesso(deps.processos, processo_id) : null;
    const contexto = processo ? montarContextoProcesso(processo) : 'Processo não informado.';

    let perfilJuiz = '';
    if (processo && (processo.juiz || processo.relator) && deps.sbGet) {
      try {
        const nome = processo.juiz || processo.relator;
        const juiz_id = `${(processo.tribunal || '').toUpperCase()}::${nome.toLowerCase().replace(/\s+/g, '_')}`;
        const cache = await deps.sbGet('perfis_juizes', { juiz_id });
        if (cache && cache.length > 0) {
          perfilJuiz = `\n\nPERFIL DO JULGADOR (${nome}):\n${cache[0].resumo || ''}\n\nAjuste o tom da peça a este perfil.`;
        }
      } catch (e) { console.warn('[VIVO] falha ao carregar perfil do julgador:', e?.message || e); }
    }

    const fundamentos = (briefing.fundamentos_chave || []).join('\n- ');
    const elementos = (briefing.elementos_novos || []).join('\n- ');
    const prequestion = (briefing.prequestionamento || []).join('\n- ');
    const decisao = decisao_anexada
      ? `\n\nDECISÃO A ANALISAR/ATACAR:\n${decisao_anexada}`
      : (briefing.decisao_a_atacar ? `\n\nDECISÃO A ATACAR:\n${briefing.decisao_a_atacar}` : '');

    const systemPromptGerar = `Você é o redator jurídico sênior do escritório Camargos Advocacia (OAB/MG 118.237 — Kleuber Melchior; titular: Wanderson Farias de Camargos).
Contexto institucional: Kleuber atua como analista jurídico (NÃO advogado); assinatura técnica do Dr. Wanderson.
Autonomia: quando agir por iniciativa própria, peça confirmação primeiro. Quando Kleuber der uma ordem direta, execute imediatamente.
Qualidade: rigor técnico e jurisprudência real.
Proatividade: antecipe riscos recursais e aperfeiçoe a estrutura para fases futuras.
Sua tarefa é REDIGIR a peça processual solicitada com padrão técnico máximo, pronta para protocolo.
REGRAS ABSOLUTAS:
1. INSTRUMENTO CABÍVEL (CPC) — se não for, diga no topo e sugira o correto, mas entregue a peça pedida mesmo assim.
2. PROIBIDO INOVAR NO PEDIDO (art. 329 CPC) — mesmo destino, caminho diferente quando jurisprudência for desfavorável.
3. PREQUESTIONAMENTO — marque expressamente dispositivos federais/constitucionais pertinentes.
4. JURISPRUDÊNCIA REAL — só cite precedentes verdadeiros. Não invente números.
5. PADRÃO FORMAL — epígrafe (vara/número), qualificação, fatos, fundamentos, pedidos, encerramento.
6. ASSINATURA obrigatória: "Wanderson Farias de Camargos — OAB/MG 118.237".`;

    const userPromptGerar = `Redija agora a peça processual completa:

TIPO DE PEÇA: ${briefing.tipo_peca}
INSTRUMENTO CABÍVEL? ${briefing.instrumento_cabivel ? 'Sim' : 'Verificar'}

${contexto}${perfilJuiz}${decisao}

OBJETO DA PEÇA: ${briefing.objeto || '(derivar do contexto)'}

FUNDAMENTOS CHAVE:
- ${fundamentos || '(derivar do contexto)'}

${elementos ? `ELEMENTOS NOVOS/FATOS SUPERVENIENTES:\n- ${elementos}\n` : ''}
${prequestion ? `PREQUESTIONAMENTO (marcar dispositivos):\n- ${prequestion}\n` : ''}
${briefing.instrucoes_extras ? `INSTRUÇÕES EXTRAS DO KLEUBER:\n${briefing.instrucoes_extras}\n` : ''}
Redija a peça completa agora.`;

    const modelo = deps.MODELO_REDATOR || MODELO_REDATOR;
    const payload = {
      model: modelo,
      max_tokens: 8192,
      system: systemPromptGerar,
      messages: [{ role: 'user', content: userPromptGerar }]
    };

    const resposta = await chamarAnthropicComRetry(deps.ANTHROPIC_KEY, deps.https, payload);
    const { texto: peca } = extrairRespostaModelo(resposta);

    // Log da ação
    if (deps.sbPost && processo_id) {
      try {
        await deps.sbPost('vivo_acoes', {
          processo_id: String(processo_id),
          acao: 'peca_gerada',
          proposta_json: briefing,
          depois_json: { tipo_peca: briefing.tipo_peca, tamanho_chars: peca.length }
        });
      } catch (e) { console.warn('[VIVO] falha ao registrar acao vivo_acoes:', e?.message || e); }
    }

    // AUTO-GRAVAR no processo: peça elaborada = atualiza andamento + ATIVO
    if (processo && deps.sbReq) {
      try {
        const hoje = new Date().toISOString().slice(0, 10);
        processo.andamentos = processo.andamentos || [];
        processo.andamentos.push({
          data: hoje,
          texto: `Peça jurídica elaborada: ${briefing.tipo_peca}. Pronta para protocolo.`,
          origem: 'redator_ia'
        });
        processo.status = 'ATIVO';
        processo.atualizado_em = hoje;
        processo.ultima_atualizacao = hoje;
        processo.dias_parado = 0;
        await persistirProcesso(deps, processo);
        console.log('[VIVO] Processo atualizado automaticamente após geração de peça:', processo_id);
      } catch (e) { console.warn('[VIVO] falha ao auto-atualizar processo após peça:', e?.message || e); }
    }

    return jsonResponse(res, 200, {
      ok: true,
      peca,
      tipo_peca: briefing.tipo_peca,
      modelo,
      tem_perfil_juiz: !!perfilJuiz,
      briefing
    }, deps.CORS);

  } catch (e) {
    console.error('[VIVO] peca/gerar erro:', e.message);
    return jsonResponse(res, 500, { error: e.message }, deps.CORS);
  }
}

// =====================================================================
// HANDLER 5 — PESQUISADOR DE JUÍZES (Sonnet 4.6 + web_search)
// POST /api/vivo/juiz/conversar
// =====================================================================

async function handlerJuizConversar(req, res, body, deps) {
  try {
    const { mensagem, historico, nome, tribunal, instancia } = body || {};
    if (!mensagem) return jsonResponse(res, 400, { error: 'mensagem obrigatória' }, deps.CORS);

    // Check cache primeiro se a conversa está começando e tem nome+tribunal
    if ((!historico || historico.length === 0) && nome && tribunal && deps.sbGet) {
      const juiz_id = `${tribunal.toUpperCase()}::${nome.toLowerCase().replace(/\s+/g, '_')}`;
      try {
        const cache = await deps.sbGet('perfis_juizes', { juiz_id });
        if (cache && cache.length > 0) {
          const c = cache[0];
          const tsAt = c.atualizado_em ? new Date(c.atualizado_em).getTime() : 0;
          const idade = (tsAt > 0 && !isNaN(tsAt)) ? (Date.now() - tsAt) / (1000 * 60 * 60 * 24) : Infinity;
          if (idade < 90) {
            return jsonResponse(res, 200, {
              ok: true,
              texto: `Já tenho um perfil de ${nome} em cache (${Math.floor(idade)}d atrás):\n\n${c.resumo}\n\nQuer que eu atualize a pesquisa ou continuamos com esse perfil?`,
              cache_hit: true,
              perfil_cache: c.perfil_json,
              modelo: 'cache'
            }, deps.CORS);
          }
        }
      } catch (e) { /* segue */ }
    }

    const ctxInicial = nome
      ? `\n\nALVO DA PESQUISA: ${nome}${tribunal ? ` — ${tribunal}` : ''}${instancia ? ` (${instancia})` : ''}`
      : '';

    const systemPrompt = `${PROMPT_PESQUISADOR_JUIZES}${ctxInicial}`;

    const messages = sanitizarHistorico(historico);
    messages.push({ role: 'user', content: mensagem });
    garantirPrimeiroUser(messages);

    const modelo = deps.MODELO_PESQUISADOR || MODELO_PESQUISADOR;
    const payload = {
      model: modelo,
      max_tokens: 4096,
      system: systemPrompt,
      tools: [
        { type: 'web_search_20250305' },   // CORRIGIDO: 'name' removido — não deve existir em built-in tools
        TOOL_CONSOLIDAR_PERFIL,
        TOOL_BUSCAR_DOCUMENTOS
      ],
      messages
    };

    const { texto, toolsUsadas, buscasWeb, stop_reason } = await resolverToolUse(deps, payload);

    const consolidacao = toolsUsadas.find(t => t.name === 'consolidar_perfil');

    // Se consolidou, salva no cache
    if (consolidacao && consolidacao.input && consolidacao.input.material_suficiente && deps.sbUpsert) {
      const perfilJson = consolidacao.input;
      const trib = perfilJson.tribunal || tribunal || '';
      const nm = perfilJson.nome || nome;
      if (nm) {
        const juiz_id = `${trib.toUpperCase()}::${nm.toLowerCase().replace(/\s+/g, '_')}`;
        try {
          await deps.sbUpsert('perfis_juizes', {
            juiz_id, nome: nm,
            tribunal: trib,
            instancia: instancia || '',
            perfil_json: perfilJson,
            resumo: perfilJson.resumo || '',
            atualizado_em: new Date().toISOString()
          }, 'juiz_id');
        } catch (e) { console.warn('[VIVO] cache perfil save falhou:', e.message); }
      }
    }

    return jsonResponse(res, 200, {
      ok: true,
      texto,
      perfil_consolidado: consolidacao ? consolidacao.input : null,
      buscas_feitas: (buscasWeb || []).length,   // CORRIGIDO: web_search é server_tool_use, não tool_use
      modelo,
      stop_reason,
      cache_hit: false
    }, deps.CORS);

  } catch (e) {
    console.error('[VIVO] juiz/conversar erro:', e.message);
    return jsonResponse(res, 500, { error: e.message }, deps.CORS);
  }
}

// =====================================================================
// HANDLER 6 — PESQUISADOR DE JURISPRUDÊNCIA (Sonnet 4.6 + web_search)
// POST /api/vivo/juris/conversar
// =====================================================================

async function handlerJurisConversar(req, res, body, deps) {
  try {
    const { mensagem, historico, processo_id, tema, tribunal_alvo, movimentos_pje } = body || {};
    if (!mensagem || typeof mensagem !== 'string' || !mensagem.trim()) {
      return jsonResponse(res, 400, { error: 'Por favor, descreva o que deseja pesquisar.' }, deps.CORS);
    }

    const processo = processo_id != null ? acharProcesso(deps.processos, processo_id) : null;

    // Injeta movimentos PJe temporariamente para enriquecer o contexto
    let processoParaCtx = processo;
    if (processo && Array.isArray(movimentos_pje) && movimentos_pje.length > 0) {
      processoParaCtx = Object.assign({}, processo, {
        movimentos_pje: (processo.movimentos_pje || []).concat(movimentos_pje)
      });
    }

    const ctxProcesso = processoParaCtx
      ? '\n\nCONTEXTO DO PROCESSO EM ANÁLISE:\n' + montarContextoProcesso(processoParaCtx)
      : '';

    // Instrução de cruzamento PJe x jurisprudência
    const instrucaoPje = (Array.isArray(movimentos_pje) && movimentos_pje.length > 0)
      ? '\n\nMOVIMENTOS PJe PARA CRUZAR COM JURISPRUDÊNCIA:\n' +
        movimentos_pje.map((m, i) => {
          if (!m) return '';
          const dt   = m.dataHora || m.data || '?';
          const cod  = m.codigo   || m.codigoNacional || '';
          const desc = m.descricao || m.nome || JSON.stringify(m);
          return '  ' + (i + 1) + '. [' + dt + ']' + (cod ? ' Cód. ' + cod + ':' : '') + ' ' + desc;
        }).filter(Boolean).join('\n') +
        '\n\nPara cada movimento acima: pesquise jurisprudência sobre esse tipo de decisão/ato e indique se há precedentes favoráveis à reforma ou continuidade.'
      : '';

    const ctxInicial = tema
      ? '\n\nTEMA INICIAL: ' + tema + (tribunal_alvo ? ' (foco em ' + tribunal_alvo + ')' : '')
      : '';

    const systemPrompt = PROMPT_PESQUISADOR_JURIS + ctxProcesso + instrucaoPje + ctxInicial;

    const messages = sanitizarHistorico(historico);
    messages.push({ role: 'user', content: mensagem });
    garantirPrimeiroUser(messages);

    const modelo = deps.MODELO_PESQUISADOR || MODELO_PESQUISADOR;
    const payload = {
      model: modelo,
      max_tokens: 4096,
      system: systemPrompt,
      tools: [
        { type: 'web_search_20250305' },   // CORRIGIDO: 'name' removido
        TOOL_CONSOLIDAR_JURIS,
        TOOL_BUSCAR_DOCUMENTOS
      ],
      messages
    };

    const { texto, toolsUsadas, buscasWeb, stop_reason } = await resolverToolUse(deps, payload);

    const consolidacao = toolsUsadas.find(t => t.name === 'consolidar_jurisprudencia');

    return jsonResponse(res, 200, {
      ok: true,
      texto,
      juris_consolidada: consolidacao ? consolidacao.input : null,
      sacadas_juridicas: consolidacao && consolidacao.input ? (consolidacao.input.sacadas_juridicas || []) : [],
      buscas_feitas: (buscasWeb || []).length,   // CORRIGIDO: conta server_tool_use
      processo_id: processo_id || null,
      modelo,
      stop_reason
    }, deps.CORS);

  } catch (e) {
    console.error('[VIVO] juris/conversar erro:', e.message);
    return jsonResponse(res, 500, { error: erroSeguro(e.message) }, deps.CORS);
  }
}

// =====================================================================
// EXPORTACAO DE DADOS DO AGENTE (correcao #7)
// Consolida tudo que os agentes tem sobre um processo: processo em si,
// andamentos, perfis de juiz em cache, pecas geradas, acoes registradas.
// Util para debug, auditoria, backup e integracao externa (incl. PJe).
// =====================================================================
async function exportarDadosAgente(processo_id, deps) {
  const out = {
    processo_id: String(processo_id || ''),
    exportado_em: new Date().toISOString(),
    versao_modulo: '2.1',
    processo: null,
    perfil_juiz: null,
    acoes: [],
    pronto_para_pje: false,
    fonte: {}
  };
  if (!processo_id) return out;

  // Processo: tenta Supabase -> memoria
  try {
    if (deps && typeof deps.sbGet === 'function') {
      const rows = await deps.sbGet('processos_cache', { id: String(processo_id) });
      if (rows && rows.length > 0) {
        out.processo = rows[0];
        out.fonte.processo = 'supabase';
      }
    }
  } catch (e) { /* segue pra memoria */ }
  if (!out.processo) {
    out.processo = acharProcesso(deps && deps.processos, processo_id) || null;
    if (out.processo) out.fonte.processo = 'memoria';
  }

  // Perfil de juiz em cache, se houver juiz/relator
  if (out.processo && (out.processo.juiz || out.processo.relator) && deps && typeof deps.sbGet === 'function') {
    try {
      const nome = out.processo.juiz || out.processo.relator;
      const trib = (out.processo.tribunal || '').toUpperCase();
      const juiz_id = trib + '::' + String(nome).toLowerCase().replace(/\s+/g, '_');
      const cache = await deps.sbGet('perfis_juizes', { juiz_id });
      if (cache && cache.length > 0) {
        out.perfil_juiz = cache[0];
        out.fonte.perfil_juiz = 'supabase';
      }
    } catch (e) { /* opcional */ }
  }

  // Acoes registradas (pecas geradas, propostas aplicadas, etc.)
  try {
    if (deps && typeof deps.sbGet === 'function') {
      const acoes = await deps.sbGet('vivo_acoes', { processo_id: String(processo_id) });
      if (Array.isArray(acoes)) {
        out.acoes = acoes;
        out.fonte.acoes = 'supabase';
      }
    }
  } catch (e) { /* opcional */ }

  // Flag de prontidao pra PJe (correcao #8)
  out.pje = prepararParaPJe(out.processo);
  out.pronto_para_pje = !!(out.pje && out.pje.pronto);

  return out;
}

// =====================================================================
// INTEGRACAO PJe - PREPARACAO (correcao #8)
// Monta o payload base que sera consumido futuramente pelo conector PJe
// (REST/CNJ/PDPJ-br). Aqui NAO chamamos o PJe ainda - so deixamos os
// dados normalizados e os hooks prontos para quando o conector existir.
// =====================================================================
function prepararParaPJe(processo) {
  if (!processo) return { pronto: false, motivo: 'processo ausente' };
  const cnj = processo.cnj || processo.numero || '';
  const cnjLimpo = String(cnj).replace(/\D/g, '');
  // Formato CNJ valido tem 20 digitos: NNNNNNN-DD.AAAA.J.TR.OOOO
  const cnjValido = cnjLimpo.length === 20;
  const tribunal = (processo.tribunal || '').trim();
  const pronto = cnjValido && !!tribunal;

  return {
    pronto,
    motivo: pronto ? 'pronto para consulta PJe' : (!cnjValido ? 'CNJ invalido/incompleto' : 'tribunal ausente'),
    cnj,
    cnj_limpo: cnjLimpo,
    tribunal,
    instancia: processo.instancia || null,
    vara: processo.vara || null,
    partes: processo.partes || null,
    // Hooks a serem implementados pelo conector PJe:
    hooks: {
      consultar_processo: 'pje.consultarProcesso(cnj_limpo, tribunal)',
      baixar_andamentos:  'pje.baixarAndamentos(cnj_limpo, tribunal)',
      protocolar_peca:    'pje.protocolarPeca(cnj_limpo, peca, assinador)',
      baixar_decisao:     'pje.baixarUltimaDecisao(cnj_limpo, tribunal)'
    }
  };
}

// Handler HTTP para exportacao (correcao #7)
async function handlerExportarAgente(req, res, body, deps) {
  try {
    const { processo_id } = body || {};
    if (!processo_id) {
      return jsonResponse(res, 400, { error: 'processo_id obrigatorio' }, deps.CORS);
    }
    const dados = await exportarDadosAgente(processo_id, deps);
    return jsonResponse(res, 200, { ok: true, dados }, deps.CORS);
  } catch (e) {
    console.error('[VIVO] exportar erro:', e.message);
    return jsonResponse(res, 500, { error: erroSeguro(e.message) }, deps.CORS);
  }
}

// =====================================================================
// HANDLERS LEGADOS (retrocompatibilidade com frontend antigo)
// =====================================================================

async function handlerPerfilJuizLegado(req, res, body, deps) {
  const { nome, tribunal, instancia } = body || {};
  if (!nome) return jsonResponse(res, 400, { error: 'nome obrigatório' }, deps.CORS);
  return handlerJuizConversar(req, res, {
    mensagem: `Pesquise o perfil decisório de ${nome}${tribunal ? ` do ${tribunal}` : ''}${instancia ? ` (${instancia})` : ''}. Faça as buscas necessárias e depois chame consolidar_perfil.`,
    nome, tribunal, instancia
  }, deps);
}

async function handlerJurisprudenciaLegado(req, res, body, deps) {
  const { tema, processo_id, tribunal_alvo } = body || {};
  if (!tema) return jsonResponse(res, 400, { error: 'tema obrigatório' }, deps.CORS);
  return handlerJurisConversar(req, res, {
    mensagem: `Pesquise jurisprudência sobre: "${tema}"${tribunal_alvo ? ` com foco em ${tribunal_alvo}` : ''}. Faça as buscas e chame consolidar_jurisprudencia.`,
    tema, processo_id, tribunal_alvo
  }, deps);
}

async function handlerGerarPecaLegado(req, res, body, deps) {
  const { processo_id, tipo_peca, decisao_anexada, instrucoes_extras, fundamentos } = body || {};
  if (!tipo_peca) return jsonResponse(res, 400, { error: 'tipo_peca obrigatório' }, deps.CORS);
  const briefing = {
    tipo_peca,
    instrumento_cabivel: true,
    objeto: 'derivar do contexto do processo',
    fundamentos_chave: Array.isArray(fundamentos) ? fundamentos : (fundamentos ? [fundamentos] : []),
    instrucoes_extras: instrucoes_extras || ''
  };
  return handlerPecaGerar(req, res, { processo_id, briefing, decisao_anexada }, deps);
}

// =====================================================================
// DISPATCHER
// =====================================================================

async function tratarRota(req, res, url, deps) {
  // Normaliza URL: remove query string e trailing slash para matching robusto
  const urlLimpa = url ? url.split('?')[0].replace(/\/+$/, '') : '';
  if (!urlLimpa || !urlLimpa.startsWith('/api/vivo')) return false;
  url = urlLimpa;

  const CORS = deps.CORS || {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Aparelho-Id'
  };

  // CORS preflight
  if (req.method === 'OPTIONS') {
    try { res.writeHead(204, CORS); res.end(); } catch(e) { console.warn('[Lex] Erro silenciado:', (e && e.message) ? e.message : e); }
    return true;
  }

  // Exportar dados do agente — GET /api/vivo/exportar/:id
  if (req.method === 'GET' && url.startsWith('/api/vivo/exportar/')) {
    const procId = url.replace('/api/vivo/exportar/', '').split('?')[0].trim();
    if (!procId) {
      jsonResponse(res, 400, { error: 'Informe o ID do processo: /api/vivo/exportar/{id}' }, CORS);
      return true;
    }
    const exportado = exportarDadosAgente(procId, deps);
    jsonResponse(res, exportado.ok ? 200 : 404, exportado, CORS);
    return true;
  }

  // Health (GET)
  if (url === '/api/vivo/health' && req.method === 'GET') {
    jsonResponse(res, 200, {
      ok: true,
      modulo: 'lex_agente_vivo',
      versao: '2.2',
      funcionarios_virtuais: {
        gestor:        { modelo: deps.MODELO_GESTOR      || MODELO_GESTOR,      endpoint: '/api/vivo/conversar' },
        redator:       { modelo: deps.MODELO_REDATOR     || MODELO_REDATOR,     endpoint: '/api/vivo/peca/conversar' },
        juiz:          { modelo: deps.MODELO_PESQUISADOR || MODELO_PESQUISADOR, endpoint: '/api/vivo/juiz/conversar' },
        jurisprudencia:{ modelo: deps.MODELO_PESQUISADOR || MODELO_PESQUISADOR, endpoint: '/api/vivo/juris/conversar' }
      },
      processos_em_memoria: (deps.processos || []).length,
      supabase_conectado: typeof deps.sbGet === 'function',
      anthropic_key_presente: !!deps.ANTHROPIC_KEY
    }, CORS);
    return true;
  }

  if (req.method !== 'POST') {
    jsonResponse(res, 405, { error: 'Esta operação requer uma requisição POST.' }, CORS);
    return true;
  }

  if (typeof deps.lerBody !== 'function') {
    console.error('[VIVO] deps.lerBody não configurado — verifique a integração com o servidor principal');
    jsonResponse(res, 500, { error: 'Serviço temporariamente indisponível. Tente novamente em instantes.' }, CORS);
    return true;
  }

  let body;
  try {
    // Quando o servidor principal já leu o body, reutiliza para não consumir o stream duas vezes.
    // Isso evita travamento/erro silencioso nas rotas /api/vivo/*.
    if (deps && deps.body && typeof deps.body === 'object') {
      body = deps.body;
    } else {
      body = await deps.lerBody(req);
    }
  }
  catch (e) { jsonResponse(res, 400, { error: 'body inválido: ' + e.message }, CORS); return true; }

  const depsPlus = Object.assign({}, deps, { CORS });

  // Gestor
  if (url === '/api/vivo/conversar')        { await handlerConversar(req, res, body, depsPlus);      return true; }
  if (url === '/api/vivo/aplicar')          { await handlerAplicar(req, res, body, depsPlus);        return true; }

  // Redator (novo, conversacional)
  if (url === '/api/vivo/peca/conversar')   { await handlerPecaConversar(req, res, body, depsPlus);  return true; }
  if (url === '/api/vivo/peca/gerar')       { await handlerPecaGerar(req, res, body, depsPlus);      return true; }

  // Pesquisadores (novos, conversacionais)
  if (url === '/api/vivo/juiz/conversar')   { await handlerJuizConversar(req, res, body, depsPlus);  return true; }
  if (url === '/api/vivo/juris/conversar')  { await handlerJurisConversar(req, res, body, depsPlus); return true; }

  // Exportacao agregada (correcao #7)
  if (url === '/api/vivo/exportar')        { await handlerExportarAgente(req, res, body, depsPlus);    return true; }

  // Legados (retrocompat)
  if (url === '/api/vivo/perfil_juiz')      { await handlerPerfilJuizLegado(req, res, body, depsPlus);     return true; }
  if (url === '/api/vivo/jurisprudencia')   { await handlerJurisprudenciaLegado(req, res, body, depsPlus); return true; }
  if (url === '/api/vivo/gerar_peca')       { await handlerGerarPecaLegado(req, res, body, depsPlus);     return true; }

  jsonResponse(res, 404, { error: 'Recurso não encontrado. Verifique o endereço da solicitação.' }, CORS);
  return true;
}

module.exports = { tratarRota, montarContextoProcesso, exportarDadosAgente, prepararParaPJe };
