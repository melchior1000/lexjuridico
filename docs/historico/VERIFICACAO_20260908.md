# Verificação do LEX — 08/09/2026

Conclusão: há correções verificadas, mas o LEX completo ainda não está homologado
para operação autônoma ou comercialização. A produção continua na base antiga.

## Evidências desta sessão

| Verificação | Resultado |
| --- | --- |
| GitHub | Instalação autorizada; branch `codex/lex-revisao-20260908` disponível para escrita |
| Base remota antes deste envio | `main` e branch de revisão em `cd09982c4890c3bfbb78635b2b7b07f80e3f9353` |
| Render | Serviço `lex-juridico`, não suspenso, plano gratuito, uma instância |
| Deploy em produção | `dep-d7m47j9j2pic73829klg`, commit `cd09982…`, finalizado em 25/04/2026 |
| Recursos observados | Aproximadamente 53 MB usados, limite 537 MB; CPU baixa no intervalo consultado |
| Logs | Repetição de “Próximo alerta às 17h (0min)” em 07/09/2026, entre 20:00:52 e 20:00:59 UTC |
| Filtro de logs error | Sem resultados no intervalo retornado; a falha dos alertas aparece como info |
| Testes após correções | 93 passaram, zero falhas, zero ignorados; 17 verificações novas |
| Sintaxe e whitespace | Backend, módulos, scripts inline e `git diff --check` passaram |

Os 76 testes anteriores foram executados novamente antes das alterações. Os novos
testes reproduziram falhas antes da correção. Os ensaios usam dependências externas
simuladas, as funções reais do backend e os geradores locais de documentos.
Não houve chamada paga de IA, mensagem real enviada, migração, pareamento ou deploy.

## Corrigido nesta revisão

- Alertas: próximo horário sempre futuro, cálculo de amanhã baseado na data de
  Brasília, programação preservada quando Telegram recusa envio e tratamento da
  rejeição no primeiro ciclo. A verificação noturna não adia o motor pela manhã.
- Prazos: o motor não oculta um prazo cadastrado só porque houve atualização hoje.
- Telegram: anexos exigem resposta válida e ID da mensagem; falhas não são
  registradas como enviadas no histórico ou na central. Corpo multipart preserva
  os bytes do arquivo, com limite de resposta e timeout de socket.
- WhatsApp: envio de arquivo confirma identidade da linha quando configurada,
  preserva prefixo da URL Evolution e exige identificador do provedor.
- Fila de notificações: conta apenas envios confirmados. Resultados incertos ficam
  em `_notificacoesNaoConfirmadas` em memória para conferência, sem reenvio
  automático. Isso ainda não é fila durável nem recuperação após reinício.
- Documentos: geração genérica, redação do assessor e minuta pericial pelos canais
  produzem DOCX OpenXML. Os fluxos interrompem a confirmação de sucesso quando o
  canal recusa o arquivo. ZIP/CRC/conteúdo foram validados; peças e Edição Azul
  foram renderizadas e inspecionadas localmente, ainda sem homologação no aparelho do usuário.
- Webhooks: ambas as entradas WhatsApp exigem segredo antes de consumir o corpo.
  Sem configuração respondem 503; credencial ausente ou divergente recebe 401.
- Anthropic: trabalho geral usa o TOP configurado, padrão `claude-opus-5`; pesquisa jurídica e perícia usam `claude-fable-5-1`,
  conforme a preferência do titular. Overrides antigos MID/ECO não reduzem o
  modelo. Secretário, pesquisa nativa e agente vivo também preservam essa seleção.

As correções anteriores de acesso, senhas, persistência do gestor, sincronização,
documentos e dependências estão incluídas no conjunto enviado para revisão.

## Pendências concretas — não declarar resolvidas

1. Produção não recebeu este conjunto. Render usa autoDeploy de `main`, com build
   `yarn install`. A revisão tem lockfile npm; alinhar o build para `npm ci`
   antes de implantar em homologação, depois de conferir a configuração real.
2. APIs: o titular informou ausência de saldo/chave ativa. Não há credenciais
   disponíveis no ambiente local; os modelos não foram chamados nesta sessão.
3. Telegram: token, webhook/polling, recebimento, chat autorizado e entrega de
   arquivos precisam ser confirmados no serviço real. Logs legados não provam entrega.
4. WhatsApp: Evolution, linha própria, segredo, estado e pareamento precisam ser
   confirmados. Configurar `WHATSAPP_WEBHOOK_SECRET` no servidor e o mesmo valor
   no header `x-webhook-secret` do provedor antes de ativar o recebimento.
5. Banco e armazenamento: schema, RLS, contas por escritório, manifesto de
   documentos, executor local/NAS e restauração ainda não têm validação integrada.
6. Delegação: existem fachadas e rotinas, mas cadastro → processo → documentos →
   tarefa delegada → resultado persistido → retorno ao canal não foi homologado.
7. Alternância OpenAI/Claude ainda é parcial: `ia()` seleciona provedor, enquanto
   agente vivo e pesquisa nativa continuam dependentes de Anthropic. Troca automática
   com preservação de ferramentas, contexto e deduplicação não está implementada.
8. PJe: executor local não acompanha a base; protocolo e consulta integrada não
   foram homologados. Existe lógica legada de prazo fixo que precisa ser revisada.
9. Motor proativo: ainda altera prioridades no cache e tenta chamar uma função
   `persistirProcesso` ausente neste módulo, engolindo a falha. O relato de alteração
   não comprova gravação no banco. Corrigir com repositório transacional antes de
   habilitar essa autonomia. Há outras escritas legadas sujeitas ao mesmo tipo de auditoria.
10. Não há prova de isolamento entre escritórios, restauração, carga, interface
    no navegador, instalação limpa nem aprovação durável dos atos externos.

Próximo aceite operacional: usar dados sintéticos e contas de teste para cadastrar
cliente e processo, anexar documento, produzir DOCX, confirmar entrega nos dois
canais, retomar tarefa após reinício e restaurar o documento. Depois verificar
isolamento de um segundo escritório e preparar implantação/rollback.

## Referências dos contratos consultados

- [Telegram Bot API](https://core.telegram.org/bots/api#senddocument): multipart e resposta do envio.
- [Catálogo de modelos Anthropic](https://platform.claude.com/docs/en/about-claude/models/overview): modelos atuais e identificação dos IDs de API.
- [Busca web Anthropic](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/web-search-tool): filtros de domínio, limites de busca e citações.

Essas fontes descrevem contratos; não demonstram que as contas do LEX estão ativas.
