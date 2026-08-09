\set ON_ERROR_STOP on

create schema auth;
create role anon;
create role authenticated;
create role service_role;
create function auth.jwt() returns jsonb language sql stable
as $$ select jsonb_build_object('role', current_setting('request.jwt.claim.role', true)) $$;

create table public.ig_accounts (
  id uuid primary key
);
create table public.ig_runs (
  id uuid primary key,
  account_id uuid not null references public.ig_accounts(id)
);
create table public.ig_interacted_users (
  id uuid primary key,
  account_id uuid not null references public.ig_accounts(id),
  username text not null,
  followed_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.ig_unfollow_candidate_availability (
  account_id uuid not null references public.ig_accounts(id),
  normalized_username text not null,
  interaction_id uuid null references public.ig_interacted_users(id),
  status text not null,
  reason text not null,
  first_not_found_at timestamptz,
  last_checked_at timestamptz not null,
  not_found_attempt_count integer not null default 0,
  first_failure_at timestamptz,
  last_failure_at timestamptz,
  technical_attempt_count integer not null default 0,
  source_run_id uuid,
  next_retry_at timestamptz,
  terminal_at timestamptz,
  business_date_sast date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, normalized_username),
  constraint ig_unfollow_candidate_availability_status_check check (
    status in ('temporary_unavailable', 'exhausted', 'username_not_found_confirmed', 'search_surface_unhealthy')
  ),
  constraint ig_unfollow_candidate_availability_reason_check check (
    reason in ('unfollow_candidate_not_found', 'username_not_found_confirmed', 'search_surface_unhealthy')
  ),
  constraint ig_unfollow_candidate_availability_terminal_check check (true)
);

\ir ../migrations/20260809143000_unfollow_already_not_following_terminal_v1.sql

insert into public.ig_accounts values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002');
insert into public.ig_runs values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002');
insert into public.ig_interacted_users (
  id, account_id, username, followed_at
) values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Already.Gone',
  now() - interval '30 days'
);

set request.jwt.claim.role='service_role';

do $$
declare
  v_first jsonb;
  v_second jsonb;
begin
  v_first := public.record_unfollow_already_not_following_v1(
    '10000000-0000-4000-8000-000000000001',
    'Already.Gone',
    '20000000-0000-4000-8000-000000000001',
    'follow'
  );
  if v_first->>'status' <> 'already_not_following_confirmed'
     or (v_first->>'terminal_preserved')::boolean then
    raise exception 'first_terminal_write_failed:%', v_first;
  end if;
  v_second := public.record_unfollow_already_not_following_v1(
    '10000000-0000-4000-8000-000000000001',
    'already.gone',
    '20000000-0000-4000-8000-000000000001',
    'follow'
  );
  if not (v_second->>'terminal_preserved')::boolean
     or (select count(*) from public.ig_unfollow_candidate_availability) <> 1 then
    raise exception 'idempotent_terminal_preservation_failed:%', v_second;
  end if;
end $$;

do $$
begin
  begin
    perform public.record_unfollow_already_not_following_v1(
      '10000000-0000-4000-8000-000000000001', 'wrong.run',
      '20000000-0000-4000-8000-000000000002', 'follow'
    );
    raise exception 'cross_account_run_accepted';
  exception when others then
    if sqlerrm = 'cross_account_run_accepted'
       or sqlerrm not like '%unfollow_candidate_source_run_invalid%' then raise; end if;
  end;
  begin
    perform public.record_unfollow_already_not_following_v1(
      '10000000-0000-4000-8000-000000000001', 'bad.state',
      '20000000-0000-4000-8000-000000000001', 'following_missing'
    );
    raise exception 'absence_state_accepted';
  exception when others then
    if sqlerrm = 'absence_state_accepted'
       or sqlerrm not like '%unfollow_relationship_state_invalid%' then raise; end if;
  end;
end $$;

reset request.jwt.claim.role;
do $$
begin
  begin
    perform public.record_unfollow_already_not_following_v1(
      '10000000-0000-4000-8000-000000000001', 'unauthorized',
      '20000000-0000-4000-8000-000000000001', 'follow'
    );
    raise exception 'non_service_role_accepted';
  exception when others then
    if sqlerrm = 'non_service_role_accepted'
       or sqlerrm not like '%service_role_required%' then raise; end if;
  end;
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.record_unfollow_already_not_following_v1(uuid,text,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_unfollow_already_not_following_v1(uuid,text,uuid,text)', 'EXECUTE')
     or has_function_privilege('public', 'public.record_unfollow_already_not_following_v1(uuid,text,uuid,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.record_unfollow_already_not_following_v1(uuid,text,uuid,text)', 'EXECUTE') then
    raise exception 'rpc_grants_invalid';
  end if;
end $$;

select 'unfollow_already_not_following_terminal_v1_ok' as result;
