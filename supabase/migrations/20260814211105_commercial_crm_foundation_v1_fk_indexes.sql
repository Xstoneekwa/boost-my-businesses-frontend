begin;

-- Canonical remote migration version: 20260814211105.
-- Cover every Commercial CRM V1 foreign key reported by the Supabase
-- performance advisor. This forward-fix is index-only and changes no data,
-- permissions, policies, state contracts, or runtime behavior.

create index commercial_internal_access_grants_granted_by_idx
  on public.internal_access_grants (granted_by);

create index commercial_campaigns_created_by_idx
  on public.commercial_campaigns (created_by);
create index commercial_campaigns_updated_by_idx
  on public.commercial_campaigns (updated_by);

create index commercial_leads_primary_contact_business_idx
  on public.commercial_leads (primary_contact_id, business_id);
create index commercial_leads_approved_by_idx
  on public.commercial_leads (approved_by);

create index commercial_events_actor_auth_user_idx
  on public.commercial_events (actor_auth_user_id);

create index commercial_conversions_checkout_session_idx
  on public.commercial_conversions (checkout_session_id);
create index commercial_conversions_entitlement_idx
  on public.commercial_conversions (entitlement_id);
create index commercial_conversions_stripe_billing_profile_idx
  on public.commercial_conversions (stripe_billing_profile_id);
create index commercial_conversions_stripe_subscription_idx
  on public.commercial_conversions (stripe_subscription_id);
create index commercial_conversions_converted_by_idx
  on public.commercial_conversions (converted_by);

commit;
