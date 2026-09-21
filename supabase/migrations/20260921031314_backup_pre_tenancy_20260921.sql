-- Applied to Supabase production on 2026-09-21 before tenancy changes.
-- Purpose: reversible in-database snapshot of all public tables plus policies,
-- constraints and indexes. This does not replace provider backups/offsite backup.

create schema if not exists lex_backup_pre_tenancy_20260921;

create table if not exists lex_backup_pre_tenancy_20260921.backup_manifest (
  tabela text primary key,
  rows_copiadas bigint not null,
  capturado_em timestamptz not null default now()
);

do $$
declare
  r record;
  n bigint;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname='public'
    order by tablename
  loop
    execute format('drop table if exists lex_backup_pre_tenancy_20260921.%I cascade', r.tablename);
    execute format('create table lex_backup_pre_tenancy_20260921.%I (like public.%I including all)', r.tablename, r.tablename);
    execute format('insert into lex_backup_pre_tenancy_20260921.%I select * from public.%I', r.tablename, r.tablename);
    execute format('select count(*) from lex_backup_pre_tenancy_20260921.%I', r.tablename) into n;
    insert into lex_backup_pre_tenancy_20260921.backup_manifest(tabela,rows_copiadas,capturado_em)
    values(r.tablename,n,now())
    on conflict (tabela) do update
      set rows_copiadas=excluded.rows_copiadas,
          capturado_em=excluded.capturado_em;
  end loop;
end $$;

drop table if exists lex_backup_pre_tenancy_20260921.policies_snapshot;
create table lex_backup_pre_tenancy_20260921.policies_snapshot as
select * from pg_policies where schemaname='public';

drop table if exists lex_backup_pre_tenancy_20260921.constraints_snapshot;
create table lex_backup_pre_tenancy_20260921.constraints_snapshot as
select
  c.relname as tabela,
  con.conname as constraint_name,
  con.contype,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid=con.conrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public';

drop table if exists lex_backup_pre_tenancy_20260921.indexes_snapshot;
create table lex_backup_pre_tenancy_20260921.indexes_snapshot as
select * from pg_indexes where schemaname='public';
