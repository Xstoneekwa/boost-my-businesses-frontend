begin;

-- Human review workflow only. No discovery, scoring, outreach, email, DM, or
-- Phone Farm runtime is introduced by this migration.

alter table public.commercial_leads
  add constraint commercial_leads_message_angle_check
  check (message_angle is null or message_angle in ('A', 'B'));

alter table public.commercial_events
  drop constraint commercial_events_event_type_check;
alter table public.commercial_events
  add constraint commercial_events_event_type_check
  check (event_type in (
    'lead_created', 'lead_approved', 'lead_rejected', 'lead_review_updated',
    'outreach_queued', 'outreach_contacted', 'outreach_response_received',
    'outreach_no_response', 'outreach_stopped', 'sales_qualified',
    'demo_booked', 'demo_done', 'checkout_sent', 'payment_succeeded',
    'sales_lost', 'onboarding_started', 'client_activated', 'lead_discovered',
    'lead_enriched', 'lead_scored', 'outreach_sent', 'response_received',
    'response_classified', 'sales_handoff', 'payment_failed', 'lead_lost',
    'active_client'
  ));

create index commercial_leads_review_queue_v1_idx
  on public.commercial_leads (
    (case priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end),
    score desc,
    created_at,
    id
  )
  where qualification_status = 'qualified' and approved_at is null;

create index commercial_leads_ready_outreach_v1_idx
  on public.commercial_leads (approved_at desc, id)
  where qualification_status = 'approved' and outreach_status = 'not_started';

create or replace function public.commercial_review_queue_read_model_v1(
  p_filters jsonb default '{}'::jsonb,
  p_page integer default 1,
  p_page_size integer default 12
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 12), 1), 50);
  v_result jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_filters is null or jsonb_typeof(p_filters) <> 'object' then
    raise exception 'commercial_review_filters_must_be_object' using errcode = '22023';
  end if;

  with
  params as (
    select
      nullif(btrim(p_filters->>'campaign'), '')::uuid as campaign_id,
      nullif(btrim(p_filters->>'country'), '') as country,
      nullif(btrim(p_filters->>'city'), '') as city,
      nullif(btrim(p_filters->>'vertical'), '') as vertical,
      nullif(btrim(p_filters->>'subsegment'), '') as subsegment,
      nullif(btrim(p_filters->>'channel'), '') as channel,
      nullif(btrim(p_filters->>'message_angle'), '') as message_angle,
      nullif(btrim(p_filters->>'priority'), '') as priority,
      nullif(btrim(p_filters->>'search'), '') as search,
      nullif(p_filters->>'date_from', '')::timestamptz as date_from,
      nullif(p_filters->>'date_to', '')::timestamptz as date_to
  ),
  base as (
    select
      l.id,
      l.campaign_id,
      c.name as campaign_name,
      b.business_name,
      coalesce(l.city_snapshot, b.city) as city,
      coalesce(l.subsegment_snapshot, b.subsegment) as subsegment,
      b.website,
      b.instagram_handle,
      l.score,
      l.priority,
      l.qualification_status,
      l.outreach_status,
      l.outreach_channel,
      l.message_angle,
      l.personalization_context_safe,
      l.audience_context_safe,
      l.version,
      l.created_at,
      l.updated_at,
      latest.event_type as last_activity_type,
      latest.occurred_at as last_activity_at
    from public.commercial_leads l
    join public.commercial_campaigns c on c.id = l.campaign_id
    join public.commercial_businesses b on b.id = l.business_id
    left join lateral (
      select e.event_type, e.occurred_at
      from public.commercial_events e
      where e.lead_id = l.id
      order by e.occurred_at desc, e.id desc
      limit 1
    ) latest on true
    cross join params p
    where (p.campaign_id is null or l.campaign_id = p.campaign_id)
      and (p.country is null or b.country_code = p.country)
      and (p.city is null or coalesce(l.city_snapshot, b.city) = p.city)
      and (p.vertical is null or b.vertical = p.vertical)
      and (p.subsegment is null or coalesce(l.subsegment_snapshot, b.subsegment) = p.subsegment)
      and (p.channel is null or l.outreach_channel = p.channel)
      and (p.message_angle is null or l.message_angle = p.message_angle)
      and (p.priority is null or l.priority = p.priority)
      and (p.date_from is null or l.created_at >= p.date_from)
      and (p.date_to is null or l.created_at < p.date_to)
      and (
        p.search is null
        or b.business_name ilike '%' || p.search || '%'
        or coalesce(b.instagram_handle, '') ilike '%' || p.search || '%'
        or coalesce(b.website, '') ilike '%' || p.search || '%'
      )
  ),
  needs as (
    select * from base
    where qualification_status = 'qualified'
    order by
      case priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
      score desc nulls last,
      created_at,
      id
  ),
  ready as (
    select * from base
    where qualification_status = 'approved' and outreach_status = 'not_started'
    order by updated_at desc, id
  ),
  needs_page as (
    select * from needs offset (v_page - 1) * v_page_size limit v_page_size
  ),
  ready_page as (
    select * from ready offset (v_page - 1) * v_page_size limit v_page_size
  )
  select jsonb_build_object(
    'needs_approval', jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(n)) from needs_page n), '[]'::jsonb),
      'total', (select count(*)::integer from needs),
      'page', v_page,
      'page_size', v_page_size
    ),
    'ready_for_outreach', jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(r)) from ready_page r), '[]'::jsonb),
      'total', (select count(*)::integer from ready),
      'page', v_page,
      'page_size', v_page_size
    )
  ) into v_result;

  return v_result;
end
$$;

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
    if v_rejection_note is not null and v_rejection_reason is distinct from 'other' then
      raise exception 'commercial_review_rejection_note_requires_other' using errcode = '22023';
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
    return v_transition || jsonb_build_object('review_action', 'approve');
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

revoke all on function public.commercial_review_queue_read_model_v1(jsonb, integer, integer)
  from public, anon, authenticated;
revoke all on function public.review_commercial_lead_v1(uuid, uuid, text, integer, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.commercial_review_queue_read_model_v1(jsonb, integer, integer)
  to service_role;
grant execute on function public.review_commercial_lead_v1(uuid, uuid, text, integer, text, jsonb)
  to service_role;

comment on function public.commercial_review_queue_read_model_v1(jsonb, integer, integer) is
  'Bounded owner dashboard review and ready-for-outreach projection. Service-role-only; app gate remains mandatory.';
comment on function public.review_commercial_lead_v1(uuid, uuid, text, integer, text, jsonb) is
  'Owner-only optimistic-concurrency wrapper around the canonical Commercial CRM transition machine. No outreach is sent.';

commit;
