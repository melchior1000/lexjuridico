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
| **Produção medida (Taskscore) e painel de desempenho** | Taskscore® | Painel: êxito, receita por advogado, clientes em risco | Não tinha | **Frente 1 (feita) + 1b: por pessoa (feita)** |
| **Alertas que pedem ação** (parado, prazo em risco) | Justine sugere próximas ações | "Insights acionáveis" | Só o radar de quem espera resposta (#157) | **Frente 1 (feita)** |
| Aviso de andamento ao cliente pelo WhatsApp | Não citado no site | Sim (envio automático) | Não tinha (o Astrea também não — queixa de usuário) | **Frente 2 — feita como conversa, sem texto pronto** |
| Importar a carteira de planilha/sistema antigo | Não citado no site | Migração assistida em até 7 dias | Só cadastro por CNJ, um a um | **Frente 3 (feita)** |
| Financeiro e honorários (contratos, parcelas, atraso, cobrança Pix) | Sim | Sim, com cobrança escalonada | Só modelo de contrato de honorários | **Frente 4 (feita, sem Pix)** |
| Peças com os modelos do próprio escritório | Editor de documentos | Sim | Playbooks, sem biblioteca de modelos | **Frente 5 (feita)** |
| Relatório com envio automático | Não detalhado | Sim | Bom dia e recibos do dia | **Frente 1b (feita): painel toda segunda no WhatsApp** |
| API pública, webhooks, MCP | API (sem detalhe) | 200+ rotas, OAuth, webhooks | Não tem | Depois da Etapa 4 (tenant real) |
| Portal do cliente | Não citado no site | Não citado no site | Não tem | O WhatsApp faz esse papel; sem prioridade |
| Equipe humana terceirizada (BPO) | Não citado no site | Sim (Legal Ops) | — | Fora: é serviço, não software |

## 2. Frente 1 — Painel do escritório (feita, PR #161)

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

Por pessoa: resolvido na Frente 1b (seção 8) — com conta individual, o painel separa pelo nome.

## 3. Situação das frentes

1. **Frente 1 — painel do escritório:** feita (PR #161). Seção 2.
2. **Frente 2 — andamento vira conversa:** feita (PR #162). Seção 4.
3. **Frente 3 — importar a carteira de planilha:** feita (fase 2). Seção 5.
4. **Frente 4 — honorários:** feita sem Pix (fase 2). Seção 6. **Nunca** misturada com a
   cobrança da licença do LEX (AGENTS.md §12).
5. **Frente 5 — modelos do escritório:** feita (fase 2). Seção 7.
6. **Frente 1b — painel semanal e produção por pessoa:** feita (fase 2). Seção 8.
7. **Próximas candidatas:** cobrança por Pix com conciliação do extrato (exige conta e
   provedor — decisão do titular); API pública e webhooks (depois do tenant real).

## 4. Frente 2 — andamento vira conversa com o titular (sem texto pronto)

Decisão do titular (13/10/2026): *"não quero texto padrão de mensagem ao cliente; a IA tem
que interagir comigo; quero interação, nada mecânico"*. Por isso o LEX **não** copia o envio
automático do EasyJur: ele conversa.

Como funciona (`lib/andamento-conversa.js`):

1. A cada 30 minutos o LEX confere a carteira. Andamento **oficial** novo (DJEN, PJe, MNI,
   captura do tribunal, últimos 30 dias) num processo ativo vira conversa: a IA escreve ao
   titular, pelo Telegram e pelo WhatsApp dele, o que aconteceu, o que significa, se pode haver
   providência (sem nunca calcular prazo) e se vale avisar o cliente — e termina perguntando.
   Fora do horário de trabalho (mesma janela das mensagens automáticas) a conversa espera.
   O Datajud **não** abre conversa (decisão do titular, 13/10/2026): ele chega dias depois do
   fato, e aviso atrasado de andamento confunde com novidade. Ele continua atualizando a
   carteira em silêncio (ver seção 10).
2. O titular responde do jeito dele ("avisa a Maria", "fala que vamos recorrer", "não precisa").
   A IA escreve a mensagem do cliente a partir da conversa e chama `preparar_mensagem_cliente`.
3. O código mostra, logo abaixo da fala da IA, o texto **exato** e o destinatário. O "pode" do
   titular na mensagem seguinte envia — pela fila de mensagens do LEX, com conferência do
   provedor, histórico da recepção e recibo do dia.

Cintos (testados em `test/andamento-conversa.test.js`):

- não existe ferramenta de envio para a IA; o OK é conferido no código, antes do modelo;
- o OK vale só para a prévia da última resposta, só na mensagem seguinte e por 30 min;
  qualquer outra mensagem fecha a janela; sem prévia mostrada, "pode" não envia nada;
- destinatário só por vínculo gravado (recepção, atendimento, cadastro, agenda de contatos);
  vários contatos → a IA pergunta; número dito na conversa aparece por extenso com alerta e,
  depois do envio, fica gravado no processo;
- PARE conferido ao preparar e de novo ao enviar; secretária não prepara nem autoriza;
- primeira varredura, processo recém-chegado e religar marcam o histórico como visto;
- sem IA, o LEX avisa o titular em poucas linhas e diz que a IA está fora.

Ligar/desligar: `LEX_ANDAMENTO_CONVERSA=0` desliga por padrão; o titular também pode pedir na
conversa ("pare de me avisar dos andamentos") — ferramenta `avisos_de_andamento`.

Ajustes da fase 2 (auditoria de segurança, seção 9):

- no app, a prévia é da **conta** que a viu (duas pessoas com o mesmo perfil não compartilham);
- outra mensagem do LEX ao titular no mesmo canal (painel, bom dia, aviso, resumo da recepção,
  resposta a comando) fecha a prévia daquele canal; a do app e a de outras contas continuam;
- depois de uma prévia fechada assim, um "pode" solto recebe resposta clara ("não enviei; quer
  que eu mostre de novo?") — não vai para outra ação, como importar uma planilha;
- arquivo ou foto do titular fecha a prévia (o "pode" seguinte é sobre o arquivo);
- o eco do áudio ("🎙 Entendi…") sai depois da conferência do "pode": aprovar por voz funciona;
- a prévia tem teto de tamanho (nome e processo encurtados, texto ao cliente sempre inteiro)
  para nunca ser cortada pelo canal, e o que não coube não fica armado.

Limite conhecido: no WhatsApp, se o titular escrever de outro aparelho (LID diferente), o
"pode" de lá não aprova a prévia mostrada no primeiro — falha fechada.

## 5. Frente 3 — importar a carteira de uma planilha (`lib/carteira-import.js`)

Como funciona: o titular (ou advogado) manda a planilha que já tem — Excel `.xlsx` ou `.csv`,
pelo WhatsApp ou pelo Telegram. O LEX acha as colunas pelo nome (ou, sem cabeçalho, pelo
conteúdo), confere cada número CNJ e responde com o resumo: quantos são novos, quantos já
estão no LEX, repetidos, números com problema (e por quê), sem número, e quantos celulares
de cliente vieram. Só grava com a ordem dele — na conversa, do jeito que ele falar ("pode
importar", "manda ver"); sem IA, a frase "pode importar". Depois, "desfazer a importação".

Cintos (testados em `test/carteira-import.test.js`):

- número com dígito verificador errado, tribunal desconhecido ou estragado pelo Excel
  (notação científica, dígitos perdidos) não entra e aparece no resumo com o motivo; zeros
  iniciais perdidos só voltam quando o dígito verificador confirma;
- não duplica: processo que já está no LEX, repetido na planilha, que entrou por outro caminho
  entre a leitura e a ordem, ou que já existe com o número escrito de outro jeito ("Proc. …",
  sem zeros) — este último fica de fora e o resumo pede conferência;
- WhatsApp do cliente só entra se for celular brasileiro; fica marcado como vindo da planilha,
  e a prévia de mensagem ao cliente avisa "número veio da planilha importada — confira";
- a planilha nova substitui a que esperava a ordem; só a mais recente pode ser importada;
  planilha lida há mais de 7 dias precisa ser mandada de novo; duas ordens ao mesmo tempo
  importam uma vez só; importação interrompida por reinício pode ser retomada sem duplicar;
- desfazer remove só o processo que ficou exatamente como a planilha trouxe (mais a leitura
  do Datajud, que volta sozinha). Tarefa, documento, prazo, publicação, honorário, anotação
  ou dado alterado mantêm o processo. Sem conseguir ler as tarefas — ou se a lista pode ter
  deixado tarefa de fora (o Task Engine carimba toda gravação, inclusive retomar) — não desfaz
  nada. "Cancela a importação" com planilha esperando
  descarta; depois de importada, o LEX pergunta em vez de apagar;
- arquivo hostil: `.xlsx` lido aos pedaços com teto do tamanho aberto (o tamanho declarado
  pelo arquivo pode ser falso), só as 20 primeiras abas, sem DOCTYPE/ENTITY; CSV com teto de
  linhas e colunas;
- o processo entra "a conferir"; o resumo só promete leitura automática no tribunal quando a
  chave do Datajud está configurada.

Limites: `.xls` antigo e `.ods` recebem orientação para salvar como `.xlsx`/`.csv`; até 3.000
linhas por arquivo; pela tela do app ainda não dá para anexar a planilha (vai pelo WhatsApp ou
Telegram).

## 6. Frente 4 — honorários (`lib/honorarios.js`)

Contrato e pagamentos moram no próprio processo (campo `honorarios`): não nasce tabela nova,
e o financeiro segue o mesmo isolamento da carteira. A IA conversa e registra pelo que o
titular disser ("o João vai pagar 6 mil em 3 vezes a partir de 10/11"; "a Maria pagou a
segunda parcela"); toda conta é do código, em centavos, com memorial de cálculo (fonte,
critério, conta e conferência).

- Tipos: fixo (em parcelas), êxito (percentual; o valor entra como recebimento avulso quando
  houver), misto e mensal. Resto de centavos vai na última parcela; dia que não existe no mês
  vira o último dia (31/01 + 1 mês = 28 ou 29/02).
- Pagamento por parcela (parcial e depois quitação), sem parcela da mais antiga para a mais
  nova, e excedente vira recebimento avulso.
- Juros e multa só quando o contrato prevê (juros simples pro rata dia); nunca somados ao
  "vencido" — aparecem à parte como encargos.
- Contrato com pagamento registrado não é substituído (o histórico não se perde).
- Valor só em formato sem ambiguidade ("6.000", "6.000,50", "1.5"): "6,000" ou "1,000.50"
  são recusados e a IA pergunta — inclusive quando vem com a parcela (nunca vira quitação da
  parcela inteira). A mesma quantia na mesma data (para a mesma parcela, ou sem parcela de um
  dos lados) não entra duas vezes no mesmo turno; em outra mensagem, em menos de 15 minutos,
  só com a confirmação do titular de que é outro pagamento.
- Painel: recebido no mês, a receber, vencido e parcela vencida como alerta (QUEM + O QUÊ +
  POR QUÊ + AÇÃO). Por responsável aparece para o titular e advogados; a secretária vê o
  financeiro do escritório, não a receita de cada advogado.
- Cobrar o cliente: a IA escreve a mensagem e usa a mesma prévia + "pode" da Frente 2.

Limites: sem boleto/Pix nem conciliação com o extrato bancário; o histórico financeiro vai
no mesmo pacote de dados da carteira que o app baixa (quem vê processos no app vê esse campo).

## 7. Frente 5 — modelos do escritório (`lib/office-models.js`)

O titular manda o Word com "modelo" no nome ("Modelo contestação.docx") — ou cola o texto na
conversa e diz que é o modelo. O LEX guarda um modelo por tipo de peça, com versão, hash e a
versão anterior para voltar. Na redação, o Task Engine segue a estrutura, a ordem das seções,
o estilo e as fórmulas do modelo — **sem copiar dele fatos, nomes, números, datas, valores ou
pedidos** — e registra na tarefa qual modelo e versão usou (`modelo_usado`).

Cintos (testados em `test/office-models.test.js`):

- só advogado ou administrador guarda, volta versão ou remove;
- o texto do modelo vai na mensagem, entre cercas, como referência; a regra fica nas
  instruções do sistema; ninguém fecha a cerca por dentro do texto;
- só entra o que se vê na página: texto oculto (direto ou por estilo), letra branca ou
  minúscula, trecho apagado com controle de alterações e instrução de campo ficam fora — e o
  LEX conta quantos trechos tirou; ao guardar, mostra o tamanho e o começo do texto;
- o Word é lido como árvore (sem expressão regular sobre o XML), aos pedaços e com teto do
  tamanho aberto: arquivo malformado ou que mente o tamanho não trava o servidor;
- pela conversa, a IA só guarda o texto que o titular colou na própria mensagem;
- PDF e `.doc` só são tratados como modelo quando o nome também diz a peça — "Contrato modelo
  do banco.pdf" vai para a análise normal; quem não queria modelo é orientado a mandar de novo
  sem a palavra "modelo" no nome.

## 8. Frente 1b — painel semanal e produção por pessoa

- Toda segunda-feira, a partir das 8h (Brasília), o painel do escritório vai para o WhatsApp do
  titular, uma vez por semana, com o mesmo controle de entrega do bom dia
  (`LEX_PAINEL_SEMANAL=0` desliga; `LEX_PAINEL_SEMANAL_HORA` muda a hora).
- O Task Engine grava, além do perfil, a **conta** de quem pediu, revisou e devolveu cada
  tarefa (`ator_conta`, `revisado_por_conta`, `devolvido_por_conta`), tirada da sessão assinada
  do app. Com isso o painel separa a equipe por nome (o "Taskscore" do ADVBOX).

Limite: tarefa criada pelo WhatsApp/Telegram ou pelo login de senha do titular continua
contada pelo perfil; o painel explica isso.

## 9. Auditoria de segurança da fase 2

Revisão adversarial independente (subagente de segurança) antes do PR. Achados e situação:

| # | Achado | Gravidade | Situação |
|---|---|---|---|
| 1 | Prévia do app compartilhada por todas as contas do mesmo perfil | Alta (anterior à fase 2) | Corrigido: prévia por conta |
| 2 | Mensagem mais nova do LEX (painel, resumo) não fechava a prévia | Média | Corrigido: fecha no envio ao titular |
| 3 | Planilha antiga ou substituída podia ser importada | Média | Corrigido: só a mais recente, com prazo de 7 dias |
| 4 | "Cancela a importação" desfazia; erro ao listar tarefas virava lista vazia | Média | Corrigido: pergunta; sem tarefas, não apaga |
| 5 | Arquivo compactado que mente o tamanho; CSV gigante | Média | Corrigido: leitura aos pedaços com teto |
| 6 | Texto oculto do Word e cerca do modelo | Média | Corrigido: oculto fora, modelo na mensagem |
| 7 | Duplicado quando o número no LEX está escrito de outro jeito | Baixa | Corrigido: fica de fora e pede conferência |
| 8 | Valores ambíguos ("6,000"); pagamento repetido em outra mensagem | Baixa | Corrigido: recusa e pede confirmação |
| 9 | Nome "__proto__" contaminando o servidor | Baixa | Corrigido |
| 10 | Receita por advogado visível à secretária | Baixa | Corrigido (o pacote da carteira no app segue como limite) |

Além disso, a revisão interna achou e corrigiu: a prévia podia ser cortada pelo limite de
4.000 caracteres do canal (agora tem teto e só arma o que foi mostrado inteiro); o Telegram
recusava planilha e modelo `.md` como "formato não suportado".

Segunda rodada (re-checagem das correções pelo mesmo auditor): confirmou 1, 3, 7 e 9 e
apontou lacunas e efeitos colaterais, todos corrigidos com teste: resumo da recepção e
respostas a comando também fecham a prévia; o fechamento passou a valer só para a conversa
do canal em que a mensagem saiu (antes fechava a prévia de outras contas e do app); "pode"
depois de prévia fechada responde claro em vez de ir para outra ação; eco do áudio depois da
conferência; carimbo de tempo em toda gravação de tarefa; Word lido como árvore, aos pedaços,
com estilos ocultos e texto disfarçado fora; no máximo 20 abas por planilha; valor ilegível
com parcela é recusado; nome de arquivo limpo nas instruções; nome enorme não estoura a prévia.
O envio ao titular por número puro (como o LEX manda o bom dia e o painel) também passou a
ser reconhecido — a primeira versão da correção só reconhecia o identificador completo.

Rodada final (verificação do commit): todas as correções confirmadas. Três ajustes pequenos,
também com teste: letra branca sobre fundo colorido (cabeçalho de tabela) continua no modelo,
e hífen inseparável e símbolo inserido aparecem; o titular configurado sem o 55 é reconhecido
no envio; e um número **fixo** com os mesmos dígitos do celular do titular sem o nono dígito
(61 3333-4444 × 61 9 3333-4444) deixou de passar pelo titular — falha anterior a esta fase,
na conferência de quem é o titular no WhatsApp.

Limites que continuam (registrados, sem correção nesta fase): o histórico financeiro vai no
pacote da carteira que o app baixa (qualquer perfil que vê processos vê esse campo); processo
citado só dentro do número de outro ("vinculado a…") fica de fora da importação e deve ser
cadastrado pelo número.

## 10. Frente 6 — intimações e prazos sem atraso (13/10/2026)

**Pedido do titular:** "atualização atrasada arrebenta com advogado: perda de prazo perde a ação…
veja o que a ADVBOX e esses aplicativos fazem para evitar perda de prazo e notificação atrasada,
implemente no nosso e o que for de notificação atrasada exclua".

### A regra que decide (fonte oficial)

- Desde 16/05/2025, quando a lei não exige intimação pessoal, o prazo conta **da publicação no DJEN**;
  intimação simultânea por outro meio (painel do PJe, e-mail) tem valor "meramente informacional"
  (Res. CNJ 455/2022, art. 11, §3º, com a redação da Res. CNJ 569/2024).
- Publicação = 1º dia útil após a disponibilização; o prazo começa no dia útil seguinte (CPC,
  art. 224, §§ 2º e 3º). Citação e intimação pessoal da parte vão pelo Domicílio Judicial
  Eletrônico (art. 18; prazos de leitura no art. 20, §§ 3º-A, 3º-B e 4º).

### O que os sistemas de mercado fazem (pesquisa de 13/10/2026)

| Prática | Quem | LEX antes | LEX agora |
|---|---|---|---|
| Captura por OAB **e por nome** (com variações; exceção para homônimo) | Projuris, AASP | só OAB | OAB + nome (o que vier só pelo nome é marcado para conferir) |
| Mais de uma leitura por dia | AASP (duas levas) | 1 vez (6h) | de 2 em 2 h, 6h–22h |
| Publicação de processo não cadastrado também chega | Projuris, AASP | avisada 1 vez e esquecida | pendente até tratar |
| Cada intimação fica pendente até alguém tratar ("contador em zero") | Projuris, Astrea | não havia tela para confirmar o prazo | Prazos › Diário + frases do titular |
| IA sugere o prazo; pessoa confere | Astrea | sugestão sem tela de confirmação | sugestão + confirmação (botão ou frase) |
| Alerta de falha na captura / conferência diária | Projuris, OAB/PI | só depois de 26 h | alarme às 8h; aviso de normalização |
| Cada intimação ligada ao processo e acompanhada até a conclusão (quem concluiu e quando) | ADVBOX | um prazo por processo: o 2º apagava o 1º | um prazo por intimação, com baixa própria registrada |
| Alertas automáticos que lembram o prazo | ADVBOX | "N marco(s) na fila", sem dizer qual | lembrete com processo, número, data e dias (5, 2, 1, no dia, vencido) |
| Prazo interno antes do fatal (D-1); dupla checagem | ADVBOX, Projuris | — | lembrete na véspera; proposta é sugestão e a confirmação é humana (prazo interno próprio: próxima frente) |

### O que foi implementado

Ver `docs/LEX_LISTA_MESTRA.md` (registro de 13/10/2026). Módulos: `lib/djen-tratamento.js`
(intimações a tratar), `lib/djen-vigia.js` (leitura ao longo do dia e alarme), `lib/djen.js`
(leitura que falha fechada; busca por nome), `lib/notification-digest.js` (aviso depois do resumo
sai na próxima janela), `lib/forensic-calendar.js` (feriados nacionais), `lib/pje-monitor.js`
(regra do DJEN nas mensagens), `lib/prazos-abertos.js` (um prazo por intimação), `lib/deadline-alerts.js`
(lembrete de vencimento) e `lib/djen-alerts.js` (aviso de intimação não ligada e de cancelada). Frases do titular (só valem digitadas por ele; a IA é recusada):
`CONFIRMO PRAZO nº dd/mm/aaaa`, `SEM PRAZO nº`, `NÃO É NOSSO nº`, `JÁ TRATEI nº`, `REABRIR INTIMAÇÃO nº`.

### Aviso atrasado que saiu

- Datajud (atrasa dias): não chama mais o titular como "andamento novo", nem pelo relógio do PJe,
  nem pela leitura avulsa; só completa o histórico.
- Aviso de PRAZOS não espera mais o resumo do dia (que saía uma vez por dia).

### Fontes

- AASP — novas regras de contagem: https://www.aasp.org.br/?p=84278
- Texto da Res. CNJ 569/2024: https://sintse.tse.jus.br/documentos/2024/Ago/15/diario-da-justica-eletronico-cnj/resolucao-no-569-de-13-de-agosto-de-2024-altera-a-resolucao-cnj-no-455-2022-para-disciplinar-a
- TRT-11 — prazos só pelo DJE/DJEN: https://portal.trt11.jus.br/index.php/comunicacao/10272-novas-regras-de-contagem-de-prazos-processuais-valem-a-partir-de-16-de-maio
- Cartilha OAB/PI sobre o DJEN: https://www.oabpi.org.br/wp-content/uploads/2025/06/CARTILHA-NOVAS-INTIMACOES-DJEN-1.pdf
- Projuris — intimações eletrônicas: https://www.projuris.com.br/blog/intimacoes-eletronicas-como-controlar-prazos/
- Projuris ADV — controle de intimações: https://www.projuris.com.br/blog/controle-de-intimacoes-no-projuris-adv/
- Regulamento de intimações da AASP: https://www.aasp.org.br/regulamentos/intimacoes
- Astrea — tratamento de publicação com IA: https://www.aurum.com.br/blog/tratamento-de-publicacao-ia/
- ADVBOX — gestão de intimações: https://advbox.com.br/blog/gestao-de-intimacoes-e-prazos/
- ADVBOX — sistema de prazo fatal (modelo D-1): https://advbox.com.br/blog/sistema-de-prazo-fatal/
- Parâmetros da API do DJEN (nomeAdvogado, destinatarioadvogados): https://github.com/vbarcelosbt/API_DJEN

