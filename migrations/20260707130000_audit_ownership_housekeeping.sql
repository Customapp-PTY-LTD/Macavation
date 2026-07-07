-- =====================================================================
-- Audit & ownership housekeeping.
--
-- From this migration on, everything that enters the database gets an
-- owner, and every row change on every public table is logged:
--   * created_by / updated_by (uuid -> public.users.id) added to every
--     public table that lacks them, stamped automatically by trigger.
--   * audit.audit_log records INSERT / UPDATE / DELETE (row level, with
--     before/after values) and TRUNCATE (statement level) for all
--     public tables, with the acting user where identity is available.
--   * audit.attach_all() makes any table compliant; scripts/apply-migration.mjs
--     runs it after every migration so future tables are covered too.
--
-- Forward-only by design: historical rows are not backfilled.
--
-- Actor resolution order (audit.current_actor):
--   1. app.user_id transaction setting  -> source 'setting'
--      (server-side scripts: select set_config('app.user_id','<uuid>',true);)
--   2. JWT claim user_id or sub         -> source 'jwt'
--   3. X-User-Id request header          -> source 'header'
--      (the portal sends this on direct PostgREST calls; the Lambda proxy
--       must forward it for proxied calls to carry identity)
--   otherwise NULL                       -> source 'unknown'
-- =====================================================================

create schema if not exists audit;

create table if not exists audit.audit_log (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  table_name   text not null,
  operation    text not null,
  row_id       text,
  actor_id     uuid,
  actor_source text,
  db_role      text not null default current_user,
  request_path text,
  changed_cols text[],
  old_data     jsonb,
  new_data     jsonb
);

create index if not exists audit_log_occurred_at_idx on audit.audit_log (occurred_at);
create index if not exists audit_log_table_occurred_idx on audit.audit_log (table_name, occurred_at);
create index if not exists audit_log_actor_idx on audit.audit_log (actor_id) where actor_id is not null;

-- The log is written only by the security-definer trigger functions and
-- read via the database owner / public.audit_coverage(). Not exposed to API roles.
alter table audit.audit_log enable row level security;
revoke all on schema audit from anon, authenticated;
revoke all on audit.audit_log from anon, authenticated;

-- ---------------------------------------------------------------------
-- Actor resolution
-- ---------------------------------------------------------------------
create or replace function audit.current_actor(out actor uuid, out source text)
language plpgsql stable
as $$
declare
  v text;
  claims jsonb;
  hdrs jsonb;
begin
  begin
    v := nullif(current_setting('app.user_id', true), '');
    if v is not null then
      actor := v::uuid; source := 'setting'; return;
    end if;
  exception when others then null;
  end;

  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    v := coalesce(claims->>'user_id', claims->>'sub');
    if v is not null then
      actor := v::uuid; source := 'jwt'; return;
    end if;
  exception when others then null;
  end;

  begin
    hdrs := nullif(current_setting('request.headers', true), '')::jsonb;
    v := nullif(hdrs->>'x-user-id', '');
    if v is not null then
      actor := v::uuid; source := 'header'; return;
    end if;
  exception when others then null;
  end;

  actor := null; source := 'unknown';
end;
$$;

-- ---------------------------------------------------------------------
-- Owner stamping (BEFORE INSERT OR UPDATE on every table)
-- ---------------------------------------------------------------------
create or replace function audit.stamp_actor()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  a record;
  j jsonb;
begin
  select * into a from audit.current_actor();
  if a.actor is null then
    return NEW;
  end if;

  j := to_jsonb(NEW);
  if TG_OP = 'INSERT' then
    if (j ? 'created_by') and (j->>'created_by') is null then
      NEW := jsonb_populate_record(NEW, jsonb_build_object('created_by', a.actor));
    end if;
    j := to_jsonb(NEW);
    if (j ? 'updated_by') and (j->>'updated_by') is null then
      NEW := jsonb_populate_record(NEW, jsonb_build_object('updated_by', a.actor));
    end if;
  elsif TG_OP = 'UPDATE' then
    if (j ? 'updated_by') then
      NEW := jsonb_populate_record(NEW, jsonb_build_object('updated_by', a.actor));
    end if;
  end if;
  return NEW;
end;
$$;

-- ---------------------------------------------------------------------
-- Row-change logging (AFTER INSERT OR UPDATE OR DELETE on every table)
-- ---------------------------------------------------------------------
create or replace function audit.log_row_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  a record;
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
begin
  select * into a from audit.current_actor();

  if TG_OP = 'INSERT' then
    v_new := to_jsonb(NEW);
  elsif TG_OP = 'UPDATE' then
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    select coalesce(array_agg(k), '{}') into v_changed
    from jsonb_object_keys(v_new) as t(k)
    where v_new->k is distinct from v_old->k;
  elsif TG_OP = 'DELETE' then
    v_old := to_jsonb(OLD);
  end if;

  insert into audit.audit_log
    (table_name, operation, row_id, actor_id, actor_source, db_role,
     request_path, changed_cols, old_data, new_data)
  values
    (TG_TABLE_NAME, TG_OP,
     coalesce(v_new->>'id', v_old->>'id'),
     a.actor, a.source, current_user,
     nullif(current_setting('request.path', true), ''),
     v_changed,
     case when TG_OP = 'UPDATE'
          then (select jsonb_object_agg(k, v_old->k) from unnest(v_changed) as u(k))
          else v_old end,
     case when TG_OP = 'UPDATE'
          then (select jsonb_object_agg(k, v_new->k) from unnest(v_changed) as u(k))
          else v_new end);
  return null;
end;
$$;

create or replace function audit.log_truncate()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  a record;
begin
  select * into a from audit.current_actor();
  insert into audit.audit_log (table_name, operation, actor_id, actor_source, db_role)
  values (TG_TABLE_NAME, 'TRUNCATE', a.actor, a.source, current_user);
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Attach ownership + audit to every public table (idempotent).
-- Run after every migration so new tables are always covered.
-- ---------------------------------------------------------------------
create or replace function audit.attach_all()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  t record;
  n integer := 0;
begin
  for t in
    select c.relname as table_name
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I add column if not exists created_by uuid', t.table_name);
    execute format('alter table public.%I add column if not exists updated_by uuid', t.table_name);

    execute format('drop trigger if exists aaa_stamp_actor on public.%I', t.table_name);
    execute format('create trigger aaa_stamp_actor before insert or update on public.%I for each row execute function audit.stamp_actor()', t.table_name);

    execute format('drop trigger if exists zzz_audit_row on public.%I', t.table_name);
    execute format('create trigger zzz_audit_row after insert or update or delete on public.%I for each row execute function audit.log_row_change()', t.table_name);

    execute format('drop trigger if exists zzz_audit_truncate on public.%I', t.table_name);
    execute format('create trigger zzz_audit_truncate after truncate on public.%I for each statement execute function audit.log_truncate()', t.table_name);

    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- Coverage/health report for scripts (verify-audit-housekeeping.mjs).
-- ---------------------------------------------------------------------
create or replace function public.audit_coverage()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'tables_total', (
      select count(*) from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'),
    'missing_audit_trigger', (
      select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (select 1 from pg_trigger g
                        where g.tgrelid = c.oid and g.tgname = 'zzz_audit_row' and not g.tgisinternal)),
    'missing_stamp_trigger', (
      select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (select 1 from pg_trigger g
                        where g.tgrelid = c.oid and g.tgname = 'aaa_stamp_actor' and not g.tgisinternal)),
    'missing_owner_cols', (
      select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (select 1 from pg_attribute a
                        where a.attrelid = c.oid and a.attname = 'created_by' and not a.attisdropped)),
    'audit_log_rows', (select count(*) from audit.audit_log),
    'last_7d', (
      select jsonb_build_object(
        'events', count(*),
        'with_actor', count(*) filter (where actor_id is not null))
      from audit.audit_log
      where occurred_at > now() - interval '7 days')
  );
$$;

revoke execute on function public.audit_coverage() from public, anon, authenticated;
grant execute on function public.audit_coverage() to service_role;

-- Read-only probe: lets any client path (direct or via Lambda) check what
-- actor the database would attribute to it.
create or replace function public.audit_probe()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'actor', (select actor from audit.current_actor()),
    'source', (select source from audit.current_actor()),
    'db_role', current_user);
$$;

grant execute on function public.audit_probe() to anon, authenticated, service_role;

-- Activate everywhere.
select audit.attach_all() as tables_covered;
