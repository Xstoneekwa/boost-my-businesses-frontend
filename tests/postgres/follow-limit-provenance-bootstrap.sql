create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create table public.ig_accounts (
  id uuid primary key,
  username text not null unique
);

create table public.ig_action_logs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid null references public.ig_accounts(id) on delete cascade,
  run_id uuid null,
  target_username text null,
  action_type text not null,
  status text null,
  message text null,
  payload jsonb null,
  created_at timestamptz null default now()
);

insert into public.ig_accounts(id, username) values
  ('00000000-0000-0000-0000-000000000001', 'postgres_test_one'),
  ('00000000-0000-0000-0000-000000000002', 'postgres_test_two');
