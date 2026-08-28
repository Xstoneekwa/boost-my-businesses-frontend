-- LOCAL FIXTURE DATABASE ONLY. Never execute against Supabase production.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create table public.tenant_users(user_id uuid references auth.users(id),role text);
create table public.clients(id uuid primary key);
create table public.commercial_checkout_sessions(id uuid primary key);
create table public.client_account_entitlements(id uuid primary key);
create table public.commercial_stripe_billing_profiles(id uuid primary key);
create table public.commercial_stripe_subscriptions(id uuid primary key);
insert into auth.users values('580d7856-d60f-4838-a5f9-3b405d6ae79b'),('00000000-0000-4000-8000-000000000001');
insert into public.tenant_users values('580d7856-d60f-4838-a5f9-3b405d6ae79b','superadmin'),('00000000-0000-4000-8000-000000000001','superadmin');
grant usage on schema auth to service_role;
grant select on public.tenant_users,auth.users to service_role;
