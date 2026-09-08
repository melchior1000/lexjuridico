# LEX — auditoria inicial e correções de acesso

Data: 07/09/2026. Base examinada: `cd09982c4890c3bfbb78635b2b7b07f80e3f9353`.
Branch: `codex/auditoria-lex-20260907`.

## Inventário

| Arquivo | Linhas na base | Função observada |
| --- | ---: | --- |
| index.html | 13.844 | Interface, sessão, processos e sincronização |
| bot.js | 14.293 | Servidor HTTP nativo, API, integrações, documentos e agentes |
| lex_agente_vivo.js | 1.721 | Agente vivo delegado pelo servidor |
| lex-whatsapp.html | — | Interface de WhatsApp |
| package.json | — | Inicialização e oito dependências diretas |

Os três arquivos principais somam 29.858 linhas. Foram identificados 75 caminhos
literais distintos por busca estática; isso não é um inventário exaustivo de
rotas dinâmicas. O repositório recebido não contém testes, lockfile, instruções
AGENTS.md ou configuração Sites. Comentários antigos citam 293 testes, mas essa
suíte não acompanha os arquivos recebidos e não foi verificada.

## Correções deste conjunto

- Nove caminhos passam a autenticar antes de consumir o corpo ou chamar dependências:
  sincronização de versão, comandos, memória, exportação de memória, fila, DOCX
  de fallback e três rotas de diagnóstico/teste de IA.
- Diagnóstico e testes de IA exigem administrador. O diagnóstico deixa de mostrar
  o prefixo da chave de API.
- Login valida perfil próprio da tabela de permissões e senha textual antes de
  consultar a configuração. Sem senha previamente configurada, responde 503;
  não cadastra mais a senha escolhida pelo primeiro visitante.
- A abertura/reconexão SSE usa o validador comum de sessão, respeitando revogação
  e inatividade. A validação também rejeita timestamps inválidos e perfis herdados.

O frontend já injeta Authorization em fetchComTimeout, usado na sincronização
e na consulta de comandos. Nenhum HTML, estilo ou módulo do agente foi alterado.

## Validação e limites

31 testes passam com `npm test`, usando apenas recursos nativos do Node.
O teste executa o handler HTTP real e as funções reais de token em contexto
isolado, com dependências substituídas. Cobre bloqueios anônimos, tokens inválidos,
restrição de diagnóstico, login e acesso autorizado a comandos/memória, SSE
revogado/inativo e disponibilidade do health check.

Passaram também a verificação de sintaxe dos dois arquivos JavaScript, dos três
scripts inline do index.html e do script inline de lex-whatsapp.html, além de
`git diff --check`. Isso não constitui teste visual ou de funcionamento integral.

O bot completo não foi iniciado: seu startup ativa integrações e rotinas
periódicas. Não foram acessados bancos de produção, enviados avisos, feitas
chamadas pagas de IA ou alteradas configurações de hospedagem. Não houve teste
de carga, auditoria de dependências transitivas ou varredura do histórico por
segredos. A auditoria integral de todas as funções permanece pendente.

## Achados ainda pendentes

1. As duas entradas de webhook WhatsApp precisam de revisão da autenticação do
   provedor e implantação coordenada com sua configuração. Não foram fechadas
   neste conjunto para não interromper a integração existente.
2. Há duas implementações da mesma rota POST /api/trocar-senha. A primeira retorna
   antes da segunda. O fluxo de persistência de senha pode informar sucesso sem
   verificar a resposta HTTP da gravação. Exige consolidação e testes próprios.
3. POST /api/docx transforma texto em bytes UTF-8 com extensão DOCX; isso não cria
   um pacote Word válido. A ordem de composição de cabeçalhos em downloads pode
   substituir o MIME específico por application/json. Requer correção funcional.
4. O corpo HTTP tem limite padrão de 500 MB e acumula chunks em memória. Falta
   política por rota, controle de concorrência e tratamento consistente de erros.
5. O rate limit confia diretamente em x-forwarded-for; a cadeia de proxies precisa
   ser confirmada antes de definir qual endereço deve ser considerado confiável.
6. A conexão SSE já aberta não é fechada imediatamente por revogação; este conjunto
   corrige a abertura/reconexão. Expiração, renovação e encerramento de streams
   precisam ser tratados juntos em uma revisão de sessão.
7. O repositório é público e contém contexto jurídico incorporado ao código.
   A separação entre código e dados e a visibilidade precisam ser avaliadas pelo
   responsável antes de ampliar a divulgação. Não há conclusão de vazamento de
   produção nem de exposição de credenciais baseada apenas neste inventário.

## Antes de integrar em produção

Confirmar que os perfis usados têm senha configurada no servidor ou na tabela
de configuração; visitantes não poderão mais fazer cadastro inicial pelo login.
Consumidores externos de comandos/memória/fila devem enviar token válido.
Downloads de memória abertos diretamente sem token receberão 401; o fluxo de
exportação deve fornecer autenticação. Testar login, sincronização e reconexão SSE
em ambiente de homologação. Integrar somente após essa validação.

Este conjunto é uma correção inicial de segurança, não uma declaração de que
o sistema inteiro está seguro ou pronto para publicação.

## Segunda revisão — 07/09/2026

As seções anteriores registram o primeiro commit, com 31 testes. Nesta revisão,
HTML e agente também foram alterados. Os achados 2 (troca de senha duplicada) e 3
(DOCX/cabeçalhos) foram corrigidos localmente. Os demais não estão encerrados.

### Correções adicionais

- Uma rota de troca de senha, perfilAlvo validado, mínimo de oito caracteres e
  confirmação de persistência. Senha do banco prevalece sobre bootstrap antigo.
  Armazenamento de senhas ainda é legado; falta identidade individual.
- Biblioteca Supabase preserva status/erro, limita espera e bloqueia DELETE sem
  filtro. Busca de documentos e consultas revisadas extraem o array do envelope;
  upload não informa sucesso quando o banco recusa a escrita.
- Agente vivo confirma registro alterado antes de atualizar cache e notificar.
  Serializa atualizações do mesmo caso na mesma instância, preserva prazo em novo
  andamento e rejeita data inexistente. Não é transação distribuída.
- Ferramentas de proposta não alegam execução; ferramenta desconhecida retorna
  erro. Aplicação/geração pelo agente exige administrador. O chat transmite o
  perfil ao executor de marcadores, que recusa escrita de secretaria.
- Endpoint de relatório exige sessão. Token invalidado por inatividade não
  renasce numa segunda validação dentro da mesma instância.
- DOCX agora é pacote OpenXML; nove downloads preservam MIME específico.
  SMTP impede anexos por caminho local ou URL; anexos em buffer continuam.
- Retirada a chamada direta Anthropic e o campo de chave no navegador. IA depende
  do servidor autenticado. Dados/modelos do sistema continuam sujeitos à revisão.
- Modelos Anthropic aposentados substituídos por sucessores documentados;
  configuração por ambiente, concorrência compartilhada e limite de ciclos.
  Não foram ativados Managed Agents ou um teto financeiro mensal.
- Removidas cinco dependências sem uso encontrado no runtime. Mantidas jszip,
  pdf-lib e nodemailer; nodemailer atualizado para 10.0.1 e lockfile adicionado.

### Evidência e incidente de integridade

Na revisão final foi encontrada truncagem do bot.js na cópia de trabalho. O
arquivo completo foi recuperado do commit preservado, mantendo o início já
editado e reaplicando as correções pontuais. Nenhum arquivo truncado foi enviado
ao GitHub. A sintaxe do backend e scripts inline foi verificada após recuperação.
Esse incidente reforça a necessidade de examinar diff e conteúdo, além de testes.

58 testes locais passam após a recuperação. Cobrem autenticação revisada,
persistência recusada, concorrência no agente, prazo, propostas de ferramentas,
MIME, pacote DOCX com CRC, geração PDF e mensagem MIME local. Dependências externas
são simuladas; parsers/geradores de documentos usam bibliotecas reais. Os testes
não comprovam fidelidade visual dos documentos nem operação integral.

`npm run check` e `git diff --check` passam. A auditoria npm executada após a recuperação,
com nodemailer atualizado, reportou zero vulnerabilidades conhecidas; isso não
constitui auditoria de segurança completa nem comprovação de ausência de falhas.

Não houve chamada paga, acesso a banco de produção, envio real, teste de carga,
validação visual, restauração ou deploy. Não foi concluída auditoria de cada função.
O novo backlog descreve os critérios restantes para tornar o produto comercial.

## Preparação de canais — 07/09/2026

Ver docs/CANAIS_E_AGENTES.md. Número próprio configurável fora do código público;
WhatsApp valida estado e identidade da sessão, status/mensagem exigem sessão,
configuração exige admin e confirmação de persistência. Telegram e WhatsApp texto
validam confirmação do provedor; central não registra falha como envio bem-sucedido.
Diagnóstico dos canais e inventário de agentes não confundem configuração com
homologação. 76 testes locais passam. Integrações reais continuam pendentes.

## Verificação de 08/09/2026

[Relatório atualizado](docs/VERIFICACAO_20260908.md): 93 testes passam após revisão
de alertas, fuso, prazos, envio de anexos, confirmação de entrega, DOCX pelos canais
e autenticação das duas entradas WhatsApp. Os tiers Anthropic passam a usar Opus
4.8 por padrão sem redução automática. GitHub está autorizado para escrita; o
bloqueio 403 descrito acima é histórico. Produção ainda não recebeu este conjunto.
O relatório identifica expressamente as limitações restantes do motor proativo,
armazenamento, PJe, isolamento e alternância integral de APIs.
