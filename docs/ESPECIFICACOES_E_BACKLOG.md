# LEX — contratos, sequência de construção e critérios comerciais

07/09/2026. Objetivo: produto completo para comercialização. Estado atual:
checkpoint de correções locais; NÃO liberar a clientes como versão pronta.
Inventário estático e revisão de fluxos críticos não equivalem a auditoria de
cada função. Schema real e ambiente integrado ainda não foram examinados.

## Contratos dos subsistemas

| Subsistema | Invariante exigida | Evidência de aceite |
| --- | --- | --- |
| Identidade e autorização | Cada usuário pertence a um escritório; acesso ao caso validado no servidor e banco | Usuários de dois escritórios não conseguem ler, buscar, exportar ou alterar o caso alheio, inclusive trocando IDs |
| Processos e prazos | Gravação confirmada antes do sucesso; conflito explícito; andamento não encerra prazo automaticamente | Banco indisponível, gravação concorrente, datas inválidas, fuso e alteração explícita exercitados |
| Agentes | Proposta não é execução; ferramentas restritas ao caso e ao papel | Documento malicioso não amplia permissões; tentativa fora do caso falha antes de rede ou escrita |
| Ações externas | Aprovação humana vinculada ao hash exato de destinatário, documento, versão e ação | Alteração após aprovação a invalida; repetição e crash não repetem efeito confirmado |
| WhatsApp/Telegram | Validar origem; guardar evento antes de responder; deduplicar por provedor/instância/evento | Webhook inválido, repetido, fora de ordem e reinício no meio do processamento |
| PJe | Executor com operações permitidas; consulta separada de protocolo | Credenciais de teste, sessão expirada, indisponibilidade, protocolo ambíguo e conciliação humana |
| Documentos | Manifesto imutável por versão; hash; nenhum descarte da única cópia | Download interrompido, disco cheio, hash divergente, restauração do banco e dos bytes |
| Pesquisa jurídica | Fonte, data da consulta e trecho atribuível; citação não verificada sinalizada | Casos de referência avaliados por responsável jurídico; fonte inexistente não vira citação confirmada |
| IA e orçamento | Reserva atômica antes de chamar; limite por escritório; contabilizar retries | Corrida por último saldo não ultrapassa reserva; falha não perde trilha de cobrança |
| Operação | Saúde, logs sem conteúdo sensível, recuperação e migrações reproduzíveis | Instalação limpa em homologação, restore, rollback e alertas exercitados |

Não prometer exactly-once de um serviço externo só por haver fila: se houver
resultado incerto após timeout, reconciliar pelo identificador externo antes de
reenviar. Sem essa possibilidade, exigir revisão humana do resultado ambíguo.

## Tickets pequenos em ordem de dependência

| ID | Entrega | Depende de | Situação / conclusão objetiva |
| --- | --- | --- | --- |
| LEX-01 | Inventário do código e checkpoint recuperável | — | Feito no repositório local; main preservada |
| LEX-02 | Acesso a rotas operacionais e diagnóstico | 01 | Correções e testes locais; autorização completa ainda depende de 05 |
| LEX-03 | Corrigir DOCX, cabeçalhos e falhas de persistência revisadas | 01 | Feito nos fluxos listados na auditoria; outras escritas permanecem no 07 |
| LEX-04 | Extrair schema, constraints, índices e políticas do banco de teste | 01 | Pendente: insumo não disponível; inventariar sem copiar dados pessoais |
| LEX-05a | Contas individuais e associação a escritório | 04 | Pendente; substituir senha compartilhada/plaintext |
| LEX-05b | Políticas RLS e autorização por processo | 05a | Pendente; testar duas organizações e service role no backend |
| LEX-06a | Manifestos e versões de documentos | 04,05b | Pendente; migração versionada e ensaio reversível |
| LEX-06b | Executor local autenticado com destinos permitidos | 06a | Pendente; nenhuma execução de shell fornecida por IA |
| LEX-06c | Confirmação, segunda cópia e restauração | 06b | Pendente; só depois habilitar limpeza temporária |
| LEX-07 | Repositório transacional de processos e auditoria/outbox | 05b | Parcial: agente confirma PATCH antes do cache; lock atual só vale na mesma instância |
| LEX-08a | Autenticação de webhooks por canal | 05b | Entradas WhatsApp protegidas e testadas em 08/09; falta configurar e homologar o provedor |
| LEX-08b | Inbox, idempotência e recuperação dos canais | 07,08a | Pendente; evento duplicado/reinício/timeout ambíguo |
| LEX-09 | Aprovação humana vinculada à ação e versão | 06a,07 | Pendente; aplicar em mensagens sensíveis, documentos finais e PJe |
| LEX-10 | Isolar busca, contexto e ferramentas por caso | 05b,06a,09 | Pendente; eliminar busca geral sem escopo no agente |
| LEX-11 | Orçamento durável e roteamento de modelos | 07,10 | Parcial: concorrência e ciclos limitados; falta teto financeiro |
| LEX-12 | Adaptador PJe em ambiente de teste | 06b,08b,09 | Pendente; não homologado por testes simulados |
| LEX-13a | Homologação ponta a ponta e visual | 06c–12 | Pendente: cadastrar cliente, processo, anexar, pesquisar, gerar, revisar, entregar, restaurar |
| LEX-13b | Carga, recuperação, instalação e rollback | 13a | Pendente; definir volume e objetivos de recuperação, medir resultado |
| LEX-14 | Piloto comercial e operação de suporte | 13b | Pendente; documentação, plano de atendimento, contratação e revisão jurídica do produto |

## Questões críticas que continuam abertas

- Segregação por escritório não existe comprovadamente. Perfis e cache global
  não bastam para vender acesso a vários escritórios na mesma implantação.
- Senhas legadas ainda ficam em configuração textual. Corrigir a persistência
  não converte isso em um sistema de identidade comercial.
- Há buscas gerais em documentos no agente e caminhos de gravação que ignoram
  falhas. A revisão atual não autoriza atribuir isolamento integral ao produto.
- Limite de corpo padrão 500 MB acumula dados em RAM. É preciso limite por rota,
  streaming quando cabível e quotas; medir com arquivos de tamanho representativo.
- Revogação de sessão não encerra imediatamente SSE aberto e não é durável entre
  instâncias. Proxy confiável/rate limit também exigem configuração de hospedagem.
- Conteúdo específico de escritório está incorporado ao código público. É preciso
  separar configuração e dados antes da distribuição e revisar o histórico.
- O startup inicia timers e integrações. Não foi executado contra serviços reais.
- A interface não passou por teste visual nesta revisão; remover a chave no browser
  exige servidor configurado e conectado para usar IA.

## Gate de liberação comercial

Só marcar uma versão candidata quando todos os contratos críticos tiverem
evidência reproduzível e não houver defeito aberto que permita acesso cruzado,
perda de documento, prazo alterado silenciosamente ou ato externo sem aprovação.
A contagem de testes não substitui essa matriz.

Guardar relatório de execução, versões de serviços, dataset sintético, resultados
de isolamento, restauração e integrações. Obter validação funcional do responsável
jurídico sobre casos representativos. Ensaiar atualização/rollback em homologação
com banco e credenciais separados. Produção e migração de dados são etapas
posteriores ao pacote revisável; nenhuma foi realizada aqui.

## Bloqueios concretos de execução externa

Em 08/09 a instalação GitHub foi autorizada e a escrita foi confirmada. O bloqueio
403 da revisão anterior foi resolvido. O monitoramento Render também funciona.
Ainda não há neste workspace schema validado, projeto de homologação conectado,
executor do escritório e credenciais de teste das integrações. Sem esses insumos,
não é possível comprovar o funcionamento completo ou certificar comercialização.
