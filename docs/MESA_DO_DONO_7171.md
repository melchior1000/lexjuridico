# Mesa do dono — 7171

A mesa do dono é uma camada de conveniência sobre os comandos privados já existentes. Ela não cria CRM paralelo, não altera a autoridade jurídica do LEX e não mistura históricos entre contatos.

## Gatilhos naturais

No número privado configurado em `LEX_OPERATOR_WHATSAPP`, o dono pode escrever:

- `oi`, `mesa`, `resumo` ou `recepção` → lista até 10 contatos aguardando retorno;
- `histórico NUMERO` → mostra somente o histórico daquele número;
- `responder NUMERO TEXTO` → envia o texto exatamente como escrito para aquele número;
- `resolver NUMERO` → arquiva somente aquele contato da fila.

Os comandos com `/` continuam válidos e são a fonte de verdade operacional.

## Isolamento

Fila e histórico são indexados por número de WhatsApp. Uma resposta para um número não usa nem inclui o histórico de outro contato.

## Autoridade

A mesa do dono não amplia a autonomia do LEX. Estratégia, processo, acordo, honorários, perícia conclusiva, promessa ou posição do escritório continuam sujeitos à autorização do advogado. `resolver NUMERO` apenas retira o contato da fila; não autoriza o LEX a formular orientação jurídica em nome do escritório.
