do $$
begin
  if not exists (select 1 from pg_roles where rolname='lex_backend') then
    create role lex_backend
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  else
    alter role lex_backend
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
end $$;

create schema if not exists lex_security;
revoke all on schema lex_security from public;
grant usage on schema lex_security to lex_backend, service_role;

create or replace function lex_security.current_escritorio_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v text;
begin
  v := current_setting('lex.escritorio_id', true);
  if v is null or btrim(v) = '' then return null; end if;
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return v::uuid;
end;
$$;

revoke all on function lex_security.current_escritorio_id() from public;
grant execute on function lex_security.current_escritorio_id() to lex_backend, service_role;

create or replace function lex_security.prevent_tenant_reassign()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.escritorio_id is distinct from old.escritorio_id then
    raise exception 'escritorio_id imutavel';
  end if;
  if new.escritorio_id is null then
    raise exception 'escritorio_id obrigatorio';
  end if;
  return new;
end;
$$;

revoke all on function lex_security.prevent_tenant_reassign() from public;
grant execute on function lex_security.prevent_tenant_reassign() to lex_backend, service_role;

grant usage on schema public to lex_backend;
grant usage, select on all sequences in schema public to lex_backend;

do $$
declare
  t text;
  tables text[] := array[
    'agente_logs',
    'clientes_pendentes',
    'comandos_pendentes',
    'configuracoes',
    'conversas',
    'djen_comunicacoes',
    'djen_sync_state',
    'lex_status',
    'memoria_casos',
    'prazo_alertas',
    'processos_cache',
    'processos_prep',
    'processos_sync',
    'whatsapp_recepcao_eventos',
    'whatsapp_recepcao_publica'
  ];
begin
  foreach t in array tables loop
    execute format('grant select, insert, update, delete on public.%I to lex_backend', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists lex_backend_tenant on public.%I', t);
    execute format(
      'create policy lex_backend_tenant on public.%I for all to lex_backend using (escritorio_id = lex_security.current_escritorio_id()) with check (escritorio_id = lex_security.current_escritorio_id())',
      t
    );

    execute format('drop trigger if exists trg_prevent_tenant_reassign on public.%I', t);
    execute format(
      'create trigger trg_prevent_tenant_reassign before update on public.%I for each row execute function lex_security.prevent_tenant_reassign()',
      t
    );
  end loop;
end $$;

alter table public.escritorios enable row level security;
alter table public.escritorios force row level security;
grant select on public.escritorios to lex_backend;
drop policy if exists lex_backend_own_office on public.escritorios;
create policy lex_backend_own_office
  on public.escritorios
  for select
  to lex_backend
  using (id = lex_security.current_escritorio_id());

alter table public.usuarios enable row level security;
alter table public.usuarios force row level security;

alter table public.escritorio_membros enable row level security;
alter table public.escritorio_membros force row level security;

alter table public.config enable row level security;
alter table public.config force row level security;
