do $$
begin
  begin
    insert into public.ig_account_follow_limit_overrides(account_id, follow_day_cap_override, source)
    values ('00000000-0000-0000-0000-000000000001', 0, 'admin');
    raise exception 'expected positive day constraint';
  exception when check_violation then null;
  end;

  begin
    insert into public.ig_account_follow_limit_overrides(account_id, source)
    values ('00000000-0000-0000-0000-000000000001', 'admin');
    raise exception 'expected cap-present constraint';
  exception when check_violation then null;
  end;

  begin
    insert into public.ig_account_follow_limit_overrides(account_id, follow_day_cap_override, source)
    values ('00000000-0000-0000-0000-000000000001', 10, 'client');
    raise exception 'expected source constraint';
  exception when check_violation then null;
  end;

  if has_table_privilege('anon', 'public.ig_account_follow_limit_overrides', 'select') then
    raise exception 'anon table access detected';
  end if;
  if has_table_privilege('authenticated', 'public.ig_account_follow_limit_overrides', 'insert') then
    raise exception 'authenticated table write detected';
  end if;
  if not has_table_privilege('service_role', 'public.ig_account_follow_limit_overrides', 'select') then
    raise exception 'service_role table read missing';
  end if;
  if has_table_privilege('service_role', 'public.ig_account_follow_limit_overrides', 'insert') then
    raise exception 'service_role direct table write detected';
  end if;
  if has_function_privilege('anon', 'public.save_account_follow_limit_override_v1(uuid,integer,integer,text,text,uuid,text,text)', 'execute') then
    raise exception 'anon save RPC access detected';
  end if;
  if has_function_privilege('authenticated', 'public.reset_account_follow_limit_override_v1(uuid,text,uuid,text,text)', 'execute') then
    raise exception 'authenticated reset RPC access detected';
  end if;
  if not has_function_privilege('service_role', 'public.save_account_follow_limit_override_v1(uuid,integer,integer,text,text,uuid,text,text)', 'execute') then
    raise exception 'service_role save RPC access missing';
  end if;
  if exists (select 1 from public.ig_account_follow_limit_overrides) then
    raise exception 'provisioning unexpectedly created an override';
  end if;
end;
$$;

select public.save_account_follow_limit_override_v1(
  '00000000-0000-0000-0000-000000000001', 40, null, 'admin',
  'postgres_test', null, 'day only', 'postgres-upsert-1'
);

select public.save_account_follow_limit_override_v1(
  '00000000-0000-0000-0000-000000000001', 50, 30, 'support',
  'postgres_test', null, 'update both', 'postgres-upsert-2'
);

do $$
declare
  v_row public.ig_account_follow_limit_overrides%rowtype;
  v_audits integer;
begin
  select * into strict v_row from public.ig_account_follow_limit_overrides
   where account_id = '00000000-0000-0000-0000-000000000001';
  if v_row.follow_day_cap_override <> 50 or v_row.follow_session_cap_override <> 30 or v_row.source <> 'support' then
    raise exception 'upsert result mismatch';
  end if;
  select count(*) into v_audits from public.ig_action_logs
   where account_id = v_row.account_id
     and action_type in ('follow_limit_override_created', 'follow_limit_override_updated');
  if v_audits <> 2 then raise exception 'save audit mismatch'; end if;
end;
$$;

select public.reset_account_follow_limit_override_v1(
  '00000000-0000-0000-0000-000000000001', 'postgres_test', null,
  'reset', 'postgres-reset-1'
);

do $$
begin
  if exists (
    select 1 from public.ig_account_follow_limit_overrides
     where account_id = '00000000-0000-0000-0000-000000000001'
  ) then raise exception 'reset failed'; end if;
  if not exists (
    select 1 from public.ig_action_logs
     where account_id = '00000000-0000-0000-0000-000000000001'
       and action_type = 'follow_limit_override_reset'
       and payload ->> 'action' = 'reset_to_package_defaults'
  ) then raise exception 'reset audit missing'; end if;
end;
$$;

set role service_role;
select count(*) from public.ig_account_follow_limit_overrides;
reset role;
