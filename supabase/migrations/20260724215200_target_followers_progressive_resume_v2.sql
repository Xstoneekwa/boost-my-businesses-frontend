-- TARGET_FOLLOWERS_PROGRESSIVE_RESUME_V2
-- Server-only, evidence-gated progress checkpoints for target Followers lists.
-- No row, depth, anchor, target, or historical progress is backfilled here.

create table if not exists public.ig_target_followers_resume_checkpoints (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  target_id uuid not null references public.ig_targets(id) on delete restrict,
  target_username_normalized text not null,
  surface text not null default 'followers',
  checkpoint_version integer not null default 2,
  last_safe_depth integer not null default 0,
  last_safe_anchor text,
  anchor_fingerprint text,
  last_visible_anchor_hashes jsonb not null default '[]'::jsonb,
  shadow_last_safe_depth integer not null default 0,
  shadow_last_safe_anchor text,
  shadow_anchor_fingerprint text,
  shadow_visible_anchor_hashes jsonb not null default '[]'::jsonb,
  last_run_id uuid,
  last_reached_at timestamptz,
  last_instagram_version text,
  status text not null default 'active',
  invalidation_reason text,
  optimistic_version bigint not null default 1,
  lease_owner_run_id uuid,
  lease_mode text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ig_target_followers_resume_checkpoint_identity_unique
    unique (account_id, target_id, surface),
  constraint ig_target_followers_resume_checkpoint_surface_check
    check (surface = 'followers'),
  constraint ig_target_followers_resume_checkpoint_username_check
    check (target_username_normalized ~ '^[a-z0-9._]{1,64}$'),
  constraint ig_target_followers_resume_checkpoint_version_check
    check (checkpoint_version = 2),
  constraint ig_target_followers_resume_checkpoint_depth_check
    check (last_safe_depth between 0 and 80 and shadow_last_safe_depth between 0 and 80),
  constraint ig_target_followers_resume_checkpoint_optimistic_version_check
    check (optimistic_version >= 1),
  constraint ig_target_followers_resume_checkpoint_status_check
    check (status in ('active', 'stale', 'reset_required', 'exhausted', 'invalidated')),
  constraint ig_target_followers_resume_checkpoint_lease_check
    check (
      (lease_owner_run_id is null and lease_mode is null and lease_expires_at is null)
      or (
        lease_owner_run_id is not null
        and lease_mode in ('shadow', 'enforce')
        and lease_expires_at is not null
      )
    ),
  constraint ig_target_followers_resume_checkpoint_anchor_bounds_check
    check (
      coalesce(length(last_safe_anchor), 0) <= 64
      and coalesce(length(anchor_fingerprint), 0) <= 64
      and coalesce(length(shadow_last_safe_anchor), 0) <= 64
      and coalesce(length(shadow_anchor_fingerprint), 0) <= 64
    ),
  constraint ig_target_followers_resume_checkpoint_anchor_arrays_check
    check (
      jsonb_typeof(last_visible_anchor_hashes) = 'array'
      and jsonb_array_length(last_visible_anchor_hashes) <= 12
      and jsonb_typeof(shadow_visible_anchor_hashes) = 'array'
      and jsonb_array_length(shadow_visible_anchor_hashes) <= 12
    ),
  constraint ig_target_followers_resume_checkpoint_reason_bounds_check
    check (coalesce(length(invalidation_reason), 0) <= 120),
  constraint ig_tfr_checkpoint_instagram_version_bounds_check
    check (coalesce(length(last_instagram_version), 0) <= 80),
  constraint ig_target_followers_resume_checkpoint_timestamps_check
    check (updated_at >= created_at)
);

create table if not exists public.ig_target_followers_resume_checkpoint_events (
  id uuid primary key default gen_random_uuid(),
  checkpoint_id uuid not null references public.ig_target_followers_resume_checkpoints(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  target_id uuid not null references public.ig_targets(id) on delete restrict,
  run_id uuid,
  event_type text not null,
  mode text,
  previous_optimistic_version bigint,
  new_optimistic_version bigint,
  previous_depth integer,
  new_depth integer,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ig_target_followers_resume_checkpoint_events_type_check
    check (event_type in ('claimed', 'committed', 'invalidated', 'reset')),
  constraint ig_target_followers_resume_checkpoint_events_mode_check
    check (mode is null or mode in ('shadow', 'enforce')),
  constraint ig_target_followers_resume_checkpoint_events_reason_check
    check (reason ~ '^[a-z0-9_:-]{1,120}$'),
  constraint ig_target_followers_resume_checkpoint_events_depth_check
    check (
      (previous_depth is null or previous_depth between 0 and 80)
      and (new_depth is null or new_depth between 0 and 80)
    ),
  constraint ig_target_followers_resume_checkpoint_events_version_check
    check (
      (previous_optimistic_version is null or previous_optimistic_version >= 1)
      and (new_optimistic_version is null or new_optimistic_version >= 1)
    ),
  constraint ig_tfr_checkpoint_events_metadata_bounds_check
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096)
);

create index if not exists ig_target_followers_resume_checkpoint_account_target_idx
  on public.ig_target_followers_resume_checkpoints(account_id, target_id);
create index if not exists ig_target_followers_resume_checkpoint_status_updated_idx
  on public.ig_target_followers_resume_checkpoints(status, updated_at);
create index if not exists ig_tfr_checkpoint_events_checkpoint_created_idx
  on public.ig_target_followers_resume_checkpoint_events(checkpoint_id, created_at desc);

alter table public.ig_target_followers_resume_checkpoints enable row level security;
alter table public.ig_target_followers_resume_checkpoint_events enable row level security;

revoke all on table public.ig_target_followers_resume_checkpoints from public, anon, authenticated, service_role;
revoke all on table public.ig_target_followers_resume_checkpoint_events from public, anon, authenticated, service_role;
grant select on table public.ig_target_followers_resume_checkpoints to service_role;
grant select on table public.ig_target_followers_resume_checkpoint_events to service_role;

create or replace function public.get_target_followers_resume_checkpoint(
  p_account_id uuid,
  p_target_id uuid,
  p_surface text default 'followers'
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select to_jsonb(c)
  from public.ig_target_followers_resume_checkpoints as c
  where c.account_id = p_account_id
    and c.target_id = p_target_id
    and c.surface = p_surface
  limit 1
$function$;

create or replace function public.claim_target_followers_resume_checkpoint(
  p_account_id uuid,
  p_target_id uuid,
  p_target_username_normalized text,
  p_surface text,
  p_run_id uuid,
  p_mode text,
  p_expected_version bigint default null,
  p_lease_seconds integer default 180
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.ig_target_followers_resume_checkpoints%rowtype;
  v_previous_version bigint;
  v_new_version bigint;
begin
  if p_account_id is null
     or p_target_id is null
     or p_run_id is null
     or p_surface <> 'followers'
     or p_mode not in ('shadow', 'enforce')
     or p_target_username_normalized !~ '^[a-z0-9._]{1,64}$'
     or p_lease_seconds not between 30 and 900 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_claim_input');
  end if;

  if not exists (
    select 1 from public.ig_targets t
    where t.id = p_target_id and t.account_id = p_account_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'target_account_mismatch');
  end if;

  insert into public.ig_target_followers_resume_checkpoints (
    account_id, target_id, target_username_normalized, surface, checkpoint_version
  ) values (
    p_account_id, p_target_id, p_target_username_normalized, p_surface, 2
  ) on conflict (account_id, target_id, surface) do nothing;

  select * into v_row
  from public.ig_target_followers_resume_checkpoints c
  where c.account_id = p_account_id
    and c.target_id = p_target_id
    and c.surface = p_surface
  for update;

  if v_row.target_username_normalized <> p_target_username_normalized then
    return jsonb_build_object('ok', false, 'reason', 'target_username_changed', 'optimistic_version', v_row.optimistic_version);
  end if;
  if v_row.status not in ('active', 'exhausted') then
    return jsonb_build_object('ok', false, 'reason', 'checkpoint_not_claimable', 'status', v_row.status, 'optimistic_version', v_row.optimistic_version);
  end if;
  if p_expected_version is not null and v_row.optimistic_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'optimistic_version_conflict', 'optimistic_version', v_row.optimistic_version);
  end if;
  if v_row.lease_owner_run_id is not null
     and v_row.lease_owner_run_id <> p_run_id
     and v_row.lease_expires_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'lease_held', 'optimistic_version', v_row.optimistic_version, 'lease_expires_at', v_row.lease_expires_at);
  end if;

  v_previous_version := v_row.optimistic_version;
  update public.ig_target_followers_resume_checkpoints c
  set lease_owner_run_id = p_run_id,
      lease_mode = p_mode,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_run_id = p_run_id,
      optimistic_version = c.optimistic_version + 1,
      updated_at = now()
  where c.id = v_row.id
  returning c.optimistic_version into v_new_version;

  insert into public.ig_target_followers_resume_checkpoint_events (
    checkpoint_id, account_id, target_id, run_id, event_type, mode,
    previous_optimistic_version, new_optimistic_version,
    previous_depth, new_depth, reason
  ) values (
    v_row.id, p_account_id, p_target_id, p_run_id, 'claimed', p_mode,
    v_previous_version, v_new_version,
    case when p_mode = 'enforce' then v_row.last_safe_depth else v_row.shadow_last_safe_depth end,
    case when p_mode = 'enforce' then v_row.last_safe_depth else v_row.shadow_last_safe_depth end,
    'lease_claimed'
  );

  return jsonb_build_object('ok', true, 'reason', 'claimed', 'id', v_row.id, 'optimistic_version', v_new_version);
end
$function$;

create or replace function public.commit_target_followers_resume_checkpoint(
  p_account_id uuid,
  p_target_id uuid,
  p_surface text,
  p_run_id uuid,
  p_mode text,
  p_expected_version bigint,
  p_last_safe_depth integer,
  p_last_safe_anchor text default null,
  p_anchor_fingerprint text default null,
  p_last_visible_anchor_hashes jsonb default '[]'::jsonb,
  p_last_instagram_version text default null,
  p_status text default 'active',
  p_reason text default 'validated_transition'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.ig_target_followers_resume_checkpoints%rowtype;
  v_previous_depth integer;
  v_new_version bigint;
begin
  if p_account_id is null
     or p_target_id is null
     or p_run_id is null
     or p_surface <> 'followers'
     or p_mode not in ('shadow', 'enforce')
     or p_expected_version is null
     or p_last_safe_depth not between 0 and 80
     or p_status not in ('active', 'exhausted')
     or p_reason !~ '^[a-z0-9_:-]{1,120}$'
     or coalesce(length(p_last_safe_anchor), 0) > 64
     or coalesce(length(p_anchor_fingerprint), 0) > 64
     or coalesce(length(p_last_instagram_version), 0) > 80
     or jsonb_typeof(p_last_visible_anchor_hashes) <> 'array'
     or jsonb_array_length(p_last_visible_anchor_hashes) > 12
     or exists (
       select 1 from jsonb_array_elements_text(p_last_visible_anchor_hashes) a(value)
       where a.value !~ '^a2:[0-9a-f]{24}$'
     ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_commit_input');
  end if;

  select * into v_row
  from public.ig_target_followers_resume_checkpoints c
  where c.account_id = p_account_id and c.target_id = p_target_id and c.surface = p_surface
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'checkpoint_missing');
  end if;
  if v_row.optimistic_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'optimistic_version_conflict', 'optimistic_version', v_row.optimistic_version);
  end if;
  if v_row.lease_owner_run_id <> p_run_id or v_row.lease_mode <> p_mode then
    return jsonb_build_object('ok', false, 'reason', 'lease_owner_mismatch', 'optimistic_version', v_row.optimistic_version);
  end if;
  if v_row.lease_expires_at is null or v_row.lease_expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'lease_expired', 'optimistic_version', v_row.optimistic_version);
  end if;

  v_previous_depth := case when p_mode = 'enforce' then v_row.last_safe_depth else v_row.shadow_last_safe_depth end;
  if p_last_safe_depth < v_previous_depth then
    return jsonb_build_object('ok', false, 'reason', 'depth_regression_rejected', 'previous_depth', v_previous_depth);
  end if;
  if p_last_safe_depth > v_previous_depth + 1 then
    return jsonb_build_object('ok', false, 'reason', 'unproven_depth_jump_rejected', 'previous_depth', v_previous_depth);
  end if;

  update public.ig_target_followers_resume_checkpoints c
  set last_safe_depth = case when p_mode = 'enforce' then p_last_safe_depth else c.last_safe_depth end,
      last_safe_anchor = case when p_mode = 'enforce' then p_last_safe_anchor else c.last_safe_anchor end,
      anchor_fingerprint = case when p_mode = 'enforce' then p_anchor_fingerprint else c.anchor_fingerprint end,
      last_visible_anchor_hashes = case when p_mode = 'enforce' then p_last_visible_anchor_hashes else c.last_visible_anchor_hashes end,
      shadow_last_safe_depth = case when p_mode = 'shadow' then p_last_safe_depth else c.shadow_last_safe_depth end,
      shadow_last_safe_anchor = case when p_mode = 'shadow' then p_last_safe_anchor else c.shadow_last_safe_anchor end,
      shadow_anchor_fingerprint = case when p_mode = 'shadow' then p_anchor_fingerprint else c.shadow_anchor_fingerprint end,
      shadow_visible_anchor_hashes = case when p_mode = 'shadow' then p_last_visible_anchor_hashes else c.shadow_visible_anchor_hashes end,
      last_run_id = p_run_id,
      last_reached_at = now(),
      last_instagram_version = p_last_instagram_version,
      status = p_status,
      invalidation_reason = null,
      lease_owner_run_id = p_run_id,
      lease_mode = p_mode,
      lease_expires_at = now() + interval '180 seconds',
      optimistic_version = c.optimistic_version + 1,
      updated_at = now()
  where c.id = v_row.id
  returning c.optimistic_version into v_new_version;

  insert into public.ig_target_followers_resume_checkpoint_events (
    checkpoint_id, account_id, target_id, run_id, event_type, mode,
    previous_optimistic_version, new_optimistic_version,
    previous_depth, new_depth, reason, metadata
  ) values (
    v_row.id, p_account_id, p_target_id, p_run_id, 'committed', p_mode,
    v_row.optimistic_version, v_new_version, v_previous_depth, p_last_safe_depth, p_reason,
    jsonb_build_object('status', p_status, 'anchor_count', jsonb_array_length(p_last_visible_anchor_hashes))
  );

  return jsonb_build_object('ok', true, 'reason', 'committed', 'id', v_row.id, 'optimistic_version', v_new_version, 'depth', p_last_safe_depth);
end
$function$;

create or replace function public.invalidate_target_followers_resume_checkpoint(
  p_account_id uuid,
  p_target_id uuid,
  p_surface text,
  p_run_id uuid,
  p_expected_version bigint,
  p_reason text,
  p_status text default 'stale'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.ig_target_followers_resume_checkpoints%rowtype;
  v_new_version bigint;
begin
  if p_account_id is null
     or p_target_id is null
     or p_run_id is null
     or p_expected_version is null
     or p_surface <> 'followers'
     or p_status not in ('stale', 'reset_required', 'invalidated')
     or p_reason !~ '^[a-z0-9_:-]{1,120}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_invalidation_input');
  end if;
  select * into v_row from public.ig_target_followers_resume_checkpoints c
  where c.account_id = p_account_id and c.target_id = p_target_id and c.surface = p_surface
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'checkpoint_missing');
  end if;
  if v_row.optimistic_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'optimistic_version_conflict', 'optimistic_version', v_row.optimistic_version);
  end if;
  update public.ig_target_followers_resume_checkpoints c
  set status = p_status,
      invalidation_reason = p_reason,
      lease_owner_run_id = null,
      lease_mode = null,
      lease_expires_at = null,
      last_run_id = p_run_id,
      optimistic_version = c.optimistic_version + 1,
      updated_at = now()
  where c.id = v_row.id
  returning c.optimistic_version into v_new_version;
  insert into public.ig_target_followers_resume_checkpoint_events (
    checkpoint_id, account_id, target_id, run_id, event_type,
    previous_optimistic_version, new_optimistic_version,
    previous_depth, new_depth, reason
  ) values (
    v_row.id, p_account_id, p_target_id, p_run_id, 'invalidated',
    v_row.optimistic_version, v_new_version,
    greatest(v_row.last_safe_depth, v_row.shadow_last_safe_depth),
    greatest(v_row.last_safe_depth, v_row.shadow_last_safe_depth), p_reason
  );
  return jsonb_build_object('ok', true, 'reason', 'invalidated', 'optimistic_version', v_new_version, 'status', p_status);
end
$function$;

create or replace function public.reset_target_followers_resume_checkpoint(
  p_account_id uuid,
  p_target_id uuid,
  p_surface text,
  p_run_id uuid,
  p_expected_version bigint,
  p_reason text,
  p_reset_shadow boolean default true,
  p_reset_enforce boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.ig_target_followers_resume_checkpoints%rowtype;
  v_new_version bigint;
begin
  if p_account_id is null
     or p_target_id is null
     or p_run_id is null
     or p_expected_version is null
     or p_surface <> 'followers'
     or not (p_reset_shadow or p_reset_enforce)
     or p_reason !~ '^[a-z0-9_:-]{1,120}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_reset_input');
  end if;
  select * into v_row from public.ig_target_followers_resume_checkpoints c
  where c.account_id = p_account_id and c.target_id = p_target_id and c.surface = p_surface
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'checkpoint_missing');
  end if;
  if v_row.optimistic_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'optimistic_version_conflict', 'optimistic_version', v_row.optimistic_version);
  end if;
  update public.ig_target_followers_resume_checkpoints c
  set last_safe_depth = case when p_reset_enforce then 0 else c.last_safe_depth end,
      last_safe_anchor = case when p_reset_enforce then null else c.last_safe_anchor end,
      anchor_fingerprint = case when p_reset_enforce then null else c.anchor_fingerprint end,
      last_visible_anchor_hashes = case when p_reset_enforce then '[]'::jsonb else c.last_visible_anchor_hashes end,
      shadow_last_safe_depth = case when p_reset_shadow then 0 else c.shadow_last_safe_depth end,
      shadow_last_safe_anchor = case when p_reset_shadow then null else c.shadow_last_safe_anchor end,
      shadow_anchor_fingerprint = case when p_reset_shadow then null else c.shadow_anchor_fingerprint end,
      shadow_visible_anchor_hashes = case when p_reset_shadow then '[]'::jsonb else c.shadow_visible_anchor_hashes end,
      status = 'active',
      invalidation_reason = null,
      lease_owner_run_id = null,
      lease_mode = null,
      lease_expires_at = null,
      last_run_id = p_run_id,
      optimistic_version = c.optimistic_version + 1,
      updated_at = now()
  where c.id = v_row.id
  returning c.optimistic_version into v_new_version;
  insert into public.ig_target_followers_resume_checkpoint_events (
    checkpoint_id, account_id, target_id, run_id, event_type,
    previous_optimistic_version, new_optimistic_version,
    previous_depth, new_depth, reason, metadata
  ) values (
    v_row.id, p_account_id, p_target_id, p_run_id, 'reset',
    v_row.optimistic_version, v_new_version,
    greatest(v_row.last_safe_depth, v_row.shadow_last_safe_depth),
    greatest(
      case when p_reset_enforce then 0 else v_row.last_safe_depth end,
      case when p_reset_shadow then 0 else v_row.shadow_last_safe_depth end
    ),
    p_reason,
    jsonb_build_object('reset_shadow', p_reset_shadow, 'reset_enforce', p_reset_enforce)
  );
  return jsonb_build_object('ok', true, 'reason', 'reset', 'optimistic_version', v_new_version);
end
$function$;

revoke all on function public.get_target_followers_resume_checkpoint(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.claim_target_followers_resume_checkpoint(uuid, uuid, text, text, uuid, text, bigint, integer) from public, anon, authenticated;
revoke all on function public.commit_target_followers_resume_checkpoint(uuid, uuid, text, uuid, text, bigint, integer, text, text, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.invalidate_target_followers_resume_checkpoint(uuid, uuid, text, uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.reset_target_followers_resume_checkpoint(uuid, uuid, text, uuid, bigint, text, boolean, boolean) from public, anon, authenticated;

grant execute on function public.get_target_followers_resume_checkpoint(uuid, uuid, text) to service_role;
grant execute on function public.claim_target_followers_resume_checkpoint(uuid, uuid, text, text, uuid, text, bigint, integer) to service_role;
grant execute on function public.commit_target_followers_resume_checkpoint(uuid, uuid, text, uuid, text, bigint, integer, text, text, jsonb, text, text, text) to service_role;
grant execute on function public.invalidate_target_followers_resume_checkpoint(uuid, uuid, text, uuid, bigint, text, text) to service_role;
grant execute on function public.reset_target_followers_resume_checkpoint(uuid, uuid, text, uuid, bigint, text, boolean, boolean) to service_role;
