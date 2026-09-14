# Contrato de contexto do chat LEX

O chat comercial mantém dois conceitos separados:

1. **contexto processual** — `processo_id` selecionado;
2. **histórico conversacional** — pares `user`/`assistant` do fio atual.

A conversa geral usa um fio próprio. Cada processo usa outro fio, identificado por `processo_id`. A troca do processo selecionado troca também o histórico exibido e enviado ao servidor.

O navegador conserva no máximo 20 mensagens por fio em `sessionStorage`; isso é memória de sessão da interface, não prontuário nem fonte de verdade processual.

O servidor valida o `processo_id`. Se um ID enviado não existe na carteira autorizada carregada no servidor, `/api/vivo/conversar` deve responder 404 com `PROCESSO_CONTEXTO_INVALIDO` antes de qualquer chamada ao provedor de IA. Nunca deve rebaixar silenciosamente a solicitação para conversa geral.

O histórico recebido continua passando pelo sanitizador do agente, que aceita apenas papéis `user`/`assistant`, limita a janela e normaliza mensagens consecutivas antes de chamar o modelo.
