# LEX — rastreio reverso por blocos — 14/09/2026

Base auditada inicialmente: `85cf21d0c44dd535da7e8441088a629046b8b702`.

## Método

O inventário recursivo considera fontes de execução `.js`, `.html` e `.css`, excluindo `docs`, `test`, dependências e artefatos. O comando permanente é:

```bash
npm run audit:reverse
```

Tamanho padrão: **1.000 linhas por bloco** (`LEX_AUDIT_BLOCK` permite alterar). O primeiro inventário completo encontrou **64 arquivos**, **33.859 linhas** e **91 blocos**.

A varredura automática cobre 100% dessas linhas procurando sinais de acoplamento/risco. A revisão semântica manual é registrada abaixo por bloco; não se declara um bloco “correto” apenas porque passou sintaxe/teste.

## Arquitetura confirmada

- Linguagem principal: **JavaScript**.
- **JSON** é formato de dados, não linguagem de programação do LEX.
- Runtime servidor: **Node.js**.
- Host legado/servidor: `bot.js`.
- Interface: HTML + CSS + JavaScript.
- Operação comercial: `office-ui*.js` + `office-flow-ui.js` + `office-command-ui.js` + `office-dossier-ui.js` + `reception-handoff-ui.js` + `office-attachment-ui.js`.
- Porta operacional: `lib/office-routes.js`.
- Estado/movimentação: `lib/office-pipeline.js` / `lib/workflow.js`.
- Trabalho jurídico: `lib/task-engine.js` + `lib/agent-playbooks.js`.
- Persistência: `lib/process-store.js` + `lib/record-store.js` sobre Supabase.
- Cérebro conversacional: `lex_agente_vivo.js` / `lex_agente_vivo_core.js`.

`bot.js` continua sendo o grande ponto de entrada do servidor, mas **não é mais sozinho o “módulo central” do produto comercial**.

## Estado da revisão profunda

### `bot.js` — 13.755 linhas

| Bloco | Estado | Achados principais |
|---|---|---|
| 1–1000 | revisado | inicialização, stores, canais, Datajud legado; identidade de operador fixa em fallback; duplicidade de dono Datajud |
| 1001–2000 | revisado | backup/config/preparação; sobreposição de recursos legados com office/TaskEngine |
| 2001–3000 | revisado | documentos/PJe/perícia legados convivendo com o motor novo |
| 3001–4000 | revisado | fluxo legado e identidade específica espalhada |
| 4001–5000 | revisado | **bug real:** `_salvarPerfilCliente` confirmava sucesso sem validar resposta do banco — corrigido na branch de auditoria |
| 5001–9000 | varredura automática | sinais catalogados; revisão semântica ainda pendente |
| 9001–10000 | revisado | auth/config/chat legado; identidade profissional fixa em prompts e textos; rotas paralelas |
| 10001–11000 | varredura + rotas-chave | coexistência `/api/gestor/chat` e `/api/vivo/*` |
| 11001–12000 | revisado | contatos/canais/PJe; rotas antigas podem afirmar sucesso sem confirmação de banco; algumas tabelas legadas não existem no banco atual |
| 12001–13000 | revisado | gestor legado, perícia antiga, arquivo morto, timers; duplicidade de responsabilidades |
| 13001–13755 | varredura automática | fechamento/boot e sinais Supabase catalogados |

### `lex_agente_vivo_core.js` — 1.568 linhas

| Bloco | Estado | Achados principais |
|---|---|---|
| 1–1000 | revisado | Gestor e prompts ainda carregam nome fixo e setores antigos `autuacao/administrativo/judicial`; precisa convergir com office pipeline |
| 1001–1568 | revisado | redator/juiz/juris existem; especializados não são a porta principal da Home; algumas tabelas opcionais não existem no Supabase atual |

### `index.html` — 13.657 linhas

Todos os 14 blocos foram inventariados automaticamente. Revisão semântica profunda continua em sequência; o risco principal já confirmado é o legado continuar coexistindo como host da casca comercial.

## Correções já originadas desta reversa

1. Recepção deixou de depender de nome profissional fixo: `ESCRITORIO_RESP` / `LEX_OPERATOR_NAME` passam a definir o responsável.
2. Fallback interno do operador deixou de devolver nome pessoal fixo.
3. `_salvarPerfilCliente` agora falha fechado quando o Supabase não confirma a escrita; não pode mais dizer que cadastrou se o banco recusou.
4. Testes de regressão foram adicionados para essas falhas.

## Banco verificado

Projeto Supabase de produção conectado e saudável. Tabelas centrais presentes incluem `processos_cache`, `configuracoes`, `processos_prep`, `whatsapp_recepcao_publica` e `whatsapp_recepcao_eventos`.

A reversa também encontrou rotas legadas que mencionam tabelas não presentes no banco atual, entre elas `contatos`, `whatsapp_sessoes`, `arquivo_morto_indice` e `tempo_uso`. Elas devem ser classificadas como **oficial / compatibilidade / desativar**, antes de qualquer criação de tabela. Não criar banco para código morto por reflexo.

## Próximos blocos

1. Fechar falsos sucessos das rotas que continuarem oficiais.
2. Revisar semanticamente `bot.js` 5001–9000 e 13001–13755.
3. Revisar `index.html` em blocos de 1.000 linhas, separando host necessário de funções legadas sem dono.
4. Convergir identidade e setores dos prompts vivos com a configuração comercial.
5. Produzir mapa final: **OFICIAL / COMPATIBILIDADE / DIAGNÓSTICO / DESATIVAR DEPOIS** para cada rota e subsistema.
