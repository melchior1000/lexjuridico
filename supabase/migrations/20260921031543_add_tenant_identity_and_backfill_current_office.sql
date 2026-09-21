create extension if not exists pgcrypto;

create table if not exists public.escritorios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text not null unique,
  cnpj text,
  status text not null default 'active'
    check (status in ('trialing','active','past_due','suspended','canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usuarios (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text unique,
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.escritorio_membros (
  escritorio_id uuid not null references public.escritorios(id) on delete restrict,
  usuario_id uuid not null references public.usuarios(id) on delete restrict,
  role text not null check (role in ('admin','advogado','secretaria','analista','estagiario','cliente')),
  status text not null default 'active' check (status in ('invited','active','revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (escritorio_id, usuario_id)
);

create index if not exists escritorio_membros_usuario_active_idx
  on public.escritorio_membros(usuario_id)
  where status='active';

insert into public.escritorios(nome,slug,status)
select 'Escritório LEX atual','lex-atual','active'
where not exists (select 1 from public.escritorios where slug='lex-atual');

do $$
declare
  eid uuid;
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
  select id into eid from public.escritorios where slug='lex-atual';
  if eid is null then raise exception 'tenant inicial não encontrado'; end if;

  foreach t in array tables loop
    if to_regclass('public.'||t) is null then
      raise notice 'tabela ausente: %',t;
      continue;
    end if;
    execute format('alter table public.%I add column if not exists escritorio_id uuid',t);
    execute format('update public.%I set escritorio_id=$1 where escritorio_id is null',t) using eid;
    execute format('alter table public.%I alter column escritorio_id set not null',t);
    execute format('alter table public.%I alter column escritorio_id set default %L::uuid',t,eid);
    if not exists (
      select 1 from pg_constraint
      where conrelid=('public.'||t)::regclass
        and conname=t||'_escritorio_id_fkey'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key(escritorio_id) references public.escritorios(id) on delete restrict',
        t,t||'_escritorio_id_fkey'
      );
    end if;
    execute format('create index if not exists %I on public.%I(escritorio_id)',t||'_escritorio_id_idx',t);
  end loop;
end $$;

comment on table public.escritorios is 'Tenant do LEX. O escritório atual é o primeiro tenant.';
comment on column public.configuracoes.escritorio_id is
  'Transição SaaS: default temporário para o primeiro tenant; remover antes da venda multi-escritório.';
