create table public.ig_accounts (
  id uuid primary key,
  package_max integer not null
);

create table public.ig_interaction_events (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.ig_accounts(id),
  event_at timestamptz not null,
  interaction_type text not null,
  interaction_status text not null,
  event_type text not null,
  run_id uuid
);

create or replace view public.account_package_summary
with (security_invoker = true) as
with follow_activity_days as (
  select
    account_id,
    count(distinct (event_at at time zone 'Africa/Johannesburg')::date)
      filter (
        where (event_at at time zone 'Africa/Johannesburg')::date
          < (now() at time zone 'Africa/Johannesburg')::date
      )::integer as prior_active_days
  from public.ig_interaction_events
  where interaction_type = 'follow'
    and interaction_status = 'success'
    and event_type = 'follow_verified'
    and run_id is not null
  group by account_id
)
select
  a.id as account_id,
  least(4, coalesce(f.prior_active_days, 0) + 1)::integer as warmup_day,
  case least(4, coalesce(f.prior_active_days, 0) + 1)
    when 1 then 10
    when 2 then 20
    when 3 then 40
    else a.package_max
  end::integer as effective_follow_cap
from public.ig_accounts a
left join follow_activity_days f on f.account_id = a.id;

\ir ../migrations/20260814103834_follow_warmup_event_type_compat_v1.sql

insert into public.ig_accounts (id, package_max) values
  ('00000000-0000-0000-0000-000000000001', 120),
  ('00000000-0000-0000-0000-000000000002', 80),
  ('00000000-0000-0000-0000-000000000003', 80),
  ('00000000-0000-0000-0000-000000000004', 80),
  ('00000000-0000-0000-0000-000000000005', 120),
  ('00000000-0000-0000-0000-000000000006', 80);

-- J1: current-day evidence must not advance prior_active_days.
insert into public.ig_interaction_events (
  account_id, event_at, interaction_type, interaction_status, event_type, run_id
) values (
  '00000000-0000-0000-0000-000000000001',
  (((now() at time zone 'Africa/Johannesburg')::date + time '12:00') at time zone 'Africa/Johannesburg'),
  'follow', 'success', 'follow_verified_persisted_v1',
  '10000000-0000-0000-0000-000000000001'
);

-- J2: legacy event remains accepted.
insert into public.ig_interaction_events values
  (default, '00000000-0000-0000-0000-000000000002',
   ((((now() at time zone 'Africa/Johannesburg')::date - 1) + time '12:00') at time zone 'Africa/Johannesburg'),
   'follow', 'success', 'follow_verified', '20000000-0000-0000-0000-000000000001');

-- J3 with a missed calendar day. Failed and runless rows must be ignored.
insert into public.ig_interaction_events values
  (default, '00000000-0000-0000-0000-000000000003',
   ((((now() at time zone 'Africa/Johannesburg')::date - 3) + time '12:00') at time zone 'Africa/Johannesburg'),
   'follow', 'success', 'follow_verified_persisted_v1', '30000000-0000-0000-0000-000000000001'),
  (default, '00000000-0000-0000-0000-000000000003',
   ((((now() at time zone 'Africa/Johannesburg')::date - 1) + time '12:00') at time zone 'Africa/Johannesburg'),
   'follow', 'success', 'follow_verified_persisted_v1', '30000000-0000-0000-0000-000000000002'),
  (default, '00000000-0000-0000-0000-000000000003',
   ((((now() at time zone 'Africa/Johannesburg')::date - 2) + time '12:00') at time zone 'Africa/Johannesburg'),
   'follow', 'failed', 'follow_verified_persisted_v1', '30000000-0000-0000-0000-000000000003'),
  (default, '00000000-0000-0000-0000-000000000003',
   ((((now() at time zone 'Africa/Johannesburg')::date - 2) + time '13:00') at time zone 'Africa/Johannesburg'),
   'follow', 'success', 'follow_verified_persisted_v1', null);

-- Growth J4: both event names and multiple runs on one day count once.
insert into public.ig_interaction_events values
  (default, '00000000-0000-0000-0000-000000000004',
   ((((now() at time zone 'Africa/Johannesburg')::date - 3) + time '10:00') at time zone 'Africa/Johannesburg'),
   'follow', 'success', 'follow_verified', '40000000-0000-0000-0000-000000000001'),
  (default, '00000000-0000-0000-0000-000000000004',
   ((((now() at time zone 'Africa/Johannesburg')::date - 3) + time '15:00') at time zone 'Africa/Johannesburg'),
   'follow', 'success', 'follow_verified_persisted_v1', '40000000-0000-0000-0000-000000000002'),
  (default, '00000000-0000-0000-0000-000000000004',
   ((((now() at time zone 'Africa/Johannesburg')::date - 2) + time '12:00') at time zone 'Africa/Johannesburg'),
   'follow', 'success', 'follow_verified_persisted_v1', '40000000-0000-0000-0000-000000000003'),
  (default, '00000000-0000-0000-0000-000000000004',
   ((((now() at time zone 'Africa/Johannesburg')::date - 1) + time '12:00') at time zone 'Africa/Johannesburg'),
   'follow', 'success', 'follow_verified_persisted_v1', '40000000-0000-0000-0000-000000000004');

-- Premium J4.
insert into public.ig_interaction_events (
  account_id, event_at, interaction_type, interaction_status, event_type, run_id
)
select
  '00000000-0000-0000-0000-000000000005',
  ((((now() at time zone 'Africa/Johannesburg')::date - n) + time '12:00') at time zone 'Africa/Johannesburg'),
  'follow', 'success', 'follow_verified_persisted_v1',
  ('50000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
from generate_series(1, 3) n;

-- A non-Follow success is not a warmup day.
insert into public.ig_interaction_events values
  (default, '00000000-0000-0000-0000-000000000006',
   ((((now() at time zone 'Africa/Johannesburg')::date - 1) + time '12:00') at time zone 'Africa/Johannesburg'),
   'like', 'success', 'follow_verified_persisted_v1', '60000000-0000-0000-0000-000000000001');

do $test$
declare
  v_actual jsonb;
  v_expected constant jsonb := jsonb_build_array(
    jsonb_build_object('account_id', '00000000-0000-0000-0000-000000000001', 'warmup_day', 1, 'effective_follow_cap', 10),
    jsonb_build_object('account_id', '00000000-0000-0000-0000-000000000002', 'warmup_day', 2, 'effective_follow_cap', 20),
    jsonb_build_object('account_id', '00000000-0000-0000-0000-000000000003', 'warmup_day', 3, 'effective_follow_cap', 40),
    jsonb_build_object('account_id', '00000000-0000-0000-0000-000000000004', 'warmup_day', 4, 'effective_follow_cap', 80),
    jsonb_build_object('account_id', '00000000-0000-0000-0000-000000000005', 'warmup_day', 4, 'effective_follow_cap', 120),
    jsonb_build_object('account_id', '00000000-0000-0000-0000-000000000006', 'warmup_day', 1, 'effective_follow_cap', 10)
  );
begin
  select jsonb_agg(to_jsonb(s) order by s.account_id)
    into v_actual
  from public.account_package_summary s;

  if v_actual <> v_expected then
    raise exception 'unexpected warmup projection: %', v_actual;
  end if;

  if position(
    'follow_verified_persisted_v1'
    in pg_get_viewdef('public.account_package_summary'::regclass, true)
  ) = 0 then
    raise exception 'persisted Follow event type missing from patched view';
  end if;
end
$test$;

-- The migration is intentionally replay-safe.
\ir ../migrations/20260814103834_follow_warmup_event_type_compat_v1.sql
