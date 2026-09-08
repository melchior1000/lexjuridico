# Interface, setores e cadastro PJe — 08/09/2026

## Escopo deste checkpoint

Referência: sete páginas do PDF da interface fornecido pelo titular. A marca escura azul/dourada foi preservada. O código não foi publicado em produção neste checkpoint.

- Central de agentes consulta o registro real do backend em GET /api/agentes/status, exclusivo do administrador. Não aceita mais token de bot em prompt nem anuncia ativação por uma preferência local.
- Setores dão acesso aos módulos existentes: autuação, jurídico, perícia, prazos, identificação e PJe. O registro de uma função não comprova operação da API.
- Chat móvel usa a largura disponível, campo de texto em linha própria e ações de tamanho utilizável. O relatório de varredura converte seus links em texto antes do renderizador do chat, corrigindo as tags exibidas no PDF. Sem homologação visual em aparelho nesta rodada.
- Conectar PJe exige resposta explícita de sessão confirmada. MFA, login manual e expiração permanecem pendências. Destino de credenciais restrito a HTTPS *.jus.br; campos de senha limpos ao terminar a tentativa. Não há instalador do conector local no repositório.
- POST /api/pje/andamento recebe movimento com sessão de administrador. Somente CNJ exato e único; preserva prazo e status; exige PATCH confirmado no banco antes de mudar cache; deduplica reenvios. Bloqueio concorrente na instância, sem transação distribuída.
- Datajud requer chave pública configurada, rejeita erro de API e ordena movimentos. Tribunal não mapeado não cai silenciosamente em TJSP. UI identifica consulta pública de processos já cadastrados, não importação do acervo autenticado. Datajud não fornece documentos privados nem substitui login PJe.
- Lex.consultar limita chamadas às ferramentas declaradas de um agente disponível.

## Objetivo e critérios de aceitação restantes

| Fluxo | Estado real | Evidência necessária |
|---|---|---|
| Cadastro de cliente por canais | Código existente, homologação pendente | Advogado autorizado cadastra cliente sintético, banco confirma ID, reenvio não duplica |
| LEX delega ao setor e devolve resultado | Funções existentes; coordenação completa e recuperação pendentes | Ordem vinculada a usuário/caso, ferramenta permitida, tarefa persistida, retomada após reinício |
| Conversa advogado/IA | Não validada ao vivo | Chave e saldo válidos; contexto do caso correto e resposta real |
| Petição e perícia em DOCX | Geração e confirmação de entrega testadas com mocks | Revisão do documento e recebimento real nos dois canais |
| WhatsApp / Telegram | Integrações existentes, sessão real pendente | Identidade da conta, webhook/polling, entrada autorizada, saída e anexo confirmados |
| Primeiro cadastro do advogado no tribunal | Não implementado; distinto de importar processos | Definir tribunal, seguir cadastro oficial e requisitos de identidade |
| Login PJe e segundo fator | Interface assistida; executor ausente | Conector autorizado por usuário, confirmação do titular no tribunal e prova da sessão |
| Importação do acervo PJe no LEX | Não implementada | Paginação, CNJ/instância, participantes, documentos, origem e gravação confirmada; conta sem acesso não importa |
| Documentos no PC/NAS e backup | Especificado, não implementado integralmente | Checksum, versionamento, restauração e exclusão apenas com cópia validada |
| Isolamento entre escritórios | Não homologado; cache global legado | Contas individuais, escopo de escritório em banco/fila/arquivos e testes cruzados |
| Atos no tribunal | Não automatizados neste checkpoint | Revisão e aprovação humana antes de ciência, assinatura e protocolo |

## Pendências concretas adicionais

O motor proativo ainda contém chamada a persistirProcesso fora de seu módulo e captura falhas. Outros caminhos de cache/configuração podem confirmar sem checar a resposta do banco. A sincronização local antiga ainda precisa migrar para a ingestão autenticada com confirmação de persistência. Deduplicação durável de entradas dos canais, fila por tarefa e recuperação após falha continuam necessárias. Não é uma versão comercial homologada.

## Validação

107 testes locais passaram, sem acesso aos processos reais nem envio de mensagens. Incluem rejeição de gravação, CNJ divergente/duplicado, movimentos concorrentes, repetição de evento, permissões da rota e falhas de Datajud. Sintaxe do backend, módulos e scripts inline verificada. Os testes não certificam o funcionamento integral do escritório.

## Fontes

- [CNJ — API pública Datajud](https://datajud-wiki.cnj.jus.br/api-publica/): metadados de processos e movimentos, resguardo de informações sigilosas.
- [CNJ — autenticação Datajud](https://datajud-wiki.cnj.jus.br/api-publica/acesso/): cabeçalho Authorization com APIKey pública vigente.
- [TJMG — segundo fator para usuários externos](https://www.tjmg.jus.br/portal-tjmg/informes/pje-duplo-fator-de-autenticacao-para-usuarios-externos.htm): autenticação adicional pelo usuário. Fluxos devem ser homologados por tribunal.
