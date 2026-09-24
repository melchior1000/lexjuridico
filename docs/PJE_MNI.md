# PJe no LEX — integração oficial pelo MNI

## O que faz

| Ação | Operação MNI | Dá ciência? | Quem dispara |
|---|---|---|---|
| Vigiar expedientes (intimação, citação, notificação, vista) | `consultarAvisosPendentes` | **Não** | Automático, a cada 2 h (6h–22h) |
| Ver cabeçalho e movimentos de um processo | `consultarProcesso` com `incluirDocumentos=false` | **Não** | Sob demanda |
| Abrir o teor de um expediente | `consultarTeorComunicacao` | **Sim — o prazo começa** | Só o advogado, com `CONFIRMO CIENCIA SIGLA ID` |

Para cada expediente, o LEX guarda tribunal, número do aviso, tipo, data de envio, processo (casado pelo CNJ exato) e a **data da ciência tácita**. Se ninguém abrir o expediente em 10 dias corridos do envio, o sistema do tribunal registra a ciência sozinho às 23:59:59 do 10º dia (Lei 11.419/2006, art. 5º, §3º). O prazo tem como marco o dia útil seguinte à consulta ou ao fim desses 10 dias (CPC, art. 231, V).

Expediente novo gera aviso no Telegram e no WhatsApp do titular. Expediente que sai da lista sem ter sido aberto pelo LEX vira `nao_listado`: ele pode ter sido aberto em outro lugar ou ter tido ciência tácita, e **nunca é tratado como resolvido**.

## Pelo WhatsApp/Telegram

- "intimações do PJe" / "tem expediente pendente?" — lista com a data da ciência tácita.
- "tem intimação nova?" — DJEN e PJe juntos.
- "abrir intimação TJMG #123" — o LEX avisa que abrir dá ciência e pede a frase exata.
- "CONFIRMO CIENCIA TJMG 123" — abre o teor, grava o texto, registra o andamento no processo e informa que o prazo começou. Só perfil advogado/admin. A autorização vale 10 minutos e só para aquele aviso.
- O bom dia inclui o total de expedientes e a próxima ciência tácita.

## Configuração (por escritório)

Ver `config/lex.env.example`: `PJE_MNI_TRIBUNAIS`, `PJE_MNI_CPF`, `PJE_MNI_SENHA` e, se o tribunal exigir TLS mútuo, `PJE_MNI_PFX_BASE64`/`PJE_MNI_PFX_SENHA`.

- O endereço tem que ser HTTPS em domínio `.jus.br`, para a senha não ser enviada a outro servidor.
- Senha e certificado nunca aparecem em log, erro ou resposta.
- `npm run status:integracoes -- --live` testa o acesso em cada tribunal com `consultarAvisosPendentes`, que só lista e não dá ciência.
- `GET /api/escritorio/pje/avisos` lista os expedientes para a interface. `POST /api/escritorio/pje/sincronizar` força uma leitura (advogado/admin).

## Limites conhecidos — homologar por tribunal

1. **Acesso do advogado ao MNI varia por tribunal.** Uns aceitam CPF e senha, outros exigem certificado (TLS mútuo) ou cadastro prévio do sistema. Confirmar com o tribunal antes de ativar.
2. **Namespaces e endereço** seguem a versão 2.2.2 publicada pelo CNJ. Se o WSDL do tribunal divergir, ajustar `PJE_MNI_NS_SERVICO`/`PJE_MNI_NS_TIPOS`. O parser não depende de prefixo.
3. O ambiente de desenvolvimento não alcança `*.jus.br`. Os testes usam respostas no formato do MNI 2.2.2, e a primeira leitura real precisa ser feita com o advogado, conferindo a lista no painel do PJe.
4. **Protocolo/peticionamento** (`entregarManifestacaoProcessual`) não foi implementado de propósito: exige assinatura com certificado e revisão humana.
5. Credenciais hoje são por implantação (variáveis de ambiente). No SaaS com vários escritórios, mover para cofre de segredos por escritório.

## Fontes

- CNJ — Modelo Nacional de Interoperabilidade, versão 2.2.2 (`servico-intercomunicacao-2.2.2`, `tipos-servico-intercomunicacao-2.2.2`).
- SEEU/PJe — Consulta de Avisos Pendentes e Teor da Comunicação: https://docs.seeu.pje.jus.br/docs/documentacao-tecnica/manual_avisos_pendentes_comunicacao/ (a consulta ao teor registra a ciência e inicia o prazo).
- Lei 11.419/2006, art. 5º, §§1º e 3º; CPC, art. 231, V.

## Atualizar a carteira (andamentos e partes)

- Pelo WhatsApp/Telegram/web: "atualize meus processos" (toda a carteira) ou "atualize o processo da Maria" / CNJ.
- Botão "Atualizar do tribunal" na tela do processo (usa PJe; sem PJe conectado, Datajud, que não traz partes).
- Automático: uma vez por dia, na primeira ronda da vigia a partir das 6h; andamentos novos geram aviso.
- Usa `consultarProcesso` com `incluirDocumentos=false` (não dá ciência). Tribunal deduzido do CNJ (J.TR): 8.13=TJMG, 8.26=TJSP, 4.06=TRF6 etc.
- Campo número com vários autos ("6002060-50... / Embargos 6002846-94...") atualiza todos; campo que começa com texto ("A confirmar — vinculado a...") não atualiza, porque o número citado é de outro processo.
- O relatório diz o que não foi atualizado e por quê: sem CNJ, tribunal não conectado, falha do tribunal.
