do $$
declare
  eid uuid;
begin
  select id into eid from public.escritorios where slug='lex-atual';
  if eid is null then raise exception 'tenant inicial não encontrado'; end if;

  alter table public.config add column if not exists escritorio_id uuid;
  update public.config set escritorio_id=eid where escritorio_id is null;
  alter table public.config alter column escritorio_id set not null;
  execute format(
    'alter table public.config alter column escritorio_id set default %L::uuid',
    eid::text
  );

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.config'::regclass
      and conname='config_escritorio_id_fkey'
  ) then
    alter table public.config
      add constraint config_escritorio_id_fkey
      foreign key(escritorio_id) references public.escritorios(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.config'::regclass
      and conname='config_tenant_chave_key'
  ) then
    alter table public.config
      add constraint config_tenant_chave_key unique(escritorio_id,chave);
  end if;
end $$;

create index if not exists config_escritorio_id_idx on public.config(escritorio_id);

grant select,insert,update,delete on public.config to lex_backend;
grant usage,select on sequence public.config_id_seq to lex_backend;

alter table public.config enable row level security;
alter table public.config force row level security;
drop policy if exists lex_backend_tenant on public.config;
create policy lex_backend_tenant
  on public.config
  for all
  to lex_backend
  using (escritorio_id=lex_security.current_escritorio_id())
  with check (escritorio_id=lex_security.current_escritorio_id());

drop trigger if exists trg_prevent_tenant_reassign on public.config;
create trigger trg_prevent_tenant_reassign
  before update on public.config
  for each row execute function lex_security.prevent_tenant_reassign();
