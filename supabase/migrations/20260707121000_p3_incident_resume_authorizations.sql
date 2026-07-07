-- P3: durable, audited, atomically consumable human resume authorizations.
--
-- One row is armed by the operator action "Prêt à relancer" on a
-- recovery-eligible incident. Auto Restart is the ONLY consumer: it claims
-- the row atomically (status armed -> consumed) before creating exactly one
-- resume run request in the same active window. A consumed or expired
-- authorization can never be re-armed for the same window (partial unique
-- index), which enforces: 1 click -> at most 1 resume request -> 1 window.

create table if not exists public.incident_resume_authorizations (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null,
  account_id uuid not null,
  run_id uuid,
  resume_plan_id uuid,
  resume_window_key text not null,
  scheduled_window_start timestamptz,
  scheduled_window_end timestamptz,
  status text not null default 'armed'
    check (status in ('armed', 'consumed', 'expired', 'revoked')),
  armed_source text not null default 'botapp_relay',
  armed_by text,
  armed_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_by_request_id uuid,
  expired_at timestamptz,
  consume_error text,
  resolution_note text,
  metadata_safe jsonb not null default '{}'::jsonb,
  test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live (armed) authorization per incident.
create unique index if not exists incident_resume_authorizations_one_armed_per_incident
  on public.incident_resume_authorizations (incident_id)
  where status = 'armed';

-- Anti-loop budget: once armed or consumed in a window, no re-arm in the
-- same account window. Expired / revoked rows do not block a future window.
create unique index if not exists incident_resume_authorizations_one_per_window
  on public.incident_resume_authorizations (account_id, resume_window_key)
  where status in ('armed', 'consumed');

create index if not exists incident_resume_authorizations_armed_idx
  on public.incident_resume_authorizations (status, armed_at)
  where status = 'armed';

alter table public.incident_resume_authorizations enable row level security;

drop policy if exists incident_resume_authorizations_service_role_all
  on public.incident_resume_authorizations;
create policy incident_resume_authorizations_service_role_all
  on public.incident_resume_authorizations
  for all
  to service_role
  using (true)
  with check (true);
