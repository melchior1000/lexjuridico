# LEX — Repasse para o GPT/Codex (interface + comercial)

Data: 23/09/2026. Leia também `AGENTS.md` (regras do projeto) e `AUDITORIA.md`.

## 1. Como aplicar este pacote no GitHub

Use o terminal na pasta do seu repositório `lexjuridico` (a cópia ligada ao GitHub).

```bash
# 1) Atualizar a cópia local e criar um ramo só para esta entrega
git checkout main
git pull origin main
git checkout -b correcao-interface-comercial

# 2) Aplicar o pacote de mudanças (arquivo .patch que veio junto)
git am docs/0001-lex-correcao-interface-comercial.patch
#    Se o "git am" reclamar de conflito:
#    git am --abort
#    git apply --3way docs/0001-lex-correcao-interface-comercial.patch
#    (resolver os arquivos marcados, depois:)
#    git add -A && git commit -m "LEX: correção de interface, marca branca e segurança"

# 3) Instalar dependências EXATAS e conferir tudo antes de subir
npm ci
npm run check        # sintaxe + lint (esperado: 0 erros, 0 avisos)
npm test             # esperado: 611 testes, 611 passando, 0 falhas

# 4) Enviar para o GitHub e abrir o pedido de revisão (Pull Request)
git push -u origin correcao-interface-comercial
# No GitHub: "Compare & pull request" → base: main → Create pull request.
# Só junte (merge) depois que o CI (.github/workflows/ci.yml) ficar verde.
```

Alternativa sem o .patch: descompacte o ZIP por cima da cópia local (sem apagar `.git`),
depois `git add -A && git commit -m "LEX: correção de interface, marca branca e segurança"`
e siga do passo 3.

Depois do merge, configure no Render (backend) as variáveis novas — ver seção 5.
O Vercel publica a interface sozinho a partir da `main`.

## 2. O que já foi feito (não refazer)

### Interface
- **Roteador único** (`lex-nav.js`, carregado por último em `office-ui.js`).
  Antes, `ir()` era embrulhada por 3 camadas (office-ui-v2, lex2-interface-core,
  office-command-ui) instaladas em 0/120/250/1000 ms: a tela aberta dependia de
  corrida, título e item ativo do menu falhavam, rota desconhecida deixava tela
  branca. Agora: uma tabela de rotas, um roteador, bandeiras que impedem as
  camadas antigas de reembrulhar.
- Endereço por tela (`#/processos`), botão voltar do navegador funciona, link
  salvo reabre a tela após o login.
- Tela "não encontrada" e "acesso restrito" no lugar de página branca.
  Erro dentro de uma tela vira mensagem, sem travar a navegação.
- **Menu reorganizado por tarefa**: Dia a dia (Início, Tarefas, Recepção,
  Processos, Prazos) · Produção jurídica (Peças, Perícia, Jurisprudência,
  Padrão decisório) · "Mais telas" recolhido (Autuação, Processos
  administrativos, Em preparação, Calendário, Contatos, Histórico de mensagens,
  Estatísticas) · Configuração só para administrador.
  Removidos do menu os itens duplicados ("Hoje/Trabalho" x "Painel Geral",
  "Central de agentes" que abria o mesmo que "Meu escritório", Perícia perdida em
  "Canais"). Nenhuma tela foi apagada: nomes antigos continuam funcionando
  (`agentes` → `escritorio`).
- Bug do **modal da planilha de dívida**: havia duas funções de fechar; a segunda
  usava `display:none` e o modal não reabria sem recarregar. Unificada.
- **34 pontos de HTML** montavam nome/partes/tribunal do processo sem escapar
  (dados vindos de WhatsApp/PJe) — agora passam por `lexEscape`.

### Segurança (backend)
Senhas com hash scrypt; limite de login pelo IP real do proxy; negação por padrão
em `/api/*`; logout encerra SSE; 413/400 para corpo grande/JSON inválido.

### Marca branca
Sem nome de escritório/titular no código; trava `test/white-label-guard.test.js`.

## 3. Regras para quem continuar (obrigatórias)

1. Não reescrever a interface do zero nem criar "segunda casca". Consertar o que existe.
2. **Nova tela = uma linha na tabela `ROTAS` de `lex-nav.js` + um botão com
   `data-route` no `<nav>` do `index.html`.** O teste `test/lex-nav.test.js` falha se
   faltar um dos dois.
3. Nunca mais embrulhar `window.ir`. Se uma camada precisa trocar a tela de uma rota,
   troque a função `tela` da rota em `lex-nav.js`.
4. Todo dado vindo de fora (processo, cliente, mensagem) entra em HTML via `lexEscape`.
5. Nenhum nome de escritório/pessoa/cidade real em código de produção.
6. Toda mudança: `npm run check` e `npm test` verdes antes do commit. Não afirmar
   "concluído" sem rodar; relatar números reais.

## 4. Tarefas pendentes (em ordem) com critério de aceite

| # | Tarefa | Aceite |
|---|--------|--------|
| 1 | **Conferência visual no navegador** (não foi feita: o ambiente desta entrega não tinha navegador). Abrir cada item do menu em computador e celular, como admin e como secretária. | Nenhuma tela branca; item ativo certo; menu fecha no celular; secretária não vê Configuração. Anotar problemas com print. |
| 2 | Retirar as camadas de roteamento que ficaram sem efeito (`hook` em office-ui-v2, `patch` em lex2-interface-core, `hardenNavigation` em office-command-ui) **depois** do item 1 aprovado. | Testes verdes; `grep "window.ir="` só em `lex-nav.js`. |
| 3 | Revisar os demais `innerHTML` com dados externos além de `p.nome/partes/tribunal` (ex.: mensagens, andamentos). | Teste que injeta `<img onerror>` em cada campo e não executa. |
| 4 | Cobrança Asaas + regra de licença (período de teste, ativo, atrasado, suspenso, cancelado). **Desligada por padrão** (`LEX_BILLING_ENFORCE=0`). | Webhook com token inválido → 401; evento repetido não duplica; escritório errado → recusa. |
| 5 | **Teste A/B de isolamento em banco real** (Supabase de homologação, dois escritórios sintéticos). É o bloqueio para vender. | Escritório A não lê, não altera e não lista nada do B em nenhuma rota. |

## 5. Variáveis de ambiente novas (Render)

```
ESCRITORIO_NOME=            # ex.: LEX Jurídico
ESCRITORIO_RESP=            # nome do titular
ESCRITORIO_REG=             # OAB/UF nº
ESCRITORIO_END=             # cidade/UF
LEX_TITULAR_TRATAMENTO=Dr.
LEX_OPERADOR_LABEL=         # como os agentes chamam o operador
LEX_ASSISTENTE_NOME=LEX
LEX_TRUSTED_PROXY_HOPS=1    # Render = 1
```

## 6. Estado verificado desta entrega

- `npm run check`: sintaxe em 187 arquivos; lint 0 erros, 0 avisos.
- `npm test`: 611 testes, 611 passando (após `npm ci`).
- **Não verificado**: aparência no navegador (tarefa 1) e isolamento em banco real (tarefa 5).
