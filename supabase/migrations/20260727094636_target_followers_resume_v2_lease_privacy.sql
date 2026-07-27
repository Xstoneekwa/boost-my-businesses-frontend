-- TARGET_FOLLOWERS_PROGRESSIVE_RESUME_V2 lease/privacy hardening.
-- No historical depth is invented. Existing unhashed anchors are purged.

create table if not exists public.ig_target_followers_resume_checkpoints (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  target_id uuid not null references public.ig_targets(id) on delete restrict,
  surface text not null default 'followers',
  checkpoint_version integer not null default 3,
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
  last_verified_at timestamptz,
  last_instagram_version text,
  status text not null default 'active',
  end_reached boolean not null default false,
  invalidation_reason text,
  optimistic_version bigint not null default 1,
  lease_owner_run_id uuid,
  lease_mode text,
  lease_expires_at timestamptz,
  lease_heartbeat_at timestamptz,
  lease_generation bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, target_id, surface)
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
  created_at timestamptz not null default now()
);

-- Remove the only RPC whose signature accepts a target username before dropping
-- the plaintext column. The new claim RPC accepts target_id only.
drop function if exists public.claim_target_followers_resume_checkpoint(uuid, uuid, text, text, uuid, text, bigint, integer);
drop function if exists public.commit_target_followers_resume_checkpoint(uuid, uuid, text, uuid, text, bigint, integer, text, text, jsonb, text, text, text);

alter table public.ig_target_followers_resume_checkpoints
  add column if not exists last_verified_at timestamptz,
  add column if not exists end_reached boolean not null default false,
  add column if not exists lease_heartbeat_at timestamptz,
  add column if not exists lease_generation bigint not null default 0;

alter table public.ig_target_followers_resume_checkpoints
  drop constraint if exists ig_target_followers_resume_checkpoint_username_check,
  drop constraint if exists ig_target_followers_resume_checkpoint_version_check,
  drop constraint if exists ig_target_followers_resume_checkpoint_lease_check;

-- Old SHA-256 follower identifiers were not keyed. Purge them instead of
-- pretending they satisfy the new HMAC privacy contract.
update public.ig_target_followers_resume_checkpoints
set last_safe_anchor = null,
    anchor_fingerprint = null,
    last_visible_anchor_hashes = '[]'::jsonb,
    shadow_last_safe_anchor = null,
    shadow_anchor_fingerprint = null,
    shadow_visible_anchor_hashes = '[]'::jsonb,
    checkpoint_version = 3,
    lease_owner_run_id = null,
    lease_mode = null,
    lease_expires_at = null,
    lease_heartbeat_at = null,
    optimistic_version = optimistic_version + 1,
    updated_at = now();

alter table public.ig_target_followers_resume_checkpoints
  drop column if exists target_username_normalized;

alter table public.ig_target_followers_resume_checkpoints
  add constraint ig_target_followers_resume_checkpoint_version_check check (checkpoint_version = 3),
  add constraint ig_target_followers_resume_checkpoint_lease_check check (
    (lease_owner_run_id is null and lease_mode is null and lease_expires_at is null and lease_heartbeat_at is null)
    or (lease_owner_run_id is not null and lease_mode in ('shadow', 'enforce') and lease_expires_at is not null and lease_heartbeat_at is not null)
  ),
  add constraint ig_target_followers_resume_checkpoint_lease_generation_check check (lease_generation >= 0);

alter table public.ig_target_followers_resume_checkpoint_events
  drop constraint if exists ig_target_followers_resume_checkpoint_events_type_check;
alter table public.ig_target_followers_resume_checkpoint_events
  add constraint ig_target_followers_resume_checkpoint_events_type_check
  check (event_type in ('claimed', 'renewed', 'reclaimed', 'committed', 'released', 'invalidated', 'reset'));

create index if not exists ig_target_followers_resume_checkpoint_account_target_idx
  on public.ig_target_followers_resume_checkpoints(account_id, target_id);
create index if not exists ig_tfr_checkpoint_events_checkpoint_created_idx
  on public.ig_target_followers_resume_checkpoint_events(checkpoint_id, created_at desc);

alter table public.ig_target_followers_resume_checkpoints enable row level security;
alter table public.ig_target_followers_resume_checkpoint_events enable row level security;
revoke all on table public.ig_target_followers_resume_checkpoints from public, anon, authenticated, service_role;
revoke all on table public.ig_target_followers_resume_checkpoint_events from public, anon, authenticated, service_role;
grant select on table public.ig_target_followers_resume_checkpoints to service_role;
grant select on table public.ig_target_followers_resume_checkpoint_events to service_role;

create or replace function public.get_target_followers_resume_checkpoint_v3(
  p_account_id uuid, p_target_id uuid, p_surface text default 'followers'
) returns jsonb language sql stable security definer set search_path = '' as $function$
  select to_jsonb(c) from public.ig_target_followers_resume_checkpoints c
  where c.account_id = p_account_id and c.target_id = p_target_id and c.surface = p_surface limit 1
$function$;

create or replace function public.claim_target_followers_resume_checkpoint_v3(
  p_account_id uuid,
  p_target_id uuid,
  p_surface text,
  p_run_id uuid,
  p_mode text,
  p_expected_version bigint default null,
  p_lease_seconds integer default 3600
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_row public.ig_target_followers_resume_checkpoints%rowtype;
  v_previous_version bigint;
  v_new_version bigint;
  v_reclaimed boolean := false;
  v_expiry timestamptz;
begin
  if p_account_id is null or p_target_id is null or p_run_id is null
     or p_surface <> 'followers' or p_mode not in ('shadow', 'enforce')
     or p_lease_seconds not between 300 and 7200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_claim_input');
  end if;
  if not exists (select 1 from public.ig_targets t where t.id = p_target_id and t.account_id = p_account_id) then
    return jsonb_build_object('ok', false, 'reason', 'target_account_mismatch');
  end if;

  insert into public.ig_target_followers_resume_checkpoints(account_id, target_id, surface, checkpoint_version)
  values (p_account_id, p_target_id, p_surface, 3)
  on conflict (account_id, target_id, surface) do nothing;

  select * into v_row from public.ig_target_followers_resume_checkpoints c
  where c.account_id = p_account_id and c.target_id = p_target_id and c.surface = p_surface for update;
  if v_row.status not in ('active', 'exhausted') then
    return jsonb_build_object('ok', false, 'reason', 'checkpoint_not_claimable', 'optimistic_version', v_row.optimistic_version);
  end if;
  if p_expected_version is not null and v_row.optimistic_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'optimistic_version_conflict', 'optimistic_version', v_row.optimistic_version);
  end if;
  if v_row.lease_owner_run_id is not null and v_row.lease_owner_run_id <> p_run_id and v_row.lease_expires_at > now() then
    if exists (
      select 1 from public.ig_runs r
      where r.id = v_row.lease_owner_run_id and r.status not in ('completed', 'failed', 'stopped')
    ) or not exists (select 1 from public.ig_runs r where r.id = v_row.lease_owner_run_id) then
      return jsonb_build_object('ok', false, 'reason', 'lease_held', 'optimistic_version', v_row.optimistic_version, 'lease_expires_at', v_row.lease_expires_at);
    end if;
    v_reclaimed := true;
  elsif v_row.lease_owner_run_id is not null and v_row.lease_owner_run_id <> p_run_id then
    v_reclaimed := true;
  end if;

  v_previous_version := v_row.optimistic_version;
  v_expiry := now() + make_interval(secs => p_lease_seconds);
  update public.ig_target_followers_resume_checkpoints c
  set lease_owner_run_id = p_run_id, lease_mode = p_mode,
      lease_expires_at = v_expiry, lease_heartbeat_at = now(),
      lease_generation = c.lease_generation + 1, last_run_id = p_run_id,
      optimistic_version = c.optimistic_version + 1, updated_at = now()
  where c.id = v_row.id returning c.optimistic_version into v_new_version;

  insert into public.ig_target_followers_resume_checkpoint_events(
    checkpoint_id, account_id, target_id, run_id, event_type, mode,
    previous_optimistic_version, new_optimistic_version, previous_depth, new_depth, reason
  ) values (
    v_row.id, p_account_id, p_target_id, p_run_id,
    case when v_reclaimed then 'reclaimed' else 'claimed' end, p_mode,
    v_previous_version, v_new_version,
    case when p_mode = 'enforce' then v_row.last_safe_depth else v_row.shadow_last_safe_depth end,
    case when p_mode = 'enforce' then v_row.last_safe_depth else v_row.shadow_last_safe_depth end,
    case when v_reclaimed then 'lease_reclaimed' else 'lease_claimed' end
  );
  return jsonb_build_object('ok', true, 'reason', case when v_reclaimed then 'reclaimed' else 'claimed' end,
    'optimistic_version', v_new_version, 'lease_expires_at', v_expiry, 'lease_generation', v_row.lease_generation + 1);
end
$function$;

create or replace function public.renew_target_followers_resume_checkpoint_v3(
  p_account_id uuid, p_target_id uuid, p_surface text, p_run_id uuid, p_mode text,
  p_expected_version bigint, p_lease_seconds integer default 3600
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_row public.ig_target_followers_resume_checkpoints%rowtype;
  v_new_version bigint;
  v_expiry timestamptz;
  v_reclaimed boolean;
begin
  if p_lease_seconds not between 300 and 7200 or p_expected_version is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_renew_input');
  end if;
  select * into v_row from public.ig_target_followers_resume_checkpoints c
  where c.account_id=p_account_id and c.target_id=p_target_id and c.surface=p_surface for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'checkpoint_missing'); end if;
  if v_row.optimistic_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'optimistic_version_conflict', 'optimistic_version', v_row.optimistic_version);
  end if;
  if v_row.lease_owner_run_id <> p_run_id or v_row.lease_mode <> p_mode then
    return jsonb_build_object('ok', false, 'reason', 'lease_owner_mismatch', 'optimistic_version', v_row.optimistic_version);
  end if;
  v_reclaimed := v_row.lease_expires_at is null or v_row.lease_expires_at <= now();
  v_expiry := now() + make_interval(secs => p_lease_seconds);
  update public.ig_target_followers_resume_checkpoints c
  set lease_expires_at=v_expiry, lease_heartbeat_at=now(),
      lease_generation=case when v_reclaimed then c.lease_generation+1 else c.lease_generation end,
      optimistic_version=c.optimistic_version+1, updated_at=now()
  where c.id=v_row.id returning optimistic_version into v_new_version;
  insert into public.ig_target_followers_resume_checkpoint_events(
    checkpoint_id,account_id,target_id,run_id,event_type,mode,previous_optimistic_version,new_optimistic_version,
    previous_depth,new_depth,reason
  ) values (v_row.id,p_account_id,p_target_id,p_run_id,case when v_reclaimed then 'reclaimed' else 'renewed' end,p_mode,
    v_row.optimistic_version,v_new_version,
    case when p_mode='enforce' then v_row.last_safe_depth else v_row.shadow_last_safe_depth end,
    case when p_mode='enforce' then v_row.last_safe_depth else v_row.shadow_last_safe_depth end,
    case when v_reclaimed then 'lease_reclaimed_same_run' else 'lease_renewed' end);
  return jsonb_build_object('ok',true,'reason',case when v_reclaimed then 'reclaimed' else 'renewed' end,
    'optimistic_version',v_new_version,'lease_expires_at',v_expiry);
end
$function$;

create or replace function public.commit_target_followers_resume_checkpoint_v3(
  p_account_id uuid, p_target_id uuid, p_surface text, p_run_id uuid, p_mode text,
  p_expected_version bigint, p_last_safe_depth integer, p_last_safe_anchor text default null,
  p_anchor_fingerprint text default null, p_last_visible_anchor_hashes jsonb default '[]'::jsonb,
  p_last_instagram_version text default null, p_status text default 'active',
  p_end_reached boolean default false, p_reason text default 'validated_transition',
  p_lease_seconds integer default 3600
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_row public.ig_target_followers_resume_checkpoints%rowtype;
  v_previous_depth integer;
  v_new_version bigint;
  v_reclaimed boolean;
  v_expiry timestamptz;
begin
  if p_expected_version is null or p_surface <> 'followers' or p_mode not in ('shadow','enforce')
     or p_last_safe_depth not between 0 and 80 or p_status not in ('active','exhausted')
     or p_reason !~ '^[a-z0-9_:-]{1,120}$' or p_lease_seconds not between 300 and 7200
     or coalesce(p_last_safe_anchor,'') !~ '^(|a3:[0-9a-f]{32})$'
     or coalesce(p_anchor_fingerprint,'') !~ '^(|v3:[0-9a-f]{32})$'
     or jsonb_typeof(p_last_visible_anchor_hashes) <> 'array'
     or jsonb_array_length(p_last_visible_anchor_hashes) > 12
     or exists (select 1 from jsonb_array_elements_text(p_last_visible_anchor_hashes) a(value) where a.value !~ '^a3:[0-9a-f]{32}$') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_commit_input');
  end if;
  select * into v_row from public.ig_target_followers_resume_checkpoints c
  where c.account_id=p_account_id and c.target_id=p_target_id and c.surface=p_surface for update;
  if not found then return jsonb_build_object('ok',false,'reason','checkpoint_missing'); end if;
  if v_row.optimistic_version <> p_expected_version then
    return jsonb_build_object('ok',false,'reason','optimistic_version_conflict','optimistic_version',v_row.optimistic_version);
  end if;
  if v_row.lease_owner_run_id <> p_run_id or v_row.lease_mode <> p_mode then
    return jsonb_build_object('ok',false,'reason','lease_owner_mismatch','optimistic_version',v_row.optimistic_version);
  end if;
  v_reclaimed := v_row.lease_expires_at is null or v_row.lease_expires_at <= now();
  v_previous_depth := case when p_mode='enforce' then v_row.last_safe_depth else v_row.shadow_last_safe_depth end;
  if p_last_safe_depth < v_previous_depth then return jsonb_build_object('ok',false,'reason','depth_regression_rejected','previous_depth',v_previous_depth); end if;
  if p_last_safe_depth > v_previous_depth + 1 then return jsonb_build_object('ok',false,'reason','unproven_depth_jump_rejected','previous_depth',v_previous_depth); end if;
  v_expiry := now() + make_interval(secs => p_lease_seconds);
  if v_reclaimed then
    insert into public.ig_target_followers_resume_checkpoint_events(
      checkpoint_id,account_id,target_id,run_id,event_type,mode,previous_optimistic_version,new_optimistic_version,
      previous_depth,new_depth,reason
    ) values (v_row.id,p_account_id,p_target_id,p_run_id,'reclaimed',p_mode,v_row.optimistic_version,v_row.optimistic_version,
      v_previous_depth,v_previous_depth,'lease_reclaimed_before_commit');
  end if;
  update public.ig_target_followers_resume_checkpoints c set
    last_safe_depth=case when p_mode='enforce' then p_last_safe_depth else c.last_safe_depth end,
    last_safe_anchor=case when p_mode='enforce' then p_last_safe_anchor else c.last_safe_anchor end,
    anchor_fingerprint=case when p_mode='enforce' then p_anchor_fingerprint else c.anchor_fingerprint end,
    last_visible_anchor_hashes=case when p_mode='enforce' then p_last_visible_anchor_hashes else c.last_visible_anchor_hashes end,
    shadow_last_safe_depth=case when p_mode='shadow' then p_last_safe_depth else c.shadow_last_safe_depth end,
    shadow_last_safe_anchor=case when p_mode='shadow' then p_last_safe_anchor else c.shadow_last_safe_anchor end,
    shadow_anchor_fingerprint=case when p_mode='shadow' then p_anchor_fingerprint else c.shadow_anchor_fingerprint end,
    shadow_visible_anchor_hashes=case when p_mode='shadow' then p_last_visible_anchor_hashes else c.shadow_visible_anchor_hashes end,
    last_run_id=p_run_id,last_reached_at=now(),last_verified_at=now(),last_instagram_version=p_last_instagram_version,
    status=p_status,end_reached=p_end_reached,invalidation_reason=null,
    lease_expires_at=v_expiry,lease_heartbeat_at=now(),
    lease_generation=case when v_reclaimed then c.lease_generation+1 else c.lease_generation end,
    optimistic_version=c.optimistic_version+1,updated_at=now()
  where c.id=v_row.id returning optimistic_version into v_new_version;
  insert into public.ig_target_followers_resume_checkpoint_events(
    checkpoint_id,account_id,target_id,run_id,event_type,mode,previous_optimistic_version,new_optimistic_version,
    previous_depth,new_depth,reason,metadata
  ) values (v_row.id,p_account_id,p_target_id,p_run_id,'committed',p_mode,v_row.optimistic_version,v_new_version,
    v_previous_depth,p_last_safe_depth,p_reason,jsonb_build_object('status',p_status,'end_reached',p_end_reached,
      'anchor_count',jsonb_array_length(p_last_visible_anchor_hashes),'lease_reclaimed',v_reclaimed));
  return jsonb_build_object('ok',true,'reason','committed','optimistic_version',v_new_version,
    'depth',p_last_safe_depth,'lease_expires_at',v_expiry,'lease_reclaimed',v_reclaimed);
end
$function$;

create or replace function public.release_target_followers_resume_checkpoint_v3(
  p_account_id uuid, p_target_id uuid, p_surface text, p_run_id uuid, p_mode text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_row public.ig_target_followers_resume_checkpoints%rowtype; v_new_version bigint;
begin
  select * into v_row from public.ig_target_followers_resume_checkpoints c
  where c.account_id=p_account_id and c.target_id=p_target_id and c.surface=p_surface for update;
  if not found then return jsonb_build_object('ok',false,'reason','checkpoint_missing'); end if;
  if v_row.lease_owner_run_id is null then return jsonb_build_object('ok',true,'reason','already_released','optimistic_version',v_row.optimistic_version); end if;
  if v_row.lease_owner_run_id <> p_run_id or v_row.lease_mode <> p_mode then
    return jsonb_build_object('ok',false,'reason','lease_owner_mismatch','optimistic_version',v_row.optimistic_version);
  end if;
  update public.ig_target_followers_resume_checkpoints c set lease_owner_run_id=null,lease_mode=null,
    lease_expires_at=null,lease_heartbeat_at=null,optimistic_version=c.optimistic_version+1,updated_at=now()
  where c.id=v_row.id returning optimistic_version into v_new_version;
  insert into public.ig_target_followers_resume_checkpoint_events(
    checkpoint_id,account_id,target_id,run_id,event_type,mode,previous_optimistic_version,new_optimistic_version,
    previous_depth,new_depth,reason
  ) values (v_row.id,p_account_id,p_target_id,p_run_id,'released',p_mode,v_row.optimistic_version,v_new_version,
    case when p_mode='enforce' then v_row.last_safe_depth else v_row.shadow_last_safe_depth end,
    case when p_mode='enforce' then v_row.last_safe_depth else v_row.shadow_last_safe_depth end,'lease_released');
  return jsonb_build_object('ok',true,'reason','released','optimistic_version',v_new_version);
end
$function$;

revoke all on function public.get_target_followers_resume_checkpoint_v3(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.claim_target_followers_resume_checkpoint_v3(uuid,uuid,text,uuid,text,bigint,integer) from public,anon,authenticated;
revoke all on function public.renew_target_followers_resume_checkpoint_v3(uuid,uuid,text,uuid,text,bigint,integer) from public,anon,authenticated;
revoke all on function public.commit_target_followers_resume_checkpoint_v3(uuid,uuid,text,uuid,text,bigint,integer,text,text,jsonb,text,text,boolean,text,integer) from public,anon,authenticated;
revoke all on function public.release_target_followers_resume_checkpoint_v3(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.get_target_followers_resume_checkpoint_v3(uuid,uuid,text) to service_role;
grant execute on function public.claim_target_followers_resume_checkpoint_v3(uuid,uuid,text,uuid,text,bigint,integer) to service_role;
grant execute on function public.renew_target_followers_resume_checkpoint_v3(uuid,uuid,text,uuid,text,bigint,integer) to service_role;
grant execute on function public.commit_target_followers_resume_checkpoint_v3(uuid,uuid,text,uuid,text,bigint,integer,text,text,jsonb,text,text,boolean,text,integer) to service_role;
grant execute on function public.release_target_followers_resume_checkpoint_v3(uuid,uuid,text,uuid,text) to service_role;
