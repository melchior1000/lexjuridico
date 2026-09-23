# Etapa 1 — porta e autoridade do LEX

Base revisada: `db2784b` (PR #24). O PR #23 de perícia permanece separado.

## Hierarquia

o profissional responsável → LEX coordenador → agentes dos setores. WhatsApp, Telegram e a simulação de atendimento da interface compartilham `intakeDecision`.

Recepção apenas acolhe, identifica o assunto, mantém contexto e indica o setor. Não consulta processos, não calcula, não cria tarefa jurídica automaticamente e não transforma arquivo recebido em laudo. O despacho executável para os agentes será homologado na próxima etapa, com autorização do dono.

Setores sugeridos: cadastro, instrução, andamento, perícia e recepção. Urgência e pedidos de contato com titular são destacados para o dono.

## Autoridade efetiva nesta etapa

- WhatsApp: somente o número de `LEX_OPERATOR_WHATSAPP`, inclusive a forma brasileira sem o nono dígito, acessa o caminho privado. Ausência de configuração não libera modo legado.
- Telegram: somente o remetente de `TELEGRAM_ADMIN`/`TELEGRAM_ADMIN_CHAT_ID`, em conversa privada, acessa o caminho do dono. Terceiros passam pela mesma porta; grupos não acessam o motor.
- Resposta ao cliente exige destinatário e texto exato. Não há reescrita por IA após aprovação.
- `/responder NUMERO TEXTO EXATO` no WhatsApp privado envia uma única resposta. `/respondertg ID TEXTO EXATO` no Telegram privado faz o equivalente.
- `/recepcaotg`, `/historicotg ID` e `/arquivartg ID` organizam a recepção do Telegram.
- `sim`, `ok` e `autorizo` genéricos não liberam o mecanismo antigo de orientações nem respostas em lote.
- Identidade e contatos administrativos permanecem na fila até arquivamento explícito.

## Memória e reporte

WhatsApp usa o histórico existente de recepção; Telegram grava uma conversa por remetente em registros `lex_recepcao_telegram_*` pelo `RecordStore` existente. Nenhuma nova tabela é criada. O nome do perfil do mensageiro não serve como autenticação.

Mensagens textuais rápidas no WhatsApp são agrupadas em 2,5 segundos. Turnos do mesmo contato são serializados para que o próximo leia o histórico anterior. Mídia aguarda o texto pendente.

Atendimento comum gera um resumo ao dono contendo entrada, resultado do envio e decisão pendente. Urgência gera aviso prévio e confirmação posterior. Falha de envio não é apresentada como entrega confirmada.

## Limites que não podem ser vendidos como resolvidos

- A porta usa regras de recepção e histórico; não é um novo modelo de IA conversacional.
- Indicação de setor não prova execução do agente. O encaminhamento executável, anexos completos e retorno de cada setor ainda exigem homologação.
- No Telegram, a referência do arquivo e o setor são registrados; não há download nem cálculo na porta.
- Não foi feita homologação visual no iPhone, nem comprovada uma única bolha no aparelho físico.
- A fila do painel atual é de WhatsApp. A fila Telegram está disponível pelos comandos privados; unificação visual é etapa posterior.
- O armazenamento WhatsApp conserva o fallback em memória já existente quando o banco falha; isso não equivale a persistência confirmada.
- Qualidade documental e padrão institucional do PR #23 serão revisados no setor de perícia.
- Motor proativo, PJe, `persistirProcesso`, Evolution, números, chaves e provedor global não são alterados por esta etapa.

## Verificação

Testes de regressão cobrem a sequência do print, titular → nome → assunto, identidade sem arquivamento, consentimento, sigilo, classificação por setor, autorização exata, comandos de terceiro, proprietário no JID legado, Telegram sem acesso ao cadastrador, histórico entre recriações do serviço e indisponibilidade do banco. A suíte completa e a verificação de sintaxe devem passar antes do merge.

Homologação seguinte: contato de teste → recepção → autorização do dono → tarefa do setor → evidência/documento → revisão → resposta aprovada. Cada setor deve ser testado isoladamente antes de ser declarado operacional.
