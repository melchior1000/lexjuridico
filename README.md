# LEX

Sistema legado de gestão jurídica em evolução. Este checkout contém a versão
completa recebida e correções isoladas em branch. Não é uma release comercial.

Verificação mais recente: [resultados e pendências de 08/09/2026](docs/VERIFICACAO_20260908.md).
93 testes locais passam. O deploy de produção ainda está na base de abril.

## Verificar localmente

Node.js 20 ou superior; instalar dependências pelo lockfile:

```sh
npm ci --ignore-scripts
npm run check
npm test
```

Os testes isolam chamadas externas; não iniciam o servidor completo. O teste de
email monta a mensagem localmente e não envia SMTP. Não há teste ponta a ponta,
PJe, WhatsApp ou banco real nesta suíte.

## Executar em homologação

Configurar variáveis do servidor a partir de `config/lex.env.example` em um
ambiente separado, com schema revisado e credenciais de teste. O Node não carrega
esse arquivo automaticamente: use o gerenciador de ambiente da hospedagem.
`npm start` inicia também integrações e tarefas periódicas; não apontar para
serviços de produção durante testes. Não versionar credenciais.

A configuração fornecida é parcial e não substitui a implantação do schema.
As tabelas reais ainda precisam de inventário antes de uma instalação reproduzível.

- [Auditoria e correções](AUDITORIA.md)
- [Arquitetura e armazenamento híbrido](docs/ARQUITETURA_E_ARMAZENAMENTO.md)
- [Especificações, tickets e gate comercial](docs/ESPECIFICACOES_E_BACKLOG.md)
- [Preparação de WhatsApp, Telegram e agentes](docs/CANAIS_E_AGENTES.md)
