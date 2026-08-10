begin;

-- Data reconciliation is intentionally not reversed: restoring
-- proven_false_ready would discard the successful pre-gate login evidence.
-- Restore the strict trigger body. Reconciled historical rows remain truthful
-- historical_model_missing records; their data is not rewritten.
create or replace function public.enforce_client_instagram_ready_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canonical_username text;
  v_ready_transition boolean;
begin
  v_ready_transition :=
    (tg_op = 'INSERT' and (
      lower(coalesce(new.login_status, '')) = 'connected'
      or lower(coalesce(new.provisioning_status, '')) = 'ready'
      or lower(coalesce(new.onboarding_status, '')) = 'ready'
    ))
    or (tg_op = 'UPDATE' and (
      (lower(coalesce(new.login_status, '')) = 'connected'
        and lower(coalesce(old.login_status, '')) <> 'connected')
      or (lower(coalesce(new.provisioning_status, '')) = 'ready'
        and lower(coalesce(old.provisioning_status, '')) <> 'ready')
      or (lower(coalesce(new.onboarding_status, '')) = 'ready'
        and lower(coalesce(old.onboarding_status, '')) <> 'ready')
    ));

  if not v_ready_transition then
    return new;
  end if;

  select public.normalize_instagram_identity_username_v1(ia.username)
    into v_canonical_username
  from public.ig_accounts ia
  where ia.id = new.account_id;

  if new.login_identity_proof_status <> 'verified'
     or new.login_identity_profile_opened is distinct from true
     or new.login_identity_username_match is distinct from true
     or new.login_identity_verified_at is null
     or public.normalize_instagram_identity_username_v1(new.login_identity_expected_username) = ''
     or public.normalize_instagram_identity_username_v1(new.login_identity_detected_username) = ''
     or public.normalize_instagram_identity_username_v1(new.login_identity_expected_username) <> v_canonical_username
     or public.normalize_instagram_identity_username_v1(new.login_identity_detected_username) <> v_canonical_username
  then
    raise exception 'login_identity_not_verified'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

commit;
