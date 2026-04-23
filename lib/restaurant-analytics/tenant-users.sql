create table if not exists public.tenant_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid,
  role text not null check (role in ('tenant', 'superadmin')),
  created_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists tenant_users_user_id_idx on public.tenant_users (user_id);
create index if not exists tenant_users_tenant_id_idx on public.tenant_users (tenant_id);
