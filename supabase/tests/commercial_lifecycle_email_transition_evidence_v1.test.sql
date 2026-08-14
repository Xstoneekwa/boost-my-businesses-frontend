begin;

do $test$
declare
  v_account_id uuid := gen_random_uuid();
  v_operation_id uuid := gen_random_uuid();
  v_before integer;
  v_after integer;
begin
  insert into public.ig_accounts (id, username, admin_lifecycle_status)
  values (v_account_id, 'lifecycle_email_test_' || substr(v_account_id::text, 1, 8), 'active');

  insert into public.commercial_account_lifecycle_operations (
    id, account_id, operation_type, idempotency_key, state, source_surface
  ) values (
    v_operation_id, v_account_id, 'pause', 'test:' || v_operation_id::text, 'in_progress', 'postgres_contract_test'
  );

  select count(*) into v_before
  from public.ig_action_logs
  where payload ->> 'commercial_lifecycle_operation_id' = v_operation_id::text;

  if v_before <> 0 then
    raise exception 'evidence must not exist before completed transition';
  end if;

  update public.commercial_account_lifecycle_operations
  set state = 'completed', updated_at = now()
  where id = v_operation_id;

  select count(*) into v_after
  from public.ig_action_logs
  where payload ->> 'commercial_lifecycle_operation_id' = v_operation_id::text
    and action_type = 'account_admin_status_changed'
    and message = 'account_paused';

  if v_after <> 1 then
    raise exception 'completed Pause must produce exactly one canonical evidence row, got %', v_after;
  end if;

  update public.commercial_account_lifecycle_operations
  set state = 'completed', updated_at = now()
  where id = v_operation_id;

  select count(*) into v_after
  from public.ig_action_logs
  where payload ->> 'commercial_lifecycle_operation_id' = v_operation_id::text;

  if v_after <> 1 then
    raise exception 'repeated completed refresh must remain idempotent, got %', v_after;
  end if;
end;
$test$;

rollback;
