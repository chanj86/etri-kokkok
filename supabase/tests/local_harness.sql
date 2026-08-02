-- 로컬 PostgreSQL 에서 Supabase 마이그레이션을 검증하기 위한 최소 모사 환경.
-- 사용 순서:
--   createdb kokkok_test
--   psql kokkok_test -f supabase/tests/local_harness.sql
--   for m in supabase/migrations/*.sql; do psql kokkok_test -f "$m"; done
--   psql kokkok_test -f supabase/tests/database_invariants.sql

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create schema if not exists extensions;

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end;
$$;

-- Supabase Storage 모사 (아바타 버킷·정책 마이그레이션 검증용)
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean
);

create table if not exists storage.objects (
  bucket_id text,
  name text,
  owner uuid
);

alter table storage.objects enable row level security;

-- pg_cron 모사 (verify.sql 검증용)
create schema if not exists cron;

create table if not exists cron.job (
  jobid bigint,
  jobname text,
  schedule text
);

create table if not exists cron.job_run_details (
  jobid bigint,
  status text,
  start_time timestamptz,
  end_time timestamptz
);
