do $$
declare
  v_rls_enabled boolean;
begin
  select c.relrowsecurity
    into v_rls_enabled
  from pg_class c
  where c.oid = 'public.client_account_notifications'::regclass;

  if not coalesce(v_rls_enabled, false) then
    raise exception 'client_account_notifications_rls_required';
  end if;
end
$$;

revoke all privileges on table public.client_account_notifications
  from public, anon, authenticated;

grant all privileges on table public.client_account_notifications
  to service_role;

do $$
declare
  v_role name;
  v_privilege text;
  v_column name;
  v_rls_enabled boolean;
begin
  select c.relrowsecurity
    into v_rls_enabled
  from pg_class c
  where c.oid = 'public.client_account_notifications'::regclass;

  if not coalesce(v_rls_enabled, false) then
    raise exception 'client_account_notifications_rls_disabled';
  end if;

  if exists (
    select 1
    from pg_class c
    cross join lateral aclexplode(c.relacl) acl
    where c.oid = 'public.client_account_notifications'::regclass
      and acl.grantee = 0
  ) then
    raise exception 'client_account_notifications_public_acl_remaining';
  end if;

  foreach v_role in array array['anon'::name, 'authenticated'::name]
  loop
    foreach v_privilege in array array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    loop
      if has_table_privilege(
        v_role,
        'public.client_account_notifications',
        v_privilege
      ) then
        raise exception 'client_account_notifications_unexpected_table_privilege:%:%',
          v_role, v_privilege;
      end if;
    end loop;

    for v_column in
      select a.attname
      from pg_attribute a
      where a.attrelid = 'public.client_account_notifications'::regclass
        and a.attnum > 0
        and not a.attisdropped
    loop
      foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
      loop
        if has_column_privilege(
          v_role,
          'public.client_account_notifications',
          v_column,
          v_privilege
        ) then
          raise exception 'client_account_notifications_unexpected_column_privilege:%:%:%',
            v_role, v_column, v_privilege;
        end if;
      end loop;
    end loop;
  end loop;

  foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE']
  loop
    if not has_table_privilege(
      'service_role',
      'public.client_account_notifications',
      v_privilege
    ) then
      raise exception 'client_account_notifications_service_role_privilege_missing:%',
        v_privilege;
    end if;
  end loop;

  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'client_account_notifications'
      and p.roles && array['public', 'anon', 'authenticated']::name[]
  ) then
    raise exception 'client_account_notifications_permissive_user_policy_present';
  end if;
end
$$;
