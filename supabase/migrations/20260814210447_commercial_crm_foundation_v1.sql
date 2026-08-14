begin;

-- BMB Commercial CRM Foundation V1 (canonical remote migration version 20260814210447).
-- Founder-only, server-side data plane. Browser roles receive no table or RPC
-- privileges; backend calls must first resolve a real Supabase Auth user, then
-- prove both the canonical superadmin role and an active explicit grant.

create table public.internal_access_grants (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  permission_key text not null,
  active boolean not null default true,
  granted_by uuid null references auth.users(id) on delete set null,
  revoked_at timestamptz null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint internal_access_grants_permission_key_check
    check (permission_key = btrim(permission_key) and permission_key ~ '^[a-z][a-z0-9_]{2,79}$'),
  constraint internal_access_grants_metadata_object_check
    check (jsonb_typeof(metadata_safe) = 'object'),
  constraint internal_access_grants_active_revocation_check
    check ((active and revoked_at is null) or (not active and revoked_at is not null)),
  constraint internal_access_grants_user_permission_unique
    unique (auth_user_id, permission_key)
);

create index internal_access_grants_active_permission_user_idx
  on public.internal_access_grants (permission_key, auth_user_id)
  where active and revoked_at is null;

create table public.commercial_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_code text not null unique,
  name text not null,
  country_code text not null,
  city_scope text[] not null default '{}'::text[],
  geography jsonb not null default '{}'::jsonb,
  vertical text not null,
  status text not null default 'draft',
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_campaigns_code_check
    check (campaign_code = upper(btrim(campaign_code)) and campaign_code ~ '^[A-Z0-9][A-Z0-9_-]{2,79}$'),
  constraint commercial_campaigns_name_check check (char_length(btrim(name)) between 1 and 160),
  constraint commercial_campaigns_country_check check (country_code ~ '^[A-Z]{2}$'),
  constraint commercial_campaigns_vertical_check check (char_length(btrim(vertical)) between 1 and 100),
  constraint commercial_campaigns_status_check
    check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
  constraint commercial_campaigns_geography_object_check check (jsonb_typeof(geography) = 'object'),
  constraint commercial_campaigns_metadata_object_check check (jsonb_typeof(metadata_safe) = 'object')
);

create index commercial_campaigns_status_updated_idx
  on public.commercial_campaigns (status, updated_at desc);

create table public.commercial_businesses (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  country_code text not null,
  city text null,
  vertical text not null,
  subsegment text null,
  website text null,
  website_domain_normalized text null,
  instagram_handle text null,
  instagram_handle_normalized text null,
  phone text null,
  email text null,
  address_safe text null,
  source text not null default 'manual',
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_businesses_name_check check (char_length(btrim(business_name)) between 1 and 200),
  constraint commercial_businesses_country_check check (country_code ~ '^[A-Z]{2}$'),
  constraint commercial_businesses_vertical_check check (char_length(btrim(vertical)) between 1 and 100),
  constraint commercial_businesses_source_check check (char_length(btrim(source)) between 1 and 80),
  constraint commercial_businesses_metadata_object_check check (jsonb_typeof(metadata_safe) = 'object')
);

create unique index commercial_businesses_website_domain_uidx
  on public.commercial_businesses (website_domain_normalized)
  where website_domain_normalized is not null;
create unique index commercial_businesses_instagram_handle_uidx
  on public.commercial_businesses (instagram_handle_normalized)
  where instagram_handle_normalized is not null;
create index commercial_businesses_geography_idx
  on public.commercial_businesses (country_code, city, vertical, subsegment);

create table public.commercial_contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.commercial_businesses(id) on delete cascade,
  full_name text null,
  job_title text null,
  email text null,
  email_normalized text null,
  instagram_handle text null,
  instagram_handle_normalized text null,
  phone text null,
  phone_normalized text null,
  preferred_channel text null,
  is_primary boolean not null default false,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_contacts_identity_present_check
    check (email is not null or instagram_handle is not null or phone is not null),
  constraint commercial_contacts_preferred_channel_check
    check (preferred_channel is null or preferred_channel in ('email', 'instagram', 'phone')),
  constraint commercial_contacts_metadata_object_check check (jsonb_typeof(metadata_safe) = 'object'),
  constraint commercial_contacts_id_business_unique unique (id, business_id)
);

create unique index commercial_contacts_business_email_uidx
  on public.commercial_contacts (business_id, email_normalized)
  where email_normalized is not null;
create unique index commercial_contacts_business_instagram_uidx
  on public.commercial_contacts (business_id, instagram_handle_normalized)
  where instagram_handle_normalized is not null;
create unique index commercial_contacts_business_phone_uidx
  on public.commercial_contacts (business_id, phone_normalized)
  where phone_normalized is not null;
create unique index commercial_contacts_one_primary_per_business_uidx
  on public.commercial_contacts (business_id)
  where is_primary;

create table public.commercial_leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.commercial_campaigns(id) on delete restrict,
  business_id uuid not null references public.commercial_businesses(id) on delete restrict,
  primary_contact_id uuid null,
  qualification_status text not null default 'discovered',
  outreach_status text not null default 'not_started',
  sales_status text not null default 'not_started',
  score smallint null,
  priority text not null default 'normal',
  city_snapshot text null,
  subsegment_snapshot text null,
  outreach_channel text null,
  message_angle text null,
  template_version text null,
  personalization_context_safe jsonb not null default '{}'::jsonb,
  audience_context_safe jsonb not null default '{}'::jsonb,
  approved_by uuid null references auth.users(id) on delete restrict,
  approved_at timestamptz null,
  sales_owner_auth_user_id uuid null references auth.users(id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_leads_campaign_business_unique unique (campaign_id, business_id),
  constraint commercial_leads_contact_business_fkey
    foreign key (primary_contact_id, business_id)
    references public.commercial_contacts(id, business_id) on delete restrict,
  constraint commercial_leads_qualification_status_check
    check (qualification_status in ('discovered', 'enriched', 'qualified', 'approved', 'rejected', 'not_qualified')),
  constraint commercial_leads_outreach_status_check
    check (outreach_status in ('not_started', 'queued', 'contacted', 'replied', 'no_response', 'stopped')),
  constraint commercial_leads_sales_status_check
    check (sales_status in ('not_started', 'sales_qualified', 'demo_booked', 'demo_done', 'checkout_sent', 'paid', 'lost', 'onboarding', 'active_client')),
  constraint commercial_leads_score_check check (score is null or score between 0 and 100),
  constraint commercial_leads_priority_check check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint commercial_leads_outreach_channel_check
    check (outreach_channel is null or outreach_channel in ('email', 'instagram')),
  constraint commercial_leads_context_objects_check
    check (jsonb_typeof(personalization_context_safe) = 'object' and jsonb_typeof(audience_context_safe) = 'object'),
  constraint commercial_leads_approval_shape_check
    check (
      (qualification_status = 'approved' and approved_by is not null and approved_at is not null)
      or
      (qualification_status <> 'approved' and approved_by is null and approved_at is null)
    ),
  constraint commercial_leads_state_coherence_check
    check (
      (outreach_status in ('not_started', 'stopped') or qualification_status = 'approved')
      and
      (sales_status in ('not_started', 'lost') or (qualification_status = 'approved' and outreach_status = 'replied'))
    )
);

create index commercial_leads_campaign_pipeline_idx
  on public.commercial_leads (campaign_id, qualification_status, outreach_status, sales_status);
create index commercial_leads_business_idx on public.commercial_leads (business_id);
create index commercial_leads_sales_owner_idx
  on public.commercial_leads (sales_owner_auth_user_id, sales_status)
  where sales_owner_auth_user_id is not null;

create table public.commercial_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.commercial_leads(id) on delete restrict,
  event_type text not null,
  actor_type text not null,
  actor_auth_user_id uuid null references auth.users(id) on delete restrict,
  idempotency_key text not null,
  metadata_safe jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint commercial_events_event_type_check
    check (event_type in (
      'lead_created', 'lead_approved', 'lead_rejected', 'outreach_queued',
      'outreach_contacted', 'outreach_response_received', 'outreach_no_response',
      'outreach_stopped', 'sales_qualified', 'demo_booked', 'demo_done',
      'checkout_sent', 'payment_succeeded', 'sales_lost', 'onboarding_started',
      'client_activated', 'lead_discovered', 'lead_enriched', 'lead_scored',
      'outreach_sent', 'response_received', 'response_classified', 'sales_handoff',
      'payment_failed', 'lead_lost', 'active_client'
    )),
  constraint commercial_events_actor_type_check
    check (actor_type in ('commercial_owner', 'system', 'automation', 'sales')),
  constraint commercial_events_idempotency_key_check
    check (char_length(btrim(idempotency_key)) between 1 and 200),
  constraint commercial_events_metadata_object_check check (jsonb_typeof(metadata_safe) = 'object'),
  constraint commercial_events_lead_idempotency_unique unique (lead_id, idempotency_key)
);

create index commercial_events_lead_time_idx
  on public.commercial_events (lead_id, occurred_at desc, id desc);
create index commercial_events_type_time_idx
  on public.commercial_events (event_type, occurred_at desc);

create table public.commercial_conversions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.commercial_leads(id) on delete restrict,
  business_id uuid not null references public.commercial_businesses(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  checkout_session_id uuid null references public.commercial_checkout_sessions(id) on delete set null,
  entitlement_id uuid null references public.client_account_entitlements(id) on delete set null,
  stripe_billing_profile_id uuid null references public.commercial_stripe_billing_profiles(id) on delete set null,
  stripe_subscription_id uuid null references public.commercial_stripe_subscriptions(id) on delete set null,
  package_reference text null,
  converted_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null unique,
  attribution_snapshot_safe jsonb not null default '{}'::jsonb,
  metadata_safe jsonb not null default '{}'::jsonb,
  converted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint commercial_conversions_idempotency_key_check
    check (char_length(btrim(idempotency_key)) between 1 and 200),
  constraint commercial_conversions_attribution_object_check check (jsonb_typeof(attribution_snapshot_safe) = 'object'),
  constraint commercial_conversions_metadata_object_check check (jsonb_typeof(metadata_safe) = 'object')
);

create index commercial_conversions_client_idx on public.commercial_conversions (client_id, converted_at desc);
create index commercial_conversions_business_idx on public.commercial_conversions (business_id);

create or replace function public.commercial_crm_touch_updated_at_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create or replace function public.commercial_crm_normalize_business_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_domain text;
begin
  new.business_name := btrim(new.business_name);
  new.country_code := upper(btrim(new.country_code));
  new.city := nullif(btrim(new.city), '');
  new.vertical := btrim(new.vertical);
  new.subsegment := nullif(btrim(new.subsegment), '');
  new.website := nullif(btrim(new.website), '');
  new.instagram_handle := nullif(btrim(new.instagram_handle), '');
  new.email := nullif(lower(btrim(new.email)), '');
  new.phone := nullif(btrim(new.phone), '');

  if new.website is null then
    new.website_domain_normalized := null;
  else
    v_domain := lower(regexp_replace(new.website, '^[a-z][a-z0-9+.-]*://', '', 'i'));
    v_domain := regexp_replace(v_domain, '^www\.', '', 'i');
    new.website_domain_normalized := nullif(regexp_replace(v_domain, '[/?:#].*$', ''), '');
  end if;

  new.instagram_handle_normalized := nullif(
    lower(regexp_replace(coalesce(new.instagram_handle, ''), '^@+', '')),
    ''
  );
  return new;
end
$$;

create or replace function public.commercial_crm_normalize_contact_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.full_name := nullif(btrim(new.full_name), '');
  new.job_title := nullif(btrim(new.job_title), '');
  new.email := nullif(lower(btrim(new.email)), '');
  new.email_normalized := new.email;
  new.instagram_handle := nullif(btrim(new.instagram_handle), '');
  new.instagram_handle_normalized := nullif(
    lower(regexp_replace(coalesce(new.instagram_handle, ''), '^@+', '')),
    ''
  );
  new.phone := nullif(btrim(new.phone), '');
  new.phone_normalized := nullif(regexp_replace(coalesce(new.phone, ''), '[^0-9+]', '', 'g'), '');
  return new;
end
$$;

create or replace function public.commercial_crm_guard_lead_state_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    new.qualification_status is distinct from old.qualification_status
    or new.outreach_status is distinct from old.outreach_status
    or new.sales_status is distinct from old.sales_status
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
  ) and coalesce(current_setting('app.commercial_crm_transition_v1', true), '') <> 'on' then
    raise exception 'commercial_lead_state_requires_atomic_transition' using errcode = '42501';
  end if;
  return new;
end
$$;

create or replace function public.commercial_crm_prevent_event_mutation_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'commercial_events_are_append_only' using errcode = '42501';
end
$$;

create trigger commercial_campaigns_touch_updated_at
before update on public.commercial_campaigns
for each row execute function public.commercial_crm_touch_updated_at_v1();

create trigger internal_access_grants_touch_updated_at
before update on public.internal_access_grants
for each row execute function public.commercial_crm_touch_updated_at_v1();

create trigger commercial_businesses_normalize
before insert or update on public.commercial_businesses
for each row execute function public.commercial_crm_normalize_business_v1();
create trigger commercial_businesses_touch_updated_at
before update on public.commercial_businesses
for each row execute function public.commercial_crm_touch_updated_at_v1();

create trigger commercial_contacts_normalize
before insert or update on public.commercial_contacts
for each row execute function public.commercial_crm_normalize_contact_v1();
create trigger commercial_contacts_touch_updated_at
before update on public.commercial_contacts
for each row execute function public.commercial_crm_touch_updated_at_v1();

create trigger commercial_leads_guard_state
before update on public.commercial_leads
for each row execute function public.commercial_crm_guard_lead_state_v1();
create trigger commercial_leads_touch_updated_at
before update on public.commercial_leads
for each row execute function public.commercial_crm_touch_updated_at_v1();

create trigger commercial_events_append_only
before update or delete on public.commercial_events
for each row execute function public.commercial_crm_prevent_event_mutation_v1();

create or replace function public.commercial_crm_actor_authorized_v1(p_actor_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor_user_id is not null and exists (
    select 1
    from public.tenant_users tu
    inner join public.internal_access_grants iag
      on iag.auth_user_id = tu.user_id
     and iag.permission_key = 'commercial_crm_access'
     and iag.active
     and iag.revoked_at is null
    where tu.user_id = p_actor_user_id
      and tu.role::text = 'superadmin'
  )
$$;

create or replace function public.transition_commercial_lead_v1(
  p_actor_user_id uuid,
  p_lead_id uuid,
  p_action text,
  p_idempotency_key text,
  p_metadata_safe jsonb default '{}'::jsonb,
  p_client_id uuid default null,
  p_checkout_session_id uuid default null,
  p_entitlement_id uuid default null,
  p_stripe_billing_profile_id uuid default null,
  p_stripe_subscription_id uuid default null,
  p_package_reference text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_lead public.commercial_leads%rowtype;
  v_event_id uuid;
  v_conversion_id uuid;
  v_event_type text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if not public.commercial_crm_actor_authorized_v1(p_actor_user_id) then
    raise exception 'commercial_crm_owner_access_required' using errcode = '42501';
  end if;
  if p_lead_id is null then
    raise exception 'commercial_lead_id_required' using errcode = '22023';
  end if;
  if char_length(v_idempotency_key) not between 1 and 200 then
    raise exception 'commercial_idempotency_key_invalid' using errcode = '22023';
  end if;
  if p_metadata_safe is null or jsonb_typeof(p_metadata_safe) <> 'object' then
    raise exception 'commercial_metadata_safe_must_be_object' using errcode = '22023';
  end if;

  select * into v_lead
  from public.commercial_leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'commercial_lead_not_found' using errcode = 'P0002';
  end if;

  select id into v_event_id
  from public.commercial_events
  where lead_id = p_lead_id and idempotency_key = v_idempotency_key;

  if v_event_id is not null then
    select id into v_conversion_id
    from public.commercial_conversions
    where lead_id = p_lead_id;
    return jsonb_strip_nulls(jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'lead_id', v_lead.id,
      'event_id', v_event_id,
      'conversion_id', v_conversion_id,
      'qualification_status', v_lead.qualification_status,
      'outreach_status', v_lead.outreach_status,
      'sales_status', v_lead.sales_status,
      'version', v_lead.version
    ));
  end if;

  perform set_config('app.commercial_crm_transition_v1', 'on', true);

  case v_action
    when 'approve' then
      if v_lead.qualification_status <> 'qualified' then
        raise exception 'commercial_lead_approve_invalid_transition' using errcode = '22023';
      end if;
      update public.commercial_leads
      set qualification_status = 'approved', approved_by = p_actor_user_id,
          approved_at = now(), version = version + 1
      where id = p_lead_id returning * into v_lead;
      v_event_type := 'lead_approved';
    when 'reject' then
      if v_lead.qualification_status not in ('discovered', 'enriched', 'qualified') then
        raise exception 'commercial_lead_reject_invalid_transition' using errcode = '22023';
      end if;
      update public.commercial_leads
      set qualification_status = 'rejected', outreach_status = 'stopped',
          version = version + 1
      where id = p_lead_id returning * into v_lead;
      v_event_type := 'lead_rejected';
    when 'queue_outreach' then
      if v_lead.qualification_status <> 'approved' or v_lead.outreach_status <> 'not_started' then
        raise exception 'commercial_lead_queue_invalid_transition' using errcode = '22023';
      end if;
      update public.commercial_leads
      set outreach_status = 'queued', version = version + 1
      where id = p_lead_id returning * into v_lead;
      v_event_type := 'outreach_queued';
    when 'mark_contacted' then
      if v_lead.qualification_status <> 'approved' or v_lead.outreach_status <> 'queued' then
        raise exception 'commercial_lead_contacted_invalid_transition' using errcode = '22023';
      end if;
      update public.commercial_leads
      set outreach_status = 'contacted', version = version + 1
      where id = p_lead_id returning * into v_lead;
      v_event_type := 'outreach_contacted';
    when 'record_response' then
      if v_lead.qualification_status <> 'approved' or v_lead.outreach_status <> 'contacted' then
        raise exception 'commercial_lead_response_invalid_transition' using errcode = '22023';
      end if;
      update public.commercial_leads
      set outreach_status = 'replied', version = version + 1
      where id = p_lead_id returning * into v_lead;
      v_event_type := 'outreach_response_received';
    when 'mark_no_response' then
      if v_lead.outreach_status <> 'contacted' then
        raise exception 'commercial_lead_no_response_invalid_transition' using errcode = '22023';
      end if;
      update public.commercial_leads
      set outreach_status = 'no_response', version = version + 1
      where id = p_lead_id returning * into v_lead;
      v_event_type := 'outreach_no_response';
    when 'stop_outreach' then
      if v_lead.outreach_status not in ('queued', 'contacted', 'no_response') then
        raise exception 'commercial_lead_stop_outreach_invalid_transition' using errcode = '22023';
      end if;
      update public.commercial_leads
      set outreach_status = 'stopped', version = version + 1
      where id = p_lead_id returning * into v_lead;
      v_event_type := 'outreach_stopped';
    when 'mark_sales_qualified' then
      if v_lead.outreach_status <> 'replied' or v_lead.sales_status <> 'not_started' then
        raise exception 'commercial_lead_sales_qualified_invalid_transition' using errcode = '22023';
      end if;
      update public.commercial_leads
      set sales_status = 'sales_qualified', version = version + 1
      where id = p_lead_id returning * into v_lead;
      v_event_type := 'sales_qualified';
    when 'mark_demo_booked' then
      if v_lead.sales_status <> 'sales_qualified' then
        raise exception 'commercial_lead_demo_booked_invalid_transition' using errcode = '22023';
      end if;
      update public.commercial_leads set sales_status = 'demo_booked', version = version + 1
      where id = p_lead_id returning * into v_lead;
      v_event_type := 'demo_booked';
    when 'mark_demo_done' then
      if v_lead.sales_status <> 'demo_booked' then
        raise exception 'commercial_lead_demo_done_invalid_transition' using errcode = '22023';
      end if;
      update public.commercial_leads set sales_status = 'demo_done', version = version + 1
      where id = p_lead_id returning * into v_lead;
      v_event_type := 'demo_done';
    when 'mark_checkout_sent' then
      if v_lead.sales_status not in ('sales_qualified', 'demo_done') then
        raise exception 'commercial_lead_checkout_sent_invalid_transition' using errcode = '22023';
      end if;
      update public.commercial_leads set sales_status = 'checkout_sent', version = version + 1
      where id = p_lead_id returning * into v_lead;
      v_event_type := 'checkout_sent';
    when 'mark_paid' then
      if v_lead.sales_status <> 'checkout_sent' then
        raise exception 'commercial_lead_paid_invalid_transition' using errcode = '22023';
      end if;
      if p_client_id is null then
        raise exception 'commercial_conversion_client_id_required' using errcode = '22023';
      end if;
      insert into public.commercial_conversions (
        lead_id, business_id, client_id, checkout_session_id, entitlement_id,
        stripe_billing_profile_id, stripe_subscription_id, package_reference,
        converted_by, idempotency_key, attribution_snapshot_safe, metadata_safe
      ) values (
        v_lead.id, v_lead.business_id, p_client_id, p_checkout_session_id, p_entitlement_id,
        p_stripe_billing_profile_id, p_stripe_subscription_id, nullif(btrim(p_package_reference), ''),
        p_actor_user_id, v_idempotency_key,
        jsonb_strip_nulls(jsonb_build_object(
          'schema_version', 'commercial_conversion_attribution_v1',
          'lead_id', v_lead.id,
          'campaign_id', v_lead.campaign_id,
          'business_id', v_lead.business_id,
          'city', v_lead.city_snapshot,
          'subsegment', v_lead.subsegment_snapshot,
          'outreach_channel', v_lead.outreach_channel,
          'message_angle', v_lead.message_angle,
          'template_version', v_lead.template_version
        )),
        p_metadata_safe
      ) returning id into v_conversion_id;
      update public.commercial_leads set sales_status = 'paid', version = version + 1
      where id = p_lead_id returning * into v_lead;
      v_event_type := 'payment_succeeded';
    when 'mark_lost' then
      if v_lead.sales_status not in ('not_started', 'sales_qualified', 'demo_booked', 'demo_done', 'checkout_sent') then
        raise exception 'commercial_lead_lost_invalid_transition' using errcode = '22023';
      end if;
      update public.commercial_leads set sales_status = 'lost', version = version + 1
      where id = p_lead_id returning * into v_lead;
      v_event_type := 'sales_lost';
    when 'start_onboarding' then
      if v_lead.sales_status <> 'paid' then
        raise exception 'commercial_lead_onboarding_invalid_transition' using errcode = '22023';
      end if;
      update public.commercial_leads set sales_status = 'onboarding', version = version + 1
      where id = p_lead_id returning * into v_lead;
      v_event_type := 'onboarding_started';
    when 'activate_client' then
      if v_lead.sales_status <> 'onboarding' then
        raise exception 'commercial_lead_active_client_invalid_transition' using errcode = '22023';
      end if;
      update public.commercial_leads set sales_status = 'active_client', version = version + 1
      where id = p_lead_id returning * into v_lead;
      v_event_type := 'client_activated';
    else
      raise exception 'commercial_lead_action_unknown' using errcode = '22023';
  end case;

  insert into public.commercial_events (
    lead_id, event_type, actor_type, actor_auth_user_id, idempotency_key, metadata_safe
  ) values (
    v_lead.id, v_event_type, 'commercial_owner', p_actor_user_id, v_idempotency_key,
    p_metadata_safe || jsonb_strip_nulls(jsonb_build_object(
      'action', v_action,
      'conversion_id', v_conversion_id,
      'contract_version', 'commercial_crm_foundation_v1'
    ))
  ) returning id into v_event_id;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'lead_id', v_lead.id,
    'event_id', v_event_id,
    'conversion_id', v_conversion_id,
    'qualification_status', v_lead.qualification_status,
    'outreach_status', v_lead.outreach_status,
    'sales_status', v_lead.sales_status,
    'version', v_lead.version
  ));
end
$$;

alter table public.internal_access_grants enable row level security;
alter table public.internal_access_grants force row level security;
alter table public.commercial_campaigns enable row level security;
alter table public.commercial_campaigns force row level security;
alter table public.commercial_businesses enable row level security;
alter table public.commercial_businesses force row level security;
alter table public.commercial_contacts enable row level security;
alter table public.commercial_contacts force row level security;
alter table public.commercial_leads enable row level security;
alter table public.commercial_leads force row level security;
alter table public.commercial_events enable row level security;
alter table public.commercial_events force row level security;
alter table public.commercial_conversions enable row level security;
alter table public.commercial_conversions force row level security;

create policy internal_access_grants_service_role_all on public.internal_access_grants
  for all to service_role using (true) with check (true);
create policy commercial_campaigns_service_role_all on public.commercial_campaigns
  for all to service_role using (true) with check (true);
create policy commercial_businesses_service_role_all on public.commercial_businesses
  for all to service_role using (true) with check (true);
create policy commercial_contacts_service_role_all on public.commercial_contacts
  for all to service_role using (true) with check (true);
create policy commercial_leads_service_role_all on public.commercial_leads
  for all to service_role using (true) with check (true);
create policy commercial_events_service_role_select on public.commercial_events
  for select to service_role using (true);
create policy commercial_events_service_role_insert on public.commercial_events
  for insert to service_role with check (true);
create policy commercial_conversions_service_role_select on public.commercial_conversions
  for select to service_role using (true);
create policy commercial_conversions_service_role_insert on public.commercial_conversions
  for insert to service_role with check (true);

revoke all on table
  public.internal_access_grants,
  public.commercial_campaigns,
  public.commercial_businesses,
  public.commercial_contacts,
  public.commercial_leads,
  public.commercial_events,
  public.commercial_conversions
from public, anon, authenticated;

grant select, insert, update on table public.internal_access_grants to service_role;
grant select, insert, update on table public.commercial_campaigns to service_role;
grant select, insert, update on table public.commercial_businesses to service_role;
grant select, insert, update on table public.commercial_contacts to service_role;
grant select, insert, update on table public.commercial_leads to service_role;
grant select, insert on table public.commercial_events to service_role;
grant select, insert on table public.commercial_conversions to service_role;

revoke all on function
  public.commercial_crm_touch_updated_at_v1(),
  public.commercial_crm_normalize_business_v1(),
  public.commercial_crm_normalize_contact_v1(),
  public.commercial_crm_guard_lead_state_v1(),
  public.commercial_crm_prevent_event_mutation_v1(),
  public.commercial_crm_actor_authorized_v1(uuid),
  public.transition_commercial_lead_v1(uuid, uuid, text, text, jsonb, uuid, uuid, uuid, uuid, uuid, text)
from public, anon, authenticated;

grant execute on function public.commercial_crm_actor_authorized_v1(uuid) to service_role;
grant execute on function public.transition_commercial_lead_v1(uuid, uuid, text, text, jsonb, uuid, uuid, uuid, uuid, uuid, text)
  to service_role;

do $$
declare
  v_owner_id constant uuid := '580d7856-d60f-4838-a5f9-3b405d6ae79b';
begin
  if not exists (
    select 1
    from auth.users au
    inner join public.tenant_users tu on tu.user_id = au.id
    where au.id = v_owner_id and tu.role::text = 'superadmin'
  ) then
    raise exception 'canonical_commercial_owner_identity_missing_or_not_superadmin';
  end if;

  insert into public.internal_access_grants (
    auth_user_id, permission_key, active, granted_by, revoked_at, metadata_safe
  ) values (
    v_owner_id,
    'commercial_crm_access',
    true,
    v_owner_id,
    null,
    '{"source":"commercial_crm_foundation_v1","purpose":"initial_canonical_owner"}'::jsonb
  )
  on conflict (auth_user_id, permission_key) do update
  set active = true,
      granted_by = excluded.granted_by,
      revoked_at = null,
      metadata_safe = public.internal_access_grants.metadata_safe || excluded.metadata_safe,
      updated_at = now();
end
$$;

comment on table public.internal_access_grants is
  'Server-only explicit internal permissions. Generic admin or superadmin status alone does not grant Commercial CRM access.';
comment on table public.commercial_events is
  'Append-only Commercial CRM event ledger. UPDATE and DELETE are rejected by trigger and absent from service_role ACL.';
comment on table public.commercial_conversions is
  'Immutable prospect-to-client linkage created atomically with the paid lead transition.';
comment on function public.transition_commercial_lead_v1(uuid, uuid, text, text, jsonb, uuid, uuid, uuid, uuid, uuid, text) is
  'Service-role-only atomic Commercial CRM state machine. Requires a real actor who is both superadmin and actively granted commercial_crm_access.';

commit;
