\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;

create table public.ig_accounts (
  id uuid primary key,
  admin_lifecycle_status text,
  updated_at timestamptz not null default now()
);

create table public.account_incidents (
  id uuid primary key,
  account_id uuid references public.ig_accounts(id),
  incident_type text not null,
  reason text,
  failure_reason text,
  status text not null,
  severity text not null default 'warning',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  archived_at timestamptz
);

create table public.instagram_account_restriction_holds (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id),
  incident_id uuid not null unique references public.account_incidents(id),
  generation_id uuid not null default gen_random_uuid(),
  stable_reason text not null,
  status text not null check (status in ('active', 'verification_required', 'cleared', 'superseded')),
  previous_admin_lifecycle_status text,
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrence_count integer not null default 1,
  human_resolved_at timestamptz,
  verification_required_at timestamptz,
  verified_cleared_at timestamptz,
  verified_by_run_id uuid,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index instagram_account_restriction_holds_one_blocker_test
  on public.instagram_account_restriction_holds(account_id)
  where status in ('active', 'verification_required');

create table public.incident_resume_authorizations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id),
  incident_id uuid not null references public.account_incidents(id),
  status text not null,
  armed_at timestamptz not null default now(),
  expires_at timestamptz,
  scheduled_window_end timestamptz,
  test boolean not null default false
);

-- Only a resolved direct restriction with a still-armed authorization may be
-- repaired by the bounded migration backfill.
insert into public.ig_accounts(id, admin_lifecycle_status) values
  ('00000000-0000-4000-8000-000000000001', 'active'),
  ('00000000-0000-4000-8000-000000000002', 'active');
insert into public.account_incidents(
  id, account_id, incident_type, reason, status, severity, resolved_at
) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   'instagram_account_restriction', 'instagram_account_restriction_messages_disabled',
   'resolved', 'critical', now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002',
   'instagram_account_restriction', 'instagram_account_restriction_messages_disabled',
   'resolved', 'critical', now());
insert into public.incident_resume_authorizations(
  account_id, incident_id, status, expires_at
) values
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'armed', now() + interval '1 hour'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'armed', now() - interval '1 hour');

\ir ../migrations/20260911123000_instagram_identity_restriction_resume_contract_v1.sql

do $$
declare
  v_status text;
  v_previous text;
  v_not_before timestamptz;
begin
  select status, previous_admin_lifecycle_status into v_status, v_previous
  from public.instagram_account_restriction_holds
  where incident_id = '10000000-0000-4000-8000-000000000001';
  if v_status <> 'verification_required' or v_previous <> 'active' then
    raise exception 'armed_resolved_restriction_backfill_failed';
  end if;
  if (select admin_lifecycle_status from public.ig_accounts
      where id = '00000000-0000-4000-8000-000000000001') <> 'paused' then
    raise exception 'armed_resolved_restriction_not_paused';
  end if;
  if exists (
    select 1 from public.instagram_account_restriction_holds
    where incident_id = '10000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'expired_historical_restriction_was_backfilled';
  end if;

  insert into public.ig_accounts(id, admin_lifecycle_status) values
    ('00000000-0000-4000-8000-000000000003', 'active'),
    ('00000000-0000-4000-8000-000000000004', 'active'),
    ('00000000-0000-4000-8000-000000000005', 'active');

  insert into public.account_incidents(
    id, account_id, incident_type, reason, status, severity, metadata, created_at
  ) values
    ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003',
     'instagram_account_restriction', 'instagram_account_restriction_messages_disabled',
     'open', 'critical', '{"restriction_end_date":"2026-09-22"}'::jsonb, now()),
    ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004',
     'instagram_account_restriction', 'instagram_account_restriction_unknown_scope',
     'open', 'critical', '{}'::jsonb, now()),
    ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000005',
     'instagram_account_restriction', 'instagram_action_rate_limit',
     'open', 'error', '{"manual_incident_resolution_required":true}'::jsonb,
     '2026-09-10T06:00:00+00'::timestamptz);

  if (select status from public.instagram_account_restriction_holds
      where incident_id = '10000000-0000-4000-8000-000000000003') <> 'active' then
    raise exception 'direct_restriction_insert_did_not_create_active_hold';
  end if;
  if exists (
    select 1 from public.instagram_account_restriction_holds
    where incident_id = '10000000-0000-4000-8000-000000000005'
  ) then
    raise exception 'legacy_action_limit_received_direct_identity_hold';
  end if;

  update public.account_incidents
  set status = 'resolved', resolved_at = now()
  where id = '10000000-0000-4000-8000-000000000003';
  if (select status from public.instagram_account_restriction_holds
      where incident_id = '10000000-0000-4000-8000-000000000003') <> 'verification_required' then
    raise exception 'direct_restriction_resolution_did_not_require_preflight';
  end if;

  -- A later restriction generation must inherit the original lifecycle, not
  -- the temporary paused projection owned by the superseded hold.
  insert into public.account_incidents(
    id, account_id, incident_type, reason, status, severity, metadata
  ) values (
    '10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000003',
    'instagram_account_restriction', 'instagram_account_restriction_messages_disabled',
    'open', 'critical', '{"restriction_end_date":"2026-09-23"}'::jsonb
  );
  if (select status from public.instagram_account_restriction_holds
      where incident_id = '10000000-0000-4000-8000-000000000003') <> 'superseded' then
    raise exception 'prior_restriction_generation_not_superseded';
  end if;
  select status, previous_admin_lifecycle_status into v_status, v_previous
  from public.instagram_account_restriction_holds
  where incident_id = '10000000-0000-4000-8000-000000000006';
  if v_status <> 'active' or v_previous <> 'active' then
    raise exception 'new_restriction_generation_lost_original_lifecycle';
  end if;

  select not_before into v_not_before
  from public.canonical_active_blocking_incidents_v1(
    array['00000000-0000-4000-8000-000000000004'::uuid]
  );
  if v_not_before is not null then
    raise exception 'unknown_scope_restriction_invented_duration';
  end if;

  select not_before into v_not_before
  from public.canonical_active_blocking_incidents_v1(
    array['00000000-0000-4000-8000-000000000005'::uuid]
  );
  if v_not_before <> '2026-09-12T06:00:00+00'::timestamptz then
    raise exception 'legacy_action_limit_48h_policy_changed';
  end if;

  select not_before into v_not_before
  from public.canonical_active_blocking_incidents_v1(
    array['00000000-0000-4000-8000-000000000003'::uuid]
  );
  if v_not_before <> '2026-09-23T00:00:00+00'::timestamptz then
    raise exception 'messages_disabled_evidence_date_not_projected';
  end if;
end
$$;

select 'instagram_identity_restriction_resume_contract_v1_ok' as result;
