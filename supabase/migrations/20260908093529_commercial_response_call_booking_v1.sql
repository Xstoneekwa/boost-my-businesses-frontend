begin;
-- Canonical applied Supabase migration version: 20260908093529.

-- A per-lead projection, NOT a second prospect or sales pipeline. Identity and
-- append-only history remain commercial_leads / commercial_events.
create table public.commercial_followup_workflows (
  lead_id uuid primary key references public.commercial_leads(id) on delete restrict,
  version integer not null default 0 check(version >= 0),
  cold_suspended boolean not null default false,
  state jsonb not null default '{"schema_version":1,"replies":[],"actions":[],"calls":[],"bookings":[],"notifications":[],"do_not_contact":false}',
  updated_at timestamptz not null default now(),
  constraint commercial_followup_state_shape check (
    state->>'schema_version'='1' and jsonb_typeof(state->'replies')='array'
    and jsonb_typeof(state->'actions')='array' and jsonb_typeof(state->'calls')='array'
    and jsonb_typeof(state->'bookings')='array' and jsonb_typeof(state->'notifications')='array'
    and jsonb_typeof(state->'do_not_contact')='boolean'
  )
);
create table public.commercial_followup_receipts (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique check(length(source_key) between 1 and 200),
  payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
  lead_id uuid references public.commercial_leads(id) on delete restrict,
  status text not null check(status in ('matched','unmatched')),
  operation text not null,
  metadata_safe jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index commercial_followup_receipts_lead_idx on public.commercial_followup_receipts(lead_id);
create index commercial_followup_bookings_idx on public.commercial_followup_workflows using gin(state jsonb_path_ops);
alter table public.commercial_followup_workflows enable row level security;
alter table public.commercial_followup_receipts enable row level security;
revoke all on public.commercial_followup_workflows, public.commercial_followup_receipts from public, anon, authenticated;
grant select,insert,update on public.commercial_followup_workflows to service_role;
grant select,insert on public.commercial_followup_receipts to service_role;
create trigger commercial_followup_receipts_append_only before update or delete on public.commercial_followup_receipts
for each row execute function public.commercial_crm_prevent_event_mutation_v1();

create view public.commercial_next_actions_v1 with (security_invoker=true) as
select w.lead_id, a->>'id' as id, a->>'action_type' as action_type,
  (a->>'due_at')::timestamptz as due_at, a->>'timezone' as timezone,
  a->>'status' as status, a->>'reason' as reason, a->>'owner' as owner,
  a->>'source_event_id' as source_event_id
from public.commercial_followup_workflows w cross join lateral jsonb_array_elements(w.state->'actions') a;
revoke all on public.commercial_next_actions_v1 from public,anon,authenticated;
grant select on public.commercial_next_actions_v1 to service_role;

create function public.commit_commercial_followup_v1(
  p_actor_user_id uuid, p_lead_id uuid, p_expected_version integer,
  p_source_key text, p_payload_hash text, p_operation text,
  p_state jsonb, p_metadata_safe jsonb default '{}'
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_lead public.commercial_leads%rowtype; v_work public.commercial_followup_workflows%rowtype;
  v_receipt public.commercial_followup_receipts%rowtype; v_reply jsonb; v_sales text; v_outreach text; v_type text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' or not public.commercial_crm_actor_authorized_v1(p_actor_user_id) then
    raise exception 'commercial_owner_required' using errcode='42501';
  end if;
  if p_operation not in ('reply_received','reply_classified','next_action_rescheduled','next_action_completed','next_action_cancelled','call_completed','call_missed','call_duplicate_ignored','call_disposition_set','calendly_booking_created','calendly_booking_rescheduled','calendly_booking_cancelled','booking_late_create_ignored','booking_stale_event_ignored','demo_disposition_set','demo_no_show','notification_simulated','unmatched') then
    raise exception 'invalid_followup_operation' using errcode='22023';
  end if;
  -- Global provider idempotency, including concurrent redeliveries and unmatched records.
  perform pg_advisory_xact_lock(hashtextextended(p_source_key,0));
  select * into v_receipt from public.commercial_followup_receipts where source_key=p_source_key;
  if found then
    if v_receipt.payload_hash<>p_payload_hash or v_receipt.lead_id is distinct from p_lead_id then
      raise exception 'followup_idempotency_conflict' using errcode='40001';
    end if;
    return jsonb_build_object('duplicate',true,'lead_id',v_receipt.lead_id);
  end if;
  if p_lead_id is null then
    if p_operation <> 'unmatched' then raise exception 'lead_required'; end if;
    insert into public.commercial_followup_receipts(source_key,payload_hash,operation,status,metadata_safe)
    values(p_source_key,p_payload_hash,p_operation,'unmatched',p_metadata_safe);
    return jsonb_build_object('unmatched',true);
  end if;
  select * into v_lead from public.commercial_leads where id=p_lead_id for update;
  if not found then raise exception 'lead_not_found'; end if;
  insert into public.commercial_followup_workflows(lead_id) values(p_lead_id) on conflict do nothing;
  select * into v_work from public.commercial_followup_workflows where lead_id=p_lead_id for update;
  if v_work.version<>p_expected_version then raise exception 'followup_stale_version' using errcode='40001'; end if;
  if p_state is null or p_state->>'schema_version' is distinct from '1'
    or jsonb_typeof(p_state->'replies') is distinct from 'array'
    or jsonb_typeof(p_state->'actions') is distinct from 'array'
    or jsonb_typeof(p_state->'calls') is distinct from 'array'
    or jsonb_typeof(p_state->'bookings') is distinct from 'array'
    or jsonb_typeof(p_state->'notifications') is distinct from 'array'
    or jsonb_typeof(p_state->'do_not_contact') is distinct from 'boolean' then raise exception 'invalid_followup_state'; end if;
  if exists(select 1 from jsonb_array_elements(p_state->'actions') a where a->>'status'='pending' group by a->>'intention' having count(*)>1) then raise exception 'duplicate_active_intention'; end if;
  if exists(select 1 from jsonb_array_elements(p_state->'notifications') n where n->>'status' not in ('READY_DRY_RUN','FAILED_CLOSED','CANCELLED','SENT_SIMULATED')) then raise exception 'live_transport_forbidden'; end if;
  if (v_work.state->>'do_not_contact')::boolean and not (p_state->>'do_not_contact')::boolean then raise exception 'suppression_cannot_be_removed'; end if;
  if exists(select 1 from jsonb_array_elements(p_state->'notifications') n where n->>'kind'='pricing_email' and n->>'status' in ('READY_DRY_RUN','SENT_SIMULATED') and not exists(
    select 1 from jsonb_array_elements(p_state->'bookings') b where b->>'id'=n->>'booking_id' and b->>'disposition'='INTERESTED' and b->>'status'='active'
  )) then raise exception 'human_demo_interest_required'; end if;
  -- All linked replies must belong to this canonical business/lead.
  for v_reply in select * from jsonb_array_elements(p_state->'replies') loop
    if nullif(v_reply->>'contact_id','') is not null and not exists(select 1 from public.commercial_contacts c where c.id=(v_reply->>'contact_id')::uuid and c.business_id=v_lead.business_id) then raise exception 'reply_contact_mismatch'; end if;
    if nullif(v_reply->>'outreach_item_id','') is not null and not exists(select 1 from public.commercial_outreach_items oi where oi.id=(v_reply->>'outreach_item_id')::uuid and oi.lead_id=p_lead_id) then raise exception 'reply_outreach_mismatch'; end if;
  end loop;
  update public.commercial_followup_workflows set state=p_state,version=version+1,
    cold_suspended=cold_suspended or p_operation='reply_received',updated_at=now() where lead_id=p_lead_id;
  if (p_state->>'do_not_contact')::boolean then
    update public.commercial_outreach_items oi set state='cancelled',cancelled_at=now(),cancelled_by=p_actor_user_id,cancellation_reason='business_do_not_contact',generation_locked_at=null,generation_locked_by=null,version=oi.version+1
      from public.commercial_leads l where l.id=oi.lead_id and l.business_id=v_lead.business_id and oi.state not in ('cancelled','sent','delivery_failed');
  end if;
  if p_operation='reply_received' then
    -- This transaction commits BEFORE any classifier is invoked. Preserve approved copy.
    update public.commercial_outreach_items set state='cancelled',cancelled_at=now(),cancelled_by=p_actor_user_id,cancellation_reason='reply_received',generation_locked_at=null,generation_locked_by=null,version=version+1
      where lead_id=p_lead_id and state not in ('cancelled','sent','delivery_failed');
    perform set_config('app.commercial_crm_transition_v1','on',true);
    v_outreach := case when v_lead.qualification_status='approved' then 'replied' else 'stopped' end;
    update public.commercial_leads set outreach_status=v_outreach,version=version+1 where id=p_lead_id;
    insert into public.commercial_events(lead_id,event_type,actor_type,actor_auth_user_id,idempotency_key,metadata_safe)
    values(p_lead_id,'outreach_stopped','commercial_owner',p_actor_user_id,p_source_key||':stop',jsonb_build_object('action','cold_sequence_suspended','delivery_enabled',false));
  end if;
  if p_operation in ('call_disposition_set','demo_disposition_set','reply_classified')
    and (p_metadata_safe->>'disposition'='NOT_INTERESTED' or (p_state->>'do_not_contact')::boolean
      or exists(select 1 from jsonb_array_elements(p_state->'replies') r where r->>'classification'='NOT_INTERESTED'))
    and v_lead.sales_status not in ('paid','onboarding','active_client') then
    perform set_config('app.commercial_crm_transition_v1','on',true);
    update public.commercial_leads set sales_status='lost',version=version+1 where id=p_lead_id;
  elsif v_lead.qualification_status='approved' then
    v_sales := case
      when p_operation in ('calendly_booking_created','calendly_booking_rescheduled') then 'demo_booked'
      when p_operation='demo_disposition_set' then 'demo_done'
      when p_operation='demo_no_show' and v_lead.sales_status='demo_booked' then 'sales_qualified'
      when p_operation='calendly_booking_cancelled' and v_lead.sales_status='demo_booked' and not exists(select 1 from jsonb_array_elements(p_state->'bookings') b where b->>'status'='active') then 'sales_qualified'
      else null end;
    -- Never regress canonical paid/onboarding/client state or claim checkout/payment.
    if v_sales is not null and v_lead.sales_status not in ('paid','onboarding','active_client','checkout_sent') then
      perform set_config('app.commercial_crm_transition_v1','on',true);
      update public.commercial_leads set outreach_status='replied',sales_status=v_sales,version=version+1 where id=p_lead_id;
    end if;
  end if;
  v_type:=case p_operation when 'reply_received' then 'response_received' when 'reply_classified' then 'response_classified' else 'sales_handoff' end;
  insert into public.commercial_events(id,lead_id,event_type,actor_type,actor_auth_user_id,idempotency_key,metadata_safe)
    values(coalesce((p_metadata_safe->>'source_event_id')::uuid,gen_random_uuid()),p_lead_id,v_type,'commercial_owner',p_actor_user_id,p_source_key,
      p_metadata_safe || jsonb_build_object('action',p_operation,'delivery_enabled',false,'auto_approval_enabled',false));
  insert into public.commercial_followup_receipts(source_key,payload_hash,lead_id,status,operation,metadata_safe)
    values(p_source_key,p_payload_hash,p_lead_id,'matched',p_operation,p_metadata_safe);
  return jsonb_build_object('lead_id',p_lead_id,'version',v_work.version+1,'duplicate',false);
end $$;
revoke all on function public.commit_commercial_followup_v1(uuid,uuid,integer,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commit_commercial_followup_v1(uuid,uuid,integer,text,text,text,jsonb,jsonb) to service_role;

-- Protect future generation/queue paths as well as items active at receipt time.
create function public.commercial_followup_cold_guard_v1() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.state<>'cancelled' then
    perform 1 from public.commercial_leads where id=new.lead_id for update;
    if exists(select 1 from public.commercial_followup_workflows where lead_id=new.lead_id and cold_suspended)
      or exists(select 1 from public.commercial_followup_workflows w join public.commercial_leads old_lead on old_lead.id=w.lead_id
        join public.commercial_leads target on target.business_id=old_lead.business_id
        where target.id=new.lead_id and w.state->>'do_not_contact'='true') then
      raise exception 'cold_sequence_suspended_on_reply' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.commercial_followup_cold_guard_v1() from public,anon,authenticated;
grant execute on function public.commercial_followup_cold_guard_v1() to service_role;
create trigger commercial_outreach_followup_cold_guard before insert or update on public.commercial_outreach_items
for each row execute function public.commercial_followup_cold_guard_v1();
commit;
