-- Incident Detail + Human Review V1.
-- Scope: incident read model, audited operator lifecycle, and independent
-- Slack/Discord resolution delivery preparation. No Worker/runtime function is
-- changed and no notification is sent from SQL.

alter table public.account_incidents
  add column if not exists lifecycle_version bigint not null default 1,
  add column if not exists resolution_reason text,
  add column if not exists resolution_note text;

create table if not exists public.account_incident_review_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.account_incidents(id) on delete cascade,
  event_type text not null check (event_type in ('acknowledged', 'note_added', 'resolved', 'notification_retry')),
  previous_status text,
  new_status text,
  resolution_reason text,
  note text,
  actor_type text not null check (actor_type in ('admin', 'ops', 'system')),
  actor_id uuid,
  source text not null check (source in ('admin_dashboard', 'botapp_relay', 'system')),
  idempotency_key text not null,
  incident_version bigint not null,
  metadata_safe jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata_safe) = 'object' and not public.jsonb_has_forbidden_safe_metadata_key(metadata_safe)),
  created_at timestamptz not null default now(),
  unique (incident_id, idempotency_key)
);

create index if not exists account_incident_review_events_incident_created_idx
  on public.account_incident_review_events (incident_id, created_at desc);

alter table public.account_incident_review_events enable row level security;
revoke all on table public.account_incident_review_events from public, anon, authenticated;
grant select, insert on table public.account_incident_review_events to service_role;

create or replace function public.transition_account_incident_human_review_v1(
  p_incident_id uuid,
  p_action text,
  p_expected_version bigint,
  p_actor_type text,
  p_actor_id uuid,
  p_source text,
  p_note text,
  p_resolution_reason text,
  p_idempotency_key text,
  p_channel text default null,
  p_notification_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_incident public.account_incidents%rowtype;
  v_action text := lower(coalesce(nullif(trim(p_action), ''), ''));
  v_actor_type text := lower(coalesce(nullif(trim(p_actor_type), ''), 'ops'));
  v_source text := lower(coalesce(nullif(trim(p_source), ''), 'botapp_relay'));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_resolution_reason text := nullif(trim(coalesce(p_resolution_reason, '')), '');
  v_idempotency_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_channel text := lower(coalesce(nullif(trim(p_channel), ''), ''));
  v_event_id uuid := gen_random_uuid();
  v_event_type text;
  v_previous_status text;
  v_new_status text;
  v_version bigint;
  v_existing public.account_incident_review_events%rowtype;
  v_delivery public.account_incident_notifications%rowtype;
  v_linked_action_ids uuid[] := '{}'::uuid[];
  v_now timestamptz := now();
  v_channel_row record;
begin
  if p_incident_id is null or v_idempotency_key is null then
    raise exception 'incident_human_review_payload_invalid' using errcode = '22023';
  end if;
  if char_length(v_idempotency_key) > 180 then
    raise exception 'incident_human_review_idempotency_key_too_long' using errcode = '22023';
  end if;
  if v_action not in ('acknowledge', 'add_note', 'resolve', 'retry_notification') then
    raise exception 'incident_human_review_action_invalid' using errcode = '22023';
  end if;
  if v_actor_type not in ('admin', 'ops', 'system') then
    raise exception 'incident_human_review_actor_invalid' using errcode = '22023';
  end if;
  if v_source not in ('admin_dashboard', 'botapp_relay', 'system') then
    raise exception 'incident_human_review_source_invalid' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'incident_human_review_note_too_long' using errcode = '22023';
  end if;
  if v_resolution_reason is not null and char_length(v_resolution_reason) > 160 then
    raise exception 'incident_human_review_resolution_reason_too_long' using errcode = '22023';
  end if;

  select e.* into v_existing
  from public.account_incident_review_events e
  where e.incident_id = p_incident_id and e.idempotency_key = v_idempotency_key;

  if v_existing.id is not null then
    select i.* into v_incident from public.account_incidents i where i.id = p_incident_id;
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'event_id', v_existing.id,
      'incident_id', p_incident_id,
      'status', v_incident.status,
      'version', v_incident.lifecycle_version,
      'notification_ids', coalesce((
        select jsonb_agg(n.id order by n.channel)
        from public.account_incident_notifications n
        where n.metadata ->> 'human_review_event_id' = v_existing.id::text
      ), '[]'::jsonb)
    );
  end if;

  select i.* into v_incident
  from public.account_incidents i
  where i.id = p_incident_id and i.archived_at is null
  for update;

  if v_incident.id is null then
    raise exception 'incident_not_found' using errcode = 'P0002';
  end if;
  if p_expected_version is null or p_expected_version <> v_incident.lifecycle_version then
    raise exception 'incident_version_conflict' using errcode = '40001';
  end if;

  v_previous_status := v_incident.status;
  v_new_status := v_incident.status;
  v_version := v_incident.lifecycle_version;

  if v_action = 'acknowledge' then
    if v_incident.status <> 'open' then
      raise exception 'incident_acknowledge_conflict' using errcode = '40001';
    end if;
    v_event_type := 'acknowledged';
    v_new_status := 'acknowledged';
    v_version := v_version + 1;
    update public.account_incidents
    set status = 'acknowledged',
        acknowledged_at = coalesce(acknowledged_at, v_now),
        acknowledged_by = coalesce(p_actor_id, acknowledged_by),
        lifecycle_version = v_version,
        updated_at = v_now
    where id = p_incident_id;

    update public.account_dashboard_actions
    set status = case when status = 'pending' then 'acknowledged' else status end,
        acknowledged_at = coalesce(acknowledged_at, v_now),
        updated_at = v_now,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'last_transition', 'acknowledged',
          'transition_at', v_now,
          'actor_type', v_actor_type,
          'source', v_source
        )
    where incident_id = p_incident_id
      and status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted');

  elsif v_action = 'add_note' then
    if v_note is null then
      raise exception 'incident_note_required' using errcode = '22023';
    end if;
    v_event_type := 'note_added';

  elsif v_action = 'resolve' then
    if v_incident.status not in ('open', 'acknowledged') then
      raise exception 'incident_resolve_conflict' using errcode = '40001';
    end if;
    if v_resolution_reason is null then
      raise exception 'incident_resolution_reason_required' using errcode = '22023';
    end if;
    v_event_type := 'resolved';
    v_new_status := 'resolved';
    v_version := v_version + 1;
    update public.account_incidents
    set status = 'resolved',
        resolved_at = v_now,
        resolved_by = p_actor_id,
        resolution_reason = v_resolution_reason,
        resolution_note = v_note,
        lifecycle_version = v_version,
        updated_at = v_now
    where id = p_incident_id;

    update public.account_dashboard_actions
    set status = 'resolved',
        blocking_campaign = false,
        requires_client_action = false,
        resolved_at = coalesce(resolved_at, v_now),
        updated_at = v_now,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'last_transition', 'resolved',
          'transition_at', v_now,
          'actor_type', v_actor_type,
          'source', v_source,
          'reason', v_resolution_reason,
          'human_review_event_id', v_event_id::text
        ))
    where incident_id = p_incident_id
      and status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted');

    select coalesce(array_agg(a.id order by a.created_at), '{}'::uuid[])
      into v_linked_action_ids
    from public.account_dashboard_actions a
    where a.incident_id = p_incident_id and a.status = 'resolved';

  else
    if v_channel not in ('slack', 'discord') or p_notification_id is null then
      raise exception 'incident_notification_retry_payload_invalid' using errcode = '22023';
    end if;
    select n.* into v_delivery
    from public.account_incident_notifications n
    where n.id = p_notification_id
      and n.incident_id = p_incident_id
      and n.channel = v_channel
    for update;
    if v_delivery.id is null then
      raise exception 'incident_notification_not_found' using errcode = 'P0002';
    end if;
    if v_delivery.status <> 'failed' or v_delivery.attempt_count >= 3 then
      raise exception 'incident_notification_retry_conflict' using errcode = '40001';
    end if;
    v_event_type := 'notification_retry';
    update public.account_incident_notifications
    set status = 'pending',
        attempt_count = attempt_count + 1,
        last_attempt_at = v_now,
        last_error = null,
        response_status = null,
        response_body_preview = null,
        updated_at = v_now
    where id = v_delivery.id;
  end if;

  insert into public.account_incident_review_events (
    id, incident_id, event_type, previous_status, new_status,
    resolution_reason, note, actor_type, actor_id, source,
    idempotency_key, incident_version, metadata_safe, created_at
  ) values (
    v_event_id, p_incident_id, v_event_type, v_previous_status, v_new_status,
    v_resolution_reason, v_note, v_actor_type, p_actor_id, v_source,
    v_idempotency_key, v_version,
    jsonb_strip_nulls(jsonb_build_object(
      'channel', nullif(v_channel, ''),
      'notification_id', p_notification_id,
      'linked_action_ids', v_linked_action_ids
    )),
    v_now
  );

  if v_action = 'resolve' then
    for v_channel_row in
      select channel
      from public.incident_notification_channel_settings
      where channel in ('slack', 'discord') and enabled = true and configured = true
    loop
      insert into public.account_incident_notifications (
        incident_id, channel, status, target, delivery_key, attempt_count,
        payload, metadata, created_at, updated_at
      ) values (
        p_incident_id,
        v_channel_row.channel,
        'pending',
        'redacted',
        v_channel_row.channel || ':' || p_incident_id::text || ':human_review_resolved:' || v_event_id::text,
        0,
        jsonb_build_object(
          'notification_type', 'incident_human_review_resolved',
          'incident_id_short', left(p_incident_id::text, 8),
          'account_username', v_incident.account_username,
          'incident_type', v_incident.incident_type,
          'reason', coalesce(v_incident.reason, v_incident.failure_reason),
          'resolution_reason', v_resolution_reason,
          'operator_id_short', case when p_actor_id is null then null else left(p_actor_id::text, 8) end,
          'resolved_at', v_now
        ),
        jsonb_build_object(
          'human_review_event_id', v_event_id::text,
          'notification_type', 'incident_human_review_resolved',
          'redacted', true
        ),
        v_now,
        v_now
      ) on conflict (delivery_key) do nothing;
    end loop;
  end if;

  insert into public.ig_action_logs (
    account_id, run_id, target_username, action_type, status, message, payload, created_at
  ) values (
    v_incident.account_id,
    v_incident.run_id,
    null,
    'incident_human_review_' || v_event_type,
    'success',
    'incident_human_review_event_recorded',
    jsonb_strip_nulls(jsonb_build_object(
      'incident_id', p_incident_id,
      'event_id', v_event_id,
      'actor_type', v_actor_type,
      'actor_id', p_actor_id,
      'source', v_source,
      'previous_status', v_previous_status,
      'new_status', v_new_status,
      'resolution_reason', v_resolution_reason,
      'note_present', v_note is not null,
      'channel', nullif(v_channel, '')
    )),
    v_now
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'event_id', v_event_id,
    'incident_id', p_incident_id,
    'status', v_new_status,
    'version', v_version,
    'notification_ids', coalesce((
      select jsonb_agg(n.id order by n.channel)
      from public.account_incident_notifications n
      where n.metadata ->> 'human_review_event_id' = v_event_id::text
    ), case when p_notification_id is null then '[]'::jsonb else jsonb_build_array(p_notification_id) end)
  );
end
$$;

revoke all on function public.transition_account_incident_human_review_v1(
  uuid, text, bigint, text, uuid, text, text, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.transition_account_incident_human_review_v1(
  uuid, text, bigint, text, uuid, text, text, text, text, text, uuid
) to service_role;
