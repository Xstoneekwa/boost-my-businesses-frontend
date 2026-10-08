-- Notification Router V2 incident resolution context.
-- Provider-safe business fields only; technical payloads remain internal.

create or replace function public.suppress_legacy_incident_resolution_delivery_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.metadata ->> 'notification_type', '') = 'incident_human_review_resolved' then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists suppress_legacy_incident_resolution_delivery_v1
  on public.account_incident_notifications;
create trigger suppress_legacy_incident_resolution_delivery_v1
before insert on public.account_incident_notifications
for each row execute function public.suppress_legacy_incident_resolution_delivery_v1();

create or replace function public.notification_router_general_incident_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  combined_reason text := lower(coalesce(new.reason, '') || ' ' || coalesce(new.failure_reason, '') || ' ' || coalesce(new.incident_type, ''));
  dashboard_url text := 'https://www.boostmybusinesses.com/instagram-dashboard/incidents?incident_id=' || new.id::text;
begin
  if lower(new.incident_type) like '%login%'
    or combined_reason ~ '(password|challenge|identity|checkpoint|device.*login|provision)'
  then return new; end if;

  if new.status in ('resolved','ignored') then
    perform public.emit_notification_business_event_v2(
      'incident.resolved:' || new.id::text || ':' || new.lifecycle_version::text,
      'incident', case when new.metadata->>'environment' = 'test' then 'test' else 'live' end,
      'incident.resolved', new.account_id, new.client_id, null,
      jsonb_strip_nulls(jsonb_build_object(
        'username', coalesce('@' || trim(leading '@' from new.account_username), '@non-renseigné'),
        'summary', 'La situation signalée a été traitée.',
        'resolutionNote', nullif(left(trim(coalesce(new.resolution_note, '')), 500), ''),
        'resolutionReason', nullif(left(trim(coalesce(new.resolution_reason, '')), 160), ''),
        'resolvedAt', new.resolved_at,
        'operatorId', new.resolved_by,
        'dashboardUrl', dashboard_url
      )),
      jsonb_build_object('incident_id', new.id, 'incident_type', new.incident_type),
      coalesce(new.resolved_at, new.last_seen_at, now())
    );
    return new;
  end if;
  if new.status not in ('open','acknowledged') then return new; end if;

  perform public.emit_notification_business_event_v2(
    'incident.opened:' || new.id::text || ':' || new.lifecycle_version::text,
    'incident', case when new.metadata->>'environment' = 'test' then 'test' else 'live' end,
    'incident.opened', new.account_id, new.client_id, null,
    jsonb_build_object(
      'username', coalesce('@' || trim(leading '@' from new.account_username), '@non-renseigné'),
      'summary', coalesce(new.safe_client_message, 'Une vérification opérationnelle est nécessaire.'),
      'action', coalesce(new.action_required, 'Consulter BotApp.'),
      'dashboardUrl', dashboard_url
    ),
    jsonb_build_object('incident_id', new.id, 'incident_type', new.incident_type),
    coalesce(new.last_seen_at, new.created_at)
  );
  return new;
end;
$$;

revoke all on function public.notification_router_general_incident_v2()
  from public, anon, authenticated;
revoke all on function public.suppress_legacy_incident_resolution_delivery_v1()
  from public, anon, authenticated;
