-- Allow a code submitted from the client verification modal to resume any
-- canonical post-submit login challenge, while keeping arbitrary dashboard
-- actions fail-closed.

create or replace function public.submit_account_verification_code(
  p_action_id uuid,
  p_account_id uuid,
  p_verification_code text,
  p_actor_type text default 'client'::text,
  p_actor_id text default null::text,
  p_metadata jsonb default '{}'::jsonb,
  p_ttl_minutes integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_type text := lower(coalesce(nullif(trim(p_actor_type), ''), 'client'));
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_code text := btrim(coalesce(p_verification_code, ''));
  v_action public.account_dashboard_actions%rowtype;
  v_submission public.account_verification_code_submissions%rowtype;
  v_secret_id uuid;
  v_secret_ref text;
  v_expires_at timestamptz;
  v_now timestamptz := now();
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;

  if p_action_id is null or p_account_id is null then
    raise exception 'action_id_and_account_id_required';
  end if;

  if v_code = '' or char_length(v_code) > 32 or v_code !~ '^[A-Za-z0-9-]{4,32}$' then
    raise exception 'verification_code_invalid';
  end if;

  if jsonb_typeof(v_metadata) is distinct from 'object'
     or public.jsonb_has_forbidden_safe_metadata_key(v_metadata) then
    raise exception 'metadata_forbidden';
  end if;

  select ada.*
    into v_action
  from public.account_dashboard_actions as ada
  where ada.id = p_action_id
    and ada.account_id = p_account_id
  for update;

  if v_action.id is null then
    raise exception 'dashboard_action_not_found';
  end if;

  if not (
    v_action.action_type = 'enter_email_verification_code'
    or (
      v_action.action_type in ('complete_two_factor', 'resolve_checkpoint', 'review_login_challenge')
      and coalesce(v_action.metadata ->> 'source', '') = 'login_dashboard_action_publisher'
      and coalesce(v_action.metadata ->> 'stage', '') = 'post_submit'
      and coalesce(v_action.metadata ->> 'human_review_required', 'false') = 'true'
    )
  ) then
    raise exception 'dashboard_action_type_invalid';
  end if;

  if v_action.status not in ('pending', 'acknowledged', 'pending_verification', 'code_submitted') then
    raise exception 'dashboard_action_not_active';
  end if;

  v_expires_at := v_now + make_interval(mins => greatest(5, least(coalesce(p_ttl_minutes, 15), 60)));

  v_secret_id := public.create_ephemeral_verification_code_vault_secret(
    p_account_id,
    p_action_id,
    v_code
  );
  v_secret_ref := format('supabase_vault://%s', v_secret_id::text);

  select avcs.*
    into v_submission
  from public.account_verification_code_submissions as avcs
  where avcs.action_id = p_action_id
  order by avcs.created_at desc
  limit 1
  for update;

  if v_submission.id is null or v_submission.status in ('consumed', 'expired', 'failed') then
    insert into public.account_verification_code_submissions (
      action_id,
      account_id,
      status,
      secret_ref,
      expires_at,
      metadata_safe
    )
    values (
      p_action_id,
      p_account_id,
      'code_submitted',
      v_secret_ref,
      v_expires_at,
      v_metadata || jsonb_build_object(
        'source', 'submit_account_verification_code',
        'actor_type', v_actor_type,
        'actor_id', nullif(trim(coalesce(p_actor_id, '')), '')
      )
    )
    returning * into v_submission;
  else
    if v_submission.secret_ref is not null then
      perform public.neutralize_ephemeral_verification_code_vault_secret(v_submission.secret_ref);
    end if;

    update public.account_verification_code_submissions as avcs
    set
      updated_at = v_now,
      status = 'code_submitted',
      secret_ref = v_secret_ref,
      expires_at = v_expires_at,
      consumed_at = null,
      consumed_run_id = null,
      attempts_count = avcs.attempts_count + 1,
      metadata_safe = coalesce(avcs.metadata_safe, '{}'::jsonb) || v_metadata
    where avcs.id = v_submission.id
    returning * into v_submission;
  end if;

  update public.account_dashboard_actions as ada
  set
    updated_at = v_now,
    action_type = 'enter_email_verification_code',
    status = 'code_submitted',
    metadata = coalesce(ada.metadata, '{}'::jsonb) || jsonb_strip_nulls(
      jsonb_build_object(
        'verification_source_action_type', v_action.action_type,
        'verification_code_submitted_at', v_now,
        'verification_code_expires_at', v_expires_at,
        'verification_submission_id', v_submission.id::text
      )
    )
  where ada.id = p_action_id;

  return jsonb_build_object(
    'ok', true,
    'action_id', p_action_id,
    'account_id', p_account_id,
    'status', 'code_submitted',
    'submission_id', v_submission.id,
    'expires_at', v_expires_at,
    'message', 'Verification code stored securely and ready for worker resume.'
  );
end;
$function$;

revoke all on function public.submit_account_verification_code(uuid, uuid, text, text, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.submit_account_verification_code(uuid, uuid, text, text, text, jsonb, integer)
  to service_role;
