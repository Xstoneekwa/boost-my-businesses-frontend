-- One forward-only composition. Historical SQL is source lineage, never replayed.
-- Live predecessor: e7133eccab42da4087608031940e2ea7aa1dd82d452000ddda2e0513b15d5cdf (PROSRC only).
-- Keeps current rate-limit specialization and restores existing equivalent generations.
begin;
do $predecessor$
declare p pg_catalog.pg_proc%rowtype;
begin
  select * into p from pg_catalog.pg_proc where oid = to_regprocedure('public.transition_account_incident_human_review_v3(uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid)');
  if p.oid is null or encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') <> 'e7133eccab42da4087608031940e2ea7aa1dd82d452000ddda2e0513b15d5cdf' then
    raise exception 'incident_generation_predecessor_prosrc_mismatch' using errcode='55000';
  end if;
  if pg_get_userbyid(p.proowner) <> 'postgres' or not p.prosecdef
    or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}'
    or p.proconfig is distinct from array['search_path=public, pg_temp']::text[] then
    raise exception 'incident_generation_predecessor_permissions_mismatch' using errcode='42501';
  end if;
end
$predecessor$;
create or replace function public.transition_account_incident_human_review_v3(
  p_incident_id uuid,
  p_action text,
  p_expected_version bigint,
  p_actor_type text,
  p_actor_id uuid,
  p_source text,
  p_note text,
  p_resolution_reason text,
  p_idempotency_key text,
  p_expected_worker_sha text,
  p_cause_fixed_version text,
  p_channel text default null,
  p_notification_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anchor public.account_incidents%rowtype;
  v_transition jsonb;
  v_eligibility jsonb;
  v_preflight jsonb;
  v_authorization_id uuid;
  v_next_tick_eligible boolean := false;
  v_blocked_reason text;
  v_restore jsonb;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_normalized_reason text;
  v_sibling record;
  v_event_id uuid;
  v_now timestamptz := now();
  v_superseded_count integer := 0;
  v_remaining_blockers integer := 0;
begin
  select i.* into v_anchor
  from public.account_incidents i
  where i.id = p_incident_id
    and i.archived_at is null
  for update;

  if v_anchor.id is null then
    raise exception 'incident_not_found' using errcode = 'P0002';
  end if;

  if lower(trim(coalesce(p_action,'')))='resolve'
     and coalesce(v_anchor.metadata->>'incident_only_blocker_v2','false')='true'
     and coalesce(v_anchor.reason,v_anchor.failure_reason)='instagram_action_rate_limit' then
    v_transition := public.transition_account_incident_human_review_v1(
      p_incident_id,p_action,p_expected_version,p_actor_type,p_actor_id,p_source,p_note,
      p_resolution_reason,p_idempotency_key,p_channel,p_notification_id
    );
    v_eligibility := public.instagram_action_rate_limit_next_tick_eligibility_v2(v_anchor.account_id,p_incident_id);
    return v_transition || jsonb_build_object(
      'incident_resolved',true,'dashboard_action_resolved',true,
      'resume_authorization_created',false,'next_tick_eligible',coalesce((v_eligibility->>'next_tick_eligible')::boolean,false),
      'blocked_reason',v_eligibility->>'blocked_reason','special_resume_path_created',false
    );
  end if;

  v_transition := public.transition_account_incident_human_review_v2(
    p_incident_id,
    p_action,
    p_expected_version,
    p_actor_type,
    p_actor_id,
    p_source,
    p_note,
    p_resolution_reason,
    p_idempotency_key,
    p_expected_worker_sha,
    p_cause_fixed_version,
    p_channel,
    p_notification_id
  );

  if v_action <> 'resolve' then
    return v_transition || jsonb_build_object(
      'contract_version', 'incident_resolution_generation_auto_restart_v1',
      'equivalent_incidents_resolved', 0
    );
  end if;

  select i.* into v_anchor
  from public.account_incidents i
  where i.id = p_incident_id
  for update;

  v_normalized_reason := lower(btrim(coalesce(
    nullif(v_anchor.reason, ''),
    nullif(v_anchor.failure_reason, ''),
    ''
  )));

  if v_anchor.status = 'resolved'
     and v_anchor.resolved_at is not null
     and v_normalized_reason <> ''
     and left(lower(coalesce(v_anchor.incident_type, '')), 9) <> 'security_'
     and lower(coalesce(v_anchor.metadata ->> 'security_incident', 'false'))
         not in ('true', '1', 'yes') then
    for v_sibling in
      select i.*
      from public.account_incidents i
      where i.account_id = v_anchor.account_id
        and i.id <> v_anchor.id
        and i.incident_type = v_anchor.incident_type
        and lower(btrim(coalesce(
          nullif(i.reason, ''),
          nullif(i.failure_reason, ''),
          ''
        ))) = v_normalized_reason
        and i.status in ('open', 'acknowledged', 'investigating')
        and i.resolved_at is null
        and i.archived_at is null
        and left(lower(coalesce(i.incident_type, '')), 9) <> 'security_'
        and lower(coalesce(i.metadata ->> 'security_incident', 'false'))
            not in ('true', '1', 'yes')
      order by i.created_at, i.id
      for update
    loop
      v_event_id := gen_random_uuid();

      update public.account_incidents
      set status = 'resolved',
          resolved_at = v_now,
          resolved_by = p_actor_id,
          resolution_reason = coalesce(
            nullif(btrim(coalesce(p_resolution_reason, '')), ''),
            'equivalent_incident_generation_resolved'
          ),
          resolution_note = nullif(btrim(coalesce(p_note, '')), ''),
          lifecycle_version = lifecycle_version + 1,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'manual_resolution_v2', jsonb_build_object(
              'resolved_by', p_actor_id,
              'resolved_at', v_now,
              'cause_fixed_version', p_cause_fixed_version,
              'expected_worker_sha', lower(btrim(p_expected_worker_sha)),
              'restart_allowed_restored', true
            ),
            'incident_generation_resolution_v1', jsonb_build_object(
              'canonical_incident_id', v_anchor.id,
              'equivalence', 'account_incident_type_normalized_reason',
              'resolved_at', v_now
            )
          ),
          updated_at = v_now
      where id = v_sibling.id;

      update public.account_dashboard_actions
      set status = 'resolved',
          blocking_campaign = false,
          requires_client_action = false,
          resolved_at = coalesce(resolved_at, v_now),
          updated_at = v_now,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'last_transition', 'resolved',
            'transition_at', v_now,
            'actor_type', lower(coalesce(nullif(btrim(p_actor_type), ''), 'ops')),
            'source', lower(coalesce(nullif(btrim(p_source), ''), 'botapp_relay')),
            'reason', coalesce(
              nullif(btrim(coalesce(p_resolution_reason, '')), ''),
              'equivalent_incident_generation_resolved'
            ),
            'human_review_event_id', v_event_id::text,
            'canonical_incident_id', v_anchor.id::text
          )
      where incident_id = v_sibling.id
        and status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted');

      update public.account_session_resume_plans p
      set restart_allowed = true,
          last_updated_at = v_now
      where p.account_id = v_anchor.account_id
        and p.run_id = v_sibling.run_id
        and p.resume_state = 'awaiting_human_resume_authorization';

      insert into public.account_incident_review_events (
        id,
        incident_id,
        event_type,
        previous_status,
        new_status,
        resolution_reason,
        note,
        actor_type,
        actor_id,
        source,
        idempotency_key,
        incident_version,
        metadata_safe,
        created_at
      ) values (
        v_event_id,
        v_sibling.id,
        'resolved',
        v_sibling.status,
        'resolved',
        coalesce(
          nullif(btrim(coalesce(p_resolution_reason, '')), ''),
          'equivalent_incident_generation_resolved'
        ),
        nullif(btrim(coalesce(p_note, '')), ''),
        lower(coalesce(nullif(btrim(p_actor_type), ''), 'ops')),
        p_actor_id,
        lower(coalesce(nullif(btrim(p_source), ''), 'botapp_relay')),
        left('generation:' || v_anchor.id::text, 180),
        v_sibling.lifecycle_version + 1,
        jsonb_build_object(
          'canonical_incident_id', v_anchor.id,
          'equivalence', 'account_incident_type_normalized_reason',
          'notification_bundled_with_canonical_incident', true
        ),
        v_now
      )
      on conflict (incident_id, idempotency_key) do nothing;

      v_superseded_count := v_superseded_count + 1;
    end loop;
  end if;

  v_restore := public.restore_resolved_operator_review_runtime_v3(
    v_anchor.account_id,
    v_anchor.id,
    'incident_generation_resolution_v1'
  );

  select count(*) into v_remaining_blockers
  from public.account_dashboard_actions a
  join public.account_incidents i
    on i.id = a.incident_id
   and i.account_id = a.account_id
  where a.account_id = v_anchor.account_id
    and a.action_type in ('operator_review_required', 'review_auto_restart_hard_stop')
    and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
    and coalesce(a.blocking_campaign, false)
    and i.status in ('open', 'acknowledged', 'investigating')
    and i.resolved_at is null
    and i.archived_at is null;

  -- Runtime reactivation is not admission authority. Re-evaluate only the
  -- existing authorization after the state transition; never arm or consume one.
  v_authorization_id := nullif(v_transition ->> 'resume_authorization_id', '')::uuid;
  if v_authorization_id is not null then
    v_preflight := public.incident_resume_authorization_preflight_v2(v_authorization_id);
  else
    v_preflight := jsonb_build_object('next_tick_eligible', false,
      'blocked_reason', coalesce(v_transition ->> 'blocked_reason',
        'resume_authorization_pending_scheduled_assignment'));
  end if;
  v_next_tick_eligible := coalesce((v_preflight ->> 'next_tick_eligible')::boolean, false)
    and v_remaining_blockers = 0 and coalesce(v_restore ->> 'blocked_reason', '') = '';
  v_blocked_reason := coalesce(v_preflight ->> 'blocked_reason', v_restore ->> 'blocked_reason');
  if not v_next_tick_eligible and v_blocked_reason is null then
    v_blocked_reason := 'another_blocking_operator_review_exists';
  end if;

  return v_transition || jsonb_strip_nulls(jsonb_build_object(
    'contract_version', 'incident_resolution_generation_auto_restart_v1',
    'equivalent_incidents_resolved', v_superseded_count,
    'remaining_operator_review_blockers', v_remaining_blockers,
    'runtime_reactivated', coalesce((v_restore ->> 'runtime_reactivated')::boolean, false),
    'runtime_status', v_restore ->> 'runtime_status',
    'runtime_restore_blocked_reason', v_restore ->> 'blocked_reason',
    'next_tick_eligible', v_next_tick_eligible,
    'manual_stop_persistent_block', false,
    'schedule_changed', false,
    'run_created', false,
    'tick_created', false
  )) || jsonb_build_object(
    'blocked_reason', v_blocked_reason
  );
end
$$;


revoke all on function public.transition_account_incident_human_review_v3(
  uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.transition_account_incident_human_review_v3(
  uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid
) to service_role;


commit;
