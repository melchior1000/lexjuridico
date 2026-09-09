# LEX — arquitetura e armazenamento

Revisão de 07/09/2026. Este documento distingue o código observado da arquitetura
proposta. Não é um atestado de prontidão comercial nem uma migração aplicada.

## Sistema observado

| Subsistema | Implementação observada | Dependência e risco |
| --- | --- | --- |
| Interface | index.html e lex-whatsapp.html; estado no navegador e sincronização HTTP/SSE | Cache pode divergir do servidor; falta teste visual e ponta a ponta |
| Servidor | bot.js, HTTP nativo, rotas e timers no mesmo processo | Reinício afeta sessões, filas em memória e integrações |
| Agente vivo | lex_agente_vivo.js delegado pelo servidor | Ferramentas consultam banco e cache; isolamento por processo ainda incompleto |
| Banco | REST Supabase; config/configuracoes, processos, documentos e outras tabelas | Schema real, índices, políticas RLS e migrações não foram fornecidos |
| Documentos | PDFs base64, extração de texto, exportação PDF/DOCX/ZIP | Importação não equivale a arquivo original durável e versionado |
| Mensageria | Evolution/WhatsApp, Telegram e SMTP | Autenticação de webhook, deduplicação e recuperação não homologadas |
| PJe | Rotinas de acompanhamento no servidor e proposta de executor local | Não há evidência de integração completa testada em ambiente separado |
| IA | Chamadas diretas Anthropic, OpenAI e Google | Modelos e concorrência configuráveis; sem orçamento financeiro durável |
| Segurança | Perfis compartilhados, token assinado, validação de rotas | Não atende ainda segregação entre escritórios nem identidade individual |

Os módulos compartilham o array de processos. Um filtro esquecido em busca,
cache ou prompt pode misturar casos. Controle na interface não resolve isso.
O helper legado sbGet ainda pode converter falha em lista vazia; apenas os
fluxos revisados usam leitura estrita. Outras escritas atualizam memória antes
do banco e precisam ser migradas gradualmente, com testes de falha.

## Decisão de armazenamento proposta

Preservar o combinado: gestão na nuvem e arquivos pesados no computador/NAS do
escritório, com entrega de cópias ao cliente. A sincronização automática descrita
abaixo NÃO está implementada neste checkpoint.

| Local | Conteúdo | Regra |
| --- | --- | --- |
| PostgreSQL/Supabase | Escritório, usuário, cliente, processo, tarefas, permissões, histórico de operações e manifestos de documentos | Nenhum PDF base64 como armazenamento permanente de rotina |
| Computador/NAS do escritório | Originais, versões, OCR completo e índice local por processo | Criptografia, permissões, espaço monitorado e segunda cópia independente |
| Área temporária de transferência | Arquivos estritamente necessários a uma operação autorizada | Expiração só após confirmação durável e política de retenção |
| Computador do cliente | Cópia de entrega identificada por versão | Não substitui o arquivo e o backup do escritório |

O manifesto proposto contém tenant_id, case_id, document_id, version_id,
sha256, tamanho, MIME, storage_node_id, estado e timestamps. Nome do cliente não
é identificador de autorização. Caminhos locais não vêm de comandos livres da IA.

### Protocolo necessário antes de remover cópias temporárias

1. Autorizar usuário, escritório, processo e operação no servidor.
2. Criar versão imutável e registrar transferência com chave idempotente.
3. O executor local baixa em arquivo temporário, verifica tamanho/hash e grava
   atomicamente no destino autorizado; confirma a versão ao servidor.
4. Produzir segunda cópia independente e registrar evidência verificável.
5. Só então marcar elegível para limpeza, respeitando retenção e impedimentos.
6. Repetir o mesmo pedido não duplica versão ou apaga arquivo errado. Falha,
   disco cheio, queda de rede ou confirmação ausente mantêm estado recuperável.

HTTP 200 de download não prova que o arquivo foi salvo. Nenhuma rotina deve
apagar a única cópia. Prazo de retenção e política de descarte permanecem decisões
pendentes; não foi encontrado um período previamente aprovado.

Se o computador/NAS estiver desligado, consultas aos metadados continuam, mas
arquivos locais ficam indisponíveis. O produto deve mostrar isso claramente.
Disponibilidade contínua exige nó sempre conectado ou cópia remota adicional,
com custo e política explícitos. Backup do banco não basta para recuperar PDFs.

## Agentes, APIs e custo

Manter Supabase/PostgreSQL como base. Separar primeiro identidade, autorização,
transações e auditoria; avaliar fila PostgreSQL durável depois, evitando adicionar
Redis e outro provedor antes de existir necessidade medida.

Manter Anthropic como provedor principal configurável. Chamadas diretas atendem
as tarefas curtas atuais. O interesse anterior em Claude Managed Agents continua
como piloto para trabalhos longos após isolamento, recuperação e orçamento; não
foi ativado. OpenAI fica como opção de revisão, acionada conforme tarefa e limite,
e não uma segunda chamada automática para toda mensagem. Google permanece legado,
sem promessa de disponibilidade de cada modelo configurado.

Nesta revisão: concorrência compartilhada padrão 2, até 3 ciclos de ferramentas
no agente vivo, sem fila ilimitada em RAM. Isso reduz chamadas simultâneas, mas
NÃO impõe teto mensal em dinheiro, nem cobre todos os caminhos legados de rede.
O teto comercial precisa reservar custo antes da execução e reconciliar uso real
por escritório, tarefa e provedor, inclusive retry, áudio, busca e documentos.

Não provisionar novos serviços para esta revisão. Não prometer operação comercial
24 horas gratuitamente: armazenamento, backup, disponibilidade e APIs têm limites.

## Referências técnicas verificadas nesta revisão

- [Modelos descontinuados e substitutos Anthropic](https://platform.claude.com/docs/en/about-claude/model-deprecations)
- [Managed Agents: escopo do serviço](https://platform.claude.com/docs/en/managed-agents/overview)
- [Preços Claude](https://claude.com/pricing)
- [RLS do Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Backups Supabase: dados e objetos são distintos](https://supabase.com/docs/guides/platform/backups)
- [Filas PostgreSQL no Supabase](https://supabase.com/docs/guides/queues)
- [Limites de instâncias gratuitas Render](https://render.com/docs/free)
- [Condições do plano Hobby Vercel](https://vercel.com/docs/plans/hobby)

Preços e modelos devem ser revalidados na contratação. Nenhuma contratação ou
chamada paga foi feita durante a validação local.
