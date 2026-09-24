-- Isolamento por escritório das tabelas que ficaram fora da primeira muralha.
-- Mesmo padrão de 20260921031543 (coluna + backfill) e 20260921033243 (RLS).
-- Idempotente: pode rodar de novo; tabela ausente é ignorada com aviso.
-- Backup antes de aplicar (ver 20260921031314_backup_pre_tenancy).

do $$
declare
  eid uuid;
  t text;
  tables text[] := array[
    'arquivo_morto_indice',
    'auditoria',
    'cobrancas_pix',
    'contatos',
    'documentos_indexados',
    'documentos_processo',
    'memoria_checkpoints',
    'mensagens_chat',
    'perfis_juizes',
    'tempo_uso',
    'vivo_acoes',
    'whatsapp_sessoes'
  ];
begin
  select id into eid from public.escritorios where slug='lex-atual';
  if eid is null then raise exception 'tenant inicial não encontrado'; end if;

  foreach t in array tables loop
    if to_regclass('public.'||t) is null then
      raise notice 'tabela ausente: %', t;
      continue;
    end if;

    execute format('alter table public.%I add column if not exists escritorio_id uuid', t);
    execute format('update public.%I set escritorio_id=$1 where escritorio_id is null', t) using eid;
    execute format('alter table public.%I alter column escritorio_id set not null', t);

    if not exists (select 1 from pg_constraint where conrelid=('public.'||t)::regclass and conname=t||'_escritorio_id_fkey') then
      execute format('alter table public.%I add constraint %I foreign key(escritorio_id) references public.escritorios(id) on delete restrict', t, t||'_escritorio_id_fkey');
    end if;
    execute format('create index if not exists %I on public.%I(escritorio_id)', t||'_escritorio_id_idx', t);

    execute format('grant select, insert, update, delete on public.%I to lex_backend', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists lex_backend_tenant on public.%I', t);
    execute format('create policy lex_backend_tenant on public.%I for all to lex_backend using (escritorio_id = lex_security.current_escritorio_id()) with check (escritorio_id = lex_security.current_escritorio_id())', t);
    execute format('drop trigger if exists trg_prevent_tenant_reassign on public.%I', t);
    execute format('create trigger trg_prevent_tenant_reassign before update on public.%I for each row execute function lex_security.prevent_tenant_reassign()', t);
  end loop;

  grant usage, select on all sequences in schema public to lex_backend;
end $$;

-- Chaves de gravação compostas (o runtime já usa escritorio_id + chave).
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('whatsapp_sessoes','numero','whatsapp_sessoes_tenant_numero_key'),
      ('memoria_checkpoints','task_id','memoria_checkpoints_tenant_task_key'),
      ('arquivo_morto_indice','id_indice','arquivo_morto_indice_tenant_indice_key')
    ) as v(tabela, coluna, nome)
  loop
    if to_regclass('public.'||spec.tabela) is null then continue; end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name=spec.tabela and column_name=spec.coluna) then
      raise notice 'coluna %.% ausente', spec.tabela, spec.coluna; continue;
    end if;
    if not exists (select 1 from pg_constraint where conrelid=('public.'||spec.tabela)::regclass and conname=spec.nome) then
      execute format('alter table public.%I add constraint %I unique (escritorio_id, %I)', spec.tabela, spec.nome, spec.coluna);
    end if;
  end loop;
end $$;

-- Ativação do modo multi-escritório. Chamar UMA vez, ao cadastrar o segundo
-- escritório (scripts/provision-office.js imprime a chamada):
--   1. remove o DEFAULT escritorio_id = primeiro escritório (gravação sem
--      escritório passa a falhar em vez de cair no escritório nº 1);
--   2. remove chaves únicas globais legadas quando a composta equivalente
--      existe (ex.: djen_id — dois escritórios recebem a mesma publicação).
create or replace function lex_security.ativar_multi_escritorio()
returns table(tabela text, acao text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
  c record;
  legacy_cols text[];
  tables text[] := array[
    'agente_logs','clientes_pendentes','comandos_pendentes','config','configuracoes','conversas',
    'djen_comunicacoes','djen_sync_state','lex_status','memoria_casos','prazo_alertas',
    'processos_cache','processos_prep','processos_sync','whatsapp_recepcao_eventos','whatsapp_recepcao_publica',
    'arquivo_morto_indice','auditoria','cobrancas_pix','contatos','documentos_indexados','documentos_processo',
    'memoria_checkpoints','mensagens_chat','perfis_juizes','tempo_uso','vivo_acoes','whatsapp_sessoes'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.'||t) is null then continue; end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='escritorio_id' and column_default is not null) then
      execute format('alter table public.%I alter column escritorio_id drop default', t);
      tabela := t; acao := 'default removido'; return next;
    end if;
    -- Unique legada = unique cujas colunas, somadas a escritorio_id, formam
    -- outra unique já existente.
    for c in
      select con.conname, array_agg(att.attname::text order by att.attname) as cols
      from pg_constraint con
      join pg_attribute att on att.attrelid=con.conrelid and att.attnum = any(con.conkey)
      where con.conrelid=('public.'||t)::regclass and con.contype='u'
      group by con.conname
    loop
      if 'escritorio_id' = any(c.cols) then continue; end if;
      legacy_cols := c.cols;
      if exists (
        select 1 from pg_constraint con2
        where con2.conrelid=('public.'||t)::regclass and con2.contype='u'
          and (select array_agg(a2.attname::text order by a2.attname) from pg_attribute a2
               where a2.attrelid=con2.conrelid and a2.attnum = any(con2.conkey))
              = (select array_agg(x order by x) from unnest(legacy_cols || array['escritorio_id']) x)
      ) then
        execute format('alter table public.%I drop constraint %I', t, c.conname);
        tabela := t; acao := 'unique global removida: '||c.conname; return next;
      end if;
    end loop;
  end loop;
end;
$$;

revoke all on function lex_security.ativar_multi_escritorio() from public;
comment on function lex_security.ativar_multi_escritorio() is
  'Executar com usuário administrador ao cadastrar o segundo escritório. Idempotente.';
