# LEX — fronteiras de componentes web

## Estado atual

A interface comercial permanece em **light DOM**. O repositório não adota React, Lit, Custom Elements, Shadow DOM nem Declarative Shadow DOM como dependência arquitetural do produto atual.

O tema do login segue a cadeia simples:

`body.dia / body.lex-day -> custom properties --login-* -> classes do componente`

O markup do login não deve voltar a ter cores temáticas absolutas em `style=""`. Estilos inline ficam reservados a geometria/medidas quando ainda necessários.

## Cascade layers

`login-theme.css` usa cascade layers para separar tokens e componentes. Layers organizam a origem interna das regras, mas não substituem tokens e não são encapsulamento de árvore. A regra do projeto é evitar resolver tema por escalada de especificidade ou novos `!important`.

## Shadow DOM e Declarative Shadow DOM

Shadow DOM é uma fronteira de árvore e CSS. Declarative Shadow DOM é a forma declarativa dessa mesma fronteira, por exemplo com `<template shadowrootmode="open">`.

Não usar Shadow DOM como correção pontual no login atual. O código legado e comercial ainda consulta IDs e elementos do documento; mover apenas o markup para uma shadow tree trocaria dívida de CSS por dívida de seletores, eventos e integração.

Shadow DOM entra quando **um recurso inteiro** migrar com seu contrato de JavaScript, eventos e estilos. Candidatos futuros: `lex-login` e `lex-chat`.

Quando houver Shadow DOM:

- o host recebe os tokens por custom properties;
- o interior consome `var(--token)` e usa `font: inherit` nos controles;
- nenhuma cor temática absoluta é gravada via `style=""`;
- `::part` só é exposto quando houver necessidade real de customização externa;
- `mode: open` é preferível para depuração e integração; `closed` não é mecanismo de segurança.

## Web Components

Web Components é um conjunto de padrões, principalmente Custom Elements + Shadow DOM + templates/slots e APIs CSS relacionadas. Um Custom Element deve possuir API e ciclo de vida próprios; não criar elementos customizados apenas para trocar uma `div` por uma tag com hífen.

Customized built-ins (`extends HTMLButtonElement`, `is="..."`) não fazem parte do caminho do LEX. Se houver migração, usar Autonomous Custom Elements (`<lex-chat>`, `<lex-login>`).

## Lit

Lit é uma camada sobre os padrões web, não pré-requisito para Web Components. Não adicionar Lit ao monólito apenas para reescrever telas estáveis.

Critério para adoção: um componente autônomo com estado/renderização suficientemente complexo para justificar template reativo e ciclo de atualização próprio.

Se o chat migrar para Lit:

- mensagens devem usar `repeat(mensagens, m => m.id, ...)` com chave estável;
- o campo de entrada fica fora do `repeat`;
- `classMap` pode expressar estado visual;
- `styleMap` não deve receber cores temáticas absolutas; tema continua nos tokens;
- trabalho assíncrono deve respeitar desconexão/cancelamento (`AsyncDirective` quando a lógica realmente pertencer a uma diretiva);
- `cache` só deve ser usado quando preservar uma subárvore for desejado e timers/listeners tiverem teardown correto.

## Regra de responsabilidade

- **Token** é dono da paleta.
- **Componente** é dono do markup e do estado local.
- **Diretiva** é um mecanismo pontual do template, não um componente.
- **Shadow root** é dono da fronteira de encapsulamento, quando houver uma fronteira real de produto.

Essa separação evita recriar no futuro a mesma dívida que existia no login legado.