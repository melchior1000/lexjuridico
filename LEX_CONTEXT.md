# LEX — CONTEXTO OPERACIONAL DO PROJETO

Atualizado em: 10/09/2026
Branch de auditoria: `audit/lex-context-20260910`
Base desta branch: `codex/lex-revisao-final-20260909` (PR #2)
Produção atual: Render acompanha `main` com auto-deploy por commit.

## 1. Objetivo deste arquivo

Este arquivo é a memória técnica curta do LEX. Ele deve permitir iniciar uma nova sessão de trabalho sem depender de conversas longas. Antes de alterar o sistema, leia este arquivo, confira o Git e valide o ambiente atual.

Regra principal: não registrar como concluído algo que apenas existe no código ou passou em teste isolado. Distinguir sempre: IMPLEMENTADO, TESTADO LOCALMENTE, HOMOLOGADO COM SERVIÇO REAL, EM PRODUÇÃO.

## 2. Estado atual confirmado

- Repositório: `melchior1000/lexjuridico`.
- Branch de produção: `main`.
- Commit conhecido em produção/main antes da revisão: `cd09982c4890c3bfbb78635b2b7b07f80e3f9353`, de 25/04/2026.
- Render: serviço `lex-juridico`, branch `main`, autoDeploy habilitado por commit, start `node bot.js`, build `yarn install`.
- Supabase: projeto `Lex Juridico pro`, ref `tpzedlqzzktvkwtkvqjp`, status ACTIVE_HEALTHY.
- PR #2: branch `codex/lex-revisao-final-20260909`, ainda em draft, com 134/134 testes locais reportados. Não considerar isso equivalente a homologação real.

## 3. Tamanho e concentração do código

Na base auditada em 07/09/2026:

- `index.html`: ~13.844 linhas — interface, sessão, processos e sincronização.
- `bot.js`: ~14.293 linhas — servidor HTTP, API, integrações, documentos, timers e agentes.
- `lex_agente_vivo.js`: ~1.721 linhas — agente vivo delegado pelo servidor.

Esses três arquivos somavam ~29.858 linhas. O risco principal é acoplamento excessivo: frontend, backend, integrações e regras de negócio estão concentrados em poucos arquivos grandes.

## 4. Arquitetura observada

### Interface
- `index.html`
- `lex-whatsapp.html`
- `office-ui.js`
- `office-ui.css`

Risco: estado local do navegador pode divergir do servidor se o backend falhar ou responder sucesso sem persistência confirmada.

### Backend
- `bot.js`
- HTTP nativo, rotas e timers no mesmo processo.

Risco: reinício afeta sessões, filas em memória e rotinas periódicas. O backend precisa migrar gradualmente para módulos menores sem reescrever o sistema do zero.

### Agentes e workflow
- `lex_agente_vivo.js`
- `lib/task-engine.js`
- `lib/workflow.js`
- `lib/ai-runtime.js`
- `lib/legal-quality.js`
- `lib/judicial-profile.js`

Critério para considerar um agente funcional: receber ordem, validar permissões, executar, persistir estado/resultado, devolver erro real em falha e permitir auditoria da execução.

### Persistência / Supabase
- `lib/supabase.js`
- `lib/process-persistence.js`
- `lib/process-store.js`
- `lib/record-store.js`

Objetivo arquitetural: Supabase/PostgreSQL deve ser fonte durável de verdade para processos, tarefas, permissões e histórico. Cache/memória não pode confirmar sucesso antes do banco.

### Notificações
- `lib/notification-digest.js`
- timers e rotinas legadas em `bot.js`.

Prioridade crítica: impedir laços de alerta, duplicação após reinício e qualquer baixa automática sem identificação e confirmação explícitas.

### PJe
- `lib/pje-sync.js`
- `lib/connector.js`
- `conector-navegador/`

Separar claramente:
1. consulta pública/DataJud;
2. captura autenticada assistida no navegador/computador do advogado;
3. qualquer automação futura autenticada.
Nunca apresentar captura assistida como integração PJe integral.

### Canais
- Telegram em backend legado/revisado.
- WhatsApp via Evolution e `lex-whatsapp.html`.
- SMTP para e-mail.

Critério: só registrar envio como concluído após confirmação real do provedor.

### Documentos e perícia
- geração DOCX/PDF no backend e bibliotecas auxiliares.
- perícia exige cálculo determinístico quando aplicável, revisão e aprovação humana antes de entrega externa.

## 5. Problemas já confirmados na auditoria anterior

- Produção continuava em código de abril apesar das revisões recentes.
- Havia fluxos que alteravam memória/cache antes de confirmar gravação durável.
- Havia risco de sucesso falso em persistência e envio em caminhos legados.
- Alertas em massa/reagendamento repetido eram problema operacional prioritário.
- Existem partes ainda não homologadas com serviços reais: Supabase como fonte única, isolamento por escritório, PJe autenticado, Central de Prazos, WhatsApp, Telegram, IA e backup/restauração.
- O repositório é público; dados/contexto específico de escritório não devem ficar incorporados ao código do produto.

## 6. Ordem obrigatória de auditoria e estabilização

1. Persistência real e autenticação.
2. Alertas/notificações e timers.
3. Agentes: inventário e teste individual por função.
4. Fluxo processual ponta a ponta: cadastro -> triagem -> documentos -> petição -> revisão -> encaminhamento/distribuição -> acompanhamento.
5. Telegram e WhatsApp.
6. PJe/DataJud/conector local.
7. Perícia e geração de documentos.
8. Segurança, RLS, logs, backup e recuperação.
9. Refatoração estrutural progressiva.

Não adicionar novas funcionalidades importantes antes de estabilizar os itens 1 a 4.

## 7. Regra de deploy

A `main` está ligada ao Render com auto-deploy. Portanto:

- não editar `main` para experimentar;
- trabalhar em branch;
- testar;
- revisar diff;
- homologar integrações reais quando necessário;
- somente então fazer merge na `main`.

Um commit na `main` pode virar produção automaticamente.

## 8. Critérios de evidência

Para cada módulo usar estes estados:

- `NÃO REVISADO`
- `IMPLEMENTADO`
- `TESTE LOCAL PASSOU`
- `HOMOLOGADO COM SERVIÇO REAL`
- `EM PRODUÇÃO`
- `FALHOU / BLOQUEADO`

Nenhum teste com mock substitui homologação de banco, canal, PJe ou provedor real.

## 9. Próxima missão

Auditar o PR #2 contra a `main` por blocos, começando por persistência e notificações. Para cada bloco:

1. localizar caminhos e rotas envolvidos;
2. identificar código legado ainda ativo;
3. verificar se existe dupla fonte de verdade memória/banco;
4. confirmar tratamento de falha;
5. mapear testes existentes;
6. marcar o estado real no checklist;
7. só depois corrigir código.

## 10. Regra para novas sessões

Prompt curto recomendado:

`Leia LEX_CONTEXT.md, confira o estado atual do Git e continue pela próxima missão pendente. Não presuma que algo funciona sem evidência. Não altere main diretamente.`
