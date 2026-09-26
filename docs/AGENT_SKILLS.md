# Agent Skills no LEX Jurídico

Este repositório inclui uma seleção de workflows de engenharia do projeto público `addyosmani/agent-skills`, instalada em `.claude/skills/` para uso pelo Claude Code e agentes compatíveis.

## Regra de precedência

O `AGENTS.md` do LEX continua sendo a autoridade do produto. As skills orientam **como desenvolver, testar, revisar e publicar**; elas não alteram a arquitetura, a lista-mestra, as travas humanas, o modelo de tenant/RLS nem o critério de homologação do LEX.

Se uma skill genérica conflitar com uma regra específica do LEX, prevalece a regra do LEX.

## Skills instaladas

- `using-agent-skills`
- `incremental-implementation`
- `test-driven-development`
- `debugging-and-error-recovery`
- `code-review-and-quality`
- `security-and-hardening`
- `frontend-ui-engineering`
- `api-and-interface-design`
- `observability-and-instrumentation`
- `shipping-and-launch`
- `browser-testing-with-devtools`

## Fluxo esperado

Para mudanças relevantes: entender o problema → trabalhar em branch própria → implementar em fatias pequenas → teste de regressão → revisão de segurança/qualidade → validação de interface quando houver UI → merge → deploy → homologação real.

Código verde sem homologação não transforma item da lista-mestra em concluído.

## Origem e licença

Fonte: `addyosmani/agent-skills`.
Os arquivos copiados permanecem sob a licença MIT do projeto de origem. A cópia da licença está em `.claude/skills/UPSTREAM_LICENSE.txt`.
