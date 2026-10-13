# O melhor do ADVBOX e do EasyJur no LEX — mapa e fila de frentes

Pedido do titular (13/10/2026): unir o que o ADVBOX e o EasyJur têm de bom **e
funcionando**, trazendo para o LEX. Este arquivo é o contrato dessa frente: o que cada
um oferece, o que o LEX já tem no código, o que entra e em que ordem.

Critério para copiar: só função que o concorrente entrega hoje (o que ele anuncia como
"em breve" fica fora) e sempre do jeito do LEX — a IA dirige, o código calcula e
confere, nada de sucesso falso, ato com efeito externo só com autorização humana
(AGENTS.md §1A). É cópia da **ideia**, com código nosso: nenhum código, tela ou texto
dos concorrentes é reproduzido.

Fontes consultadas em 13/10/2026: páginas públicas `advbox.com.br` e `easyjur.com`,
comparativo do blog da EasyJur, avaliações do Astrea no Capterra e histórico de preços
do PricingSaaS. Preço e recurso de concorrente mudam: conferir antes de usar em venda.

## 1. Mapa

| Função | ADVBOX | EasyJur | LEX hoje (código) | Decisão |
|---|---|---|---|---|
| Captura de publicações e intimações | Sim (Donna classifica) | Sim, com envio de andamento | DJEN, PJe/MNI e Datajud (`djen-monitor`, `pje-mni`, `datajud`) | Já tem. Diferencial: prazo só vira prazo com fonte oficial e confirmação |
| Cálculo de prazo com feriados | Não detalhado | Sim (CPC + feriados) | `forensic-calendar`, `deadline-truth` | Já tem |
| IA que lê o caso e sugere a próxima ação | Donna e Justine | Agentes com contexto | Agente vivo + Task Engine com triagem e auditoria de citações | Já tem. Diferencial: executa e conversa também pelo WhatsApp |
| Rotinas automáticas | Sim | Sim (workflows) | Setores, rotina noturna, bom dia, radar da recepção | Já tem |
| **Produção medida (Taskscore) e painel de desempenho** | Taskscore® | Painel: êxito, receita por advogado, clientes em risco | Não tinha | **Frente 1 — este PR** |
| **Alertas que pedem ação** (parado, prazo em risco) | Justine sugere próximas ações | "Insights acionáveis" | Só o radar de quem espera resposta (#157) | **Frente 1 — este PR** |
| Aviso de andamento ao cliente pelo WhatsApp | Não citado no site | Sim | Não tem (o Astrea também não — queixa de usuário) | Frente 2 |
| Importar a carteira de planilha/sistema antigo | Não citado no site | Migração assistida em até 7 dias | Só cadastro por CNJ, um a um | Frente 3 |
| Financeiro e honorários (contratos, parcelas, atraso, cobrança Pix) | Sim | Sim, com cobrança escalonada | Só modelo de contrato de honorários | Frente 4 (grande; depende da Etapa 4) |
| Peças com os modelos do próprio escritório | Editor de documentos | Sim | Playbooks, sem biblioteca de modelos | Frente 5 |
| Relatório com envio automático | Não detalhado | Sim | Bom dia e recibos do dia | Junto da Frente 1: painel semanal pelo canal |
| API pública, webhooks, MCP | API (sem detalhe) | 200+ rotas, OAuth, webhooks | Não tem | Depois da Etapa 4 (tenant real) |
| Portal do cliente | Não citado no site | Não citado no site | Não tem | O WhatsApp faz esse papel; sem prioridade |
| Equipe humana terceirizada (BPO) | Não citado no site | Sim (Legal Ops) | — | Fora: é serviço, não software |

## 2. Frente 1 — Painel do escritório (entregue neste PR)

`lib/office-insights.js`, ligado a três portas:

- **Conversa:** ferramenta `painel_do_escritorio` do agente vivo ("como está a produtividade?",
  "o que está parado?").
- **Executor sem IA:** frases "painel do escritório", "indicadores", "processos parados",
  "taxa de êxito", "desempenho dos advogados" (`office_panel` em `office-queries.js`).
  Ordem com verbo ("atualize os processos parados") continua indo para o executor próprio.
- **Bom dia:** uma linha "📊 Painel: N pontos pedindo ação…" só quando há algo.

O que mostra (tudo dos registros, nada estimado):

- Carteira com as mesmas regras de setor da Home (`workflow.summary`), para não divergir.
- Taxa de êxito só com processo marcado GANHO ou PERDIDO; sem base, diz que não há base.
- Prazos oficiais (lista do `DeadlineWatch`): vencidos, hoje, próximos 7 dias; prazo marcado
  como cumprido sai da conta.
- Produção em 30 dias: minutas aprovadas, esperando revisão, travadas, devolvidas e tempo
  médio entre a minuta pronta e a aprovação.
- Equipe (não aparece para secretária): ordens, revisões e devoluções por quem as registrou;
  por responsável do processo: ativos, parados, prazos vencidos.
- Alertas, cada um com QUEM + O QUÊ + POR QUÊ + AÇÃO + a frase para dizer ao LEX:
  prazo oficial vencido; prazo oficial em até 5 dias sem peça em produção; minuta pronta
  há mais de 48 h sem revisão; tarefa travada; processo sem andamento há 90 dias ou mais —
  separando "o tribunal confirmou que não anda" de "o LEX está sem leitura recente".

Limite conhecido: o Task Engine grava o **perfil** de quem deu a ordem (admin, advogado,
secretária), não a conta da pessoa. O painel avisa isso. Para o ranking individual do tipo
Taskscore, a próxima fatia é gravar a conta individual (`lib/lex-users.js`) em `ator`,
`revisado_por` e `devolvido_por` — o cálculo do painel já agrupa pelo que estiver gravado.

## 3. Fila das próximas frentes

1. **Frente 1b (pequena):** conta individual nas tarefas + envio semanal do painel pelo
   canal do titular, com o mesmo controle de entrega do bom dia.
2. **Frente 2 — aviso de andamento ao cliente:** quando entra andamento oficial, o LEX
   redige o aviso em linguagem simples e o titular aprova com um toque; depois, opção de
   envio automático só para movimentos simples, respeitando o ritmo (#156) e o PARE (#155).
3. **Frente 3 — importar carteira:** planilha (CSV/XLSX) com CNJ e cliente; cada número
   conferido (dígito verificador e tribunal) antes de gravar; relatório antes/depois; sem
   duplicar processo que já existe. Essencial para implantar nos escritórios que esperam.
4. **Frente 4 — financeiro e honorários:** contratos, parcelas, atraso e cobrança por Pix,
   com `escritorio_id` e RLS desde o início; **nunca** misturado com a cobrança da licença
   do LEX (AGENTS.md §12). Só depois da Etapa 4.
5. **Frente 5 — modelos do escritório:** biblioteca de modelos por escritório usada pelo
   Task Engine na redação, com versão e hash.
