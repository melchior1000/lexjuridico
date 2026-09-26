# Multi-escritório em produção — roteiro de migração e homologação

Este roteiro leva a instalação atual (single-tenant, REST com `service_role`) ao modo
comercial (um processo por escritório, banco compartilhado com RLS, role `lex_runtime`),
**sem perder nada** e com volta garantida em cada passo. Só depois do passo 6 aprovado o
LEX pode ser declarado comercial (AGENTS.md §8–§10, §24).

Quem executa: o titular, com acesso de administrador ao Supabase e ao Render. Tempo
estimado: 1 h de trabalho + janela de indisponibilidade de ~10 min no passo 4.

## 0. Pré-requisitos

- Branches mescladas na `main`: `fix/auditoria-20260925` → `feat/lex-executa-ui` → `feat/lex-vivo`.
- `npm test` verde na `main` (inclui `tenant-migrations-pglite` e `homologar-isolamento`).
- Acesso: Supabase (SQL Editor + senha do banco), Render (variáveis do serviço).
- Um horário de baixo uso (noite/fim de semana) para o passo 4.

## 1. Backup (obrigatório, antes de qualquer SQL)

No Supabase: **Database → Backups → Create backup** (ou `pg_dump`):

```sh
pg_dump "$LEX_ADMIN_DATABASE_URL" --format=custom --no-owner --file=lex-pre-tenancy-$(date +%Y%m%d-%H%M).dump
```

Guarde o arquivo fora do servidor. Anote as contagens de referência (vão no dossiê):

```sql
select 'processos_cache' t, count(*) from public.processos_cache
union all select 'configuracoes', count(*) from public.configuracoes
union all select 'whatsapp_recepcao_eventos', count(*) from public.whatsapp_recepcao_eventos
union all select 'djen_comunicacoes', count(*) from public.djen_comunicacoes
union all select 'documentos_processo', count(*) from public.documentos_processo;
```

**Rollback deste passo:** não há mudança ainda.

## 2. Aplicar as migrações (idempotentes, na ordem)

No SQL Editor, como administrador, rode os arquivos de `supabase/migrations/` na ordem
alfabética (os já aplicados não fazem nada — são idempotentes):

1. `20260921031314_backup_pre_tenancy_20260921.sql`
2. `20260921031543_add_tenant_identity_and_backfill_current_office.sql` — cria `escritorios`, o
   **primeiro escritório** (o atual) e preenche `escritorio_id` em tudo que já existe.
3. `20260921031730_add_transitional_tenant_unique_constraints.sql`
4. `20260921033243_add_lex_backend_rls_muralha.sql` — RLS forçada em todas as tabelas isoladas.
5. `20260921034118_add_lex_runtime_role.sql` — role `lex_runtime` (sem BYPASSRLS).
6. `20260921034444_tenantize_legacy_config.sql`
7. `20260924120000_tenantize_remaining_tables.sql`

Depois, confira que nada se perdeu (mesmas contagens do passo 1, agora com `escritorio_id`):

```sql
select id, nome, slug, status from public.escritorios;               -- deve haver 1 linha: o escritório atual
select count(*) from public.processos_cache where escritorio_id is null; -- deve ser 0
```

Anote o `id` do escritório atual: é o `LEX_ESCRITORIO_ID`.

**Rollback deste passo:** restaurar o backup do passo 1 (`pg_restore --clean`). A instalação
atual continua funcionando **sem** mudar nada no Render enquanto o passo 4 não for feito —
o modo REST ignora a RLS e o `escritorio_id` preenchido não atrapalha.

## 3. Senha da role `lex_runtime` e string de conexão

```sql
alter role lex_runtime with login password '<senha-forte-gerada>';
```

Monte a string (pooler do Supabase, modo sessão ou transação):

```
postgres://lex_runtime:<senha>@<host-do-pooler>:<porta>/postgres?sslmode=require
```

Teste a conexão e a trava de RLS com o script de homologação **antes** de tocar no Render
(passo 6 pode ser feito aqui, como prévia — ele não altera dados do escritório).

## 4. Ligar o modo comercial na instalação atual (janela de ~10 min)

No Render, no serviço do LEX, adicione/ajuste:

```
LEX_COMERCIAL=1
LEX_ESCRITORIO_ID=<id do passo 2>
LEX_TENANCY_REQUIRED=1
LEX_TENANCY_V2=1
LEX_DB_MODE=postgres
LEX_DATABASE_URL=<string do passo 3>
AUTH_SECRET=<valor fixo, gerado uma vez>   # sem ele cada restart derruba as sessões
```

Mantenha `SUPABASE_URL`/`SUPABASE_KEY` por enquanto (leitura de storage/legado); a escrita
de trabalho passa a ir pelo Postgres com RLS. Faça o deploy e acompanhe o log de boot: o
`tenant-guard` recusa subir se faltar qualquer variável — isso é o esperado, não erro.

Homologação funcional imediata (10 min): login → Conversa → "como estamos hoje?" → abrir um
processo → Prazos → Recibos → mandar "bom dia" pelo WhatsApp do titular. Tudo deve responder
com os dados de sempre.

**Rollback deste passo:** remover as variáveis acima (ou `LEX_COMERCIAL=0`) e fazer deploy —
volta ao modo REST em 2 min. O banco não precisa ser restaurado.

## 5. Cadastrar o segundo escritório

```sh
node scripts/provision-office.js --nome "Escritório Cliente" --slug cliente --oab 123456:MG
```

O script imprime o SQL (rodar como administrador) e o `.env` da **instalação dedicada** desse
escritório (um serviço Render por escritório, com Evolution/Telegram/PJe próprios). O SQL chama
`ativar_multi_escritorio()`, que remove o "padrão primeiro escritório" e as chaves únicas
globais — a partir daí o banco é multi-escritório de verdade.

## 6. Homologação A/B no banco real (o gate comercial)

```sh
LEX_DATABASE_URL="postgres://lex_runtime:...@.../postgres?sslmode=require" \
LEX_ADMIN_DATABASE_URL="postgres://postgres:...@.../postgres?sslmode=require" \
node scripts/homologar-isolamento.js --json docs/evidencias/homologacao-ab-$(date +%Y%m%d).json
```

O script cria dois escritórios sintéticos, tenta em **todas** as tabelas isoladas: B ler A,
alterar A, apagar A, gravar em nome de A, mover linha própria para A (e a sessão sem escritório
ver qualquer coisa), pela role do runtime, e remove os dados sintéticos no fim. Saída:

- `HOMOLOGAÇÃO A/B: APROVADA` + JSON com a evidência por tabela → **pode vender**.
- `REPROVADA` → o JSON diz a tabela e o ataque que passou; **não** ligue o segundo escritório
  nem o gate de licença. Corrija a migração/política e repita.

Guarde o JSON em `docs/evidencias/` (é o rastro exigido pelo AGENTS.md §1A e §9).

## 7. Depois da homologação

- Ligar o gate de licença apenas agora: `LEX_LICENSE_GATE=1` (política em
  `lib/license-policy.js`; cobrança Mercado Pago em `lib/billing-mercadopago.js`).
- Canais por escritório: cada instalação com sua Evolution, seu bot Telegram, suas OABs e seu
  PJe (`config/lex.env.example`). Nunca compartilhar credenciais entre instalações.
- Datajud: `DATAJUD_API_KEY` em cada instalação (sem ela o Recibo do dia avisa que a
  carteira não foi atualizada).

## Checklist de evidência (colar no dossiê)

- [ ] Arquivo de backup + contagens do passo 1
- [ ] Saída das migrações + contagens do passo 2 (iguais às do passo 1)
- [ ] Log de boot do Render com `LEX_COMERCIAL=1` aceito pelo tenant-guard
- [ ] Homologação funcional do passo 4 (o que foi testado, hora, resultado)
- [ ] SQL do `provision-office.js` aplicado (passo 5)
- [ ] JSON da homologação A/B aprovada (passo 6)
