-- Instagram action-rate-limit restriction hold V1.
--
-- Detection atomically creates/enriches one canonical incident generation,
-- applies the existing visible account pause, and leaves the hold in place
-- after human incident resolution. Only a successful Worker-side physical
-- preflight may release the hold and restore the prior lifecycle projection.

create table if not exists public.instagram_account_restriction_holds (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  incident_id uuid not null references public.account_incidents(id) on delete cascade,
  generation_id uuid not null default gen_random_uuid(),
  stable_reason text not null default 'instagram_action_rate_limit',
  status text not null default 'active'
    check (status in ('active', 'verification_required', 'cleared', 'superseded')),
  previous_admin_lifecycle_status text,
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  human_resolved_at timestamptz,
  verification_required_at timestamptz,
  verified_cleared_at timestamptz,
  verified_by_run_id uuid,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (incident_id),
  unique (account_id, generation_id)
);

create unique index if not exists instagram_account_restriction_holds_one_blocker
  on public.instagram_account_restriction_holds (account_id)
  where status in ('active', 'verification_required');

create index if not exists instagram_account_restriction_holds_incident_idx
  on public.instagram_account_restriction_holds (incident_id, status);

alter table public.instagram_account_restriction_holds enable row level security;
revoke all on table public.instagram_account_restriction_holds from public, anon, authenticated;
grant select, insert, update on table public.instagram_account_restriction_holds to service_role;

drop policy if exists instagram_account_restriction_holds_service_role_all
  on public.instagram_account_restriction_holds;
create policy instagram_account_restriction_holds_service_role_all
  on public.instagram_account_restriction_holds
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.apply_instagram_action_restriction_v1(
  p_account_id uuid,
  p_account_username text default null,
  p_run_id uuid default null,
  p_request_id uuid default null,
  p_stable_reason text default 'instagram_action_rate_limit',
  p_metadata_safe jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.ig_accounts%rowtype;
  v_hold public.instagram_account_restriction_holds%rowtype;
  v_incident public.account_incidents%rowtype;
  v_generation_id uuid := gen_random_uuid();
  v_dedupe_key text;
  v_deduplicated boolean := false;
  v_action jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_account_id is null then
    raise exception 'account_id_required' using errcode = '22023';
  end if;
  if coalesce(nullif(trim(p_stable_reason), ''), '') <> 'instagram_action_rate_limit' then
    raise exception 'stable_reason_invalid' using errcode = '22023';
  end if;

  select * into v_account
  from public.ig_accounts
  where id = p_account_id
  for update;
  if v_account.id is null then
    raise exception 'account_not_found' using errcode = '22023';
  end if;

  select * into v_hold
  from public.instagram_account_restriction_holds
  where account_id = p_account_id
    and status in ('active', 'verification_required')
  for update;

  -- A popup reappearing after human resolution is a new restriction
  -- generation. Preserve the old row as evidence and open a new incident.
  if v_hold.id is not null and v_hold.status = 'verification_required' then
    update public.instagram_account_restriction_holds
    set status = 'superseded',
        last_seen_at = now(),
        occurrence_count = occurrence_count + 1,
        metadata_safe = coalesce(metadata_safe, '{}'::jsonb)
          || jsonb_build_object('restriction_reappeared_at', now()),
        updated_at = now()
    where id = v_hold.id;
    v_hold := null;
  end if;

  if v_hold.id is not null then
    v_generation_id := v_hold.generation_id;
    v_dedupe_key := 'account:' || p_account_id::text
      || ':instagram_action_rate_limit:' || v_generation_id::text;
    v_deduplicated := true;
  else
    v_dedupe_key := 'account:' || p_account_id::text
      || ':instagram_action_rate_limit:' || v_generation_id::text;
  end if;

  select * into v_incident
  from public.upsert_account_incident(
    p_incident_type => 'instagram_account_restriction',
    p_dedupe_key => v_dedupe_key,
    p_severity => 'error',
    p_status => 'open',
    p_account_id => p_account_id,
    p_account_username => coalesce(nullif(trim(p_account_username), ''), v_account.username),
    p_run_id => p_run_id,
    p_source => 'instagram_action_restriction_guard',
    p_reason => 'instagram_action_rate_limit',
    p_failure_reason => 'instagram_action_rate_limit',
    p_action_required => 'Open the account manually, verify whether Instagram still shows the action restriction, wait if necessary, then resolve the incident only after confirming the restriction is cleared.',
    p_safe_client_message => 'Automation paused because Instagram is temporarily limiting actions.',
    p_assistant_message => 'Instagram action restriction detected. The campaign is paused and Auto Restart is blocked.',
    p_admin_message => 'Human review and a successful physical preflight are required before business actions may resume.',
    p_metadata => coalesce(p_metadata_safe, '{}'::jsonb) || jsonb_build_object(
      'stable_reason', 'instagram_action_rate_limit',
      'risk_class', 'human_review_required',
      'severity', 'error',
      'blocking_campaign', true,
      'operator_review_required', true,
      'auto_restart_allowed', false,
      'account_pause_required', true,
      'physical_preflight_required', true,
      'request_id', p_request_id,
      'restriction_generation', v_generation_id
    )
  );

  if v_hold.id is null then
    insert into public.instagram_account_restriction_holds (
      account_id, incident_id, generation_id, stable_reason, status,
      previous_admin_lifecycle_status, metadata_safe
    ) values (
      p_account_id, v_incident.id, v_generation_id,
      'instagram_action_rate_limit', 'active',
      v_account.admin_lifecycle_status,
      coalesce(p_metadata_safe, '{}'::jsonb)
        || jsonb_build_object('request_id', p_request_id, 'run_id', p_run_id)
    ) returning * into v_hold;
  else
    update public.instagram_account_restriction_holds
    set incident_id = v_incident.id,
        last_seen_at = now(),
        occurrence_count = occurrence_count + 1,
        metadata_safe = coalesce(metadata_safe, '{}'::jsonb)
          || coalesce(p_metadata_safe, '{}'::jsonb)
          || jsonb_build_object('last_request_id', p_request_id, 'last_run_id', p_run_id),
        updated_at = now()
    where id = v_hold.id
    returning * into v_hold;
  end if;

  -- Reuse the canonical visible lifecycle pause. The hold row records prior
  -- state so only its own preflight release may restore it.
  if coalesce(v_account.admin_lifecycle_status, '') <> 'paused' then
    update public.ig_accounts
    set admin_lifecycle_status = 'paused', updated_at = now()
    where id = p_account_id;
  end if;

  select to_jsonb(a) into v_action
  from public.upsert_account_dashboard_action(
    p_account_id => p_account_id,
    p_client_id => null,
    p_incident_id => v_incident.id,
    p_action_type => 'operator_review_required',
    p_status => 'pending_verification',
    p_title => 'Instagram action restriction detected',
    p_dedupe_key => 'account:' || p_account_id::text || ':incident:' || v_incident.id::text || ':restriction_review',
    p_safe_client_message => null,
    p_admin_message => 'Verify the Instagram restriction manually. Do not resolve until it is cleared.',
    p_assistant_message => 'Campaign paused. Auto Restart remains blocked until review and physical preflight.',
    p_action_label => 'Mark reviewed',
    p_action_deep_link => '/instagram-dashboard/incidents',
    p_severity => 'error',
    p_audience => 'admin',
    p_requires_client_action => false,
    p_blocking_campaign => true,
    p_metadata => jsonb_build_object(
      'stable_reason', 'instagram_action_rate_limit',
      'restriction_generation', v_generation_id,
      'physical_preflight_required', true
    )
  ) a;

  return jsonb_build_object(
    'ok', true,
    'incident_id', v_incident.id,
    'dedupe_key', v_dedupe_key,
    'hold_id', v_hold.id,
    'hold_status', v_hold.status,
    'restriction_generation', v_generation_id,
    'deduplicated', v_deduplicated,
    'account_paused', true,
    'auto_restart_allowed', false,
    'operator_review_required', true,
    'dashboard_action', coalesce(v_action, '{}'::jsonb)
  );
end
$$;

revoke all on function public.apply_instagram_action_restriction_v1(uuid,text,uuid,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_instagram_action_restriction_v1(uuid,text,uuid,uuid,text,jsonb)
  to service_role;

create or replace function public.mark_instagram_restriction_preflight_required_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.incident_type <> 'instagram_account_restriction' then
    return new;
  end if;
  update public.instagram_account_restriction_holds
  set status = 'verification_required',
      human_resolved_at = coalesce(new.resolved_at, now()),
      verification_required_at = now(),
      metadata_safe = coalesce(metadata_safe, '{}'::jsonb)
        || jsonb_build_object('incident_resolved_but_physical_preflight_pending', true),
      updated_at = now()
  where incident_id = new.id and status = 'active';
  return new;
end
$$;

revoke all on function public.mark_instagram_restriction_preflight_required_v1()
  from public, anon, authenticated;
grant execute on function public.mark_instagram_restriction_preflight_required_v1()
  to service_role;

drop trigger if exists account_incident_restriction_preflight_required_v1
  on public.account_incidents;
create trigger account_incident_restriction_preflight_required_v1
after update of status on public.account_incidents
for each row
when (new.status = 'resolved' and old.status is distinct from new.status)
execute function public.mark_instagram_restriction_preflight_required_v1();

create or replace function public.release_instagram_action_restriction_hold_v1(
  p_account_id uuid,
  p_incident_id uuid,
  p_preflight_run_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hold public.instagram_account_restriction_holds%rowtype;
  v_incident public.account_incidents%rowtype;
  v_restored_status text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select * into v_hold
  from public.instagram_account_restriction_holds
  where account_id = p_account_id
    and incident_id = p_incident_id
  for update;
  if v_hold.id is null then
    return jsonb_build_object('ok', false, 'reason', 'restriction_hold_missing');
  end if;
  if v_hold.status = 'cleared' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'hold_id', v_hold.id, 'hold_status', v_hold.status);
  end if;
  if v_hold.status <> 'verification_required' then
    return jsonb_build_object('ok', false, 'reason', 'restriction_preflight_not_authorized', 'hold_status', v_hold.status);
  end if;

  select * into v_incident
  from public.account_incidents
  where id = p_incident_id and account_id = p_account_id
  for share;
  if v_incident.id is null or v_incident.status <> 'resolved' then
    return jsonb_build_object('ok', false, 'reason', 'restriction_incident_not_resolved');
  end if;

  update public.instagram_account_restriction_holds
  set status = 'cleared',
      verified_cleared_at = now(),
      verified_by_run_id = p_preflight_run_id,
      metadata_safe = coalesce(metadata_safe, '{}'::jsonb)
        || jsonb_build_object(
          'physical_preflight_passed', true,
          'physical_preflight_run_id', p_preflight_run_id,
          'hold_released_at', now()
        ),
      updated_at = now()
  where id = v_hold.id
  returning * into v_hold;

  v_restored_status := coalesce(nullif(v_hold.previous_admin_lifecycle_status, ''), 'active');
  if v_restored_status <> 'paused'
     and not exists (
       select 1 from public.instagram_account_restriction_holds h
       where h.account_id = p_account_id
         and h.id <> v_hold.id
         and h.status in ('active', 'verification_required')
     ) then
    update public.ig_accounts
    set admin_lifecycle_status = v_restored_status, updated_at = now()
    where id = p_account_id and admin_lifecycle_status = 'paused';
  end if;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'hold_id', v_hold.id,
    'hold_status', v_hold.status,
    'restored_admin_lifecycle_status', v_restored_status,
    'physical_preflight_passed', true
  );
end
$$;

revoke all on function public.release_instagram_action_restriction_hold_v1(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.release_instagram_action_restriction_hold_v1(uuid,uuid,uuid)
  to service_role;

comment on table public.instagram_account_restriction_holds is
  'Service-role-only Instagram restriction generations. Human resolution moves a hold to verification_required; only a successful physical Worker preflight clears it.';
