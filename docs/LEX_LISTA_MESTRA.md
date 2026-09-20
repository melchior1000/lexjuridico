# LEX — lista-mestra de fechamento

Controle definido pelo titular em 19/09/2026 e consolidado para o fechamento comercial. Esta lista prevalece sobre estados históricos dos relatórios anteriores. Um item só recebe ✅ depois de implementado, testado, sem pendência relevante de revisão e homologado no fluxo real quando aplicável.

## Etapas

| # | Etapa | Estado |
| --- | --- | --- |
| 1 | Telegram: transporte/polling | ✅ concluído, conforme homologação informada pelo titular |
| 2 | Recepção unificada WhatsApp + Telegram | ✅ concluído, conforme homologação informada pelo titular |
| 3 | Histórico/resposta pelo canal correto | ✅ concluído, conforme homologação informada pelo titular |
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

Fechar a lista funcional não autoriza vender o sistema se o isolamento entre escritórios não estiver comprovado. Antes da declaração comercial, cumprir o gate SaaS de `AGENTS.md`: identidade por usuário/escritório, isolamento de dados/ferramentas, RLS ou mecanismo equivalente comprovado, segredos, documentos/versionamento, backup/restore, limites, observabilidade, onboarding e rollback.

Nenhum novo ✅ deve ser atribuído apenas por CI, mock, PR ou preview.
