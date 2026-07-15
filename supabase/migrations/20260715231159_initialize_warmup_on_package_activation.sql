-- Initialize the existing Follow warmup contract when a commercial package
-- becomes active. Existing warmup start dates are immutable here: package
-- changes must not restart an account at Day 1.

create or replace function public.initialize_account_warmup_on_package_activation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_started_at timestamptz;
begin
  if new.status <> 'active' or new.ends_at is not null then
    return new;
  end if;

  v_started_at := coalesce(new.starts_at, new.created_at, now());

  insert into public.account_warmup_settings (
    account_id,
    warmup_enabled,
    package_started_at,
    warmup_profile_code,
    day_1_follow_cap,
    day_2_follow_cap,
    day_3_follow_cap,
    day_4_plus_follow_cap,
    status,
    updated_at
  ) values (
    new.account_id,
    true,
    v_started_at,
    'follow_default_v1',
    10,
    20,
    40,
    null,
    'active',
    now()
  )
  on conflict (account_id) do update
    set package_started_at = excluded.package_started_at,
        status = 'active',
        updated_at = now()
    where account_warmup_settings.package_started_at is null;

  return new;
end;
$$;

drop trigger if exists initialize_account_warmup_on_package_activation
  on public.account_commercial_packages;

create trigger initialize_account_warmup_on_package_activation
after insert or update of status, ends_at, starts_at
on public.account_commercial_packages
for each row
when (new.status = 'active' and new.ends_at is null)
execute function public.initialize_account_warmup_on_package_activation();

revoke all on function public.initialize_account_warmup_on_package_activation()
  from public, anon, authenticated;
