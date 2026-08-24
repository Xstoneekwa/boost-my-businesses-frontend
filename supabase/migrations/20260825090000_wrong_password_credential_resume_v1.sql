-- Wrong-password credential resume V1.
--
-- A proved credential rejection creates a blocking update_instagram_password
-- action.  A later credential rotation is not success by itself: the action is
-- resolved only after the newly active credential has been accepted and the
-- exact assigned Instagram identity has been verified.  This reconciliation
-- intentionally does not depend on the initial-target onboarding gate and
-- does not mutate commercial, package, schedule, target, or runtime state.

begin;

create function public.reconcile_instagram_password_remediation_v1(
  p_account_id uuid,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.client_instagram_accounts%rowtype;
  v_source text := lower(btrim(coalesce(p_source, '')));
  v_now timestamptz := now();
  v_actions_resolved integer := 0;
begin
  if p_account_id is null then
    raise exception 'account_id_required' using errcode = '22023';
  end if;
  if v_source not in ('identity_success', 'credential_confirmed', 'manual_reconcile') then
    raise exception 'password_remediation_source_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'instagram_password_remediation:' || p_account_id::text,
    0
  ));

  select * into v_client
  from public.client_instagram_accounts
  where account_id = p_account_id
    and active is true
  for update;

  if not found
     or lower(coalesce(v_client.login_status, '')) <> 'connected'
     or lower(coalesce(v_client.provisioning_status, '')) <> 'ready'
     or lower(coalesce(v_client.onboarding_status, '')) <> 'ready'
     or lower(coalesce(v_client.login_identity_proof_status, '')) <> 'verified'
     or coalesce(v_client.login_identity_profile_opened, false) is not true
     or coalesce(v_client.login_identity_username_match, false) is not true
     or v_client.login_identity_verified_at is null
     or nullif(btrim(coalesce(v_client.login_state_invalidation_reason, '')), '') is not null then
    return jsonb_build_object('ok', false, 'reason', 'exact_login_identity_not_ready');
  end if;

  if not exists (
    select 1
    from public.account_credentials c
    where c.account_id = p_account_id
      and c.provider = 'instagram'
      and c.status = 'active'
      and coalesce(c.reauth_required, false) is false
      and nullif(btrim(coalesce(c.secret_ref, '')), '') is not null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'accepted_active_credential_required');
  end if;

  update public.account_dashboard_actions a
  set status = 'resolved',
      blocking_campaign = false,
      requires_client_action = false,
      resolved_at = coalesce(a.resolved_at, v_now),
      updated_at = v_now,
      metadata_safe = coalesce(a.metadata_safe, '{}'::jsonb) || jsonb_build_object(
        'superseded_by_accepted_credential_identity_success', true,
        'identity_verified_at', v_client.login_identity_verified_at,
        'reconciliation_source', v_source
      )
  where a.account_id = p_account_id
    and a.action_type = 'update_instagram_password'
    and a.created_at <= v_client.login_identity_verified_at
    and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted');
  get diagnostics v_actions_resolved = row_count;

  return jsonb_build_object(
    'ok', true,
    'reason', case when v_actions_resolved > 0
      then 'password_remediation_resolved'
      else 'already_converged'
    end,
    'account_id', p_account_id,
    'actions_resolved', v_actions_resolved,
    'identity_verified_at', v_client.login_identity_verified_at,
    'runtime_started', false,
    'commercial_state_changed', false,
    'schedule_changed', false,
    'target_changed', false
  );
end;
$$;

revoke all on function public.reconcile_instagram_password_remediation_v1(uuid,text)
  from public, anon, authenticated;
grant execute on function public.reconcile_instagram_password_remediation_v1(uuid,text)
  to service_role;

comment on function public.reconcile_instagram_password_remediation_v1(uuid,text) is
  'Resolves active update_instagram_password actions only after an accepted active credential and exact assigned-account identity success; never mutates growth, commercial, schedule, target, or runtime state.';

create function public.trigger_instagram_password_remediation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_source text;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_table_name = 'client_instagram_accounts' then
    v_account_id := new.account_id;
    v_source := 'identity_success';
  elsif tg_table_name = 'account_credentials' then
    if new.provider <> 'instagram'
       or new.status <> 'active'
       or coalesce(new.reauth_required, false) is true
       or nullif(btrim(coalesce(new.secret_ref, '')), '') is null then
      return new;
    end if;
    v_account_id := new.account_id;
    v_source := 'credential_confirmed';
  else
    return new;
  end if;

  perform public.reconcile_instagram_password_remediation_v1(v_account_id, v_source);
  return new;
end;
$$;

revoke all on function public.trigger_instagram_password_remediation_v1()
  from public, anon, authenticated;

create trigger client_instagram_password_remediation_v1
after insert or update of login_status, provisioning_status, onboarding_status,
  login_identity_proof_status, login_identity_verified_at,
  login_identity_profile_opened, login_identity_username_match,
  login_state_invalidation_reason
on public.client_instagram_accounts
for each row
when (
  new.active is true
  and new.login_status = 'connected'
  and new.provisioning_status = 'ready'
  and new.onboarding_status = 'ready'
  and new.login_identity_proof_status = 'verified'
  and new.login_identity_profile_opened is true
  and new.login_identity_username_match is true
  and new.login_identity_verified_at is not null
  and nullif(btrim(coalesce(new.login_state_invalidation_reason, '')), '') is null
)
execute function public.trigger_instagram_password_remediation_v1();

create trigger accepted_instagram_credential_password_remediation_v1
after insert or update of status, reauth_required, secret_ref
on public.account_credentials
for each row
when (
  new.provider = 'instagram'
  and new.status = 'active'
  and new.reauth_required is false
  and new.secret_ref is not null
)
execute function public.trigger_instagram_password_remediation_v1();

commit;
