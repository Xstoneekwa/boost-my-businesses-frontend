begin;

-- BMB Commercial Outreach Orchestration V1.
-- Durable generation and owner review only: this migration contains no email,
-- Instagram, SMTP, Postmark, Phone Farm, or other delivery transport.

create table public.commercial_outreach_templates (
  template_key text primary key,
  channel text not null,
  angle text not null,
  version text not null,
  intent text not null,
  max_subject_chars integer not null,
  max_body_chars integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint commercial_outreach_templates_channel_check check (channel in ('email', 'instagram')),
  constraint commercial_outreach_templates_angle_check check (angle in ('A', 'B')),
  constraint commercial_outreach_templates_limits_check check (
    max_subject_chars between 0 and 160 and max_body_chars between 100 and 4000
  ),
  constraint commercial_outreach_templates_channel_angle_version_unique unique (channel, angle, version),
  constraint commercial_outreach_templates_key_channel_angle_unique unique (template_key, channel, angle)
);

insert into public.commercial_outreach_templates (
  template_key, channel, angle, version, intent, max_subject_chars, max_body_chars
) values
  (
    'IG_BEAUTY_ANGLE_A_V1', 'instagram', 'A', 'V1',
    'Open a concise conversation about underused Instagram visibility, content consistency, and reaching relevant local audiences without asserting unverified performance.',
    0, 900
  ),
  (
    'IG_BEAUTY_ANGLE_B_V1', 'instagram', 'B', 'V1',
    'Open a concise conversation about turning relevant Instagram audiences into potential customer conversations without asserting customer, revenue, or growth outcomes.',
    0, 900
  ),
  (
    'EMAIL_BEAUTY_ANGLE_A_V1', 'email', 'A', 'V1',
    'Introduce a specific, evidence-based Instagram visibility opportunity and invite a low-friction conversation without asserting unverified performance.',
    120, 2000
  ),
  (
    'EMAIL_BEAUTY_ANGLE_B_V1', 'email', 'B', 'V1',
    'Introduce a specific, evidence-based Instagram acquisition opportunity and invite a low-friction conversation without asserting customer, revenue, or growth outcomes.',
    120, 2000
  );

create unique index commercial_leads_id_campaign_v1_uidx
  on public.commercial_leads (id, campaign_id);

create table public.commercial_outreach_items (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.commercial_leads(id) on delete restrict,
  campaign_id uuid not null references public.commercial_campaigns(id) on delete restrict,
  channel text not null,
  angle text not null,
  template_key text not null,
  template_version text not null default 'V1',
  state text not null default 'draft',
  subject text null,
  body text null,
  personalization_summary text null,
  facts_used jsonb not null default '[]'::jsonb,
  confidence numeric(4,3) null,
  validation_codes text[] not null default '{}'::text[],
  generation_attempt_count integer not null default 0,
  max_generation_attempts integer not null default 2,
  generation_model text null,
  generation_prompt_version text null,
  generation_locked_at timestamptz null,
  generation_locked_by text null,
  generated_at timestamptz null,
  approved_by uuid null references auth.users(id) on delete restrict,
  approved_at timestamptz null,
  cancelled_by uuid null references auth.users(id) on delete restrict,
  cancelled_at timestamptz null,
  cancellation_reason text null,
  supersedes_item_id uuid null references public.commercial_outreach_items(id) on delete restrict,
  owner_edited boolean not null default false,
  content_hash text null,
  idempotency_key text not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_outreach_items_lead_campaign_fkey
    foreign key (lead_id, campaign_id)
    references public.commercial_leads(id, campaign_id) on delete restrict,
  constraint commercial_outreach_items_template_shape_fkey
    foreign key (template_key, channel, angle)
    references public.commercial_outreach_templates(template_key, channel, angle) on delete restrict,
  constraint commercial_outreach_items_channel_check check (channel in ('email', 'instagram')),
  constraint commercial_outreach_items_angle_check check (angle in ('A', 'B')),
  constraint commercial_outreach_items_state_check check (state in (
    'draft', 'generating', 'ready_for_review', 'approved_for_send',
    'queued_dry_run', 'cancelled', 'generation_failed',
    'sending', 'sent', 'delivery_failed'
  )),
  constraint commercial_outreach_items_facts_array_check check (jsonb_typeof(facts_used) = 'array'),
  constraint commercial_outreach_items_confidence_check check (confidence is null or confidence between 0 and 1),
  constraint commercial_outreach_items_attempts_check check (
    generation_attempt_count between 0 and max_generation_attempts and max_generation_attempts between 1 and 3
  ),
  constraint commercial_outreach_items_cancel_shape_check check (
    (state = 'cancelled' and cancelled_at is not null and cancellation_reason is not null)
    or
    (state <> 'cancelled' and cancelled_at is null and cancelled_by is null and cancellation_reason is null)
  ),
  constraint commercial_outreach_items_approval_shape_check check (
    (state in ('approved_for_send', 'queued_dry_run', 'sending', 'sent') and approved_by is not null and approved_at is not null)
    or
    (state not in ('approved_for_send', 'queued_dry_run', 'sending', 'sent'))
  ),
  constraint commercial_outreach_items_transport_forbidden_v1 check (state not in ('sending', 'sent', 'delivery_failed')),
  constraint commercial_outreach_items_idempotency_unique unique (idempotency_key)
);

create unique index commercial_outreach_one_active_path_v1_uidx
  on public.commercial_outreach_items (lead_id, campaign_id)
  where state <> 'cancelled';
create index commercial_outreach_review_queue_v1_idx
  on public.commercial_outreach_items (state, updated_at desc, id)
  where state in ('draft', 'generating', 'ready_for_review', 'generation_failed', 'queued_dry_run');
create index commercial_outreach_generation_claim_v1_idx
  on public.commercial_outreach_items (created_at, id)
  where state in ('draft', 'generation_failed');

create table public.commercial_outreach_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.commercial_outreach_items(id) on delete restrict,
  lead_id uuid not null references public.commercial_leads(id) on delete restrict,
  event_type text not null,
  actor_type text not null,
  actor_auth_user_id uuid null references auth.users(id) on delete restrict,
  idempotency_key text not null,
  metadata_safe jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint commercial_outreach_events_type_check check (event_type in (
    'item_created', 'generation_claimed', 'generation_ready', 'generation_failed',
    'message_edited', 'message_approved_dry_run', 'item_cancelled',
    'item_regenerated', 'selection_changed'
  )),
  constraint commercial_outreach_events_actor_check check (actor_type in ('system', 'commercial_owner')),
  constraint commercial_outreach_events_metadata_object_check check (jsonb_typeof(metadata_safe) = 'object'),
  constraint commercial_outreach_events_idempotency_unique unique (item_id, idempotency_key)
);

create index commercial_outreach_events_item_timeline_v1_idx
  on public.commercial_outreach_events (item_id, occurred_at desc, id desc);

create or replace function public.commercial_outreach_template_key_v1(p_channel text, p_angle text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(btrim(coalesce(p_channel, ''))) = 'instagram' and upper(btrim(coalesce(p_angle, ''))) = 'A' then 'IG_BEAUTY_ANGLE_A_V1'
    when lower(btrim(coalesce(p_channel, ''))) = 'instagram' and upper(btrim(coalesce(p_angle, ''))) = 'B' then 'IG_BEAUTY_ANGLE_B_V1'
    when lower(btrim(coalesce(p_channel, ''))) = 'email' and upper(btrim(coalesce(p_angle, ''))) = 'A' then 'EMAIL_BEAUTY_ANGLE_A_V1'
    when lower(btrim(coalesce(p_channel, ''))) = 'email' and upper(btrim(coalesce(p_angle, ''))) = 'B' then 'EMAIL_BEAUTY_ANGLE_B_V1'
    else null
  end
$$;

create or replace function public.commercial_outreach_payload_basic_valid_v1(
  p_channel text,
  p_subject text,
  p_body text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_body is not null
    and char_length(btrim(p_body)) between 20 and case when p_channel = 'instagram' then 900 else 2000 end
    and (
      (p_channel = 'instagram' and nullif(btrim(coalesce(p_subject, '')), '') is null)
      or
      (p_channel = 'email' and char_length(btrim(coalesce(p_subject, ''))) between 3 and 120)
    )
    and p_body !~* '(\{\{[^}]+\}\}|\[[[:space:]]*(name|business|city|company|insert|placeholder)[^]]*\]|<[^>]*(name|business|city|company)[^>]*>)'
    and coalesce(p_subject, '') !~* '(\{\{[^}]+\}\}|\[[[:space:]]*(name|business|city|company|insert|placeholder)[^]]*\]|<[^>]*(name|business|city|company)[^>]*>)'
    and p_body !~* '(system prompt|developer message|internal instruction|debug output|json payload|```|"(channel|angle|facts_used|confidence)"[[:space:]]*:)'
    and coalesce(p_subject, '') !~* '(system prompt|developer message|internal instruction|debug output|json payload|```|"(channel|angle|facts_used|confidence)"[[:space:]]*:)'
    and p_body !~* '(your (revenue|ad spend|customer count|growth rate)|you spend .* on ads|you have [0-9]+ customers|your owner)'
$$;

create or replace function public.commercial_outreach_touch_updated_at_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create or replace function public.commercial_outreach_prevent_event_mutation_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'commercial_outreach_events_are_append_only' using errcode = '42501';
end
$$;

create or replace function public.commercial_outreach_apply_template_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.qualification_status = 'approved' then
    new.template_version := public.commercial_outreach_template_key_v1(new.outreach_channel, new.message_angle);
    if new.template_version is null then
      raise exception 'commercial_outreach_channel_and_angle_required' using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;

create or replace function public.commercial_outreach_sync_lead_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_template_key text;
  v_item_id uuid;
begin
  if new.qualification_status = 'approved' and new.outreach_status in ('not_started', 'queued') then
    v_template_key := public.commercial_outreach_template_key_v1(new.outreach_channel, new.message_angle);
    if v_template_key is null then
      raise exception 'commercial_outreach_channel_and_angle_required' using errcode = '22023';
    end if;

    update public.commercial_outreach_items
    set state = 'cancelled', cancelled_at = now(), cancellation_reason = 'lead_selection_changed',
        generation_locked_at = null, generation_locked_by = null, version = version + 1
    where lead_id = new.id and campaign_id = new.campaign_id and state <> 'cancelled'
      and (channel <> new.outreach_channel or angle <> new.message_angle or template_key <> v_template_key);

    select id into v_item_id
    from public.commercial_outreach_items
    where lead_id = new.id and campaign_id = new.campaign_id and state <> 'cancelled'
    limit 1;

    if v_item_id is null then
      insert into public.commercial_outreach_items (
        lead_id, campaign_id, channel, angle, template_key, template_version, idempotency_key
      ) values (
        new.id, new.campaign_id, new.outreach_channel, new.message_angle, v_template_key, 'V1',
        'commercial-outreach:auto:' || new.id::text || ':' || new.version::text || ':' || lower(new.outreach_channel) || ':' || upper(new.message_angle)
      ) returning id into v_item_id;

      insert into public.commercial_outreach_events (
        item_id, lead_id, event_type, actor_type, actor_auth_user_id, idempotency_key, metadata_safe
      ) values (
        v_item_id, new.id, 'item_created', 'system', new.approved_by,
        'created:' || v_item_id::text,
        jsonb_build_object(
          'channel', new.outreach_channel,
          'angle', new.message_angle,
          'template_key', v_template_key,
          'delivery_enabled', false,
          'contract_version', 'commercial_outreach_orchestration_v1'
        )
      );
    end if;
  elsif new.qualification_status in ('rejected', 'not_qualified') or new.outreach_status = 'stopped' then
    update public.commercial_outreach_items
    set state = 'cancelled', cancelled_at = now(), cancellation_reason = 'lead_no_longer_eligible',
        generation_locked_at = null, generation_locked_by = null, version = version + 1
    where lead_id = new.id and campaign_id = new.campaign_id and state <> 'cancelled';
  end if;
  return new;
end
$$;

create trigger commercial_outreach_items_touch_updated_at
before update on public.commercial_outreach_items
for each row execute function public.commercial_outreach_touch_updated_at_v1();

create trigger commercial_outreach_events_append_only
before update or delete on public.commercial_outreach_events
for each row execute function public.commercial_outreach_prevent_event_mutation_v1();

-- The alphabetical prefix ensures template selection is applied before the
-- existing lead-state guard and touch triggers.
create trigger commercial_leads_a_outreach_template_v1
before insert or update
on public.commercial_leads
for each row execute function public.commercial_outreach_apply_template_v1();

create trigger commercial_leads_z_outreach_sync_v1
after insert or update
on public.commercial_leads
for each row execute function public.commercial_outreach_sync_lead_v1();

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

create or replace function public.complete_commercial_outreach_generation_v1(
  p_item_id uuid,
  p_worker_id text,
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
  v_subject text;
  v_body text;
  v_event_type text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'commercial_outreach_payload_must_be_object' using errcode = '22023';
  end if;

  select * into v_item from public.commercial_outreach_items where id = p_item_id for update;
  if not found then raise exception 'commercial_outreach_item_not_found' using errcode = 'P0002'; end if;
  if v_item.state <> 'generating' or v_item.generation_locked_by is distinct from nullif(btrim(p_worker_id), '') then
    raise exception 'commercial_outreach_generation_claim_mismatch' using errcode = '40001';
  end if;

  v_subject := nullif(btrim(p_payload->>'subject'), '');
  v_body := nullif(btrim(p_payload->>'body'), '');
  if p_success and (
    coalesce(array_length(p_validation_codes, 1), 0) <> 0
    or not public.commercial_outreach_payload_basic_valid_v1(v_item.channel, v_subject, v_body)
    or jsonb_typeof(coalesce(p_payload->'facts_used', '[]'::jsonb)) <> 'array'
  ) then
    raise exception 'commercial_outreach_generation_payload_invalid' using errcode = '22023';
  end if;

  if p_success then
    update public.commercial_outreach_items
    set state = 'ready_for_review', subject = v_subject, body = v_body,
        personalization_summary = nullif(btrim(p_payload->>'personalization_summary'), ''),
        facts_used = coalesce(p_payload->'facts_used', '[]'::jsonb),
        confidence = nullif(p_payload->>'confidence', '')::numeric,
        validation_codes = '{}'::text[], generation_model = nullif(btrim(p_payload->>'model'), ''),
        generation_prompt_version = nullif(btrim(p_payload->>'prompt_version'), ''),
        generated_at = now(), generation_locked_at = null, generation_locked_by = null,
        content_hash = nullif(btrim(p_payload->>'content_hash'), ''), version = version + 1
    where id = p_item_id returning * into v_item;
    v_event_type := 'generation_ready';
  else
    update public.commercial_outreach_items
    set state = 'generation_failed', validation_codes = coalesce(p_validation_codes, '{}'::text[]),
        generation_model = nullif(btrim(p_payload->>'model'), ''),
        generation_prompt_version = nullif(btrim(p_payload->>'prompt_version'), ''),
        generation_locked_at = null, generation_locked_by = null, version = version + 1
    where id = p_item_id returning * into v_item;
    v_event_type := 'generation_failed';
  end if;

  insert into public.commercial_outreach_events (
    item_id, lead_id, event_type, actor_type, idempotency_key, metadata_safe
  ) values (
    v_item.id, v_item.lead_id, v_event_type, 'system',
    v_event_type || ':' || v_item.generation_attempt_count::text,
    jsonb_build_object(
      'attempt', v_item.generation_attempt_count,
      'validation_codes', to_jsonb(coalesce(p_validation_codes, '{}'::text[])),
      'delivery_enabled', false,
      'contract_version', 'commercial_outreach_orchestration_v1'
    )
  ) on conflict (item_id, idempotency_key) do nothing;

  return jsonb_build_object('ok', true, 'item_id', v_item.id, 'state', v_item.state, 'version', v_item.version);
end
$$;

create or replace function public.mutate_commercial_outreach_item_v1(
  p_actor_user_id uuid,
  p_item_id uuid,
  p_action text,
  p_expected_version integer,
  p_idempotency_key text,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_item public.commercial_outreach_items%rowtype;
  v_lead public.commercial_leads%rowtype;
  v_existing public.commercial_outreach_events%rowtype;
  v_new_item_id uuid;
  v_channel text;
  v_angle text;
  v_template text;
  v_subject text;
  v_body text;
  v_event_type text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if not public.commercial_crm_actor_authorized_v1(p_actor_user_id) then
    raise exception 'commercial_crm_owner_access_required' using errcode = '42501';
  end if;
  if char_length(v_key) not between 1 and 200 or p_expected_version is null or p_expected_version < 1 then
    raise exception 'commercial_outreach_mutation_contract_invalid' using errcode = '22023';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'commercial_outreach_patch_must_be_object' using errcode = '22023';
  end if;

  select * into v_item from public.commercial_outreach_items where id = p_item_id for update;
  if not found then raise exception 'commercial_outreach_item_not_found' using errcode = 'P0002'; end if;

  select * into v_existing from public.commercial_outreach_events where item_id = p_item_id and idempotency_key = v_key;
  if found then
    return jsonb_build_object(
      'ok', true, 'idempotent_replay', true, 'item_id', v_item.id,
      'replacement_item_id', v_existing.metadata_safe->>'replacement_item_id',
      'state', v_item.state, 'version', v_item.version
    );
  end if;
  if v_item.version <> p_expected_version then
    raise exception 'commercial_outreach_stale_version' using errcode = '40001';
  end if;

  case v_action
    when 'approve_message' then
      if v_item.state <> 'ready_for_review' or coalesce(array_length(v_item.validation_codes, 1), 0) <> 0 then
        raise exception 'commercial_outreach_message_not_ready' using errcode = '22023';
      end if;
      update public.commercial_outreach_items
      set state = 'queued_dry_run', approved_by = p_actor_user_id, approved_at = now(), version = version + 1
      where id = p_item_id returning * into v_item;
      v_event_type := 'message_approved_dry_run';

    when 'cancel' then
      if v_item.state = 'cancelled' then raise exception 'commercial_outreach_already_cancelled' using errcode = '22023'; end if;
      update public.commercial_outreach_items
      set state = 'cancelled', cancelled_by = p_actor_user_id, cancelled_at = now(),
          cancellation_reason = coalesce(nullif(btrim(v_patch->>'reason'), ''), 'owner_cancelled'),
          generation_locked_at = null, generation_locked_by = null, version = version + 1
      where id = p_item_id returning * into v_item;
      v_event_type := 'item_cancelled';

    when 'edit_message' then
      if v_item.state <> 'ready_for_review' then raise exception 'commercial_outreach_edit_state_invalid' using errcode = '22023'; end if;
      v_subject := nullif(btrim(v_patch->>'subject'), '');
      v_body := nullif(btrim(v_patch->>'body'), '');
      if not public.commercial_outreach_payload_basic_valid_v1(v_item.channel, v_subject, v_body) then
        raise exception 'commercial_outreach_edited_payload_invalid' using errcode = '22023';
      end if;
      update public.commercial_outreach_items
      set subject = v_subject, body = v_body, owner_edited = true,
          content_hash = nullif(btrim(v_patch->>'content_hash'), ''), version = version + 1
      where id = p_item_id returning * into v_item;
      v_event_type := 'message_edited';

    when 'regenerate' then
      if v_item.state = 'cancelled' then raise exception 'commercial_outreach_regenerate_state_invalid' using errcode = '22023'; end if;
      update public.commercial_outreach_items
      set state = 'cancelled', cancelled_by = p_actor_user_id, cancelled_at = now(),
          cancellation_reason = 'owner_regenerate', generation_locked_at = null, generation_locked_by = null,
          version = version + 1
      where id = p_item_id returning * into v_item;
      insert into public.commercial_outreach_items (
        lead_id, campaign_id, channel, angle, template_key, template_version,
        supersedes_item_id, idempotency_key
      ) values (
        v_item.lead_id, v_item.campaign_id, v_item.channel, v_item.angle, v_item.template_key,
        v_item.template_version, v_item.id, 'commercial-outreach:regenerate:' || v_key
      ) returning id into v_new_item_id;
      v_event_type := 'item_regenerated';

    when 'change_selection' then
      if v_item.state = 'cancelled' then raise exception 'commercial_outreach_selection_state_invalid' using errcode = '22023'; end if;
      v_channel := lower(btrim(coalesce(v_patch->>'channel', '')));
      v_angle := upper(btrim(coalesce(v_patch->>'angle', '')));
      v_template := public.commercial_outreach_template_key_v1(v_channel, v_angle);
      if v_template is null then raise exception 'commercial_outreach_selection_invalid' using errcode = '22023'; end if;
      select * into v_lead from public.commercial_leads where id = v_item.lead_id for update;
      if v_lead.qualification_status <> 'approved' then raise exception 'commercial_outreach_lead_not_approved' using errcode = '22023'; end if;

      update public.commercial_outreach_items
      set state = 'cancelled', cancelled_by = p_actor_user_id, cancelled_at = now(),
          cancellation_reason = 'owner_changed_selection', generation_locked_at = null,
          generation_locked_by = null, version = version + 1
      where id = p_item_id returning * into v_item;

      update public.commercial_leads
      set outreach_channel = v_channel, message_angle = v_angle, template_version = v_template,
          version = version + 1
      where id = v_item.lead_id;

      select id into v_new_item_id
      from public.commercial_outreach_items
      where lead_id = v_item.lead_id and campaign_id = v_item.campaign_id and state <> 'cancelled'
      limit 1;
      v_event_type := 'selection_changed';

    else raise exception 'commercial_outreach_action_unknown' using errcode = '22023';
  end case;

  insert into public.commercial_outreach_events (
    item_id, lead_id, event_type, actor_type, actor_auth_user_id, idempotency_key, metadata_safe
  ) values (
    v_item.id, v_item.lead_id, v_event_type, 'commercial_owner', p_actor_user_id, v_key,
    jsonb_strip_nulls(jsonb_build_object(
      'action', v_action,
      'replacement_item_id', v_new_item_id,
      'delivery_enabled', false,
      'contract_version', 'commercial_outreach_orchestration_v1'
    ))
  );

  return jsonb_build_object(
    'ok', true, 'idempotent_replay', false, 'item_id', v_item.id,
    'replacement_item_id', v_new_item_id, 'state', v_item.state, 'version', v_item.version
  );
end
$$;

-- Materialize one and only one active dry-run path for every already approved
-- lead. The trigger owns all future approvals and selection changes.
insert into public.commercial_outreach_items (
  lead_id, campaign_id, channel, angle, template_key, template_version, idempotency_key
)
select
  l.id, l.campaign_id, l.outreach_channel, l.message_angle,
  public.commercial_outreach_template_key_v1(l.outreach_channel, l.message_angle), 'V1',
  'commercial-outreach:backfill:' || l.id::text
from public.commercial_leads l
where l.qualification_status = 'approved'
  and l.outreach_status in ('not_started', 'queued')
  and public.commercial_outreach_template_key_v1(l.outreach_channel, l.message_angle) is not null
  and not exists (
    select 1 from public.commercial_outreach_items oi
    where oi.lead_id = l.id and oi.campaign_id = l.campaign_id and oi.state <> 'cancelled'
  );

insert into public.commercial_outreach_events (
  item_id, lead_id, event_type, actor_type, actor_auth_user_id, idempotency_key, metadata_safe
)
select
  oi.id, oi.lead_id, 'item_created', 'system', l.approved_by, 'created:' || oi.id::text,
  jsonb_build_object(
    'channel', oi.channel, 'angle', oi.angle, 'template_key', oi.template_key,
    'backfill', true, 'delivery_enabled', false,
    'contract_version', 'commercial_outreach_orchestration_v1'
  )
from public.commercial_outreach_items oi
join public.commercial_leads l on l.id = oi.lead_id
where oi.idempotency_key like 'commercial-outreach:backfill:%'
on conflict (item_id, idempotency_key) do nothing;

alter table public.commercial_outreach_templates enable row level security;
alter table public.commercial_outreach_templates force row level security;
alter table public.commercial_outreach_items enable row level security;
alter table public.commercial_outreach_items force row level security;
alter table public.commercial_outreach_events enable row level security;
alter table public.commercial_outreach_events force row level security;

create policy commercial_outreach_templates_service_role_all on public.commercial_outreach_templates
  for all to service_role using (true) with check (true);
create policy commercial_outreach_items_service_role_all on public.commercial_outreach_items
  for all to service_role using (true) with check (true);
create policy commercial_outreach_events_service_role_all on public.commercial_outreach_events
  for all to service_role using (true) with check (true);

revoke all on table
  public.commercial_outreach_templates,
  public.commercial_outreach_items,
  public.commercial_outreach_events
from public, anon, authenticated;
grant select on table public.commercial_outreach_templates to service_role;
grant select, insert, update on table public.commercial_outreach_items to service_role;
grant select, insert on table public.commercial_outreach_events to service_role;

revoke all on function public.commercial_outreach_template_key_v1(text, text) from public, anon, authenticated;
revoke all on function public.commercial_outreach_payload_basic_valid_v1(text, text, text) from public, anon, authenticated;
revoke all on function public.claim_commercial_outreach_items_v1(integer, text) from public, anon, authenticated;
revoke all on function public.complete_commercial_outreach_generation_v1(uuid, text, boolean, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.mutate_commercial_outreach_item_v1(uuid, uuid, text, integer, text, jsonb) from public, anon, authenticated;

grant execute on function public.commercial_outreach_template_key_v1(text, text) to service_role;
grant execute on function public.commercial_outreach_payload_basic_valid_v1(text, text, text) to service_role;
grant execute on function public.claim_commercial_outreach_items_v1(integer, text) to service_role;
grant execute on function public.complete_commercial_outreach_generation_v1(uuid, text, boolean, jsonb, text[]) to service_role;
grant execute on function public.mutate_commercial_outreach_item_v1(uuid, uuid, text, integer, text, jsonb) to service_role;

comment on table public.commercial_outreach_items is
  'Owner-reviewed dry-run outreach queue. V1 transport states are forbidden by a check constraint.';
comment on function public.mutate_commercial_outreach_item_v1(uuid, uuid, text, integer, text, jsonb) is
  'Owner-only dry-run review mutations. Every action requires service role plus canonical commercial access grant.';

commit;
