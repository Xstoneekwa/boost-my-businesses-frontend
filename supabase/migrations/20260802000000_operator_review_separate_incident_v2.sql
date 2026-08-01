-- Keep operator review acknowledgement separate from canonical incident resolution.
-- The previous RPC transitioned the action to resolved. Its BEFORE trigger then
-- resolved the linked incident, whose AFTER trigger attempted to update the same
-- action tuple and raised SQLSTATE 27000.

create or replace function public.review_operator_dashboard_action(
  p_action_id uuid,
  p_account_id uuid,
  p_actor_id uuid,
  p_source text default 'admin_dashboard'::text,
  p_note text default null::text,
  p_metadata jsonb default '{}'::jsonb
) returns public.account_dashboard_actions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_action public.account_dashboard_actions;
  v_transitioned public.account_dashboard_actions;
  v_source text := lower(coalesce(nullif(trim(p_source), ''), 'admin_dashboard'));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_reviewed_at timestamptz := now();
begin
  if p_action_id is null or p_account_id is null or p_actor_id is null then
    raise exception 'operator_review_identity_required' using errcode = '22023';
  end if;

  if v_source not in ('admin_dashboard', 'botapp_relay') then
    raise exception 'operator_review_source_invalid' using errcode = '22023';
  end if;

  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'operator_review_note_too_long' using errcode = '22023';
  end if;

  if jsonb_typeof(v_metadata) is distinct from 'object' then
    raise exception 'operator_review_metadata_invalid' using errcode = '22023';
  end if;

  select ada.* into v_action
  from public.account_dashboard_actions as ada
  where ada.id = p_action_id and ada.account_id = p_account_id
  for update;

  if v_action.id is null then
    raise exception 'dashboard_action_not_found' using errcode = 'P0002';
  end if;
  if v_action.action_type <> 'operator_review_required' then
    raise exception 'dashboard_action_not_operator_review' using errcode = '22023';
  end if;
  if v_action.status not in ('pending', 'acknowledged', 'pending_verification', 'code_submitted') then
    raise exception 'dashboard_action_not_reviewable' using errcode = '22023';
  end if;

  select transitioned.* into v_transitioned
  from public.transition_account_dashboard_action(
    p_action_id,
    'acknowledged',
    'admin',
    p_actor_id,
    'operator_marked_reviewed',
    v_metadata || jsonb_strip_nulls(jsonb_build_object(
      'review_status', 'reviewed',
      'reviewed_by', p_actor_id::text,
      'reviewed_at', v_reviewed_at,
      'review_source', v_source,
      'review_note', v_note,
      'operator_review_completed', true,
      'incident_resolution_separate', true,
      'keep_action_active_until_readiness_ok', false
    ))
  ) as transitioned;

  update public.account_dashboard_actions as ada
  set blocking_campaign = false,
      requires_client_action = false,
      updated_at = v_reviewed_at
  where ada.id = p_action_id
  returning ada.* into v_transitioned;

  insert into public.ig_action_logs (
    account_id, run_id, target_username, action_type, status, message, payload, created_at
  ) values (
    p_account_id, null, null, 'dashboard_action_reviewed', 'success',
    'operator_review_action_acknowledged',
    jsonb_build_object(
      'actor_type', 'admin',
      'actor_id', p_actor_id,
      'source', v_source,
      'dashboard_action_id', p_action_id,
      'dashboard_action_type', 'operator_review_required',
      'review_status', 'reviewed',
      'reviewed_at', v_reviewed_at,
      'incident_resolution_separate', true,
      'note_present', v_note is not null
    ),
    v_reviewed_at
  );

  return v_transitioned;
end;
$function$;

comment on function public.review_operator_dashboard_action(uuid, uuid, uuid, text, text, jsonb)
is 'Atomically acknowledges one operator_review_required action and records its audit. The linked incident must be resolved separately.';

revoke all on function public.review_operator_dashboard_action(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.review_operator_dashboard_action(uuid, uuid, uuid, text, text, jsonb) to service_role;
