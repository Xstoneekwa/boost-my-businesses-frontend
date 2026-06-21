-- UI/API E2E FIXTURE ONLY — workspace + plan change bootstrap for isolated nxntngkhkoynljcagmkq.
-- Requires commercial checkout tables from fast-track bootstrap + plan change migrations.

create table if not exists public.tenant_users (
  user_id uuid primary key,
  tenant_id uuid null references public.clients(id) on delete cascade,
  role text not null check (role in ('superadmin', 'tenant')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_users_tenant_id_idx on public.tenant_users (tenant_id);

alter table public.clients
  add column if not exists status text;

alter table public.clients
  add column if not exists metadata jsonb;

update public.clients
set status = coalesce(status, 'active'),
    metadata = coalesce(metadata, '{}'::jsonb)
where status is null or metadata is null;

alter table public.clients
  alter column status set default 'active';

alter table public.clients
  alter column status set not null;

alter table public.clients
  alter column metadata set default '{}'::jsonb;

alter table public.clients
  alter column metadata set not null;

create table if not exists public.client_instagram_accounts (
  client_id uuid not null references public.clients(id) on delete cascade,
  account_id uuid not null,
  login_status text,
  onboarding_status text,
  provisioning_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, account_id)
);

create index if not exists client_instagram_accounts_client_id_idx
  on public.client_instagram_accounts (client_id);
