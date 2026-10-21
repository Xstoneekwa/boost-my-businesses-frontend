begin;

create or replace function public.recover_commercial_outreach_failed_item_v31(
  p_item_id uuid,
  p_expected_lead_id uuid,
  p_expected_version integer,
  p_expected_channel text,
  p_expected_angle text,
  p_expected_template_version text,
  p_idempotency_key text,
  p_source_kind text,
  p_success boolean,
  p_payload jsonb default '{}'::jsonb,
  p_validation_codes text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.commercial_outreach_items%rowtype;
  v_lead public.commercial_leads%rowtype;
  v_existing public.commercial_outreach_events%rowtype;
  v_subject text;
  v_body text;
  v_state text;
  v_event_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_source_kind not in ('captured_v3_diagnostic','openai_single_call')
    or nullif(btrim(p_idempotency_key), '') is null or char_length(p_idempotency_key) > 180 then
    raise exception 'commercial_outreach_recovery_input_invalid' using errcode = '22023';
  end if;

  select * into v_item from public.commercial_outreach_items where id=p_item_id for update;
  if not found then raise exception 'commercial_outreach_item_not_found' using errcode = 'P0002'; end if;
  select * into v_existing from public.commercial_outreach_events
    where item_id=p_item_id and idempotency_key=p_idempotency_key;
  if found then
    return jsonb_build_object('ok',true,'idempotent_replay',true,'item_id',v_existing.item_id,
      'state',v_existing.metadata_safe->>'result_state','event_id',v_existing.id);
  end if;
  if v_item.state <> 'generation_failed' or v_item.approved_at is not null or v_item.approved_by is not null or v_item.body is not null then
    raise exception 'commercial_outreach_recovery_state_invalid' using errcode = '22023';
  end if;
  if v_item.lead_id <> p_expected_lead_id or v_item.version <> p_expected_version
    or v_item.channel <> lower(btrim(p_expected_channel)) or v_item.angle <> upper(btrim(p_expected_angle))
    or v_item.template_version <> btrim(p_expected_template_version) then
    raise exception 'commercial_outreach_recovery_identity_mismatch' using errcode = '40001';
  end if;
  select * into v_lead from public.commercial_leads where id=v_item.lead_id for share;
  if not found or v_lead.qualification_status <> 'approved' or v_lead.outreach_status not in ('not_started','queued')
    or v_lead.outreach_channel <> v_item.channel or v_lead.message_angle <> v_item.angle then
    raise exception 'commercial_outreach_recovery_lead_ineligible' using errcode = '22023';
  end if;

  v_subject := nullif(btrim(p_payload->>'subject'), '');
  v_body := nullif(btrim(p_payload->>'body'), '');
  if p_success and (
    coalesce(array_length(p_validation_codes,1),0) <> 0
    or not public.commercial_outreach_payload_basic_valid_v1(v_item.channel,v_subject,v_body)
    or jsonb_typeof(coalesce(p_payload->'facts_used','[]'::jsonb)) <> 'array'
    or p_payload->>'channel' <> v_item.channel or p_payload->>'angle' <> v_item.angle
    or p_payload->>'template_version' <> v_item.template_version
    or p_payload->>'prompt_version' <> 'commercial_outreach_message_quality_v3'
    or coalesce(p_payload->>'content_hash','') !~ '^[a-f0-9]{64}$'
  ) then raise exception 'commercial_outreach_recovery_payload_invalid' using errcode = '22023'; end if;

  if p_success then
    update public.commercial_outreach_items set
      state='ready_for_review', subject=v_subject, body=v_body,
      personalization_summary=nullif(btrim(p_payload->>'personalization_summary'),''),
      facts_used=coalesce(p_payload->'facts_used','[]'::jsonb),
      confidence=nullif(p_payload->>'confidence','')::numeric,
      validation_codes='{}'::text[], generation_model=nullif(btrim(p_payload->>'model'),''),
      generation_prompt_version=p_payload->>'prompt_version', generated_at=now(),
      generation_locked_at=null, generation_locked_by=null,
      content_hash=p_payload->>'content_hash', version=version+1
    where id=v_item.id;
    v_state := 'ready_for_review';
  else
    update public.commercial_outreach_items set
      validation_codes=case when coalesce(array_length(p_validation_codes,1),0)=0
        then array['recovery_validation_failed'] else p_validation_codes end,
      generation_model=nullif(btrim(p_payload->>'model'),''),
      generation_prompt_version=coalesce(nullif(btrim(p_payload->>'prompt_version'),''),generation_prompt_version),
      version=version+1
    where id=v_item.id;
    v_state := 'generation_failed';
  end if;

  insert into public.commercial_outreach_events(item_id,lead_id,event_type,actor_type,idempotency_key,metadata_safe)
  values(v_item.id,v_item.lead_id,'item_regenerated','system',p_idempotency_key,jsonb_build_object(
    'recovery_version','commercial_outreach_failed_preview_recovery_v31',
    'source_kind',p_source_kind,'result_state',v_state,
    'validation_codes',to_jsonb(coalesce(p_validation_codes,'{}'::text[])),
    'model',nullif(btrim(p_payload->>'model'),''),'prompt_version',nullif(btrim(p_payload->>'prompt_version'),''),
    'content_hash',nullif(btrim(p_payload->>'content_hash'),''),
    'openai_calls',case when p_source_kind='openai_single_call' then 1 else 0 end,
    'delivery_enabled',false,'auto_approval_enabled',false
  )) on conflict (item_id,idempotency_key) do nothing
  returning id into v_event_id;

  return jsonb_build_object('ok',true,'idempotent_replay',false,'item_id',v_item.id,
    'state',v_state,'event_id',v_event_id,'version',v_item.version+1);
end
$$;

revoke all on function public.recover_commercial_outreach_failed_item_v31(uuid,uuid,integer,text,text,text,text,text,boolean,jsonb,text[]) from public, anon, authenticated;
grant execute on function public.recover_commercial_outreach_failed_item_v31(uuid,uuid,integer,text,text,text,text,text,boolean,jsonb,text[]) to service_role;

commit;
