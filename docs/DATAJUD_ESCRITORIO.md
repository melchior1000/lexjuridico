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

## Correções de 13/10/2026 (auditoria de consulta e andamentos)

Cada item tem teste que falha se o erro voltar (`test/datajud-leitura.test.js`,
`test/atualizar-processo.test.js`, `test/andamentos.test.js`, `test/andamentos-tela.test.js`).

- **Não achar não é "sem movimentação".** Lista vazia do Datajud (segredo de justiça, número ou
  tribunal a conferir, processo ainda não indexado) agora volta `ok:false, nao_encontrado:true`,
  grava `datajud_nao_encontrado_em` e **não** conta como leitura oficial recente. Resposta sem a
  lista de resultados é falha de consulta (não "não encontrado").
- **Todos os registros do número** (1º e 2º grau vêm separados): `size:10`, movimentos juntos, sem
  repetir, do mais novo para o mais antigo. O último movimento é o mais novo de verdade.
- **Complemento pelo nome** ("Intimação"), não pelo tipo ("tipo_de_documento"). O que já estava
  gravado com o texto antigo (ou só com o nome, pela varredura antiga do servidor) é **corrigido no
  lugar**, conta como `corrigidos` (não como novo) e guarda `txt_anterior` — quem já viu o
  andamento não o recebe de novo como novidade.
- **Endereço do tribunal**: TRE-DF é `tre-dft`, TSE é `tse`; STF e CNJ não têm base pública (o LEX
  diz isso em vez de chamar um endereço inexistente). O servidor deixou o mapa feito à mão (que
  trocava 8.04 por TJPE e 8.07 por TJES) e usa o mesmo cálculo da rotina diária.
- **Resposta guardada uma vez**: leitura com o mesmo corpo da anterior não guarda o corpo de novo
  (`mesmo_corpo_de`); o hash continua em cada leitura.
- **Carteira**: arquivado/baixado/encerrado não é lido todo dia; número citado em outro cadastro
  ("A / Embargos B") não bloqueia a leitura de B; sem `DATAJUD_API_KEY` ou sem
  `COURT_READING_INTEGRITY_KEY` (32 bytes ou mais) não se gasta consulta.
- **Rotina diária**: processo não encontrado não faz o dia recomeçar; nova tentativa no mesmo dia
  (Diário falhou, OAB faltando) **não relê** a carteira no Datajud; cada aviso sai uma vez por dia;
  os Recibos não somam a mesma carteira várias vezes.
- **"Atualize este processo"** sem PJe (ou com PJe que não cobre o tribunal): lê o Datajud na hora
  e diz que é a base pública do CNJ, que **pode atrasar alguns dias e não traz o Diário**. Sem
  nenhuma fonte, responde `ok:false` com o que falta — nunca "atualizado".
- **Botão "Verificar andamentos" e relógio do PJe** (`/api/pje/sincronizar`): usam a mesma leitura
  (`syncRegistered`), com recibo, sem duplicar; a tela mostra o erro quando nada foi consultado.

O Datajud **não é fonte de prazo**: atrasa e não traz as intimações do Diário. Prazo nasce do
DJEN/PJe e da confirmação humana (AGENTS.md §18).

## Andamentos: ordem pela data real (`lib/andamentos.js`)

O campo `andamentos` mistura "13/10/2026" (anotação), "2026-10-13" (Diário, PJe) e ISO do Datajud,
e cada fonte gravava numa ordem. Regra única, no servidor (`lib/andamentos.js`) e na tela
(`_lexAndamentosRecentes`/`_lexUltimoAndamento` em `index.html`):

- do mais novo para o mais antigo pela data real; dia sempre o de Brasília; data "sem hora" que
  veio como meia-noite UTC é o próprio dia; sem data vai para o fim;
- mesma data: fica a ordem gravada (o andamento novo entra no início) — ordenar de novo não troca;
- "último andamento" para dias parado é o mais novo **que já aconteceu** (data futura não conta);
- a tela de detalhe mostra a lista ordenada e o botão de excluir confere a chave (data + texto)
  antes de apagar, para nunca apagar outro andamento se a lista mudou.

Trava permanente: `test/andamentos-tela.test.js` falha se qualquer código voltar a ler
`andamentos[0]`, `.slice(0,N)` do campo bruto ou ordenar por texto.

