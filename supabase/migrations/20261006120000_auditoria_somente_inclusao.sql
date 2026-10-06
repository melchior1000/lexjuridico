-- Auditoria só aceita inclusão: registro de auditoria não pode ser alterado nem apagado
-- pelo servidor do LEX (nem pela chave service_role do modo REST). Só o administrador do
-- banco (postgres) pode, por exemplo, para atender a um pedido de eliminação da LGPD.
-- Ideia do DeskcommCRM (supabase/baseline.sql, api_audit_log — MIT). Idempotente.
do $$
declare r text;
begin
  foreach r in array array['lex_backend','lex_runtime','service_role','authenticated','anon'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke update, delete, truncate on table public.auditoria from %I', r);
    end if;
  end loop;
end $$;
