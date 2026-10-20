# ECC — implantação gradual (piloto 01)

Projeto: **LEX Jurídico**. Origem: [affaan-m/ECC](https://github.com/affaan-m/ECC), agente `silent-failure-hunter`, licença MIT em `.claude/ECC_UPSTREAM_LICENSE.txt`.

## O que foi realmente instalado
- **Uma configuração de subagente de Claude Code**, `.claude/agents/ecc-silent-failure-hunter.md`, adaptada para os riscos deste projeto.
- O agente é **somente leitura** e só atua quando chamado no ambiente de desenvolvimento. Não há hooks automáticos, execução contínua, modelo treinado, serviço em produção nem instalação global do pacote ECC.
- Não instalar o ECC completo por cima das 25 skills já existentes. Avaliar cada agente novo de forma isolada para evitar comandos e regras duplicados.
- O arquivo `AGENTS.md` continua sendo a autoridade local.

## Piloto: como executar
1. Abrir o repositório no Claude Code e solicitar uma auditoria com o subagente `ecc-silent-failure-hunter` no escopo de um PR ou módulo pequeno.
2. Entregar um caso com fallback silencioso conhecido e um caso normal (controle negativo). Exigir caminhos, linhas, gravidade, evidência e teste de regressão sugerido.
3. Conferir a existência das linhas citadas e rejeitar achados inventados. Não permitir alteração de arquivos pelo agente.
4. Executar o CI e a revisão normal de PR. Conferir se não houve mudança do produto ou de permissões.
5. Só marcar como **validado em execução** depois de observar e registrar a saída real do agente. A checagem estática no CI NÃO equivale a esse teste.

## Etapas e travas
| Etapa | Liberação | Critério de aceite |
|---|---|---|
| 01 — Falhas silenciosas | Piloto em PR | Frontmatter válida, ferramentas somente leitura, licença, CI verde e auditoria real sem achados inventados |
| 02 — Impacto de mudança | Depois da 01 | Análise verificável antes/depois de um diff real, sem tocar em produção |
| 03 — Testes de regressão | Depois da 02 | Teste capaz de falhar para defeito reproduzido e passar após correção |
| 04 — Segurança e lançamento | Depois da 03 | Revisão humana, testes completos e evidência do deploy e da homologação exigidos pelo projeto |

**Rollback do piloto:** remover somente `.claude/agents/ecc-silent-failure-hunter.md`, a checagem de CI e, se nenhuma outra cópia ECC permanecer, esta documentação e licença. Não tocar no código operacional.

**Regra de publicação:** PR aberto, verificação estática e CI verde, isoladamente, não comprovam que o agente foi executado nem que a produção está homologada.
