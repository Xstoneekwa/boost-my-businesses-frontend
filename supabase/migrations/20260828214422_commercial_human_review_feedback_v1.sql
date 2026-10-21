begin;

-- Refuse to overwrite a concurrently changed canonical RPC. The two review
-- hashes are the repository baseline and its audited production return-shape fix.
do $$ begin
  if (select md5(prosrc) from pg_proc where oid='public.review_commercial_lead_v1(uuid,uuid,text,integer,text,jsonb)'::regprocedure)
    not in ('0622ab5f04c616c32da70250a3b619ff','0b165bddc0f84b0b34e1e483fd64efe6')
    or (select md5(prosrc) from pg_proc where oid='public.claim_commercial_outreach_items_v1(integer,text)'::regprocedure)
    <> '6bc59a70c5ab46ea74d4c72849351ac1' then
    raise exception 'commercial_review_baseline_drift_reaudit_required';
  end if;
end $$;

-- Append-only, bounded measurement cohort. No synthetic human decisions.
-- Extend the existing event contract without removing any existing event type.
do $$
declare v_check text;
begin
  select pg_get_constraintdef(oid) into v_check from pg_constraint
  where conrelid = 'public.commercial_events'::regclass and conname = 'commercial_events_event_type_check';
  if v_check is null then raise exception 'commercial_event_contract_missing'; end if;
  alter table public.commercial_events drop constraint commercial_events_event_type_check;
  execute 'alter table public.commercial_events add constraint commercial_events_event_type_check check (' ||
    substring(v_check from 7) ||
    ' or event_type in (''human_review_canary_enrolled'', ''human_review_started'', ''human_review_edited'', ''human_review_completed''))';
end $$;

create unique index commercial_human_review_once_v1_idx on public.commercial_events(lead_id, event_type)
where event_type in ('human_review_canary_enrolled', 'human_review_started', 'human_review_completed');

-- No automatic enrollment on GET. Deployment enrolls once, atomically, below.
create function public.enroll_commercial_review_canary_v1(p_actor_user_id uuid, p_baseline_revision text)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_lead public.commercial_leads%rowtype; v_count integer := 0;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role'
    or not public.commercial_crm_actor_authorized_v1(p_actor_user_id) then
    raise exception 'commercial_crm_owner_access_required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('commercial-human-review-canary-v1'));
  if exists(select 1 from public.commercial_events where event_type = 'human_review_canary_enrolled') then
    return (select count(*)::integer from public.commercial_events where event_type = 'human_review_canary_enrolled');
  end if;
  if nullif(btrim(p_baseline_revision), '') is null then raise exception 'baseline_revision_required'; end if;
  -- Short one-time table lock prevents an in-flight human edit from being
  -- mistaken for an original AI recommendation during enrollment.
  lock table public.commercial_leads in share row exclusive mode;
  for v_lead in
    select l.* from public.commercial_leads l
    join (
      select id, row_number() over(partition by priority order by score desc nulls last, created_at, id) as rank
      from public.commercial_leads where qualification_status = 'qualified' and approved_at is null
        and priority in ('urgent', 'high')
        and not exists(select 1 from public.commercial_events e where e.lead_id = commercial_leads.id
          and e.actor_type = 'commercial_owner' and e.event_type in ('lead_review_updated','lead_approved','lead_rejected'))
    ) ranked on ranked.id = l.id
    where l.qualification_status='qualified' and l.approved_at is null
      and ranked.rank <= case l.priority when 'urgent' then 15 else 10 end
    order by case l.priority when 'urgent' then 1 else 2 end, l.score desc, l.created_at, l.id
    for update of l
  loop
    v_count := v_count + 1;
    insert into public.commercial_events(lead_id,event_type,actor_type,idempotency_key,metadata_safe)
    values(v_lead.id,'human_review_canary_enrolled','system','human-review:enrolled:v1',jsonb_build_object(
      'canary_key','human_review_canary_v1','position',v_count,'reviewer_user_id',p_actor_user_id,
      'baseline_revision',p_baseline_revision,'ai_priority',v_lead.priority,'ai_score',v_lead.score,
      'ai_channel',v_lead.outreach_channel,'ai_angle',v_lead.message_angle,
      'personalization_note',v_lead.personalization_context_safe->>'review_note',
      'audience_note',v_lead.audience_context_safe->>'review_note',
      'scoring_frozen',true,'channel_logic_frozen',true,'angle_logic_frozen',true));
  end loop;
  if v_count <> 25 or (select count(*) from public.commercial_events
    where event_type='human_review_canary_enrolled' and metadata_safe->>'ai_priority'='urgent') <> 15 then
    raise exception 'commercial_canary_requires_15_p1_and_10_p2';
  end if;
  return v_count;
end $$;

create function public.start_commercial_human_review_v1(p_actor_user_id uuid,p_lead_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_lead public.commercial_leads%rowtype; v_enrollment public.commercial_events%rowtype; v_started timestamptz;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role'
    or not public.commercial_crm_actor_authorized_v1(p_actor_user_id) then
    raise exception 'commercial_crm_owner_access_required' using errcode = '42501';
  end if;
  select * into v_lead from public.commercial_leads where id=p_lead_id for update;
  if not found then raise exception 'commercial_lead_not_found' using errcode='P0002'; end if;
  select * into v_enrollment from public.commercial_events where lead_id=p_lead_id and event_type='human_review_canary_enrolled';
  if not found or v_enrollment.metadata_safe->>'reviewer_user_id' is distinct from p_actor_user_id::text then
    raise exception 'commercial_canary_reviewer_required' using errcode='42501';
  end if;
  if v_lead.qualification_status <> 'qualified' or v_lead.approved_at is not null then
    raise exception 'commercial_review_lead_not_eligible' using errcode='22023';
  end if;
  insert into public.commercial_events(lead_id,event_type,actor_type,actor_auth_user_id,idempotency_key,occurred_at,metadata_safe)
  values(p_lead_id,'human_review_started','commercial_owner',p_actor_user_id,'human-review:started:v1',clock_timestamp(),
    jsonb_build_object('canary_key','human_review_canary_v1')) on conflict do nothing;
  select occurred_at into v_started from public.commercial_events where lead_id=p_lead_id and event_type='human_review_started';
  return jsonb_build_object('ok',true,'lead_id',p_lead_id,'review_started_at',v_started);
end $$;

-- Run after canonical review events, inside the SAME transaction as the decision
-- and the existing outreach trigger. A missing start/identity fails everything closed.
create function public.capture_commercial_human_review_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_enrolled jsonb; v_start public.commercial_events%rowtype; v_lead public.commercial_leads%rowtype;
  v_current jsonb; v_previous jsonb; v_changes jsonb; v_finished timestamptz;
begin
  select metadata_safe into v_enrolled from public.commercial_events
    where lead_id=new.lead_id and event_type='human_review_canary_enrolled';
  if not found then return new; end if;
  if new.actor_type <> 'commercial_owner' or new.actor_auth_user_id is null
    or v_enrolled->>'reviewer_user_id' is distinct from new.actor_auth_user_id::text
    or not public.commercial_crm_actor_authorized_v1(new.actor_auth_user_id) then
    raise exception 'commercial_canary_reviewer_required' using errcode='42501';
  end if;
  select * into v_start from public.commercial_events where lead_id=new.lead_id and event_type='human_review_started';
  if not found or v_start.actor_auth_user_id is distinct from new.actor_auth_user_id then
    raise exception 'commercial_review_start_required' using errcode='22023';
  end if;
  if new.event_type='lead_rejected' and coalesce(new.metadata_safe->>'rejection_reason','') not in (
    'not_a_fit','low_quality_instagram','too_small_no_budget_signal','no_clear_business_activity',
    'poor_targeting_potential','duplicate','other') then
    raise exception 'commercial_review_rejection_reason_required' using errcode='22023';
  end if;
  select * into v_lead from public.commercial_leads where id=new.lead_id;
  v_current := jsonb_build_object('channel',v_lead.outreach_channel,'angle',v_lead.message_angle,'priority',v_lead.priority,
    'personalization_note',v_lead.personalization_context_safe->>'review_note',
    'audience_note',v_lead.audience_context_safe->>'review_note');
  select metadata_safe->'final_selection' into v_previous from public.commercial_events
    where lead_id=new.lead_id and event_type='human_review_edited' order by occurred_at desc,id desc limit 1;
  v_previous := coalesce(v_previous,jsonb_build_object('channel',v_enrolled->'ai_channel','angle',v_enrolled->'ai_angle',
    'priority',v_enrolled->'ai_priority','personalization_note',v_enrolled->'personalization_note','audience_note',v_enrolled->'audience_note'));
  select coalesce(jsonb_agg(key order by key),'[]'::jsonb) into v_changes from jsonb_each(v_current)
    where value is distinct from v_previous->key;
  if jsonb_array_length(v_changes)>0 then
    insert into public.commercial_events(lead_id,event_type,actor_type,actor_auth_user_id,idempotency_key,occurred_at,metadata_safe)
    values(new.lead_id,'human_review_edited','commercial_owner',new.actor_auth_user_id,'human-review:edit:'||new.id,clock_timestamp(),
      jsonb_build_object('canary_key','human_review_canary_v1','source_event_id',new.id,'changed_fields',v_changes,'final_selection',v_current));
  end if;
  if new.event_type in ('lead_approved','lead_rejected') then
    if new.event_type='lead_approved' and (select count(*) from public.commercial_outreach_items
      where lead_id=new.lead_id and state<>'cancelled' and channel=v_lead.outreach_channel and angle=v_lead.message_angle) <> 1 then
      raise exception 'commercial_approved_lead_requires_exactly_one_outreach_item';
    end if;
    if new.event_type='lead_rejected' and exists(select 1 from public.commercial_outreach_items where lead_id=new.lead_id and state<>'cancelled') then
      raise exception 'commercial_rejected_lead_has_active_outreach';
    end if;
    v_finished := clock_timestamp();
    insert into public.commercial_events(lead_id,event_type,actor_type,actor_auth_user_id,idempotency_key,occurred_at,metadata_safe)
    values(new.lead_id,'human_review_completed','commercial_owner',new.actor_auth_user_id,'human-review:completed:v1',v_finished,
      v_enrolled || jsonb_build_object(
        'source_event_id',new.id,'review_started_at',v_start.occurred_at,'review_completed_at',v_finished,
        'human_decision',case new.event_type when 'lead_approved' then 'approved' else 'rejected' end,
        'human_channel_final',v_lead.outreach_channel,'human_angle_final',v_lead.message_angle,
        'channel_overridden',(v_enrolled->>'ai_channel') is distinct from v_lead.outreach_channel,
        'angle_overridden',(v_enrolled->>'ai_angle') is distinct from v_lead.message_angle,
        'lead_edited',exists(select 1 from public.commercial_events where lead_id=new.lead_id and event_type='human_review_edited'),
        'reject_reason',new.metadata_safe->>'rejection_reason',
        'optional_review_note',coalesce(new.metadata_safe->>'rejection_note',v_lead.personalization_context_safe->>'review_note'),
        'review_duration_seconds',greatest(0,extract(epoch from v_finished-v_start.occurred_at)),
        'duration_method','server_elapsed_including_breaks','real_send',false));
  end if;
  return new;
end $$;
create trigger commercial_events_human_review_feedback_v1 after insert on public.commercial_events
for each row when(new.event_type in ('lead_approved','lead_rejected','lead_review_updated'))
execute function public.capture_commercial_human_review_v1();

create function public.freeze_commercial_canary_score_v1() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.score is distinct from old.score and exists(select 1 from public.commercial_events
    where lead_id=old.id and event_type='human_review_canary_enrolled') then
    raise exception 'commercial_canary_scoring_frozen' using errcode='22023';
  end if;
  return new;
end $$;
create trigger commercial_leads_canary_score_frozen_v1 before update of score on public.commercial_leads
for each row execute function public.freeze_commercial_canary_score_v1();

revoke all on function public.enroll_commercial_review_canary_v1(uuid,text) from public,anon,authenticated;
revoke all on function public.start_commercial_human_review_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.capture_commercial_human_review_v1() from public,anon,authenticated;
revoke all on function public.freeze_commercial_canary_score_v1() from public,anon,authenticated;
grant execute on function public.enroll_commercial_review_canary_v1(uuid,text),public.start_commercial_human_review_v1(uuid,uuid),
  public.capture_commercial_human_review_v1(),public.freeze_commercial_canary_score_v1() to service_role;

create or replace function public.review_commercial_lead_v1(
  p_actor_user_id uuid,
  p_lead_id uuid,
  p_action text,
  p_expected_version integer,
  p_idempotency_key text,
  p_review_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_patch jsonb := coalesce(p_review_patch, '{}'::jsonb);
  v_lead public.commercial_leads%rowtype;
  v_existing_event public.commercial_events%rowtype;
  v_expected_event_type text;
  v_channel text;
  v_angle text;
  v_priority text;
  v_personalization_note text;
  v_audience_note text;
  v_rejection_reason text;
  v_rejection_note text;
  v_transition jsonb;
  v_event_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if not public.commercial_crm_actor_authorized_v1(p_actor_user_id) then
    raise exception 'commercial_crm_owner_access_required' using errcode = '42501';
  end if;
  if p_lead_id is null then
    raise exception 'commercial_lead_id_required' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'commercial_review_expected_version_invalid' using errcode = '22023';
  end if;
  if char_length(v_idempotency_key) not between 1 and 200 then
    raise exception 'commercial_idempotency_key_invalid' using errcode = '22023';
  end if;
  if p_review_patch is null or jsonb_typeof(p_review_patch) <> 'object' then
    raise exception 'commercial_review_patch_must_be_object' using errcode = '22023';
  end if;
  if (v_patch - array[
    'outreach_channel', 'message_angle', 'priority', 'personalization_note',
    'audience_note', 'rejection_reason', 'rejection_note'
  ]) <> '{}'::jsonb then
    raise exception 'commercial_review_patch_field_not_allowed' using errcode = '22023';
  end if;

  case v_action
    when 'approve' then v_expected_event_type := 'lead_approved';
    when 'reject' then v_expected_event_type := 'lead_rejected';
    when 'update_context' then v_expected_event_type := 'lead_review_updated';
    else raise exception 'commercial_review_action_unknown' using errcode = '22023';
  end case;

  select * into v_lead
  from public.commercial_leads
  where id = p_lead_id
  for update;
  if not found then
    raise exception 'commercial_lead_not_found' using errcode = 'P0002';
  end if;

  select * into v_existing_event
  from public.commercial_events
  where lead_id = p_lead_id and idempotency_key = v_idempotency_key;
  if found then
    if v_existing_event.event_type <> v_expected_event_type
       or coalesce(v_existing_event.metadata_safe->>'review_action', '') <> v_action then
      raise exception 'commercial_review_idempotency_conflict' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'lead_id', v_lead.id,
      'event_id', v_existing_event.id,
      'qualification_status', v_lead.qualification_status,
      'outreach_status', v_lead.outreach_status,
      'outreach_channel', v_lead.outreach_channel,
      'message_angle', v_lead.message_angle,
      'priority', v_lead.priority,
      'version', v_lead.version
    );
  end if;

  if v_lead.version <> p_expected_version then
    raise exception 'commercial_review_stale_version' using errcode = '40001';
  end if;

  v_channel := case when v_patch ? 'outreach_channel'
    then nullif(btrim(v_patch->>'outreach_channel'), '') else v_lead.outreach_channel end;
  v_angle := case when v_patch ? 'message_angle'
    then nullif(upper(btrim(v_patch->>'message_angle')), '') else v_lead.message_angle end;
  v_priority := case when v_patch ? 'priority'
    then nullif(lower(btrim(v_patch->>'priority')), '') else v_lead.priority end;
  v_personalization_note := nullif(btrim(v_patch->>'personalization_note'), '');
  v_audience_note := nullif(btrim(v_patch->>'audience_note'), '');
  v_rejection_reason := nullif(lower(btrim(v_patch->>'rejection_reason')), '');
  v_rejection_note := nullif(btrim(v_patch->>'rejection_note'), '');

  if v_channel is not null and v_channel not in ('instagram', 'email') then
    raise exception 'commercial_review_channel_invalid' using errcode = '22023';
  end if;
  if v_angle is not null and v_angle not in ('A', 'B') then
    raise exception 'commercial_review_angle_invalid' using errcode = '22023';
  end if;
  if v_priority is null or v_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'commercial_review_priority_invalid' using errcode = '22023';
  end if;
  if char_length(coalesce(v_personalization_note, '')) > 1000
     or char_length(coalesce(v_audience_note, '')) > 1000
     or char_length(coalesce(v_rejection_note, '')) > 500 then
    raise exception 'commercial_review_note_too_long' using errcode = '22023';
  end if;

  if v_action in ('approve', 'update_context') then
    if v_patch ? 'rejection_reason' or v_patch ? 'rejection_note' then
      raise exception 'commercial_review_rejection_field_not_allowed' using errcode = '22023';
    end if;
    if v_lead.qualification_status <> 'qualified' or v_lead.approved_at is not null then
      raise exception 'commercial_review_lead_not_eligible' using errcode = '22023';
    end if;
  end if;

  if v_action = 'reject' then
    if (v_patch - array['rejection_reason', 'rejection_note']) <> '{}'::jsonb then
      raise exception 'commercial_review_reject_patch_invalid' using errcode = '22023';
    end if;
    if v_rejection_reason is not null and v_rejection_reason not in (
      'not_a_fit', 'low_quality_instagram', 'too_small_no_budget_signal',
      'no_clear_business_activity', 'poor_targeting_potential', 'duplicate', 'other'
    ) then
      raise exception 'commercial_review_rejection_reason_invalid' using errcode = '22023';
    end if;
    if v_lead.qualification_status <> 'qualified' or v_lead.approved_at is not null then
      raise exception 'commercial_review_lead_not_eligible' using errcode = '22023';
    end if;

    select public.transition_commercial_lead_v1(
      p_actor_user_id,
      p_lead_id,
      'reject',
      v_idempotency_key,
      jsonb_strip_nulls(jsonb_build_object(
        'review_action', 'reject',
        'rejection_reason', v_rejection_reason,
        'rejection_note', v_rejection_note,
        'contract_version', 'commercial_lead_review_workflow_v1'
      ))
    ) into v_transition;
    return v_transition || jsonb_build_object('review_action', 'reject');
  end if;

  if v_action = 'update_context' and not (
    v_patch ? 'outreach_channel' or v_patch ? 'message_angle' or v_patch ? 'priority'
    or v_patch ? 'personalization_note' or v_patch ? 'audience_note'
  ) then
    raise exception 'commercial_review_patch_empty' using errcode = '22023';
  end if;
  if v_action = 'approve' and (v_channel is null or v_angle is null) then
    raise exception 'commercial_review_approval_channel_and_angle_required' using errcode = '22023';
  end if;

  update public.commercial_leads
  set
    outreach_channel = v_channel,
    message_angle = v_angle,
    priority = v_priority,
    personalization_context_safe = case when v_patch ? 'personalization_note'
      then (personalization_context_safe - 'review_note') ||
        case when v_personalization_note is null then '{}'::jsonb
             else jsonb_build_object('review_note', v_personalization_note) end
      else personalization_context_safe end,
    audience_context_safe = case when v_patch ? 'audience_note'
      then (audience_context_safe - 'review_note') ||
        case when v_audience_note is null then '{}'::jsonb
             else jsonb_build_object('review_note', v_audience_note) end
      else audience_context_safe end,
    version = version + case when v_action = 'update_context' then 1 else 0 end
  where id = p_lead_id
  returning * into v_lead;

  if v_action = 'approve' then
    select public.transition_commercial_lead_v1(
      p_actor_user_id,
      p_lead_id,
      'approve',
      v_idempotency_key,
      jsonb_build_object(
        'review_action', 'approve',
        'outreach_channel', v_channel,
        'message_angle', v_angle,
        'priority', v_priority,
        'contract_version', 'commercial_lead_review_workflow_v1'
      )
    ) into v_transition;
    return v_transition || jsonb_build_object(
      'review_action', 'approve',
      'outreach_channel', v_channel,
      'message_angle', v_angle,
      'priority', v_priority
    );
  end if;

  insert into public.commercial_events (
    lead_id, event_type, actor_type, actor_auth_user_id, idempotency_key, metadata_safe
  ) values (
    p_lead_id,
    'lead_review_updated',
    'commercial_owner',
    p_actor_user_id,
    v_idempotency_key,
    jsonb_build_object(
      'review_action', 'update_context',
      'outreach_channel', v_lead.outreach_channel,
      'message_angle', v_lead.message_angle,
      'priority', v_lead.priority,
      'personalization_note_changed', v_patch ? 'personalization_note',
      'audience_note_changed', v_patch ? 'audience_note',
      'contract_version', 'commercial_lead_review_workflow_v1'
    )
  ) returning id into v_event_id;

  return jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'review_action', 'update_context',
    'lead_id', v_lead.id,
    'event_id', v_event_id,
    'qualification_status', v_lead.qualification_status,
    'outreach_status', v_lead.outreach_status,
    'outreach_channel', v_lead.outreach_channel,
    'message_angle', v_lead.message_angle,
    'priority', v_lead.priority,
    'version', v_lead.version
  );
end
$$;
create or replace function public.claim_commercial_outreach_items_v1(
  batch_limit integer default 5,
  worker_id text default null
)
returns setof public.commercial_outreach_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(batch_limit, 5), 1), 20);
  v_worker text := nullif(btrim(worker_id), '');
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if v_worker is null or char_length(v_worker) > 160 then
    raise exception 'commercial_outreach_worker_id_invalid' using errcode = '22023';
  end if;

  -- Recover abandoned worker leases; retries remain capped by the existing attempt limit.
  with expired as (
    update public.commercial_outreach_items
    set state='generation_failed', generation_locked_at=null, generation_locked_by=null,
        validation_codes=array['generation_lease_expired'], version=version+1
    where state='generating' and generation_locked_at < now()-interval '10 minutes'
    returning id,lead_id,generation_attempt_count
  )
  insert into public.commercial_outreach_events(item_id,lead_id,event_type,actor_type,idempotency_key,metadata_safe)
  select id,lead_id,'generation_failed','system','lease-expired:'||generation_attempt_count,
    jsonb_build_object('reason','generation_lease_expired','delivery_enabled',false) from expired
  on conflict (item_id,idempotency_key) do nothing;
  return query
  with candidates as (
    select oi.id
    from public.commercial_outreach_items oi
    join public.commercial_leads l on l.id = oi.lead_id
    where oi.state in ('draft', 'generation_failed')
      and oi.generation_attempt_count < oi.max_generation_attempts
      and l.qualification_status = 'approved'
      and l.outreach_status in ('not_started', 'queued')
    order by
      case l.priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
      oi.created_at,
      oi.id
    for update of oi skip locked
    limit v_limit
  ), claimed as (
    update public.commercial_outreach_items oi
    set state = 'generating', generation_attempt_count = generation_attempt_count + 1,
        generation_locked_at = now(), generation_locked_by = v_worker,
        validation_codes = '{}'::text[], version = version + 1
    from candidates c
    where oi.id = c.id
    returning oi.*
  )
  select * from claimed;
end
$$;

commit;
