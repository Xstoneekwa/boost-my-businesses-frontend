begin;

-- A connected/ready lifecycle state must be backed by a persisted proof that
-- the canonical own-profile surface was opened and the detected username
-- matched the account exactly. Existing accounts pre-dating this proof model
-- remain explicitly classified as historical rather than being invalidated.
alter table public.client_instagram_accounts
  add column if not exists login_identity_proof_status text not null default 'required_unverified',
  add column if not exists login_identity_expected_username text,
  add column if not exists login_identity_detected_username text,
  add column if not exists login_identity_profile_opened boolean,
  add column if not exists login_identity_username_match boolean,
  add column if not exists login_identity_verified_at timestamptz,
  add column if not exists login_identity_source_run_id uuid,
  add column if not exists login_identity_failure_reason text,
  add column if not exists login_identity_proof_version integer not null default 1;

alter table public.client_instagram_accounts
  drop constraint if exists client_instagram_accounts_login_identity_proof_status_check,
  add constraint client_instagram_accounts_login_identity_proof_status_check
    check (login_identity_proof_status in (
      'required_unverified',
      'historical_model_missing',
      'verified',
      'failed',
      'proven_false_ready'
    )),
  drop constraint if exists client_instagram_accounts_login_identity_proof_version_check,
  add constraint client_instagram_accounts_login_identity_proof_version_check
    check (login_identity_proof_version >= 1);

comment on column public.client_instagram_accounts.login_identity_proof_status is
  'Canonical persisted own-profile identity proof. historical_model_missing preserves pre-contract accounts without asserting a false proof.';
comment on column public.client_instagram_accounts.login_identity_profile_opened is
  'True only when the canonical Instagram own-profile surface was opened during the identity verification.';
comment on column public.client_instagram_accounts.login_identity_source_run_id is
  'Login/provisioning run that produced the persisted identity proof, when available.';

-- This classifies history without inventing evidence and without changing any
-- lifecycle/readiness status. Only a separately proven false-ready account may
-- be reconciled by the service-role RPC below.
update public.client_instagram_accounts
set login_identity_proof_status = 'historical_model_missing'
where login_identity_proof_status = 'required_unverified'
  and lower(coalesce(login_status, '')) = 'connected'
  and lower(coalesce(provisioning_status, '')) = 'ready';

create or replace function public.normalize_instagram_identity_username_v1(p_username text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(trim(both '@' from trim(both '/' from trim(coalesce(p_username, '')))));
$$;

create or replace function public.enforce_client_instagram_ready_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canonical_username text;
  v_ready_transition boolean;
begin
  v_ready_transition :=
    (tg_op = 'INSERT' and (
      lower(coalesce(new.login_status, '')) = 'connected'
      or lower(coalesce(new.provisioning_status, '')) = 'ready'
      or lower(coalesce(new.onboarding_status, '')) = 'ready'
    ))
    or (tg_op = 'UPDATE' and (
      (lower(coalesce(new.login_status, '')) = 'connected'
        and lower(coalesce(old.login_status, '')) <> 'connected')
      or (lower(coalesce(new.provisioning_status, '')) = 'ready'
        and lower(coalesce(old.provisioning_status, '')) <> 'ready')
      or (lower(coalesce(new.onboarding_status, '')) = 'ready'
        and lower(coalesce(old.onboarding_status, '')) <> 'ready')
    ));

  if not v_ready_transition then
    return new;
  end if;

  select public.normalize_instagram_identity_username_v1(ia.username)
    into v_canonical_username
  from public.ig_accounts as ia
  where ia.id = new.account_id;

  if new.login_identity_proof_status <> 'verified'
     or new.login_identity_profile_opened is distinct from true
     or new.login_identity_username_match is distinct from true
     or new.login_identity_verified_at is null
     or public.normalize_instagram_identity_username_v1(new.login_identity_expected_username) = ''
     or public.normalize_instagram_identity_username_v1(new.login_identity_detected_username) = ''
     or public.normalize_instagram_identity_username_v1(new.login_identity_expected_username) <> v_canonical_username
     or public.normalize_instagram_identity_username_v1(new.login_identity_detected_username) <> v_canonical_username
  then
    raise exception 'login_identity_not_verified'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.update_client_instagram_account_status(
  p_account_id uuid,
  p_login_status text default null,
  p_provisioning_status text default null,
  p_onboarding_status text default null,
  p_reauth_required boolean default null,
  p_reauth_reason text default null,
  p_actor_type text default 'system',
  p_reason text default null,
  p_external_request_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_type text := lower(coalesce(nullif(trim(p_actor_type), ''), 'system'));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_effective_reauth_required boolean := p_reauth_required;
  v_client_id uuid;
  v_login_status text;
  v_provisioning_status text;
  v_onboarding_status text;
  v_sync_result jsonb;
  v_runtime_settings_sync jsonb := jsonb_build_object(
    'ok', true,
    'applied', false,
    'reason', 'not_connected_ready'
  );
  v_ready_requested boolean;
  v_canonical_username text;
  v_expected_username text;
  v_detected_username text;
  v_profile_opened boolean;
  v_identity_verified boolean;
  v_source_run_id uuid;
begin
  if p_account_id is null then
    raise exception 'account_id_required'
      using errcode = '22023';
  end if;

  if v_actor_type not in ('client', 'admin', 'assistant', 'ops', 'internal', 'system', 'worker', 'provisioner') then
    raise exception 'invalid_status_actor_type'
      using errcode = '22023';
  end if;

  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'reason too long'
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_metadata) is distinct from 'object' then
    raise exception 'metadata must be a json object'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(v_metadata) as k(key)
    where lower(k.key) in (
      'password',
      'secret',
      'secret_ref',
      'raw_secret',
      'token',
      'cookie',
      'webhook',
      'webhook_url',
      'vault',
      'service_role',
      'authorization',
      'bearer',
      'raw_xml',
      'xml',
      'screenshot',
      'device_udid',
      'adb_serial'
    )
  ) then
    raise exception 'metadata contains a forbidden key'
      using errcode = '22023';
  end if;

  select cia.client_id, public.normalize_instagram_identity_username_v1(ia.username)
    into v_client_id, v_canonical_username
  from public.client_instagram_accounts as cia
  join public.ig_accounts as ia on ia.id = cia.account_id
  where cia.account_id = p_account_id
  for update of cia;

  if v_client_id is null then
    raise exception 'client_instagram_account_not_found'
      using errcode = 'P0002';
  end if;

  v_ready_requested :=
    lower(coalesce(nullif(trim(p_login_status), ''), '')) = 'connected'
    or lower(coalesce(nullif(trim(p_provisioning_status), ''), '')) = 'ready'
    or lower(coalesce(nullif(trim(p_onboarding_status), ''), '')) = 'ready';

  if v_ready_requested then
    v_expected_username := public.normalize_instagram_identity_username_v1(v_metadata ->> 'expected_username');
    v_detected_username := public.normalize_instagram_identity_username_v1(v_metadata ->> 'actual_logged_in_username');
    v_profile_opened := coalesce((v_metadata ->> 'profile_opened')::boolean, false);
    v_identity_verified :=
      coalesce((v_metadata ->> 'expected_identity_verified')::boolean, false)
      and lower(coalesce(v_metadata ->> 'identity_verification_status', '')) = 'verified'
      and v_profile_opened
      and v_canonical_username <> ''
      and v_expected_username = v_canonical_username
      and v_detected_username = v_canonical_username;

    if not v_identity_verified then
      raise exception 'login_identity_not_verified'
        using errcode = '23514';
    end if;

    if coalesce(v_metadata ->> 'run_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_source_run_id := (v_metadata ->> 'run_id')::uuid;
    end if;

    update public.client_instagram_accounts
    set login_identity_proof_status = 'verified',
        login_identity_expected_username = v_expected_username,
        login_identity_detected_username = v_detected_username,
        login_identity_profile_opened = true,
        login_identity_username_match = true,
        login_identity_verified_at = now(),
        login_identity_source_run_id = v_source_run_id,
        login_identity_failure_reason = null,
        login_identity_proof_version = 1,
        updated_at = now()
    where account_id = p_account_id;
  elsif v_metadata ? 'identity_verification_status'
        and lower(coalesce(v_metadata ->> 'identity_verification_status', '')) = 'failed'
  then
    update public.client_instagram_accounts
    set login_identity_proof_status = 'failed',
        login_identity_expected_username = nullif(public.normalize_instagram_identity_username_v1(v_metadata ->> 'expected_username'), ''),
        login_identity_detected_username = nullif(public.normalize_instagram_identity_username_v1(v_metadata ->> 'actual_logged_in_username'), ''),
        login_identity_profile_opened = coalesce((v_metadata ->> 'profile_opened')::boolean, false),
        login_identity_username_match = false,
        login_identity_verified_at = null,
        login_identity_failure_reason = coalesce(
          nullif(v_metadata ->> 'identity_verification_failure_reason', ''),
          'login_identity_not_verified'
        ),
        updated_at = now()
    where account_id = p_account_id;
  end if;

  if lower(coalesce(nullif(trim(p_login_status), ''), '')) = 'connected'
     and p_reauth_required is null then
    v_effective_reauth_required := false;
  end if;

  update public.client_instagram_accounts as cia
  set
    login_status = coalesce(nullif(trim(p_login_status), ''), cia.login_status),
    provisioning_status = coalesce(nullif(trim(p_provisioning_status), ''), cia.provisioning_status),
    onboarding_status = coalesce(nullif(trim(p_onboarding_status), ''), cia.onboarding_status),
    updated_at = now()
  where cia.account_id = p_account_id
  returning cia.login_status, cia.provisioning_status, cia.onboarding_status
    into v_login_status, v_provisioning_status, v_onboarding_status;

  if v_effective_reauth_required is not null then
    update public.account_credentials as ac
    set
      reauth_required = v_effective_reauth_required,
      reauth_reason = case
        when v_effective_reauth_required then nullif(trim(coalesce(p_reauth_reason, '')), '')
        else null
      end,
      updated_at = now()
    where ac.account_id = p_account_id
      and ac.provider = 'instagram'
      and ac.status = 'active';
  end if;

  if nullif(trim(coalesce(p_onboarding_status, '')), '') is null
     and lower(coalesce(v_login_status, '')) = 'connected'
     and lower(coalesce(v_provisioning_status, '')) = 'ready'
     and lower(coalesce(v_onboarding_status, '')) not in ('ready', 'blocked', 'support_required')
     and exists (
       select 1
       from public.account_credentials as ac
       where ac.account_id = p_account_id
         and ac.provider = 'instagram'
         and ac.status = 'active'
         and coalesce(ac.reauth_required, false) = false
     )
     and exists (
       select 1
       from public.account_assignments as aa
       join public.phone_app_instances as pai
         on pai.id = aa.app_instance_id
       where aa.account_id = p_account_id
         and aa.released_at is null
         and aa.status in ('reserved', 'active')
         and nullif(trim(coalesce(pai.package_name, '')), '') is not null
     )
  then
    update public.client_instagram_accounts as cia
    set
      onboarding_status = 'ready',
      updated_at = now()
    where cia.account_id = p_account_id
    returning cia.onboarding_status into v_onboarding_status;
  end if;

  if lower(coalesce(v_login_status, '')) = 'connected'
     and lower(coalesce(v_provisioning_status, '')) = 'ready'
     and lower(coalesce(v_onboarding_status, '')) = 'ready' then
    v_runtime_settings_sync := public.sync_instagram_account_runtime_settings_after_provisioning(
      p_account_id := p_account_id,
      p_actor_type := v_actor_type,
      p_reason := coalesce(v_reason, 'login_provisioning_connected'),
      p_metadata := v_metadata
    );
  end if;

  v_sync_result := public.sync_account_dashboard_actions_from_status(
    p_account_id := p_account_id,
    p_actor_type := v_actor_type,
    p_reason := v_reason,
    p_external_request_id := p_external_request_id,
    p_metadata := v_metadata
  );

  return v_sync_result || jsonb_build_object(
    'ok', true,
    'account_id', p_account_id,
    'login_status', v_login_status,
    'provisioning_status', v_provisioning_status,
    'onboarding_status', v_onboarding_status,
    'login_identity_proof_status', case
      when v_ready_requested then 'verified'
      else null
    end,
    'runtime_settings_sync', v_runtime_settings_sync
  );
end;
$$;

drop trigger if exists enforce_client_instagram_ready_identity_v1
  on public.client_instagram_accounts;
create trigger enforce_client_instagram_ready_identity_v1
before insert or update of login_status, provisioning_status, onboarding_status
on public.client_instagram_accounts
for each row
execute function public.enforce_client_instagram_ready_identity_v1();

create or replace function public.evaluate_login_identity_gate_v1(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.client_instagram_accounts%rowtype;
begin
  select * into v_row
  from public.client_instagram_accounts
  where account_id = p_account_id
    and active = true
  limit 1;

  if v_row.id is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'login_not_connected',
      'login_status', 'unknown',
      'provisioning_status', 'unknown'
    );
  end if;

  if v_row.login_identity_proof_status in ('required_unverified', 'failed', 'proven_false_ready') then
    return jsonb_build_object(
      'ok', false,
      'reason', 'login_identity_not_verified',
      'proof_status', v_row.login_identity_proof_status,
      'login_status', v_row.login_status,
      'provisioning_status', v_row.provisioning_status
    );
  end if;

  -- historical_model_missing is a deliberate compatibility state. It is not a
  -- positive proof, but it does not blindly invalidate accounts that pre-date
  -- the model; their next technical login flow can opportunistically verify it.
  if lower(coalesce(v_row.login_status, '')) <> 'connected'
     or lower(coalesce(v_row.provisioning_status, '')) <> 'ready'
  then
    return jsonb_build_object(
      'ok', false,
      'reason', 'login_not_connected',
      'proof_status', v_row.login_identity_proof_status,
      'login_status', v_row.login_status,
      'provisioning_status', v_row.provisioning_status
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', case
      when v_row.login_identity_proof_status = 'verified' then 'login_identity_verified'
      else 'historical_identity_model_missing'
    end,
    'proof_status', v_row.login_identity_proof_status,
    'login_status', v_row.login_status,
    'provisioning_status', v_row.provisioning_status
  );
end;
$$;

create or replace function public.reconcile_proven_false_ready_identity_v1(
  p_account_id uuid,
  p_login_run_id uuid,
  p_evidence jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.client_instagram_accounts%rowtype;
  v_canonical_username text;
  v_expected_username text;
  v_detected_username text;
  v_run_matches boolean := false;
  v_active_request boolean := false;
  v_active_run boolean := false;
  v_active_lock boolean := false;
begin
  if p_account_id is null or p_login_run_id is null then
    raise exception 'account_and_login_run_required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_evidence, '{}'::jsonb)) <> 'object' then
    raise exception 'evidence_must_be_object' using errcode = '22023';
  end if;

  select * into v_account
  from public.client_instagram_accounts
  where account_id = p_account_id
    and active = true
  for update;
  if v_account.id is null then
    raise exception 'client_instagram_account_not_found' using errcode = 'P0002';
  end if;

  select public.normalize_instagram_identity_username_v1(username)
    into v_canonical_username
  from public.ig_accounts
  where id = p_account_id;
  v_expected_username := public.normalize_instagram_identity_username_v1(p_evidence ->> 'expected_username');
  v_detected_username := public.normalize_instagram_identity_username_v1(p_evidence ->> 'actual_logged_in_username');

  select exists (
    select 1
    from public.ig_runs as r
    join public.account_run_requests as rr
      on rr.run_id = r.id
     and rr.account_id = r.account_id
    where r.id = p_login_run_id
      and r.account_id = p_account_id
      and rr.requested_run_type = 'login_provisioning'
      and rr.status in ('completed', 'failed', 'canceled')
      and r.status in ('completed', 'failed', 'stopped', 'canceled')
  ) into v_run_matches;

  select exists (
    select 1 from public.account_run_requests
    where account_id = p_account_id
      and status in ('queued', 'claimed', 'running', 'cancel_requested')
  ) into v_active_request;
  select exists (
    select 1 from public.ig_runs
    where account_id = p_account_id
      and status in ('queued', 'running', 'active', 'claimed')
  ) into v_active_run;
  select exists (
    select 1 from public.auto_restart_device_locks
    where account_id = p_account_id
      and lease_expires_at > now()
  ) into v_active_lock;

  if not v_run_matches
     or v_canonical_username = ''
     or v_expected_username <> v_canonical_username
     or lower(coalesce(v_account.login_status, '')) <> 'connected'
     or lower(coalesce(v_account.provisioning_status, '')) <> 'ready'
     or coalesce((p_evidence ->> 'expected_identity_verified')::boolean, false)
     or coalesce((p_evidence ->> 'profile_opened')::boolean, false)
     or coalesce((p_evidence ->> 'username_match')::boolean, false)
     or (v_detected_username <> '' and v_detected_username = v_canonical_username)
     or v_active_request
     or v_active_run
     or v_active_lock
  then
    return jsonb_build_object(
      'ok', false,
      'eligible', false,
      'dry_run', coalesce(p_dry_run, true),
      'reason', case
        when not v_run_matches then 'login_run_not_proven'
        when v_active_request or v_active_run or v_active_lock then 'runtime_not_idle'
        when lower(coalesce(v_account.login_status, '')) <> 'connected'
          or lower(coalesce(v_account.provisioning_status, '')) <> 'ready' then 'not_false_ready'
        else 'false_ready_evidence_not_proven'
      end
    );
  end if;

  if coalesce(p_dry_run, true) then
    return jsonb_build_object(
      'ok', true,
      'eligible', true,
      'dry_run', true,
      'reason', 'proven_false_ready'
    );
  end if;

  update public.client_instagram_accounts
  set login_status = 'verification_pending',
      provisioning_status = 'login_verification_pending',
      onboarding_status = 'credentials_submitted',
      login_identity_proof_status = 'proven_false_ready',
      login_identity_expected_username = v_canonical_username,
      login_identity_detected_username = nullif(v_detected_username, ''),
      login_identity_profile_opened = false,
      login_identity_username_match = false,
      login_identity_verified_at = null,
      login_identity_source_run_id = p_login_run_id,
      login_identity_failure_reason = coalesce(nullif(p_evidence ->> 'failure_reason', ''), 'login_identity_not_verified'),
      updated_at = now()
  where account_id = p_account_id;

  perform public.sync_account_dashboard_actions_from_status(
    p_account_id := p_account_id,
    p_actor_type := 'internal',
    p_reason := 'proven_false_ready_identity_reconciled',
    p_external_request_id := 'identity-reconcile:' || p_login_run_id::text,
    p_metadata := jsonb_build_object(
      'source', 'reconcile_proven_false_ready_identity_v1',
      'run_id', p_login_run_id,
      'failure_reason', coalesce(nullif(p_evidence ->> 'failure_reason', ''), 'login_identity_not_verified')
    )
  );

  return jsonb_build_object(
    'ok', true,
    'eligible', true,
    'dry_run', false,
    'reason', 'proven_false_ready_reconciled',
    'login_status', 'verification_pending',
    'provisioning_status', 'login_verification_pending',
    'onboarding_status', 'credentials_submitted'
  );
end;
$$;

revoke execute on function
  public.enforce_client_instagram_ready_identity_v1(),
  public.evaluate_login_identity_gate_v1(uuid),
  public.reconcile_proven_false_ready_identity_v1(uuid, uuid, jsonb, boolean),
  public.update_client_instagram_account_status(uuid, text, text, text, boolean, text, text, text, text, jsonb)
from public, anon, authenticated;

grant execute on function
  public.evaluate_login_identity_gate_v1(uuid),
  public.reconcile_proven_false_ready_identity_v1(uuid, uuid, jsonb, boolean),
  public.update_client_instagram_account_status(uuid, text, text, text, boolean, text, text, text, text, jsonb)
to service_role;

commit;
