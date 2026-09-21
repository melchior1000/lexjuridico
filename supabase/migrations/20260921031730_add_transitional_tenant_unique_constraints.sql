-- Transitional phase: add tenant-aware unique keys while keeping legacy
-- global keys in place. The runtime switches to these composite targets before
-- the legacy keys are removed in a later migration.

alter table public.configuracoes
  add constraint configuracoes_tenant_chave_key unique (escritorio_id,chave);
alter table public.whatsapp_recepcao_publica
  add constraint whatsapp_recepcao_publica_tenant_numero_key unique (escritorio_id,numero);
alter table public.clientes_pendentes
  add constraint clientes_pendentes_tenant_chat_key unique (escritorio_id,chat_id);
alter table public.conversas
  add constraint conversas_tenant_chat_thread_key unique (escritorio_id,chat_id,thread_id);
alter table public.djen_comunicacoes
  add constraint djen_comunicacoes_tenant_djen_key unique (escritorio_id,djen_id);
alter table public.djen_sync_state
  add constraint djen_sync_state_tenant_oab_key unique (escritorio_id,numero_oab,uf_oab);
alter table public.lex_status
  add constraint lex_status_tenant_agente_key unique (escritorio_id,agente_id);
alter table public.memoria_casos
  add constraint memoria_casos_tenant_caso_key unique (escritorio_id,caso_id);
alter table public.prazo_alertas
  add constraint prazo_alertas_tenant_processo_due_marco_key unique (escritorio_id,processo_id,due_at,marco);
alter table public.processos_cache
  add constraint processos_cache_tenant_id_key unique (escritorio_id,id);
alter table public.processos_sync
  add constraint processos_sync_tenant_processo_key unique (escritorio_id,processo_id);
