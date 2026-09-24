# LEX — lista-mestra de fechamento

Controle definido pelo titular em 19/09/2026 e consolidado para o fechamento comercial. Esta lista prevalece sobre estados históricos dos relatórios anteriores. Um item só recebe ✅ depois de implementado, testado, sem pendência relevante de revisão e homologado no fluxo real quando aplicável.

## Etapas

| # | Etapa | Estado |
| --- | --- | --- |
| 1 | Telegram: transporte/polling | ✅ concluído — evidência E1 |
| 2 | Recepção unificada WhatsApp + Telegram | ✅ concluído — evidência E2 |
| 3 | Histórico/resposta pelo canal correto | ✅ concluído — evidência E3 |
| 4 | Task Engine — recuperação segura | 🟡 implementado/testado; falta homologação real da recuperação |
| 5 | Pipeline/Home/status | 🟡 implementado; falta homologação funcional/visual final |
| 6 | LEX vivo — entender ordens naturais e EXECUTAR | 🟡 em correção; execução natural/Core comum ainda exige fechamento e homologação funcional |
| 7 | WhatsApp ponta a ponta | 🟡 canal existe; falta homologação E2E final |
| 8 | Telegram ponta a ponta | 🟡 canal existe; falta homologação E2E final |
| 9 | Interface LEX — celular | 🔴 corrigir/homologar |
| 10 | Interface LEX — tablet/desktop | 🔴 vistoria e homologação geral |
| 11 | Processo/contexto — nunca selecionar processo aleatório | 🔴 corrigir/homologar |
| 12 | “Precisa de você” — dizer quem, o quê e qual ação + botão | 🔴 corrigir/homologar |
| 13 | Botões/ações da tela — remover atalhos sem função e ligar os úteis | 🔴 revisar/homologar |
| 14 | PJe autenticado + autorização + intimações/citações | 🟡 fundação iniciada; integração real não pode ser simulada |
| 15 | Prazo oficial/auditável + Datajud/PJe/DJEN | 🟡 fundação iniciada; fechar proveniência, frescor e fluxo real |
| 16 | Regressão completa + CodeRabbit + produção | ⬜ final |

## Evidências rastreáveis dos itens concluídos

**E1 — Telegram transporte/polling.** Implementação e endurecimento registrados nos PRs #79 (“Patch 1 — Telegram polling 24/7 seguro”), #82 e #83; o PR #85 registra explicitamente teste real em 19/09/2026 no qual o Telegram recebia mensagens. Ambiente operacional: LEX implantado. Essas referências sustentam o ✅ do transporte/polling, não substituem a homologação E2E separada da etapa 8.

**E2 — Recepção unificada WhatsApp + Telegram.** PR #84 implementa a recepção única preservando origem e persistências separadas; PRs #85 e #86 levam a central integrada para a interface e registram a correção a partir do teste real de 19/09/2026. O ✅ cobre a recepção unificada; não antecipa os E2E finais das etapas 7 e 8.

**E3 — Histórico/resposta pelo canal correto.** PR #84 registra a regra de resposta pelo canal de origem e de só persistir a saída após confirmação do provedor; PRs #85/#86 conectam esse fluxo à central integrada. O aceite funcional foi consolidado em 19/09/2026 na lista-mestra. O ✅ cobre roteamento/histórico; não equivale a homologação E2E dos canais 7 e 8.

Links localizáveis:
- https://github.com/melchior1000/lexjuridico/pull/79
- https://github.com/melchior1000/lexjuridico/pull/82
- https://github.com/melchior1000/lexjuridico/pull/83
- https://github.com/melchior1000/lexjuridico/pull/84
- https://github.com/melchior1000/lexjuridico/pull/85
- https://github.com/melchior1000/lexjuridico/pull/86

## Regras de independência

As etapas 4, 5, 7 e 8 podem ser homologadas independentemente da conclusão da etapa 6 quando seus critérios próprios puderem ser provados. Não criar dependência artificial entre elas.

A etapa 6 prova o Core: linguagem natural deve produzir ação real e segura. As etapas 7 e 8 provam separadamente o transporte ponta a ponta nos canais.

## Arquitetura a preservar

Web/App, WhatsApp e Telegram são portas do mesmo LEX Core. A ordem passa pelo mesmo núcleo de decisão, resolve pessoa/processo/documentos, executa ou distribui ao setor e aciona o Task Engine quando necessário. A resposta retorna ao canal de origem. Históricos dos provedores permanecem separados.

Consultar, organizar, cadastrar, analisar e preparar seguem a ordem do operador. Envio sensível, alteração crítica, protocolo e atos sujeitos à autorização mantêm trava humana. Ambiguidade de pessoa ou processo exige esclarecimento; nunca selecionar o primeiro resultado.

Não exigir escolha de IA/setor ou comandos decorados. Exemplos de aceite: “responda a Leidyanny”, “analise esse processo”, “faça a contestação”, “veja o que precisa de mim”, “mande isso no WhatsApp” e “cadastre esse cliente”. Exemplos são requisitos, não prova de implementação.

## Critérios de homologação

**4 — recuperação segura:** tarefa real entra na fila → interrupção/falha controlada → recuperação continua corretamente → sem duplicidade/perda.

**5 — pipeline/Home/status:** mudança real de estado → backend registra → pipeline acompanha → Home mostra a mesma verdade após refresh/reabertura.

**6 — Core:** ordens naturais resolvem pessoa/processo com segurança e executam ação real ou criam tarefa correta; ambiguidade pede esclarecimento. Resposta textual sem efeito não fecha a etapa.

**7 — WhatsApp E2E:** mensagem real → recepção registra → Core processa → resposta/ação retorna pelo WhatsApp → destinatário/provedor confirma quando aplicável → histórico registra entrada/saída.

**8 — Telegram E2E:** mesma prova pelo Telegram.

**9–13 — interface/contexto:** telas atuais funcionam no dispositivo prometido; nenhuma ação falsa, contexto aleatório, botão morto ou divergência de verdade entre Home/Processos/Prazos.

**14–15 — oficial/auditável:** autenticação e autorização reais; leitura/proveniência/frescor/recibo oficiais; falha e resultado ambíguo tratados sem fabricar sucesso.

**16 — final:** regressão, revisão, produção no commit aprovado e homologação final.

## Gate comercial adicional

Fechar a lista funcional não autoriza vender o sistema se o isolamento entre escritórios não estiver comprovado. Antes da declaração comercial, cumprir o gate SaaS de AGENTS.md: identidade por usuário/escritório, isolamento de dados/ferramentas, RLS ou mecanismo equivalente comprovado, teste A/B, segredos, documentos/versionamento, backup/restore, limites, observabilidade, onboarding, rollback e billing isolado quando habilitado.

Nenhum novo ✅ deve ser atribuído apenas por CI, mock, PR ou preview.

## Registro 24/09/2026 — consultas do dia a dia pelos canais (etapas 6 e 15)

Antes: das 18 frases típicas do advogado testadas, só 2 viravam ação no Core; "prazos de hoje", "tem intimação nova?", "andamento do processo X" e "resumo do dia" caíam na conversa livre da IA, que não pode ser fonte de prazo.

Agora (`lib/office-queries.js`, ligado em `executeNaturalOfficeCommand`): prazos (hoje/amanhã/semana/quinzena/mês/vencidos) via `DeadlineWatch.watchlist`, com "NÃO confirmado" para prazo sem autorização oficial; intimações do DJEN a partir de `djen_comunicacoes`, com órfãs (processo não cadastrado) e alerta de leitura atrasada; andamento por nome ou CNJ, com opções listadas no texto quando há ambiguidade; resumo do dia; ajuda. Banco indisponível falha fechado ("isso NÃO significa que não há intimações"). Pergunta jurídica em tese ("qual o prazo para contestar?") deixa de abrir tarefa de contestação e segue para o assessor.

Evidência: `test/office-queries.test.js` (13 testes). Estados das etapas 6 e 15 não mudam até homologação real nos canais.

## Registro 24/09/2026 (2) — LEX mais próximo do usuário

- Áudio do advogado/secretária no WhatsApp/Telegram passa a ser transcrito e executado como ordem (antes era ignorado fora da sessão de cadastro). A transcrição volta para conferência ("🎙 Entendi: …").
- Pergunta "qual processo?" aceita resposta curta ("1", "o segundo", CNJ ou nome único) e retoma a ordem original, por até 15 minutos.
- "Bom dia" automático no WhatsApp do titular a partir das 7h (`lib/morning-brief.js`): uma vez por dia, marcado só após confirmação do provedor; `LEX_BOM_DIA=0` desliga.

Evidência: `test/office-queries.test.js`, `test/morning-brief.test.js`. Sem homologação real nos canais ainda.

## Registro 24/09/2026 (3) — PJe pelo MNI (etapa 14)

Implementado o cliente MNI 2.2.2 (`lib/pje-mni.js`) e a vigia de expedientes (`lib/pje-monitor.js`). A vigia lista avisos pendentes sem dar ciência, casa pelo CNJ, calcula a ciência tácita (Lei 11.419/2006, art. 5º, §3º) e avisa nos canais. A abertura de teor exige "CONFIRMO CIENCIA SIGLA ID" do advogado. Detalhes e limites: `docs/PJE_MNI.md`. Evidência: `test/pje-mni.test.js` (10 testes, incluindo "a vigia nunca chama consultarTeorComunicacao"). A etapa 14 segue 🟡 até a leitura real com credenciais do advogado em cada tribunal.

## Registro 24/09/2026 (4) — isolamento entre escritórios (gate SaaS)

Auditoria: 12 tabelas usadas pelo LEX estavam fora da muralha (contatos, sessões do WhatsApp, documentos, mensagens, auditoria, cobranças, checkpoints etc.) e o código deixava tabela não declarada passar sem filtro. Corrigido em três camadas: código recusa tabela não isolada; migração `20260924120000` leva RLS às 12 tabelas e cria `ativar_multi_escritorio()`, que remove o padrão "primeiro escritório" e as chaves globais legadas; trava de inicialização do modo comercial. Evidência: `test/tenant-migrations-pglite.test.js` (A/B em PostgreSQL real, todas as tabelas) e `test/tenant-guard.test.js`. Falta aplicar em produção e homologar A/B com dados sintéticos (§9).
