# LEX comercial — cada escritório na sua

## Arquitetura: um processo por escritório, um banco com muralha

- **Processo (instalação) dedicado por escritório.** O bot mantém processos, memória de conversa e fila de mensagens em memória do processo. Um processo nunca atende dois escritórios: o escritório é fixado na inicialização (`LEX_ESCRITORIO_ID`) e não muda.
- **Banco compartilhado com RLS.** Toda tabela de trabalho tem `escritorio_id`, RLS forçada e política `escritorio_id = lex.escritorio_id` da sessão. O runtime conecta com a role `lex_runtime`, que não tem BYPASSRLS.
- **Credenciais e canais próprios:** instância Evolution/WhatsApp, bot do Telegram, PJe (MNI), OABs do DJEN e chaves de integridade são por instalação e nunca se repetem.

## Três camadas contra mistura

| Camada | O que impede | Onde |
|---|---|---|
| Código | Tabela sem isolamento é recusada antes de ir ao banco; `escritorio_id` injetado e divergente rejeitado | `lib/supabase.js`, `lib/postgres-tenant.js` |
| Banco | Mesmo com bug no código, B não lê, altera, apaga nem grava em nome de A; `escritorio_id` imutável | migrações `20260921033243`, `20260924120000` |
| Inicialização | Modo comercial não liga sem escritório, sem `LEX_TENANCY_REQUIRED=1` ou em REST com service_role (que ignora RLS) | `lib/tenant-guard.js` |

## Provas automáticas (rodam em todo `npm test`)

- `test/tenant-migrations-pglite.test.js`: aplica **todas** as migrações num PostgreSQL real (PGlite) e ataca A↔B em **todas** as tabelas: leitura, alteração, exclusão, gravação em nome do outro e troca de escritório. Prova também que a ativação multi-escritório remove o padrão "primeiro escritório" e as chaves únicas globais (ex.: a mesma publicação do DJEN entra nos dois escritórios).
- `test/tenant-guard.test.js`: varre o código e **falha se alguém usar tabela nova sem isolamento**; testa a trava de inicialização e o cadastro.

## Cadastrar um escritório

```sh
node scripts/provision-office.js --nome "Silva Advogados" --slug silva --oab 123456:MG
```

O script imprime (1) o SQL para rodar como administrador (cria o escritório e ativa o modo multi-escritório, idempotente) e (2) a configuração da instalação dedicada, com segredos novos. Preencha os canais do escritório e suba a instalação.

## Antes de vender o segundo escritório (checklist)

1. Backup e aplicação da migração `20260924120000_tenantize_remaining_tables.sql` em produção.
2. Criar a senha da role `lex_runtime` e migrar a instalação atual para `LEX_DB_MODE=postgres` + `LEX_COMERCIAL=1`.
3. Rodar `provision-office.js` para o segundo escritório (executa `ativar_multi_escritorio()`).
4. Homologação real A/B com dados sintéticos nos dois escritórios (AGENTS.md §9), incluindo canais.
5. Arquivos locais (uploads, DOCX) ficam no disco da instalação; cada escritório tem o seu disco.
