# Canais e agentes — preparação de implantação

Registro iniciado em 07/09/2026. A atualização de 08/09/2026 está no
[relatório de verificação](VERIFICACAO_20260908.md), que prevalece sobre os
estados históricos abaixo. Integrações reais continuam sem homologação.

## WhatsApp

A linha foi fornecida pelo titular, operadora Vivo, com ativação no celular em
andamento. O número específico fica na configuração privada de implantação,
fora do repositório público. O código lê LEX_WHATSAPP_NUMBER (55 + DDD + celular).
O número não é o contato pessoal do administrador nem concede papel de operador.

Configurar EVOLUTION_URL (HTTPS), EVOLUTION_KEY e EVOLUTION_INSTANCE no servidor.
A URL é definida pelo operador da hospedagem; não enviar a chave para uma URL
recebida no corpo da API. Usar a versão Evolution compatível com o contrato abaixo.
A conexão não é criada nem ativada por preencher o número.

O verificador consulta connectionState da instância e fetchInstances filtrado
por nome. Só confirma conexão se o estado for open e o ownerJid da sessão
corresponder ao número esperado. Sem identidade, com erro de rede, instância
ambígua ou outra linha, informa pendência/falha. O campo number da Evolution é
configuração e não prova qual conta foi autenticada. O pareamento deve ocorrer
com o titular no aparelho, depois de disponibilizada a instância.

/api/whatsapp/configurar exige administrador e confirma persistência antes de
alterar o cache. A linha fixada no servidor não pode ser substituída por outro
número pela interface. A integração continua inicialmente desativada. O envio
de texto pela linha fixada também confere a conexão; espera ID da Evolution para
confirmar aceitação. Aceitação pelo provedor não comprova leitura pelo destinatário.

## Telegram

Manter o bot existente; não criar outro antes de recuperar a configuração do
servidor. Usar TELEGRAM_TOKEN e TELEGRAM_ADMIN (ou TELEGRAM_ADMIN_CHAT_ID).
O fallback numérico legado de administrador permanece por compatibilidade;
implantação nova deve configurar explicitamente o administrador autorizado.

A consulta getMe valida o bot, e getWebhookInfo detecta conflito com o polling
usado neste backend. O diagnóstico não remove um webhook existente: antes disso,
confirmar se pertence a outra implantação. Sem token, o polling não inicia.
O polling agora tem timeout de socket e recebe apenas tipos de update processados
pelo adapter. Não foi implementada inbox durável nem deduplicação entre instâncias.

O envio de texto e de arquivo valida ok e message_id. A central e a rota de
notificação não registram sucesso se o envio for recusado. O wrapper de histórico
registra falha_envio para tentativas não confirmadas. Algumas mensagens automáticas
legadas ainda exigem auditoria. Não houve mensagem real enviada nesta validação.

## Agentes existentes: mapa de ativação

| Agente / rotina | Entrada observada | Dependências e limite atual |
| --- | --- | --- |
| Roteador | AgenteRoteador / _agenteRoteador | Cache de processos; correspondência probabilística ainda exige auditoria de isolamento |
| Cadastrador/Autuação | AgenteCadastrador / _cadastradorRecebeu | Canal, banco, documentos e IA; fluxo completo não homologado |
| Cobrador de tarefas | AgenteCobrador / _executarCobrador | Processos e avisos; não confundir com cobrança financeira |
| Assessor | AgenteAssessor / diagnóstico, estratégia, redação e revisão | Banco, IA, documentos e aprovação; não substitui revisão jurídica |
| Pericial | AgentePericial / _assessorPerical | Calculadora e IA; laudo final exige validação técnica |
| PJe | AgentePJe | Código declara pendente; executor local Playwright não acompanha esta base |
| Gestor vivo | /api/vivo/conversar e /aplicar | Anthropic e banco; escrita confirmada nos fluxos revisados |
| Redator vivo | /api/vivo/peca/conversar e /gerar | Anthropic, processo e documentos; minuta para revisão |
| Pesquisador de julgadores | /api/vivo/juiz/conversar | IA e base de fontes; identidade/fontes exigem validação |
| Pesquisador de jurisprudência | /api/vivo/juris/conversar | IA e pesquisa; citações não verificadas não são fontes confirmadas |
| Secretário e atendimento | sysSecretaria, sysAtendimentoCliente e pipeline WhatsApp | Perfis, sessões e canal; isolamento completo permanece pendente |
| Motor proativo e alertas | _motorProativoLex, enviarAlertas, timers | Mesmo processo Node; não há worker durável homologado |

Status pronto registrado em uma classe significa que a fachada foi instanciada,
não que a integração foi testada. O health do agente vivo deixou de declarar
Supabase conectado apenas porque existe uma função sbGet. O diagnóstico mostra
separadamente módulos presentes, configuração e homologação pendente.

O código legado PJe ainda define prazo de seis dias em um caminho de andamento;
isso não prova prazo processual e deve ser removido/revisado antes de ativar o
executor. Não habilitar automaticamente todos os timers contra dados reais.

## Verificar sem iniciar o servidor

```sh
npm run status:integracoes
npm run status:integracoes -- --live
```

O primeiro comando verifica presença de configuração, sem rede. O segundo faz
somente leitura de identidade/estado dos canais; não envia mensagem, chama IA,
cria instância ou modifica webhook. Exige variáveis disponíveis no ambiente.
Nenhum segredo é impresso. GET /api/integracoes/status fornece diagnóstico
semelhante, restrito a administrador, com inventário dos agentes registrados.

Na revisão de 07/09 passaram 76 testes; em 08/09 passaram 93. Não representam
integrações reais nem cobertura de todos os agentes. GitHub e monitoramento Render
estão autorizados. Publicação em produção e homologação dos canais continuam pendentes.

## Referências do contrato

- [Telegram Bot API](https://core.telegram.org/bots/api): respostas ok/result, getMe e getWebhookInfo.
- [Rotas Evolution](https://github.com/evolution-foundation/evolution-api/blob/main/src/api/routes/instance.router.ts)
- [Controller Evolution](https://github.com/evolution-foundation/evolution-api/blob/main/src/api/controllers/instance.controller.ts)
- [Modelo Instance Evolution](https://github.com/evolution-foundation/evolution-api/blob/main/prisma/postgresql-schema.prisma)

O contrato foi conferido no código oficial disponível; a versão da instância do
usuário ainda precisa ser identificada no ambiente de homologação.
