# Interface, setores e cadastro PJe — 08/09/2026

## Escopo deste checkpoint

Referência: sete páginas do PDF da interface fornecido pelo titular. A marca escura azul/dourada foi preservada. O código não foi publicado em produção neste checkpoint.

- Central de agentes consulta o registro real do backend em GET /api/agentes/status, exclusivo do administrador. Não aceita mais token de bot em prompt nem anuncia ativação por uma preferência local.
- Setores dão acesso aos módulos existentes: autuação, jurídico, perícia, prazos, identificação e PJe. O registro de uma função não comprova operação da API.
- O menu preserva os temas claro/escuro e a identidade azul/dourada. O atalho duplicado "Em Preparação" foi removido; essa fila continua dentro de Autuação. "Análise de decisões" passou a "Padrão decisório".
- A análise do julgador não deve inferir personalidade, ideologia, reputação ou porcentagem de vitória. Exige decisões identificadas e separa material analisado, fundamentos, provas, teses acolhidas/rejeitadas, aplicação possível e limites da amostra.
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

O fluxo de lembretes agora separa atualização, prazo e cumprimento. Andamento novo não baixa lembrete nem oculta prazo crítico. A baixa exige IDs exatos e confirmação explícita; o banco precisa confirmar antes de a tela receber o estado concluído. O motor proativo ainda contém caminhos legados a revisar. A sincronização local antiga ainda precisa migrar para a ingestão autenticada com confirmação de persistência. Deduplicação durável de entradas dos canais, fila por tarefa e recuperação após falha continuam necessárias. Não é uma versão comercial homologada.

## Validação

128 testes locais passaram, sem acesso aos processos reais nem envio de mensagens. Incluem rejeição de gravação, baixa explícita de lembrete, preservação de prazo após andamento, CNJ divergente/duplicado, movimentos concorrentes, repetição de evento, permissões da rota e falhas de Datajud. Sintaxe do backend, módulos e scripts inline verificada. Os testes não certificam o funcionamento integral do escritório.

## Componentes públicos avaliados

- `mcp-juridico-brasil` (MIT): interessante como referência para Datajud, LexML, snapshots e cálculo de prazo, mas não substitui o PJe autenticado. Não será incorporado sem testes próprios e revisão das regras de calendário.
- `docassemble` (MIT): forte em entrevistas guiadas e montagem de DOCX/PDF, porém adicionaria uma segunda plataforma Python pesada. A ideia de formulários guiados será aproveitada; a dependência inteira não entra neste checkpoint.
- `pje-mcp-server` (MIT): declara integração com certificados A1/A3, mas o repositório observado tem somente dois commits e afirma suporte amplo sem evidência suficiente de homologação por tribunal. Não será usado como base de produção.

## Fontes

- [CNJ — API pública Datajud](https://datajud-wiki.cnj.jus.br/api-publica/): metadados de processos e movimentos, resguardo de informações sigilosas.
- [CNJ — autenticação Datajud](https://datajud-wiki.cnj.jus.br/api-publica/acesso/): cabeçalho Authorization com APIKey pública vigente.
- [TJMG — segundo fator para usuários externos](https://www.tjmg.jus.br/portal-tjmg/informes/pje-duplo-fator-de-autenticacao-para-usuarios-externos.htm): autenticação adicional pelo usuário. Fluxos devem ser homologados por tribunal.
