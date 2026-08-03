\set ON_ERROR_STOP on

begin;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.ig_runs (
  id uuid primary key,
  account_id uuid not null,
  status text not null,
  total_follow integer default 0,
  total_like integer default 0,
  total_dm integer default 0,
  total_story integer default 0,
  updated_at timestamptz default now()
);

\ir ../migrations/20260803190500_ig_runs_live_counter_revision_v1.sql

insert into public.ig_runs (id, account_id, status)
values (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'running'
);

update public.ig_runs set total_follow = 1
where id = '10000000-0000-4000-8000-000000000001';

do $test$
begin
  if (select live_counter_revision from public.ig_runs where id = '10000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'follow_ack_did_not_advance_revision';
  end if;
end;
$test$;

update public.ig_runs set total_like = 1
where id = '10000000-0000-4000-8000-000000000001';

do $test$
begin
  if (select live_counter_revision from public.ig_runs where id = '10000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'like_ack_did_not_advance_revision';
  end if;
end;
$test$;

update public.ig_runs set total_like = 1
where id = '10000000-0000-4000-8000-000000000001';

do $test$
begin
  if (select live_counter_revision from public.ig_runs where id = '10000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'idempotent_replay_advanced_revision';
  end if;
  if has_function_privilege('anon', 'public.bump_ig_run_live_counter_revision_v1()', 'execute') then
    raise exception 'anon_execute_grant_leaked';
  end if;
  if has_function_privilege('authenticated', 'public.bump_ig_run_live_counter_revision_v1()', 'execute') then
    raise exception 'authenticated_execute_grant_leaked';
  end if;
  if not has_function_privilege('service_role', 'public.bump_ig_run_live_counter_revision_v1()', 'execute') then
    raise exception 'service_role_execute_grant_missing';
  end if;
end;
$test$;

\ir ../migrations/20260803190500_rollback_ig_runs_live_counter_revision_v1.sql

do $test$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ig_runs'
      and column_name = 'live_counter_revision'
  ) then
    raise exception 'rollback_left_revision_column';
  end if;
end;
$test$;

rollback;
