begin;

drop function if exists public.commercial_dashboard_read_model_v1(jsonb, integer, integer);
drop index if exists public.commercial_leads_created_dashboard_idx;
drop index if exists public.commercial_leads_updated_dashboard_idx;

commit;
