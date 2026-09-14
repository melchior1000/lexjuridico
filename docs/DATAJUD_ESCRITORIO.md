# Datajud no fluxo do escritório

O Datajud é uma fonte pública de metadados e movimentações por número CNJ. Ele não substitui o PJe, não abre autos sigilosos e não usa sessão do tribunal.

Fluxo comercial:

1. selecione um processo já cadastrado com CNJ completo;
2. no LEX, peça `busca andamentos deste processo` ou `atualiza Datajud`;
3. o LEX chama `POST /api/escritorio/datajud` sem consumir IA para interpretar esse comando operacional;
4. o tribunal é derivado do próprio CNJ;
5. movimentos novos entram com origem `datajud` e prefixo `[DATAJUD]`;
6. repetição de data + texto é deduplicada;
7. CNJ ausente ou duplicado no cadastro bloqueia a consulta.

A variável `DATAJUD_API_KEY` deve ser configurada no servidor. Sem chave, a rota falha fechada e não declara atualização concluída.

O conector PJe continua sendo outra camada: ele é usado somente quando uma máquina autorizada do escritório possui sessão válida e envia os eventos pelo canal autenticado existente.
