do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'ct_target_evaluation_events',
    'ct_target_evaluated_profiles',
    'ct_target_performance_observations',
    'ct_target_performance_aggregates',
    'ct_target_lifecycle_assessments',
    'ct_target_lifecycle_current',
    'ct_targeting_criteria_snapshots',
    'ct_proposal_batches',
    'ct_proposals',
    'ct_proposal_events',
    'ct_target_replacement_links',
    'ct_email_contract_references'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
  end loop;
end
$$;

create policy ct_target_evaluation_events_service_role_all
  on public.ct_target_evaluation_events to service_role using (true) with check (true);
create policy ct_target_evaluated_profiles_service_role_all
  on public.ct_target_evaluated_profiles to service_role using (true) with check (true);
create policy ct_target_performance_observations_service_role_all
  on public.ct_target_performance_observations to service_role using (true) with check (true);
create policy ct_target_performance_aggregates_service_role_all
  on public.ct_target_performance_aggregates to service_role using (true) with check (true);
create policy ct_target_lifecycle_assessments_service_role_all
  on public.ct_target_lifecycle_assessments to service_role using (true) with check (true);
create policy ct_target_lifecycle_current_service_role_all
  on public.ct_target_lifecycle_current to service_role using (true) with check (true);
create policy ct_targeting_criteria_snapshots_service_role_all
  on public.ct_targeting_criteria_snapshots to service_role using (true) with check (true);
create policy ct_proposal_batches_service_role_all
  on public.ct_proposal_batches to service_role using (true) with check (true);
create policy ct_proposals_service_role_all
  on public.ct_proposals to service_role using (true) with check (true);
create policy ct_proposal_events_service_role_all
  on public.ct_proposal_events to service_role using (true) with check (true);
create policy ct_target_replacement_links_service_role_all
  on public.ct_target_replacement_links to service_role using (true) with check (true);
create policy ct_email_contract_references_service_role_all
  on public.ct_email_contract_references to service_role using (true) with check (true);

grant select, insert on public.ct_target_evaluation_events to service_role;
grant select, insert on public.ct_target_evaluated_profiles to service_role;
grant select, insert on public.ct_target_performance_observations to service_role;
grant select, insert, update on public.ct_target_performance_aggregates to service_role;
grant select, insert on public.ct_target_lifecycle_assessments to service_role;
grant select, insert, update on public.ct_target_lifecycle_current to service_role;
grant select, insert on public.ct_targeting_criteria_snapshots to service_role;
grant select, insert, update on public.ct_proposal_batches to service_role;
grant select, insert, update on public.ct_proposals to service_role;
grant select, insert on public.ct_proposal_events to service_role;
grant select, insert, update on public.ct_target_replacement_links to service_role;
grant select on public.ct_email_contract_references to service_role;
revoke all on public.ct_target_lifecycle_stock_v1 from public, anon, authenticated;
grant select on public.ct_target_lifecycle_stock_v1 to service_role;

revoke all on function public.ct_reject_append_only_mutation_v1() from public, anon, authenticated;
grant execute on function public.ct_reject_append_only_mutation_v1() to service_role;

revoke update (action_required, action_completed_at, action_outcome, action_ref_type, action_ref_id)
  on public.client_account_notifications from public, anon, authenticated;
grant update (action_required, action_completed_at, action_outcome, action_ref_type, action_ref_id)
  on public.client_account_notifications to service_role;
