-- Count both canonical Follow persistence event names without replacing any
-- other part of the live account_package_summary projection.
do $migration$
declare
  v_definition text;
  v_updated_definition text;
  v_old_predicate constant text :=
    $$ig_interaction_events.event_type = 'follow_verified'::text$$;
  v_new_predicate constant text :=
    $$ig_interaction_events.event_type = ANY (ARRAY['follow_verified'::text, 'follow_verified_persisted_v1'::text])$$;
  v_old_predicate_count integer;
begin
  select pg_get_viewdef('public.account_package_summary'::regclass, true)
    into strict v_definition;

  v_old_predicate_count := (
    length(v_definition) - length(replace(v_definition, v_old_predicate, ''))
  ) / length(v_old_predicate);

  if v_old_predicate_count = 0
     and position('follow_verified_persisted_v1' in v_definition) > 0 then
    return;
  end if;

  if v_old_predicate_count <> 1 then
    raise exception
      'account_package_summary warmup predicate drift: expected 1 legacy predicate, found %',
      v_old_predicate_count;
  end if;

  v_updated_definition := replace(
    v_definition,
    v_old_predicate,
    v_new_predicate
  );

  execute
    'create or replace view public.account_package_summary '
    'with (security_invoker = true) as '
    || v_updated_definition;
end
$migration$;

create index if not exists ig_interaction_events_follow_verified_activity_v2_idx
  on public.ig_interaction_events (account_id, event_at)
  where interaction_type = 'follow'
    and interaction_status = 'success'
    and event_type in ('follow_verified', 'follow_verified_persisted_v1')
    and run_id is not null;

comment on view public.account_package_summary is
  'Commercial package defaults, maxima and effective caps. Follow warmup day counts prior distinct SAST dates with a successful run-bound follow_verified or follow_verified_persisted_v1 event; package_started_at is metadata only.';
