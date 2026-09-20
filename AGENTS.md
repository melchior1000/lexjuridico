# SKILL — LEX JURÍDICO
## FECHAMENTO INTEGRAL DO PRODUTO + SAAS COMERCIAL

Leia este arquivo antes de planejar, editar, revisar, abrir PR, fazer merge ou deploy.

## MISSÃO

Assuma o LEX Jurídico inteiro e leve o sistema existente até produto final funcional, seguro, implantado e comercializável.

Não entregue outro plano como resultado.
Não redesenhe o LEX.
Não crie um segundo LEX.
Não reduza o escopo a algumas telas.
Não pare porque abriu PR, passou CI ou fez deploy.

A missão termina com o produto funcionando e homologado.

## 1. REGRA DE EXECUÇÃO

Para cada frente:

AUDITAR
→ reproduzir o problema
→ corrigir
→ testar
→ resolver CI/CodeRabbit
→ integrar
→ deploy
→ homologar
→ registrar evidência
→ continuar.

Só marcar uma etapa como concluída quando houver evidência correspondente.

PR aberto ≠ concluído.
CI verde ≠ concluído.
Merge ≠ concluído.
Deploy ≠ homologação.
Mock ≠ fluxo real.
Canal conectado ≠ E2E homologado.
Resposta textual do LEX ≠ ação executada.

Relatório histórico não prevalece sobre evidência atual. Não marcar pendência como resolvida sem verificar código/ambiente; não reabrir pendência antiga sem confirmar que ainda existe.

## 2. NÃO RECONSTRUIR O QUE JÁ EXISTE

Preservar e terminar:

- LEX Core / agente vivo;
- Task Engine;
- recuperação segura de tarefas;
- agentes e playbooks;
- pipeline;
- Home;
- processos;
- prazos;
- documentos;
- recepção unificada;
- WhatsApp/Evolution;
- Telegram;
- histórico por canal;
- contexto processual;
- Datajud;
- PJe;
- DJEN;
- deadline truth/freshness;
- autorização humana;
- infraestrutura existente.

Antes de criar qualquer módulo paralelo, procurar a implementação existente.

Não criar “coordenador 2”, nova recepção, novo WhatsApp, novo Telegram ou outra casca para contornar defeito no código atual.

## 3. PENTE-FINO DO GITHUB

Auditar a main atual linha funcional por linha funcional e examinar todos os PRs abertos contra a base atual.

Para cada PR:

- identificar o objetivo;
- verificar se a mudança já existe na main;
- identificar sobreposição;
- verificar regressões;
- aproveitar apenas o que continua válido;
- fechar/descartar PR obsoleto quando substituído;
- evitar carregar commits históricos não relacionados.

Não acumular vários PRs concorrentes para o mesmo problema.

Arquivos grandes, especialmente bot.js e index.html, devem receber edição cirúrgica. Não substituir o arquivo inteiro por causa de uma alteração pequena.

## 4. LISTA-MESTRA FUNCIONAL

Usar docs/LEX_LISTA_MESTRA.md como checklist obrigatório de 16 etapas:

1. Telegram — transporte/polling
2. Recepção unificada WhatsApp + Telegram
3. Histórico/resposta pelo canal correto
4. Task Engine — recuperação segura
5. Pipeline/Home/status
6. LEX vivo — linguagem natural realmente EXECUTA
7. WhatsApp ponta a ponta
8. Telegram ponta a ponta
9. Interface celular
10. Interface tablet/desktop
11. Processo/contexto correto
12. “Precisa de você”
13. Botões/ações reais
14. PJe autenticado + autorização + intimações/citações
15. Prazo oficial/auditável + Datajud/PJe/DJEN
16. Regressão completa + produção

Preservar estados já homologados e registrar evidência rastreável. Não inventar novo ✅.

As etapas 4, 5, 7 e 8 podem ser homologadas independentemente da conclusão da etapa 6.

## 5. ETAPA 6 — UM ÚNICO LEX

Web/App, WhatsApp e Telegram são três portas do mesmo LEX Core.

Fluxo esperado:

entrada
→ identidade
→ canal
→ contexto
→ intenção
→ pessoa/processo/documentos
→ Core
→ execução direta ou Task Engine/playbook
→ resultado
→ resposta pelo canal correto.

O operador não deve escolher IA ou setor e não deve decorar comandos.

Exemplos obrigatórios:

- “responda a Leidyanny”
- “analise esse processo”
- “faça a contestação”
- “veja o que precisa de mim”
- “mande isso no WhatsApp”
- “cadastre esse cliente”

Ambiguidade de pessoa ou processo: PERGUNTAR. Nunca escolher o primeiro resultado.

“Faça a contestação desse processo” só passa no aceite se resultar em ação real:

processo correto
→ Task Engine
→ playbook correto
→ produção
→ revisão humana.

Responder “vou preparar” sem criar/executar a tarefa é falha.

## 6. WHATSAPP E TELEGRAM

Os canais já existem.

NÃO:

- recriar Evolution;
- recriar instância;
- recriar Telegram;
- pedir token novamente;
- pedir QR novamente;
- trocar webhook sem evidência.

Somente pedir QR/token/credencial quando houver evidência objetiva de perda ou invalidade.

WhatsApp #7 só fecha com:

mensagem real
→ webhook
→ recepção
→ Core
→ execução/resposta
→ Evolution
→ entrega
→ histórico.

Telegram #8 exige prova equivalente.

## 7. INTERFACE

Auditar celular, tablet e desktop.

Nenhuma tela pode prometer função inexistente.

Eliminar:

- botão morto;
- atalho sem efeito;
- texto quebrado;
- encoding quebrado;
- seleção aleatória de processo;
- dados divergentes entre Home/Processos/Prazos;
- loading infinito;
- sucesso falso;
- fallback enganoso.

“Precisa de você” deve mostrar:

QUEM
+ O QUÊ
+ POR QUÊ
+ QUAL AÇÃO
+ botão que leva/executa a ação correta.

## 8. ESTADO ATUAL DE SAAS

O LEX atual deve ser tratado como single-tenant até prova contrária.

Não declarar SaaS multi-tenant pronto.

A arquitetura comercial deve evoluir o sistema atual, sem criar um segundo produto.

Implementar:

- usuários individuais;
- escritório/tenant;
- associação usuário → escritório;
- escritorio_id nas entidades necessárias;
- autorização no servidor;
- isolamento no banco;
- RLS ou mecanismo equivalente comprovado;
- service role somente no backend.

Não confiar apenas em WHERE escritorio_id = ... .

O banco também precisa impedir acesso cruzado.

## 9. TESTE OBRIGATÓRIO DE ISOLAMENTO

Criar dois escritórios sintéticos:

ESCRITÓRIO A
ESCRITÓRIO B

Com usuários e dados distintos.

Provar que A não consegue:

- listar processo de B;
- buscar processo de B;
- abrir processo de B;
- alterar processo de B;
- exportar processo/documento de B;
- acessar tarefa de B;
- usar IA com documento de B;
- consultar histórico de B;
- acessar usuário de B;
- criar recepção em B;
- executar ferramenta contra B;

mesmo fornecendo manualmente IDs válidos pertencentes a B.

Executar também B contra A.

Qualquer acesso cruzado bloqueia a declaração de produto comercial.

## 10. MIGRAÇÃO DO ESCRITÓRIO ATUAL

O escritório atual deve virar o primeiro tenant.

Não perder:

- processos;
- documentos;
- tarefas;
- prazos;
- recepção;
- WhatsApp;
- Telegram;
- histórico;
- configurações;
- pipeline.

Antes de migração estrutural: backup + procedimento reversível.

## 11. CANAIS POR TENANT

Preparar arquitetura para configuração isolada por escritório:

- Evolution;
- WhatsApp;
- Telegram;
- IA/cota;
- PJe;
- demais credenciais externas.

Não misturar mensagens ou credenciais entre escritórios.

Não significa obrigatoriamente um Render por cliente. Significa isolamento lógico e operacional comprovado.

## 12. BILLING — ASSINATURA DO LEX

Billing é cobrança do escritório pela licença do software.

NUNCA misturar com:

- honorários advocatícios;
- cliente do processo;
- cobrança judicial;
- valores do processo.

Um domínio não pode alterar o outro.

O primeiro adapter preparado é Asaas.

Arquitetura desejada:

billing provider
→ adapter Asaas
→ webhook
→ licença do escritorio_id
→ política de acesso.

Não espalhar lógica específica do Asaas pelo LEX.

## 13. ESTADO DO ADAPTER ASAAS

Existe implementação preparada/local descrita com:

- lib/billing-asaas.js
- lib/billing-routes.js
- test/billing-asaas.test.js
- test/billing-routes.test.js
- alteração em config/lex.env.example

Variáveis:

- ASAAS_ENV
- ASAAS_API_KEY
- ASAAS_WEBHOOK_TOKEN

Rotas preparadas:

- POST /api/billing/asaas
- POST /api/webhook-asaas

Autenticação:

header asaas-access-token comparado com ASAAS_WEBHOOK_TOKEN.

Sem token configurado: 503.
Token inválido: 401.
Método inadequado: 405.

Antes de assumir que esses arquivos estão integrados à main, verificar o estado real do repositório e reaplicar apenas o que ainda for necessário.

## 14. EVENTOS ASAAS

Eventos previstos:

- PAYMENT_RECEIVED
- PAYMENT_CONFIRMED
- PAYMENT_ANTICIPATED
- PAYMENT_OVERDUE
- PAYMENT_REFUNDED
- PAYMENT_DELETED
- SUBSCRIPTION_UPDATED
- SUBSCRIPTION_INACTIVATED
- SUBSCRIPTION_DELETED

externalReference deve identificar escritorio_id.

Evento sem tenant válido não pode criar ou escolher escritório arbitrariamente.

Evento de A nunca altera B.

## 15. BILLING NÃO ESTÁ HOMOLOGADO

Não considerar o billing pronto apenas porque testes unitários passaram.

Antes de produção, implementar/verificar:

- idempotência persistente no banco;
- event.id persistido;
- proteção contra eventos fora de ordem;
- reconciliação com API do provedor quando estado for ambíguo;
- vínculo customer/subscription/payment ↔ escritorio_id;
- teste de webhook duplicado;
- webhook falsificado;
- replay após restart;
- pagamento A não altera B;
- cancelamento A não afeta B;
- observabilidade sem segredo;
- sandbox real;
- webhook real;
- homologação.

## 16. POLÍTICA DE LICENÇA

Estados mínimos:

- trialing
- active
- past_due
- suspended
- canceled

Não apagar autos, documentos ou histórico por inadimplência.

Não destruir dados quando assinatura for cancelada.

Implementar política explícita de:

- tolerância;
- bloqueio de nova IA;
- bloqueio de ações que geram custo;
- escrita;
- leitura;
- exportação;
- reativação;
- retenção.

Não bloquear abruptamente atividade jurídica crítica apenas porque um webhook de cobrança chegou.

Estado comercial deve ser reconciliável e auditável.

## 17. NÃO LIGAR BILLING PREMATURAMENTE

Se escritorio_id/identidade/RLS ainda não estiverem implementados de verdade:

NÃO ligar gate de cobrança no Task Engine, IA, WhatsApp ou produção.

Pode preservar módulos e testes preparados.

Depois do tenant real:

webhook
→ escritório correto
→ licença persistente
→ policy/gate central
→ Core/Task Engine/IA/canais.

Não espalhar if(status...) por dezenas de arquivos.

Criar política central de licença.

## 18. PJe / DATAJUD / DJEN

Não simular integração.

Guardar:

- fonte;
- timestamp;
- evidência;
- frescor;
- resultado;
- erro.

Prazo jurídico não pode nascer de alucinação da IA.

PJe precisa distinguir consulta ≠ protocolo.

Protocolo exige autorização humana quando aplicável e recibo/evidência oficial.

Testar:

- sessão válida;
- sessão expirada;
- indisponibilidade;
- timeout;
- resultado ambíguo;
- reconciliação.

## 19. DOCUMENTOS

Documento jurídico deve possuir:

- tenant/escritório;
- processo;
- versão;
- hash;
- MIME;
- origem;
- timestamps;
- armazenamento durável.

Nunca apagar a única cópia.

Testar:

- upload interrompido;
- arquivo inválido;
- hash divergente;
- recuperação;
- backup;
- restore.

## 20. SEGURANÇA E DADOS NO GIT

Auditar repo e histórico.

Distinguir “contexto jurídico escrito no código” de “dado pessoal/segredo realmente exposto”.

Localizar concretamente:

arquivo
+ linha/commit
+ natureza do dado
+ impacto.

Se houver credencial exposta:

remover da versão atual
+ rotacionar
+ avaliar histórico.

Não afirmar vazamento sem evidência.

Não deixar dados específicos do escritório incorporados ao produto comercial compartilhado.

## 21. OPERAÇÃO COMERCIAL

Antes de declarar pronto para vender, validar:

- autenticação;
- autorização;
- multi-tenancy;
- RLS;
- documentos;
- backup;
- restore;
- migração;
- rollback;
- observabilidade;
- tratamento de erro;
- limites de upload;
- concorrência;
- rate limit;
- sessões;
- revogação;
- onboarding;
- configuração por escritório;
- cota/orçamento de IA;
- recuperação após restart.

## 22. PRs

Não criar tempestade de PRs.

Preferir um trilho de integração coerente.

Antes de abrir PR: verificar se já existe PR da mesma mudança.

Antes de merge:

CI verde
+ CodeRabbit resolvido
+ diff revisado
+ sem regressão conhecida.

Depois:

merge
→ deploy
→ homologação.

Só então encerrar a pendência correspondente.

## 23. QUANDO PARAR PARA O TITULAR

Não interromper por decisão técnica que possa ser resolvida examinando código, testes, banco ou infraestrutura.

Interromper somente se precisar necessariamente de:

- login humano;
- 2FA;
- QR realmente necessário;
- credencial inexistente;
- autorização para gasto/plano pago;
- autorização para ação externa sensível;
- homologação física impossível de realizar sozinho.

Nesse caso: pedir UMA ação objetiva. Depois continuar.

## 24. CRITÉRIO FINAL

LEX só pode ser declarado PRONTO quando:

- lista-mestra funcional concluída;
- Core executa ordens naturais;
- Task Engine recupera com segurança;
- WhatsApp E2E homologado;
- Telegram E2E homologado;
- interface celular/tablet/desktop homologada;
- processo/contexto seguro;
- botões reais;
- PJe/Datajud/DJEN no nível prometido;
- prazos auditáveis;
- produção no commit correto;
- regressão completa verde;
- usuários individuais;
- multi-tenancy comprovado;
- teste A/B sem vazamento;
- billing isolado por tenant, se habilitado comercialmente;
- documentos/versionamento seguros;
- backup/restore testados;
- rollback testado;
- onboarding operacional;
- nenhum defeito conhecido capaz de causar acesso cruzado, perda silenciosa de documento/prazo ou ação externa não autorizada.

## ORDEM FINAL

Não entregue outro relatório dizendo o que falta.

Use este documento como contrato de execução.

Examine o estado real, reaproveite o que já existe, corrija o que falta, teste, integre, implante e homologue.

Não reconstrua o LEX.

Não pare entre etapas sem bloqueio humano real.

**MISSÃO FINAL: ENTREGUE O LEX JURÍDICO FUNCIONAL E COMERCIAL.**
