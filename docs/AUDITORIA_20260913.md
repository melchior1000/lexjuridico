# Auditoria do LEX — 13/09/2026

Base: `df2dc4c` de `melchior1000/lexjuridico`. Branch: `fix/full-audit-20260913`.

## Resultado verificável

165 testes locais passam, sem testes ignorados. `npm run check` agora inclui
scripts de inicialização, testes, módulos, backend e JavaScript inline das páginas.
A suíte anterior tinha 152 testes: um falhava por registrar conteúdo sensível;
outro exigia instalar as dependências declaradas com `npm ci`.

Foi executada análise estática de referências indefinidas, chaves duplicadas,
código inalcançável, condições constantes e executores async de Promise.
Foram examinados 25 arquivos de backend/módulos/scripts (16.771 linhas),
os scripts de index.html com office-ui.js e lex-whatsapp.html. Após as correções,
nenhum achado dessas regras permaneceu nesse conjunto. Globais compartilhadas
entre os scripts de navegador e bibliotecas externas foram consideradas.

Os três arquivos principais agora somam 29.031 linhas: bot.js 13.824,
index.html 13.640 e lex_agente_vivo.js 1.567. Isso não inclui módulos, scripts,
testes ou estilos. A varredura estática abrange arquivos completos, mas não equivale
a uma revisão manual de cada linha nem a uma prova de ausência de bugs.

## Defeitos corrigidos

| Área | Defeito demonstrado | Correção e evidência |
| --- | --- | --- |
| Inicialização | runtime-image-patch.js tinha SyntaxError e era executado antes do bot | Removido patch de runtime; processamento visual integra o código-fonte |
| Verificação | scripts de inicialização não entravam no check | Check ampliado; workflow GitHub executa check e testes |
| Documentos | imagens eram convertidas em texto UTF-8 | Imagens/PDF enviados em blocos visuais base64; DOCX extraído como texto; teste da função real |
| Evolution | corpo de erro podia expor dados sensíveis apesar da expressão de redação | Logs limitados a categorias conhecidas; sem corpo bruto ou mensagem arbitrária de rede |
| Bootstrap | nome de instância era comparado sem distinguir maiúsculas | Comparação exata, coerente com verificação da sessão; redirects recusados |
| WhatsApp | respostas próprias, grupos e eventos administrativos entravam no atendimento | Filtro antes de consultas, saudação e execução nas duas rotas |
| Telefone | API e cache de interface propagavam JID ao campo visual | API devolve número plano; leitura/escrita do cache normaliza JID antigo |
| Entrada processual | módulo não era alcançável pelo servidor principal | Rota conectada; teste usa handler HTTP real, com autenticação |
| Entrada processual | datas impossíveis normalizadas para outro mês; fuso ignorado | Validação de calendário/horário e comparação com offset ISO |
| Identificação | ID selecionado podia divergir do CNJ ou cair silenciosamente em outro processo | Rejeição de IDs inexistentes e números contraditórios |
| Concorrência | duplicidade decidida antes da operação de gravação | Inspeção refeita na mutação, inclusive em tentativas após conflito |
| Atendimento | dados_informados inexistente interrompia cadastro/alerta | Uso dos dados da sessão; teste do caminho de identificação |
| Cadastro por canal | chamarClaudeTexto não existia | Usa função ia existente com modelo TOP; teste confirma criação |
| Central de mensagens | token indefinido impedia três operações | Token obtido da sessão; teste das três requisições |
| Central de mensagens | JSON em onclick quebrava atributos; escapador duplicado retirava proteção de aspas | JSON em data attribute escapado, handler fixo, escapador comum; mensagem recusada preservada |
| Análise estratégica | extrairTextoPDF e splitPDFEmChunks não existiam | Reuso do divisor real e conteúdo visual, limpeza dos chunks |
| Análise estratégica | resultado só alterava objeto em memória | Gravação confirmada via ProcessStore, preservando andamentos concorrentes; erro do banco não anuncia sucesso |

## Evolution 2.3.7: diagnóstico na fonte, ainda não confirmado em produção

Foi examinada a tag oficial `2.3.7`, commit
`cd800f2976e1e5b682fbf86a01ee4d85ae61f370`.

Fontes:

- [Serviço Baileys da tag 2.3.7](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts)
- [Leitura das variáveis de ambiente](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/config/env.config.ts)
- [Relato oficial relacionado ao erro state](https://github.com/evolution-foundation/evolution-api/issues/2090)
- [Agrupamento de problemas de QR e pareamento](https://github.com/evolution-foundation/evolution-api/issues/2437)

`createClient()` já aguarda `defineAuthState()` com await. `defineAuthState()`
retorna um estado somente se provider estiver ativo, Redis estiver ativo com
SAVE_INSTANCES, ou DATABASE.SAVE_DATA.INSTANCE estiver habilitado. Sem uma dessas
condições, termina com undefined. Depois, createClient acessa authState.state.creds.

O trecho real da função foi executado isoladamente, com providers simulados:

| Condição | Retorno |
| --- | --- |
| Todos os armazenamentos de sessão desabilitados | undefined |
| Redis habilitado, sem SAVE_INSTANCES e sem banco para instância | undefined |
| DATABASE_SAVE_DATA_INSTANCE=true, demais providers desabilitados | Estado do provider de banco |
| Redis e CACHE_REDIS_SAVE_INSTANCES=true | Estado do provider Redis |

A variável DATABASE_SAVE_DATA_INSTANCE ausente também resulta em false nessa tag.
Portanto, o sintoma não comprova uma corrida de inicialização. Antes de editar
Baileys ou trocar a imagem, é necessário conferir as flags reais e o armazenamento
do serviço. Habilitar gravação de instância só é uma correção adequada se o banco
e a persistência de chaves estiverem operacionais. Não foi aplicado patch à Evolution.

## Pendências para encerramento

- Render: o conector listou My Workspace, ID `tea-d77dnln5r7bs73asp5n0`, mas recusou
  listar serviços porque não há workspace selecionado. Exigiu confirmação do usuário
  antes de usar esse ID. Nenhum log ou configuração de produção foi lido nesta rodada.
- Confirmar a imagem implantada, flags de persistência de sessão, logs da criação,
  estado open e ownerJid correto; depois homologar recebimento e resposta pelo LEX.
- Pareamento por QR pode exigir o telefone do usuário. Testes locais não comprovam
  conexão do WhatsApp, Telegram, PJe, chamadas reais de IA ou persistência de produção.
- O filtro atual trata mensagens privadas com JID telefônico. Identidades @lid
  exigem resolução explícita para telefone antes de permitir acesso a dados de cliente.
- A arquitetura ainda possui cache local no navegador, permissões por perfil e
  fluxos legados. Não foi concluída migração completa para SaaS multiusuário nem
  auditoria manual integral, visual, de carga, de recuperação e de isolamento.

Nenhuma mensagem real foi enviada, dado de cliente alterado, sessão apagada ou
configuração de produção modificada durante estes testes. As correções deste PR
não autorizam afirmar que todos os bugs do LEX foram eliminados.
