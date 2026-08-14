begin;

-- Rollback for canonical remote migration version 20260814210447.
-- Operational rollback is intentionally explicit and must only be run after
-- confirming there is no Commercial CRM data that needs preservation.
drop function if exists public.transition_commercial_lead_v1(
  uuid, uuid, text, text, jsonb, uuid, uuid, uuid, uuid, uuid, text
);
drop function if exists public.commercial_crm_actor_authorized_v1(uuid);

drop table if exists public.commercial_conversions;
drop table if exists public.commercial_events;
drop table if exists public.commercial_leads;
drop table if exists public.commercial_contacts;
drop table if exists public.commercial_businesses;
drop table if exists public.commercial_campaigns;
drop table if exists public.internal_access_grants;

drop function if exists public.commercial_crm_prevent_event_mutation_v1();
drop function if exists public.commercial_crm_guard_lead_state_v1();
drop function if exists public.commercial_crm_normalize_contact_v1();
drop function if exists public.commercial_crm_normalize_business_v1();
drop function if exists public.commercial_crm_touch_updated_at_v1();

commit;
