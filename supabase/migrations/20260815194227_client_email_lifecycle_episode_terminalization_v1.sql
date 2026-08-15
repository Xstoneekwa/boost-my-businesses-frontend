-- Materialize lifecycle close/cancel decisions emitted by the canonical planner.
-- History is retained. Only safely unsubmitted intents are canceled; sent and
-- dispatch_uncertain intents remain untouched for provider reconciliation.

create or replace function public.terminalize_client_email_lifecycle_episode_v1(
  p_account_id uuid,
  p_client_id uuid,
  p_category text,
  p_operation text,
  p_parent_episode_key text,
  p_parent_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_episode public.client_email_lifecycle_episodes%rowtype;
  v_now timestamptz := timezone('utc', now());
  v_target_status text;
  v_close_reason text;
  v_changed boolean := false;
begin
  if p_account_id is null or p_client_id is null or p_parent_id is null then
    return jsonb_build_object('ok', false, 'code', 'missing_account_client_or_parent');
  end if;

  if p_category not in ('account_paused', 'account_canceled', 'needs_assistance') then
    return jsonb_build_object('ok', false, 'code', 'invalid_category');
  end if;

  if p_operation not in ('close_lifecycle_episode', 'cancel_lifecycle_episode') then
    return jsonb_build_object('ok', false, 'code', 'invalid_operation');
  end if;

  if p_parent_episode_key is null or btrim(p_parent_episode_key) = '' then
    return jsonb_build_object('ok', false, 'code', 'missing_parent_episode_key');
  end if;

  perform pg_advisory_xact_lock(
    hashtext('client_email_lifecycle_terminalize'),
    hashtext(p_account_id::text)
  );

  if not exists (
    select 1
    from public.client_instagram_accounts cia
    where cia.account_id = p_account_id
      and cia.client_id = p_client_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'client_email_account_client_ownership_mismatch');
  end if;

  select e.*
    into v_episode
  from public.client_email_lifecycle_episodes e
  where e.id = p_parent_id
    and e.account_id = p_account_id
    and e.client_id = p_client_id
    and e.category = p_category
    and e.episode_key = p_parent_episode_key
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'lifecycle_episode_not_found');
  end if;

  v_target_status := case when p_operation = 'close_lifecycle_episode' then 'resolved' else 'canceled' end;
  v_close_reason := case
    when p_operation = 'cancel_lifecycle_episode' then 'superseded_by_new_episode'
    when p_category = 'account_paused' then 'account_reactivated'
    else 'lifecycle_state_cleared'
  end;

  if v_episode.status = 'active' then
    v_changed := true;

    update public.client_email_lifecycle_episodes e
    set status = v_target_status,
        resolved_at = case when v_target_status = 'resolved' then v_now else null end,
        canceled_at = case when v_target_status = 'canceled' then v_now else null end,
        close_reason = v_close_reason,
        updated_at = v_now
    where e.id = v_episode.id;

    update public.client_email_send_intents i
    set status = 'canceled',
        resolved_at = coalesce(i.resolved_at, v_now),
        claimed_at = null,
        claim_token = null,
        claim_expires_at = null,
        dispatch_last_error_code = 'lifecycle_episode_terminalized',
        last_error_redacted = 'Canceled before provider dispatch because the lifecycle episode became terminal.'
    where i.lifecycle_episode_id = v_episode.id
      and i.status in ('pending', 'scheduled', 'claimed');
  end if;

  select e.* into v_episode
  from public.client_email_lifecycle_episodes e
  where e.id = p_parent_id;

  return jsonb_build_object(
    'ok', true,
    'parent', jsonb_build_object(
      'id', v_episode.id,
      'kind', 'lifecycle_episode',
      'created', false
    ),
    'intent', null,
    'terminal_status', v_episode.status,
    'changed', v_changed,
    'idempotent', not v_changed
  );
end;
$$;

alter function public.terminalize_client_email_lifecycle_episode_v1(uuid, uuid, text, text, text, uuid)
  owner to postgres;

revoke all on function public.terminalize_client_email_lifecycle_episode_v1(uuid, uuid, text, text, text, uuid) from public;
revoke all on function public.terminalize_client_email_lifecycle_episode_v1(uuid, uuid, text, text, text, uuid) from anon;
revoke all on function public.terminalize_client_email_lifecycle_episode_v1(uuid, uuid, text, text, text, uuid) from authenticated;
grant execute on function public.terminalize_client_email_lifecycle_episode_v1(uuid, uuid, text, text, text, uuid) to service_role;

comment on function public.terminalize_client_email_lifecycle_episode_v1(uuid, uuid, text, text, text, uuid) is
  'Idempotently resolves or cancels a canonical client lifecycle email episode while preserving history and ambiguous/sent provider outcomes.';
