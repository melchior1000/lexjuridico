-- Auditoria de isolamento (26/09/2026), achado nº 1 — severidade alta.
--
-- processos_cache guardava o snapshot de processos com chave primária GLOBAL em `id`
-- (todo escritório grava com id='lex_juridico'). Com dois escritórios no mesmo banco,
-- o INSERT do segundo falhava com "duplicate key value violates unique constraint
-- processos_cache_pkey" e o LEX devolvia 409 ("Outra gravação ocorreu") para sempre:
-- o segundo escritório nunca conseguia salvar processos.
--
-- 1. Troca a chave primária por (escritorio_id, id). Seguro também para a instalação
--    única: a composta cobre o caso de um só escritório.
-- 2. Estende lex_security.ativar_multi_escritorio() para tratar chaves PRIMÁRIAS
--    globais do mesmo jeito que já tratava as UNIQUE globais, para qualquer tabela
--    futura: quando existir a unique composta equivalente (colunas + escritorio_id),
--    a PK global é substituída pela PK composta.

do $$
begin
  if to_regclass('public.processos_cache') is not null
     and exists (
       select 1 from pg_constraint c
       where c.conrelid='public.processos_cache'::regclass and c.contype='p'
         and not exists (select 1 from pg_attribute a where a.attrelid=c.conrelid and a.attnum=any(c.conkey) and a.attname='escritorio_id')
     ) then
    execute (select format('alter table public.processos_cache drop constraint %I', c.conname)
             from pg_constraint c where c.conrelid='public.processos_cache'::regclass and c.contype='p');
    alter table public.processos_cache add constraint processos_cache_pkey primary key (escritorio_id, id);
  end if;
end $$;

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
    -- Chave legada (unique OU primária) = chave cujas colunas, somadas a
    -- escritorio_id, formam uma unique já existente.
    for c in
      select con.conname, con.contype, array_agg(att.attname::text order by att.attname) as cols
      from pg_constraint con
      join pg_attribute att on att.attrelid=con.conrelid and att.attnum = any(con.conkey)
      where con.conrelid=('public.'||t)::regclass and con.contype in ('u','p')
      group by con.conname, con.contype
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
        if c.contype='p' then
          execute format('alter table public.%I add constraint %I primary key (escritorio_id, %s)', t, c.conname,
                         (select string_agg(format('%I', x), ', ') from unnest(legacy_cols) x));
          tabela := t; acao := 'chave primária global substituída pela composta: '||c.conname; return next;
        else
          tabela := t; acao := 'unique global removida: '||c.conname; return next;
        end if;
      end if;
    end loop;
  end loop;
end;
$$;

revoke all on function lex_security.ativar_multi_escritorio() from public;
comment on function lex_security.ativar_multi_escritorio() is
  'Executar com usuário administrador ao cadastrar o segundo escritório. Idempotente. Trata unique e primary key globais.';
