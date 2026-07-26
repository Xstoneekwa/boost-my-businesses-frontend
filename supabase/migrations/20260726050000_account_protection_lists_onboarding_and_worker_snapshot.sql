alter table public.client_instagram_onboarding_sessions
  drop constraint if exists client_instagram_onboarding_sessions_current_step_check;

alter table public.client_instagram_onboarding_sessions
  add constraint client_instagram_onboarding_sessions_current_step_check
  check (current_step in ('connection', 'analysis', 'protection_lists', 'targeting', 'targets', 'complete'));

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
       set status = 'active', current_step = 'targeting',
           last_progress_at = now(), expires_at = now() + interval '7 days', updated_at = now()
     where id = p_session_id;
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

comment on function public.advance_client_instagram_onboarding(uuid, uuid, uuid, text, jsonb) is
  'Advances resumable onboarding through canonical protection lists before targeting; completion recounts 15 strict eligible targets in PostgreSQL.';

create or replace function public.get_account_protection_lists_for_run(p_account_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (select 1 from public.ig_accounts a where a.id = p_account_id) then
      jsonb_build_object('ok', false, 'reason', 'account_not_found', 'account_id', p_account_id)
    else jsonb_build_object(
      'ok', true,
      'account_id', p_account_id,
      'source', 'account_protection_list_entries',
      'loaded_at', now(),
      'lists', jsonb_build_object(
        'interaction_blacklist', coalesce((
          select jsonb_agg(e.normalized_username order by e.normalized_username)
            from public.account_protection_list_entries e
           where e.account_id = p_account_id
             and e.list_kind = 'interaction_blacklist'
             and e.active
        ), '[]'::jsonb),
        'unfollow_whitelist', coalesce((
          select jsonb_agg(e.normalized_username order by e.normalized_username)
            from public.account_protection_list_entries e
           where e.account_id = p_account_id
             and e.list_kind = 'unfollow_whitelist'
             and e.active
        ), '[]'::jsonb)
      ),
      'versions', jsonb_build_object(
        'interaction_blacklist', coalesce((
          select v.version from public.account_protection_list_versions v
           where v.account_id = p_account_id and v.list_kind = 'interaction_blacklist'
        ), 0),
        'unfollow_whitelist', coalesce((
          select v.version from public.account_protection_list_versions v
           where v.account_id = p_account_id and v.list_kind = 'unfollow_whitelist'
        ), 0)
      )
    )
  end;
$$;

revoke all on function public.get_account_protection_lists_for_run(uuid)
  from public, anon, authenticated;
grant execute on function public.get_account_protection_lists_for_run(uuid)
  to service_role;

comment on function public.get_account_protection_lists_for_run(uuid) is
  'Returns one immutable, account-scoped protection-list snapshot for one worker run or attempt. Service role only.';
