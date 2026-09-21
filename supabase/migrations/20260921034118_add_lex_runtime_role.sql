do $$
begin
  if not exists (select 1 from pg_roles where rolname='lex_runtime') then
    create role lex_runtime
      login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  else
    alter role lex_runtime
      login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end $$;

grant lex_backend to lex_runtime;

comment on role lex_runtime is
  'Runtime LEX SaaS. Sem BYPASSRLS; herda somente privilegios da role lex_backend.';
