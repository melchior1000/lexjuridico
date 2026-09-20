# LEX — contrato de fechamento comercial

Leia este arquivo antes de planejar, editar, revisar, abrir PR, fazer merge ou deploy.

## Missão

Entregar o LEX Jurídico inteiro como produto final funcional, seguro, operável e comercializável. Não redesenhar o produto, não recomeçar e não reduzir o escopo a um recorte de telas.

O resultado final não é relatório, PR, CI verde ou preview. É o produto integrado em produção, com os fluxos reais homologados e com evidência reproduzível dos gates comerciais.

## Fontes de verdade

1. `docs/LEX_LISTA_MESTRA.md`: checklist operacional de 16 etapas aprovado pelo titular.
2. Este arquivo: contrato de execução do agente.
3. Código, schema, infraestrutura e PRs no estado atual: fatos técnicos a auditar.
4. `docs/ESPECIFICACOES_E_BACKLOG.md`: contratos comerciais e riscos de SaaS; itens históricos devem ser revalidados contra o código atual antes de serem tratados como pendentes.

Relatório histórico não prevalece sobre evidência atual. Não marcar pendência como resolvida sem verificar o código/ambiente atual; não reabrir pendência antiga sem reproduzir ou confirmar que ainda existe.

## Regra de ouro

Uma etapa só recebe ✅ quando houver, conforme aplicável:

1. implementação no código efetivamente usado;
2. testes automatizados relevantes;
3. CI e revisão sem pendência relevante;
4. merge e deploy no ambiente correto;
5. homologação real quando envolver canal, banco, navegador, credencial, tribunal ou ação externa.

Não confundir preview com produção, configuração com funcionamento, transporte com ponta a ponta, resposta textual com execução, ou merge com homologação.

## Método obrigatório: pente-fino antes de construir

Antes de criar solução nova:

- identificar a `main` e o commit efetivamente implantado;
- inventariar PRs abertos, branches relevantes e sobreposição entre mudanças;
- ler o código existente do fluxo afetado e seus testes;
- conferir banco/schema/migrações/políticas quando a mudança depender deles;
- conferir Render/Vercel e integrações reais quando a mudança depender deles;
- procurar código duplicado, rotas duplicadas, fallbacks enganosos, estado em memória/localStorage usado como verdade, funções mortas e UI que promete ação inexistente;
- comparar PRs antigos com a `main` atual antes de reaproveitar qualquer commit;
- fechar/rejeitar/substituir PR obsoleto quando houver evidência; não empilhar correções concorrentes.

Para arquivos grandes, editar cirurgicamente. Não substituir integralmente `bot.js` ou `index.html` para uma alteração pequena. Revisar diff e preservar código não relacionado.

## Arquitetura que deve sobreviver ao fechamento

Web/App, WhatsApp e Telegram são portas do mesmo LEX Core. A entrada deve carregar canal, identidade, contexto e autorização; o Core resolve intenção, pessoa, processo e documentos; executa diretamente o que for seguro ou aciona Task Engine/playbook; a resposta retorna ao canal de origem.

Preservar e concluir, em vez de recriar:
- LEX Core / agente vivo;
- Task Engine e recuperação segura;
- pipeline/Home/status;
- playbooks/agentes;
- recepção unificada;
- WhatsApp/Evolution;
- Telegram;
- processos, prazos e documentos;
- contexto por processo;
- Datajud/PJe/DJEN e verdade auditável do prazo;
- histórico e trilha de auditoria;
- travas de revisão/autorização humana.

Não exigir que o operador escolha IA/setor ou memorize comandos. Linguagem natural deve virar ação real. Ambiguidade de pessoa/processo deve pedir esclarecimento; nunca escolher o primeiro resultado.

## Estado de canais

WhatsApp/Evolution e Telegram já possuem fundações de transporte/recepção e houve homologações anteriores registradas na lista-mestra. Não recriar instância, bot, token, webhook ou pareamento por padrão. Pedir QR/credencial somente com evidência objetiva de perda/invalidade da sessão ou configuração.

Etapas 7 e 8 exigem homologação ponta a ponta separada. Canal configurado não é canal homologado.

## Ações sensíveis

Consultar, organizar, cadastrar, analisar e preparar podem seguir a ordem autorizada do operador dentro das permissões.

Envio sensível, alteração crítica, aprovação final, protocolo, PJe e outras ações externas de efeito relevante mantêm autorização humana quando exigida pelo desenho do produto. A aprovação deve se referir à ação/destinatário/documento/versão corretos; mudança relevante invalida aprovação anterior.

Falha ou timeout de provedor não pode ser registrado como sucesso. Resultado externo ambíguo deve ser reconciliado antes de repetição.

## Interface comercial

Não criar “coordenador 2” ou casca paralela.

Fazer as telas atuais cumprirem o que prometem:
- celular, tablet e desktop;
- sem encoding quebrado;
- sem botão morto;
- sem ação que apenas simula trabalho;
- Home, Processos e Prazos coerentes com a mesma fonte de verdade;
- “Precisa de você” informa pessoa/processo, motivo, ação necessária e leva ao item correto;
- seleção de processo e histórico não vazam contexto;
- anexos e respostas permanecem vinculados ao processo/canal correto;
- estados de loading, erro, vazio, offline/conflito e permissão são honestos.

## Gate comercial / SaaS

“Funciona para o titular” não equivale a “pronto para vender”.

Antes de declarar comercializável, auditar e fechar com testes reproduzíveis:

- identidade individual e autorização no servidor;
- associação de usuário a escritório/tenant;
- isolamento de processos, documentos, buscas, históricos, tarefas, exportações e ferramentas entre escritórios;
- políticas RLS/schema/migrações do banco ou mecanismo equivalente de isolamento comprovado;
- nenhum acesso cruzado por troca de ID, busca, cache, exportação ou service role mal escopado;
- segredos somente no servidor/secret store, sem exposição no cliente ou logs;
- armazenamento/versionamento/hash/recuperação de documentos;
- idempotência e recuperação de eventos/canais;
- limites de upload, memória, concorrência e abuso;
- sessão, revogação, rate limit e proxy confiável;
- observabilidade sem conteúdo sensível desnecessário;
- backup, restauração, migração e rollback exercitados;
- orçamento/limites de IA por escritório quando houver cobrança/consumo compartilhado;
- onboarding/configuração sem editar código-fonte para cada cliente;
- instalação/deploy reproduzível e documentação operacional.

Teste obrigatório de isolamento: criar pelo menos dois escritórios sintéticos e provar que usuários de A não conseguem ler, buscar, alterar, exportar ou acionar ferramentas sobre dados de B, inclusive manipulando IDs.

## PJe, Datajud, DJEN e prazo

Não simular integração.

Consulta oficial deve guardar proveniência/evidência e frescor. Prazo jurídico não nasce de texto inventado pela IA. Intimação/citação/protocolo devem respeitar autenticação, estado de sessão, autorização humana e resultado verificável.

PJe de teste/homologação deve cobrir sessão válida, sessão expirada, indisponibilidade, resultado ambíguo e reconciliação. Nunca declarar protocolo concluído sem recibo/evidência oficial correspondente.

## Documentos e qualidade jurídica

Documento final precisa ser arquivo válido, versionado e rastreável. Não descartar a única cópia. Revisão humana continua antes de entrega/protocolo quando exigida.

Jurisprudência e fonte jurídica não podem ser inventadas. Conteúdo não verificado deve ser sinalizado como tal. Dados específicos de um escritório não devem ficar embutidos no produto comercial compartilhado.

## Fluxo de trabalho

Auditar → reproduzir o defeito/gap → corrigir → testar → revisar CI/CodeRabbit → integrar → deploy → homologar → registrar evidência → avançar.

Preferir um fluxo de integração por vez. Não abrir PR paralelo para a mesma pendência. PR antigo é insumo, não autoridade: comparar com a base atual e reaplicar somente mudanças válidas.

Não parar depois de uma etapa só porque ela fechou. Continuar pela lista-mestra até o gate final.

## Proibido

- redesenhar o LEX sem necessidade comprovada;
- reduzir o produto às “quatro telas”;
- criar agente/fachada decorativa;
- criar tela que promete função não executada;
- selecionar pessoa/processo por primeiro resultado;
- registrar envio/protocolo/gravação como sucesso sem confirmação;
- usar fallback que esconda falha;
- tratar cache/localStorage como autoridade de autorização;
- carregar PR histórico inteiro sem revisar sobreposição e regressões;
- declarar SaaS pronto sem isolamento entre escritórios comprovado;
- declarar etapa concluída só por teste mockado;
- pedir ao titular informação que pode ser obtida com segurança no repo/infra já autorizada.

## Bloqueio humano

Trabalhar autonomamente. Parar somente quando a próxima ação exigir necessariamente o titular, por exemplo:
- autenticação/2FA/QR realmente necessário;
- credencial inexistente ou sem acesso;
- autorização de gasto/plano pago;
- autorização de ação externa sensível;
- homologação física que só o titular pode observar/realizar.

Quando parar, pedir uma única ação objetiva, explicar a evidência do bloqueio e indicar exatamente como retomar depois.

## Definição final de pronto

Só declarar “LEX pronto para comercialização” quando:

- as 16 etapas da lista-mestra estiverem fechadas com evidência;
- regressão completa estiver verde;
- produção estiver no commit aprovado;
- fluxos Web/App, WhatsApp e Telegram estiverem homologados;
- PJe/Datajud/DJEN e prazos estiverem no nível funcional prometido, sem simulação;
- interface estiver homologada em celular/tablet/desktop;
- isolamento multi-escritório e autorização estiverem comprovados;
- documentos, backup/restore, observabilidade, segurança operacional e rollback estiverem exercitados;
- não houver defeito aberto conhecido que permita vazamento entre escritórios, perda silenciosa de documento/prazo ou ato externo sem autorização.

Se algum gate falhar, continuar corrigindo. Não substituir execução por outro plano.

**MISSÃO FINAL: não entregue outro plano. Entregue o produto.**
