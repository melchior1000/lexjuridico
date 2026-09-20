# LEX — lista-mestra de fechamento

Controle definido pelo titular em 19/09/2026. Esta lista prevalece sobre estados
históricos dos relatórios anteriores. Um item só recebe ✅ depois de implementado,
testado, sem pendência relevante de revisão e homologado no fluxo real.

## Etapas

| # | Etapa | Estado |
| --- | --- | --- |
| 1 | Telegram: transporte/polling | ✅ concluído, conforme homologação informada pelo titular |
| 2 | Recepção unificada WhatsApp + Telegram | ✅ concluído, conforme homologação informada pelo titular |
| 3 | Histórico/resposta pelo canal correto | ✅ concluído, conforme homologação informada pelo titular |
| 4 | Task Engine — recuperação segura | 🟡 implementado; falta homologação final |
| 5 | Pipeline/Home/status | 🟡 implementado; falta homologação final |
| 6 | LEX vivo — entender ordens naturais e EXECUTAR | 🔴 em correção; busca segura por nome em revisão; Core único e fluxo real ainda pendentes |
| 7 | WhatsApp ponta a ponta | 🟡 falta homologação final |
| 8 | Telegram ponta a ponta | 🟡 falta homologação final |
| 9 | Interface LEX — celular | 🔴 corrigir; PR #88 aberto |
| 10 | Interface LEX — tablet/desktop | 🔴 vistoria geral |
| 11 | Processo/contexto — nunca selecionar processo aleatório | 🔴 corrigir; PR #88 aberto |
| 12 | “Precisa de você” — dizer quem, o quê e qual ação + botão | 🔴 corrigir |
| 13 | Botões/ações da tela — remover atalhos sem função e ligar os úteis | 🔴 revisar |
| 14 | PJe autenticado + autorização + intimações/citações | 🟡 fundação iniciada |
| 15 | Prazo oficial/auditável + Datajud/PJe/DJEN | 🟡 fundação iniciada |
| 16 | Regressão completa + CodeRabbit + produção | ⬜ final |

Os três primeiros estados foram preservados da lista do titular; esta retomada
não realizou uma nova homologação desses itens. A aprovação de um PR isolado não
equivale à conclusão da etapa 6 nem à liberação final da etapa 16.

## Arquitetura a preservar

Web/App, WhatsApp e Telegram são portas do mesmo LEX Core. A ordem deve passar
pelo mesmo coordenador, resolver pessoa/processo/documentos, executar ou distribuir
ao setor e acionar o Task Engine quando necessário. A resposta retorna ao canal
de origem. Os históricos dos provedores permanecem separados.

Consultar, organizar, cadastrar, analisar e preparar seguem a ordem do operador.
Envio sensível, alteração crítica, protocolo e atos sujeitos à autorização mantêm
a trava humana. Ambiguidade de pessoa ou processo exige esclarecimento; nunca
selecionar o primeiro resultado como se fosse uma escolha do usuário.

Não exigir que o operador escolha IA/setor ou decore comandos. Exemplos de
aceitação: “responda a Leidyanny”, “analise esse processo”, “faça a contestação”,
“veja o que precisa de mim”, “mande isso no WhatsApp” e “cadastre esse cliente”.
Esses exemplos são requisitos; sua presença aqui não declara implementação.

## Evidência da retomada — etapa 6

- Base inspecionada: `main` em `99428c071b47774e097a54cfb228d39650cac4aa`.
- [PR #87](https://github.com/melchior1000/lexjuridico/pull/87): incorporado em
  19/09/2026 às 23:23:47 UTC. CI do último commit passou; estados CodeRabbit e
  Vercel indicavam sucesso na consulta desta retomada.
- O defeito “Ana Maria” corresponder a “Ana” foi corrigido no #87.
- A revisão de paginação do #87 continuava sem resolução. O código passou de
  50 para 100 candidatos, preservando o risco de falso destinatário único.
- Foi reproduzido em teste o envio indevido com “Ana Silva” na primeira posição
  e “Ana Souza” na posição 151. A consulta também não detectava falha posterior
  à primeira página porque sequer buscava a página seguinte.
- Correção isolada em `fix/owner-recipient-complete-search`: o store percorre os
  contatos aguardando retorno, ordenados pelo número, usando cursor estável.
  Só declara unicidade depois de esgotar a consulta. Dois candidatos bastam para
  declarar ambiguidade. Página curta não é tratada como fim da consulta.
- Erro, página inválida ou cursor repetido bloqueiam envio por nome. O cache
  parcial em memória continua servindo à exibição, mas não comprova unicidade.
- Os testes exercitam o store e o handler juntos: homônimo além de 100 registros,
  falha entre páginas, limite menor imposto pelo servidor, nome incompleto,
  destinatário único e falha do provedor sem registro de entrega.
- Validação local desta correção: 30 testes focados e 429 testes da suíte completa
  passaram. `npm run check` passou, com um aviso preexistente de variável não
  utilizada em `office-ui-v2.js`. CI remoto, revisão e homologação da nova
  correção ainda não estão certificados por este registro.

## Limites e próxima sequência

1. Confirmar o CI remoto e concluir a revisão do PR desta correção.
2. Integrar os caminhos existentes ao Core comum. O handler do dono no WhatsApp
   ainda possui despacho próprio; corrigir a busca não unifica automaticamente
   o motor da Web (`/api/vivo/conversar`) e o adaptador Telegram.
3. Homologar com destinatários de teste explicitamente identificados: entrada da
   ordem, pessoa correta, envio confirmado, histórico e retorno ao dono. Testes
   simulados e deploy saudável não substituem esse percurso.
4. Só dar baixa na etapa 6 com as evidências acima; depois avançar à etapa 7.
5. Preservar a correção de interface/contexto no
   [PR #88](https://github.com/melchior1000/lexjuridico/pull/88), com vistoria em
   celular, tablet e desktop antes de dar baixa nas etapas correspondentes.

Nenhuma mensagem a terceiro foi enviada nesta retomada. Nenhum novo ✅ foi
atribuído com base apenas em testes locais.
