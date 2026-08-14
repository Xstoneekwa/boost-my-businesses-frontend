begin;

-- Keep historical lead_review_updated events valid in the append-only ledger.
revoke all on function public.review_commercial_lead_v1(uuid, uuid, text, integer, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.commercial_review_queue_read_model_v1(jsonb, integer, integer)
  from public, anon, authenticated, service_role;
drop function if exists public.review_commercial_lead_v1(uuid, uuid, text, integer, text, jsonb);
drop function if exists public.commercial_review_queue_read_model_v1(jsonb, integer, integer);
drop index if exists public.commercial_leads_review_queue_v1_idx;
drop index if exists public.commercial_leads_ready_outreach_v1_idx;
alter table public.commercial_leads drop constraint if exists commercial_leads_message_angle_check;

commit;
