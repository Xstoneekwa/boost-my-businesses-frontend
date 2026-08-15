begin;

create or replace function public.refresh_commercial_discovery_run_v2(p_run_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_run public.commercial_discovery_runs%rowtype; v_active integer; v_selected integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select count(*) filter (where selected_for_processing), count(*) filter (where selected_for_processing and status in ('pending','processing','retry_scheduled'))
    into v_selected, v_active from public.commercial_discovery_items where run_id = p_run_id;
  update public.commercial_discovery_runs r set
    precheck_rejected_count = (select count(*) from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.precheck_decision = 'PRECHECK_REJECT'),
    enriched_count = (select count(*) from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.enriched_at is not null),
    ai_pending_count = (select count(*) from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.stage in ('ENRICHED','AI_PENDING') and i.status in ('pending','processing','retry_scheduled')),
    scored_count = (select count(*) from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.analysis_snapshot_safe <> '{}'::jsonb),
    created_count = (select count(*) from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.status = 'completed' and i.lead_id is not null),
    duplicate_count = (select count(*) from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.status in ('duplicate','possible_duplicate','excluded_client')),
    hard_rejected_count = (select count(*) from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.status = 'rejected'),
    error_count = (select count(*) from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.status = 'failed'),
    qualified_count = (select count(*) from public.commercial_discovery_items i join public.commercial_leads l on l.id = i.lead_id where i.run_id = r.id and i.selected_for_processing and i.status = 'completed' and l.qualification_status = 'qualified'),
    p1_count = (select count(*) from public.commercial_discovery_items i join public.commercial_leads l on l.id = i.lead_id where i.run_id = r.id and i.selected_for_processing and i.status = 'completed' and l.score_priority = 'P1'),
    p2_count = (select count(*) from public.commercial_discovery_items i join public.commercial_leads l on l.id = i.lead_id where i.run_id = r.id and i.selected_for_processing and i.status = 'completed' and l.score_priority = 'P2'),
    p3_count = (select count(*) from public.commercial_discovery_items i join public.commercial_leads l on l.id = i.lead_id where i.run_id = r.id and i.selected_for_processing and i.status = 'completed' and l.score_priority = 'P3'),
    status = case when r.status = 'cancelled' then r.status when r.discovery_status = 'failed' then 'failed'
      when r.discovery_status = 'completed' and v_selected > 0 and v_active = 0 then
        case when exists (select 1 from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.status = 'failed') then 'completed_with_errors' else 'completed' end
      else 'running' end,
    completed_at = case when r.status <> 'cancelled' and r.discovery_status = 'completed' and v_selected > 0 and v_active = 0 then coalesce(r.completed_at, now()) else r.completed_at end,
    worker_locked_at = null, worker_locked_by = null
  where r.id = p_run_id returning * into v_run;
  if not found then raise exception 'commercial_discovery_run_not_found' using errcode = 'P0002'; end if;
  return to_jsonb(v_run);
end $$;

update public.commercial_discovery_runs r set
  qualified_count = (select count(*) from public.commercial_discovery_items i join public.commercial_leads l on l.id = i.lead_id where i.run_id = r.id and i.selected_for_processing and i.status = 'completed' and l.qualification_status = 'qualified'),
  p1_count = (select count(*) from public.commercial_discovery_items i join public.commercial_leads l on l.id = i.lead_id where i.run_id = r.id and i.selected_for_processing and i.status = 'completed' and l.score_priority = 'P1'),
  p2_count = (select count(*) from public.commercial_discovery_items i join public.commercial_leads l on l.id = i.lead_id where i.run_id = r.id and i.selected_for_processing and i.status = 'completed' and l.score_priority = 'P2'),
  p3_count = (select count(*) from public.commercial_discovery_items i join public.commercial_leads l on l.id = i.lead_id where i.run_id = r.id and i.selected_for_processing and i.status = 'completed' and l.score_priority = 'P3');

revoke all on function public.refresh_commercial_discovery_run_v2(uuid) from public, anon, authenticated;
grant execute on function public.refresh_commercial_discovery_run_v2(uuid) to service_role;

commit;
