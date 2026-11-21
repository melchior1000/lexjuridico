# Ligações por voz ao cliente — Etapa 1

Pedido do titular (21/11/2026): o LEX liga para o cliente como um assessor faria e volta com o
que foi dito. Esta etapa entrega a ligação **pedida na conversa** ("liga para a Maria lembrando a
perícia de terça às 9h"), com o OK do titular, e o resultado anotado no processo.

## Como funciona

1. O titular pede, do jeito dele, pelo app, WhatsApp ou Telegram.
2. A IA escreve o objetivo da ligação e chama `preparar_ligacao_cliente`.
3. O LEX mostra, logo abaixo da resposta, **para quem vai ligar, o número e o objetivo** (a mesma
   prévia das mensagens ao cliente, `lib/andamento-conversa.js`).
4. Só o "pode" do titular, na mensagem seguinte, disca (`lib/voz-ligacoes.js`).
5. A plataforma de voz fala com o cliente (`lib/voz-retell.js`) e avisa o LEX no fim
   (`POST /api/voz/aviso`, com assinatura conferida).
6. O LEX resume a conversa, anota `[LEX] Ligação…` no processo e conta ao titular no canal.
   A transcrição fica guardada; a IA lê com `ligacoes_do_escritorio`.

## Travas (código, não promessa)

- Nada é discado sem o OK do titular, conferido fora da IA. Não existe ferramenta que disque.
- A assistente se apresenta como **assistente virtual**, avisa que **a ligação é gravada** e só fala
  do caso depois que a pessoa diz o **nome completo** do cliente (um "sim" não basta). Caixa postal
  recebe só "retorne esta ligação", sem nome de escritório. (Recomendação do CFOAB sobre IA
  generativa, 11/11/2024 — comunicar o uso de IA; sigilo profissional.)
- **Ligação discreta** (família, violência, penal, segredo de justiça — automática — ou a pedido):
  o nome do escritório só depois da confirmação do nome completo.
- Não dá opinião jurídica, não negocia, não fala de valores nem de honorários.
- Só para cliente de processo cadastrado e por telefone brasileiro de verdade (+55 e DDD). Nunca
  para oferecer serviço (Código de Ética da OAB, art. 46, parágrafo único).
- Horário: seg–sex 9h–19h, sábado 9h–13h, nunca domingo nem feriado nacional, valendo no relógio
  de Brasília **e** no do cliente (fuso pelo DDD) (`LEX_VOZ_JANELA`, `LEX_VOZ_SABADO`).
- Quem pediu PARE no WhatsApp — em qualquer contato gravado do processo, inclusive pelo código
  interno do WhatsApp — ou disse "não me ligue" numa ligação não recebe mais (marcado pelo número e
  pelo processo). Sem conseguir conferir, não liga. Só o advogado libera ("a Maria voltou a aceitar
  ligação" → `liberar_ligacoes_cliente`).
- Sem resposta da plataforma, a ligação fica "pode ter saído" — nunca "não saiu" sem prova — e o
  LEX pergunta à plataforma depois de 15 minutos.
- Teto diário (`LEX_VOZ_TETO_DIARIO`, padrão 40). O mesmo OK nunca disca duas vezes.
- Aviso da plataforma sem assinatura válida (ou com mais de 5 minutos) é recusado; aviso repetido
  não reprocessa; aviso de outra ligação é ignorado.

## O que o titular precisa fazer (uma vez)

1. Criar conta na Retell (retellai.com) e colocar saldo.
2. Contratar um **número brasileiro** numa operadora com tronco SIP (por exemplo, Twilio ou Telnyx)
   e importar esse número na Retell. Número comprado dentro da Retell só liga para os EUA.
3. Nas variáveis do servidor do LEX (Render): `RETELL_API_KEY` e `LEX_VOZ_NUMERO` (+55...).
4. Rodar uma vez `node scripts/configurar-voz.js` com `RETELL_API_KEY` e `LEX_SERVIDOR_URL`
   (escolher a voz em português que ele listar e rodar de novo com `LEX_VOZ_VOICE_ID`). Ele cria o
   agente e mostra o `RETELL_AGENT_ID` para colocar nas variáveis.
5. Acrescentar no contrato de honorários a autorização de contato por assistente virtual, de
   gravação da ligação e do tratamento dos dados pela plataforma de voz no exterior.

Sem as três variáveis (`RETELL_API_KEY`, `RETELL_AGENT_ID`, `LEX_VOZ_NUMERO`), as ligações ficam
desligadas e o LEX diz isso quando pedirem.

## Homologação (critério de pronto)

Ligação real para o celular do titular: pedido na conversa → prévia → "pode" → toca → assistente
se apresenta → fim → anotação no processo → relato no canal. Conferir também: "pode" sem prévia
não disca; fora do horário não disca; número com PARE não disca; `GET /api/voz/estado` mostra a
ligação.

## Limites conhecidos desta etapa

- O LEX ainda não propõe lembrete sozinho (D-3/D-1 de audiência e perícia): os eventos do
  calendário da tela ficam só no navegador (`localStorage`), não no servidor. Próxima etapa.
- Gravação: o LEX não guarda o link. O agente é criado com link assinado de 1 h e com a plataforma
  apagando tudo em 90 dias (o padrão dela é guardar para sempre). A transcrição fica no LEX por
  `LEX_VOZ_GUARDA_DIAS` (padrão 180); o resumo fica no processo. Os dados passam pela plataforma no
  exterior: o contrato com ela e o de honorários precisam prever isso (LGPD, art. 33).
- A confirmação de identidade é pelo nome completo dito pela pessoa; verificação por dado que só o
  cliente sabe (fluxo em duas etapas na plataforma) fica para a Etapa 2.
- Atender o telefone do escritório (ligação de entrada) é a Etapa 2.
- Escritório único por servidor, como o resto do LEX hoje; por escritório, junto com o tenant real.
