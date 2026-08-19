-- Incident resolution generation + Auto Restart eligibility V1.
--
-- One verified resolution closes only stale, equivalent non-security
-- occurrences for the same account.  Equivalence is deliberately narrow:
-- account + incident_type + normalized causal reason.  Different causes and
-- all security incidents remain independent blockers.

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

  return v_transition || jsonb_strip_nulls(jsonb_build_object(
    'contract_version', 'incident_resolution_generation_auto_restart_v1',
    'equivalent_incidents_resolved', v_superseded_count,
    'remaining_operator_review_blockers', v_remaining_blockers,
    'runtime_reactivated', coalesce((v_restore ->> 'runtime_reactivated')::boolean, false),
    'runtime_status', v_restore ->> 'runtime_status',
    'runtime_restore_blocked_reason', v_restore ->> 'blocked_reason',
    'next_tick_eligible', v_remaining_blockers = 0
      and coalesce(v_restore ->> 'blocked_reason', '') = '',
    'manual_stop_persistent_block', false,
    'schedule_changed', false,
    'run_created', false,
    'tick_created', false
  )) || jsonb_build_object(
    'blocked_reason', v_restore ->> 'blocked_reason'
  );
end
$$;

revoke all on function public.transition_account_incident_human_review_v3(
  uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.transition_account_incident_human_review_v3(
  uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid
) to service_role;

comment on function public.transition_account_incident_human_review_v3(
  uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid
) is 'Resolves a verified non-security incident and stale equivalent occurrences for the same account/type/cause, restores paused_manual_review when no independent blocker remains, and never creates a run or tick.';
