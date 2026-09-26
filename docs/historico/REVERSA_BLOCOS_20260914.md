# Reversa em blocos — LEX — 14/09/2026

Base auditada: `85cf21d0c44dd535da7e8441088a629046b8b702`.

## Método

A leitura foi feita por faixas de até 2.000 linhas nos dois monólitos (`bot.js` e `index.html`) e, depois, por módulos centrais menores. O objetivo não é contar funções, mas identificar o dono real de cada responsabilidade, caminhos paralelos e pontos que podem quebrar o ciclo comercial.

## Linguagens e núcleo

- Servidor: Node.js / JavaScript, com `bot.js` como processo HTTP central legado e `lib/office-routes.js` como porta operacional do escritório novo.
- Dados: objetos JavaScript serializados em JSON; `ProcessStore` persiste o snapshot versionado em `processos_cache` no Supabase.
- Interface: HTML/CSS/JavaScript em `index.html` mais a casca comercial e seus sidecars `office-*`.
- IA: `TaskEngine` é o motor oficial de produção jurídica do escritório; `/api/vivo/conversar` é a conversa do Gestor.

## bot.js — blocos

### 1–2.000

Infra, providers de IA, Supabase, Evolution, configuração de canais, memória e utilitários. Há identidade e dados operacionais específicos embutidos em prompts/comentários do legado; isso não deve ser usado como configuração comercial de novos escritórios.

### 2.001–4.000

Leitura/normalização documental e geradores jurídicos legados. Há geração direta por IA e envio de DOCX fora do `TaskEngine`. É compatibilidade, não deve ser porta oficial da casca comercial porque não usa o mesmo ciclo Cadastro → Produção → Revisão.

### 4.001–6.000

Perícia e atendimento/cadastro legados. O fluxo `clientes_pendentes` é uma segunda trilha de intake, diferente da Recepção comercial. Deve permanecer isolado até migração por adapter; não deve criar um segundo conceito de Cadastro na casca nova.

### 6.001–8.000

Comandos antigos (`/converter`, `/peca`, intake por canal) escrevem na carteira por caminhos anteriores ao `office-pipeline`. São compatibilidade. O produto comercial deve usar Recepção, `office-routes`, `ProcessStore` e `TaskEngine`.

### 8.001–10.000

Atualização processual antiga faz matching heurístico por CNJ/partes/vara/cidade. O escritório novo possui intake mais conservador, que recusa ambiguidade. A heurística antiga não deve ser promovida a porta automática de produção.

### 10.001–12.000

Servidor HTTP, autenticação, sync, chat gestor antigo, atualização/distribuição legadas e perícia antiga. Existem rotas paralelas a `office-routes` e `TaskEngine`. A casca comercial deve evitar esses geradores/editores paralelos.

### 12.001–fim

Exportações, análises estratégicas, timers, Datajud/PJe legado, alertas, motor proativo e fachadas `Agente*`. As classes de agentes organizam responsabilidades, mas não constituem uma rede autônoma de bots. O motor proativo ainda usa status/setores legados e deve ser tratado como monitoramento de compatibilidade.

## index.html — blocos

### 1–2.000

Grande camada de CSS e estrutura visual legada. O arquivo continua sendo host da aplicação, mas não deve receber novas funcionalidades comerciais.

### 2.001–4.000

Tour, boas-vindas e varredura antigos. Há textos que prometem integrações mais amplas do que o fluxo comercial atualmente homologa. A casca comercial já neutraliza a varredura visual.

### 4.001–6.000

Navegação e painéis legados. `ir()` ainda abre telas antigas para várias funções. A casca comercial intercepta Home/Trabalho/Processos/Prazos, mas produção jurídica precisava também ser interceptada.

### 6.001–8.000

Jurisprudência e gerador de peças legado. O botão comercial `Nova peça` podia cair nesse gerador antigo. Este corte corrige a navegação para abrir o LEX comercial e deixar a ordem virar `/api/tarefas`.

### 8.001–10.000

Preparação/autuação antiga e análise de PDFs. É uma segunda trilha de cadastro documental; útil como compatibilidade, mas não deve substituir checklist e intake do escritório.

### 10.001–12.000

Chat global antigo e processamento autônomo no navegador. O chat envia contexto amplo da carteira e não é o chat oficial comercial. O modo autônomo grava por caminhos antigos; não deve ser promovido ao piloto.

### 12.001–fim

Centro de dados, exportações, configurações e utilitários. Úteis como ferramentas administrativas, mas precisam ser tratados como legado até migração gradual para telas comerciais.

## Núcleo comercial auditado

### `lib/office-pipeline.js`

É o estado oficial das salas: Recepção, Cadastro, Iniciais, Processos, Prazos, Peças, Perícia, Revisão e Concluídos. `handoff()` grava baixa/entrada em um único movimento; checklist bloqueia saída do Cadastro; tarefa move para produção e entrega para Revisão.

### `lib/office-routes.js`

É a porta HTTP oficial do escritório: entrada processual, Datajud, checklist, distribuição, movimentação, tarefas e quadro. Deve ser o dono das ações administrativas da casca comercial.

### `lib/task-engine.js`

É a porta oficial para análise, petição, recurso, contestação, perícia, quesitos e revisão. Resolve um único processo, exige material, faz triagem, bloqueia perícia sem evidência confiável e termina em `aguardando_revisao`.

### `lib/process-store.js`

É a fonte de persistência da carteira: snapshot JSON versionado no Supabase (`processos_cache`) com CAS e retry de conflito. Não trocar de banco durante o piloto.

### `lex_agente_vivo_core.js`

É o cérebro conversacional. Ainda contém linguagem e setores do modelo antigo (`autuacao/administrativo/judicial`) e endpoints especializados paralelos. Na casca comercial, ordens administrativas e de produção devem ser interceptadas antes e encaminhadas ao `office-routes`/`TaskEngine`.

### `conector-navegador`

Existe e é real, mas é assistido: o usuário abre uma página `.jus.br`, seleciona o texto do andamento, confere CNJ/data e envia ao LEX por token temporário. Não é varredura automática do PJe nem login remoto do servidor.

## Regra de consolidação

1. `office-ui-v2` + sidecars = produto comercial.
2. `/api/vivo/conversar` = conversa do LEX.
3. `/api/escritorio/*` = estado/movimento do escritório.
4. `/api/tarefas` + `TaskEngine` = produção jurídica.
5. `ProcessStore` = carteira persistida.
6. Rotas e telas antigas ficam como compatibilidade até migração, mas não recebem novas entradas da casca comercial.

## Correção aplicada neste corte

A navegação comercial de `peticao` e `pericia` deixa de abrir os geradores antigos e passa a abrir o LEX central com a ordem preparada. O comando é então interpretado pelo `office-command-ui` e, com processo selecionado, cria tarefa em `/api/tarefas`. `agentes` passa a abrir o quadro comercial do Escritório.

## Pendências encontradas para próximos cortes

- Remover configuração/identidade específica embutida em textos de runtime e derivar tudo do cadastro do escritório.
- Consolidar ou congelar `/api/gestor/chat` e os geradores vivos especializados que não pertencem ao fluxo oficial.
- Corrigir `lex-whatsapp.html`, cuja rota de cliente usa contrato antigo ao chamar `/api/vivo/conversar`.
- Revisar exportações para garantir que segredos/configurações sensíveis não sejam incluídos em backup de dados.
- Harmonizar motor proativo e prompts do agente vivo com as nove salas oficiais, sem permitir que status/setor legado desfaça `office_stage`.
- Homologar o ciclo no domínio somente quando o deploy Vercel da `main` estiver disponível.
