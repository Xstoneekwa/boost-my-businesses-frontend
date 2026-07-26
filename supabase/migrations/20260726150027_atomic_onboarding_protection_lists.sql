alter table public.client_instagram_onboarding_sessions
  add column if not exists protection_lists_skipped_at timestamptz null;

create or replace function public.save_client_instagram_onboarding_protection_lists(
  p_session_id uuid,
  p_client_id uuid,
  p_actor_id uuid,
  p_mode text,
  p_unfollow_items text[],
  p_blacklist_items text[],
  p_unfollow_expected_version bigint,
  p_blacklist_expected_version bigint,
  p_request_id text,
  p_idempotency_key text,
  p_unfollow_fingerprint text,
  p_blacklist_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.client_instagram_onboarding_sessions%rowtype;
  v_unfollow jsonb := '{}'::jsonb;
  v_blacklist jsonb := '{}'::jsonb;
  v_failure jsonb := '{}'::jsonb;
begin
  if p_mode not in ('save', 'skip') then
    return jsonb_build_object('ok', false, 'error', 'protection_lists_mode_invalid');
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    return jsonb_build_object('ok', false, 'error', 'invalid_idempotency_key');
  end if;
  if not exists (
    select 1
      from public.client_users cu
      join public.clients c on c.id = cu.client_id and c.status = 'active'
     where cu.client_id = p_client_id
       and cu.auth_user_id = p_actor_id
       and cu.status = 'active'
       and cu.role in ('owner', 'admin', 'assistant')
  ) then
    return jsonb_build_object('ok', false, 'error', 'client_access_denied');
  end if;

  select * into v_session
    from public.client_instagram_onboarding_sessions
   where id = p_session_id and client_id = p_client_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'onboarding_not_found');
  end if;
  if v_session.status in ('active', 'creating', 'failed_retryable')
     and v_session.expires_at <= now() then
    update public.client_instagram_onboarding_sessions
       set status = 'expired', lease_owner = null, lease_expires_at = null, updated_at = now()
     where id = p_session_id;
    return jsonb_build_object('ok', false, 'error', 'onboarding_expired');
  end if;
  if v_session.status in ('expired', 'abandoned', 'completed') then
    return jsonb_build_object('ok', false, 'error', 'onboarding_terminal');
  end if;
  if v_session.account_id is null then
    return jsonb_build_object('ok', false, 'error', 'account_not_created');
  end if;
  if v_session.current_step not in ('protection_lists', 'targeting') then
    return jsonb_build_object('ok', false, 'error', 'protection_lists_step_invalid');
  end if;

  begin
    if p_mode = 'save' then
      v_unfollow := public.mutate_account_protection_list(
        v_session.account_id, 'unfollow_whitelist', 'replace',
        coalesce(p_unfollow_items, '{}'::text[]), '{}'::text[], '{}'::text[],
        'client_onboarding', p_actor_id, p_request_id, p_idempotency_key,
        p_unfollow_expected_version, p_unfollow_fingerprint
      );
      if v_unfollow->>'ok' <> 'true' then
        v_failure := v_unfollow || jsonb_build_object('failed_list_kind', 'unfollow_whitelist');
        raise exception using errcode = 'P0001', message = 'rollback_protection_lists';
      end if;

      v_blacklist := public.mutate_account_protection_list(
        v_session.account_id, 'interaction_blacklist', 'replace',
        coalesce(p_blacklist_items, '{}'::text[]), '{}'::text[], '{}'::text[],
        'client_onboarding', p_actor_id, p_request_id, p_idempotency_key,
        p_blacklist_expected_version, p_blacklist_fingerprint
      );
      if v_blacklist->>'ok' <> 'true' then
        v_failure := v_blacklist || jsonb_build_object('failed_list_kind', 'interaction_blacklist');
        raise exception using errcode = 'P0001', message = 'rollback_protection_lists';
      end if;

      update public.client_instagram_onboarding_sessions
         set status = 'active', current_step = 'targeting', protection_lists_skipped_at = null,
             last_progress_at = now(), expires_at = now() + interval '7 days', updated_at = now()
       where id = p_session_id;
    else
      update public.client_instagram_onboarding_sessions
         set status = 'active', current_step = 'targeting',
             protection_lists_skipped_at = coalesce(protection_lists_skipped_at, now()),
             last_progress_at = now(), expires_at = now() + interval '7 days', updated_at = now()
       where id = p_session_id;
    end if;
  exception
    when sqlstate 'P0001' then
      return v_failure || jsonb_build_object('ok', false, 'rolled_back', true);
    when others then
      return jsonb_build_object('ok', false, 'error', 'protection_lists_transaction_failed', 'rolled_back', true);
  end;

  return jsonb_build_object(
    'ok', true,
    'status', 'active',
    'current_step', 'targeting',
    'mode', p_mode,
    'unfollow_whitelist', case when p_mode = 'save' then v_unfollow else null end,
    'interaction_blacklist', case when p_mode = 'save' then v_blacklist else null end
  );
end;
$$;

revoke all on function public.save_client_instagram_onboarding_protection_lists(
  uuid, uuid, uuid, text, text[], text[], bigint, bigint, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.save_client_instagram_onboarding_protection_lists(
  uuid, uuid, uuid, text, text[], text[], bigint, bigint, text, text, text, text
) to service_role;

comment on function public.save_client_instagram_onboarding_protection_lists(
  uuid, uuid, uuid, text, text[], text[], bigint, bigint, text, text, text, text
) is 'Atomically saves both canonical account protection lists and advances onboarding, or records an explicit skip without list writes.';

create or replace function public.advance_client_instagram_onboarding(
  p_session_id uuid,
  p_client_id uuid,
  p_actor_id uuid,
  p_action text,
  p_value jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.client_instagram_onboarding_sessions%rowtype;
  v_eligible_count integer := 0;
begin
  if not exists (
    select 1 from public.client_users cu
     where cu.client_id = p_client_id
       and cu.auth_user_id = p_actor_id
       and cu.status = 'active'
       and cu.role in ('owner', 'admin', 'assistant')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'client_access_denied');
  end if;

  select * into v_session
    from public.client_instagram_onboarding_sessions
   where id = p_session_id and client_id = p_client_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'onboarding_not_found');
  end if;

  if v_session.status in ('active', 'creating', 'failed_retryable')
     and v_session.expires_at <= now() then
    update public.client_instagram_onboarding_sessions
       set status = 'expired', lease_owner = null, lease_expires_at = null, updated_at = now()
     where id = p_session_id;
    return jsonb_build_object('ok', false, 'reason', 'onboarding_expired', 'status', 'expired');
  end if;
  if v_session.status = 'completed' then
    return jsonb_build_object('ok', true, 'already_completed', true, 'status', 'completed');
  end if;
  if v_session.status in ('expired', 'abandoned') then
    return jsonb_build_object('ok', false, 'reason', 'onboarding_terminal', 'status', v_session.status);
  end if;
  if v_session.status = 'creating'
     and v_session.lease_expires_at is not null
     and v_session.lease_expires_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'creation_lease_active', 'status', 'creating');
  end if;
  if v_session.account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'account_not_created');
  end if;

  if p_action = 'abandon' then
    update public.client_instagram_onboarding_sessions
       set status = 'abandoned', abandoned_at = now(), lease_owner = null,
           lease_expires_at = null, updated_at = now()
     where id = p_session_id;
    return jsonb_build_object('ok', true, 'status', 'abandoned');
  elsif p_action = 'save_analysis' then
    if nullif(trim(coalesce(p_value->>'username', '')), '') is null then
      return jsonb_build_object('ok', false, 'reason', 'public_analysis_required');
    end if;
    update public.client_instagram_onboarding_sessions
       set status = 'active', current_step = 'protection_lists', public_analysis = p_value,
           last_progress_at = now(), expires_at = now() + interval '7 days', updated_at = now()
     where id = p_session_id;
  elsif p_action = 'save_protection_lists' then
    if v_session.current_step not in ('protection_lists', 'targeting') then
      return jsonb_build_object('ok', false, 'reason', 'protection_lists_step_invalid');
    end if;
    if coalesce(p_value->>'mode', 'save') = 'skip' then
      update public.client_instagram_onboarding_sessions
         set status = 'active', current_step = 'targeting',
             protection_lists_skipped_at = coalesce(protection_lists_skipped_at, now()),
             last_progress_at = now(), expires_at = now() + interval '7 days', updated_at = now()
       where id = p_session_id;
    else
      if not exists (
        select 1 from public.account_protection_list_versions v
         where v.account_id = v_session.account_id
           and v.list_kind = 'unfollow_whitelist'
      ) or not exists (
        select 1 from public.account_protection_list_versions v
         where v.account_id = v_session.account_id
           and v.list_kind = 'interaction_blacklist'
      ) then
        return jsonb_build_object('ok', false, 'reason', 'protection_lists_not_saved');
      end if;
      update public.client_instagram_onboarding_sessions
         set status = 'active', current_step = 'targeting', protection_lists_skipped_at = null,
             last_progress_at = now(), expires_at = now() + interval '7 days', updated_at = now()
       where id = p_session_id;
    end if;
  elsif p_action = 'save_targeting' then
    if jsonb_typeof(p_value) <> 'object' or p_value = '{}'::jsonb then
      return jsonb_build_object('ok', false, 'reason', 'targeting_criteria_required');
    end if;
    update public.client_instagram_onboarding_sessions
       set status = 'active', current_step = 'targets', targeting_criteria = p_value,
           last_progress_at = now(), expires_at = now() + interval '7 days', updated_at = now()
     where id = p_session_id;
  elsif p_action = 'open_targets' then
    update public.client_instagram_onboarding_sessions
       set status = 'active', current_step = 'targets',
           last_progress_at = now(), expires_at = now() + interval '7 days', updated_at = now()
     where id = p_session_id;
  elsif p_action = 'complete' then
    if nullif(trim(coalesce(v_session.public_analysis->>'username', '')), '') is null then
      return jsonb_build_object('ok', false, 'reason', 'public_analysis_required');
    end if;
    if jsonb_typeof(v_session.targeting_criteria) <> 'object'
       or v_session.targeting_criteria = '{}'::jsonb then
      return jsonb_build_object('ok', false, 'reason', 'targeting_criteria_required');
    end if;
    if v_session.protection_lists_skipped_at is null and (
      not exists (
        select 1 from public.account_protection_list_versions v
         where v.account_id = v_session.account_id
           and v.list_kind = 'unfollow_whitelist'
      ) or not exists (
        select 1 from public.account_protection_list_versions v
         where v.account_id = v_session.account_id
           and v.list_kind = 'interaction_blacklist'
      )
    ) then
      return jsonb_build_object('ok', false, 'reason', 'protection_lists_not_saved');
    end if;

    select count(*)::integer into v_eligible_count
      from public.ig_targets t
     where t.account_id = v_session.account_id
       and lower(trim(coalesce(t.status, ''))) in ('valid', 'active')
       and lower(trim(coalesce(t.quality_status, ''))) = 'eligible'
       and lower(trim(coalesce(t.verification_status, ''))) = 'found'
       and t.archived_at is null
       and t.deleted_at is null;
    if v_eligible_count < 15 then
      return jsonb_build_object(
        'ok', false, 'reason', 'target_minimum_not_met',
        'eligible_count', v_eligible_count, 'required_count', 15
      );
    end if;

    update public.client_instagram_onboarding_sessions
       set status = 'completed', current_step = 'complete', completed_at = now(),
           lease_owner = null, lease_expires_at = null,
           last_progress_at = now(), updated_at = now()
     where id = p_session_id;
    update public.client_instagram_accounts
       set onboarding_status = 'configured', provisioning_status = 'not_started', updated_at = now()
     where client_id = p_client_id and account_id = v_session.account_id;
    insert into public.commercial_checkout_audit_events (
      entitlement_id, event_type, client_id, payload
    ) values (
      v_session.entitlement_id,
      'client_instagram_onboarding_completed',
      p_client_id,
      jsonb_build_object(
        'onboarding_session_id', p_session_id,
        'account_id', v_session.account_id,
        'actor_id', p_actor_id,
        'eligible_target_count', v_eligible_count,
        'required_target_count', 15,
        'protection_lists_source', 'account_protection_list_entries',
        'protection_lists_skipped', v_session.protection_lists_skipped_at is not null,
        'runtime_activation_requested', false
      )
    );
    return jsonb_build_object('ok', true, 'status', 'completed', 'eligible_count', v_eligible_count);
  else
    return jsonb_build_object('ok', false, 'reason', 'onboarding_action_invalid');
  end if;

  return jsonb_build_object('ok', true, 'status', 'active');
end;
$$;

revoke all on function public.advance_client_instagram_onboarding(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.advance_client_instagram_onboarding(uuid, uuid, uuid, text, jsonb)
  to service_role;
