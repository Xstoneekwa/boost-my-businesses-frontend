\set ON_ERROR_STOP on

-- Reuse the real predecessor reconstruction (including rollback/reapply) so
-- this successor is tested against the exact identity-readiness contract.
\ir login-identity-readiness-gate-v1.sql

alter table public.client_instagram_accounts
  add column if not exists social_collection_status text;

\ir ../migrations/20260810170000_login_state_monotonic_v1.sql

set role service_role;
select public.update_client_instagram_account_status(
  p_account_id := '10000000-0000-4000-8000-000000000003',
  p_login_status := 'connected',
  p_provisioning_status := 'ready',
  p_onboarding_status := 'ready',
  p_actor_type := 'provisioner',
  p_reason := 'synthetic_exact_identity_after_successor',
  p_metadata := jsonb_build_object(
    'run_id', '60000000-0000-4000-8000-000000000003',
    'expected_identity_verified', true,
    'identity_verification_status', 'verified',
    'profile_opened', true,
    'expected_username', 'future_account',
    'actual_logged_in_username', 'future_account'
  )
);
reset role;

do $$
declare
  v_before public.client_instagram_accounts%rowtype;
begin
  select * into v_before
  from public.client_instagram_accounts
  where account_id = '10000000-0000-4000-8000-000000000003';

  if v_before.login_identity_proof_status <> 'verified'
     or v_before.login_status <> 'connected'
     or v_before.login_state_source_at is null
     or v_before.login_state_version < 2
  then
    raise exception 'verified login did not start a monotonic generation';
  end if;

  begin
    update public.client_instagram_accounts
    set login_status = 'verification_pending',
        provisioning_status = 'login_verification_pending',
        onboarding_status = 'credentials_submitted'
    where account_id = '10000000-0000-4000-8000-000000000003';
    raise exception 'direct stale downgrade unexpectedly succeeded';
  exception
    when check_violation then
      if sqlerrm <> 'login_state_downgrade_requires_newer_canonical_invalidation' then
        raise;
      end if;
  end;
end;
$$;

set role service_role;
select public.invalidate_client_instagram_login_v1(
  p_account_id := '10000000-0000-4000-8000-000000000003',
  p_invalidation_reason := 'session_expired',
  -- Function arguments are evaluated with the caller privileges. Use an
  -- unambiguously old timestamp so service_role never needs table SELECT.
  p_source_timestamp := '2000-01-01 00:00:00+00'::timestamptz,
  p_login_status := 'logged_out',
  p_provisioning_status := 'login_pending',
  p_onboarding_status := 'credentials_submitted',
  p_actor_type := 'worker',
  p_metadata := '{"source":"stale_login_probe"}'::jsonb
);
reset role;

do $$
begin
  if not exists (
    select 1
    from public.client_instagram_accounts
    where account_id = '10000000-0000-4000-8000-000000000003'
      and login_status = 'connected'
      and provisioning_status = 'ready'
      and onboarding_status = 'ready'
      and login_identity_proof_status = 'verified'
  ) then
    raise exception 'stale invalidation overwrote verified login';
  end if;

  update public.client_instagram_accounts
  set social_collection_status = 'social_unavailable'
  where account_id = '10000000-0000-4000-8000-000000000003';

  if (select login_status from public.client_instagram_accounts where account_id = '10000000-0000-4000-8000-000000000003') <> 'connected' then
    raise exception 'social collection state changed canonical login';
  end if;
end;
$$;

set role service_role;
select public.invalidate_client_instagram_login_v1(
  p_account_id := '10000000-0000-4000-8000-000000000003',
  p_invalidation_reason := 'session_expired',
  p_source_timestamp := clock_timestamp() + interval '1 second',
  p_login_status := 'logged_out',
  p_provisioning_status := 'login_pending',
  p_onboarding_status := 'credentials_submitted',
  p_actor_type := 'worker',
  p_metadata := '{"source":"fresh_login_probe"}'::jsonb
);
reset role;

do $$
begin
  if not exists (
    select 1
    from public.client_instagram_accounts
    where account_id = '10000000-0000-4000-8000-000000000003'
      and login_status = 'logged_out'
      and provisioning_status = 'login_pending'
      and onboarding_status = 'credentials_submitted'
      and login_identity_proof_status = 'failed'
      and login_state_invalidation_reason = 'instagram_login_screen_confirmed'
      and login_state_version >= 3
  ) then
    raise exception 'newer explicit invalidation did not downgrade connected login';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.invalidate_client_instagram_login_v1(uuid,text,timestamptz,text,text,text,boolean,text,text,text,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.invalidate_client_instagram_login_v1(uuid,text,timestamptz,text,text,text,boolean,text,text,text,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.invalidate_client_instagram_login_v1(uuid,text,timestamptz,text,text,text,boolean,text,text,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'monotonic invalidation RPC ACL contract failed';
  end if;
end;
$$;

\ir ../rollback/20260810170000_login_state_monotonic_v1.down.sql

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'client_instagram_accounts'
      and column_name = 'login_state_source_at'
  ) then
    raise exception 'successor rollback left ordering columns behind';
  end if;
  if to_regprocedure('public.update_client_instagram_account_status(uuid,text,text,text,boolean,text,text,text,text,jsonb)') is null then
    raise exception 'successor rollback removed predecessor status writer';
  end if;
end;
$$;

\ir ../migrations/20260810170000_login_state_monotonic_v1.sql
\ir ../migrations/20260810170000_login_state_monotonic_v1.sql

select 'login_state_monotonic_v1_ok' as result;
