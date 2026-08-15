begin;

do $$
begin
  if exists (select 1 from public.commercial_discovery_runs)
     or exists (select 1 from public.commercial_discovery_items)
     or exists (select 1 from public.commercial_business_identifiers)
     or exists (select 1 from public.commercial_leads where scoring_model_version = 'BMB_SCORING_MODEL_V1') then
    raise exception 'commercial_discovery_rollback_refuses_nonempty_runtime_data';
  end if;
end
$$;

drop function if exists public.commercial_discovery_run_read_model_v1(integer);
drop function if exists public.finalize_commercial_discovery_run_v1(uuid, text, jsonb, jsonb, jsonb);
drop function if exists public.ingest_commercial_discovery_candidate_v1(uuid, jsonb, text);
drop function if exists public.claim_commercial_discovery_run_v1(uuid);
drop function if exists public.preflight_commercial_discovery_candidate_v1(uuid, text, text, text, text, text);
drop function if exists public.create_commercial_discovery_run_v1(uuid, text, text, integer, text);

drop table public.commercial_business_identifiers;
drop table public.commercial_discovery_items;
drop table public.commercial_discovery_runs;

delete from public.commercial_campaigns where campaign_code = 'BMB_ZA_BEAUTY_V1';

alter table public.commercial_leads
  drop constraint commercial_leads_score_breakdown_v1_check,
  drop constraint commercial_leads_ai_confidence_v1_check,
  drop constraint commercial_leads_score_priority_v1_check,
  drop constraint commercial_leads_lead_score_v1_check,
  drop column source_snapshot_hash,
  drop column hard_gate_codes,
  drop column needs_manual_review,
  drop column scored_at,
  drop column ai_prompt_version,
  drop column ai_model,
  drop column ai_confidence,
  drop column score_breakdown_safe,
  drop column scoring_model_version,
  drop column score_priority,
  drop column lead_score;

alter table public.commercial_businesses
  drop constraint commercial_businesses_enrichment_objects_v1_check,
  drop constraint commercial_businesses_status_v1_check,
  drop column last_enriched_at,
  drop column enrichment_provenance_safe,
  drop column enrichment_snapshot_safe,
  drop column business_status,
  drop column booking_url,
  drop column business_description;

alter table public.commercial_events drop constraint commercial_events_event_type_check;
alter table public.commercial_events add constraint commercial_events_event_type_check
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

commit;
