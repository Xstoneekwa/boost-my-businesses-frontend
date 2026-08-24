\set ON_ERROR_STOP on

insert into public.clients(id) values ('10000000-0000-0000-0000-000000000001');
insert into public.ig_accounts(id, admin_lifecycle_status) values
  ('20000000-0000-0000-0000-000000000001', 'active'),
  ('20000000-0000-0000-0000-000000000002', 'active'),
  ('20000000-0000-0000-0000-000000000003', 'cancelled'),
  ('20000000-0000-0000-0000-000000000004', 'cancelled');

insert into public.client_account_entitlements(id, client_id, account_id, status) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', null, 'entitlement_reserved'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'entitlement_consumed'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'entitlement_cancelled'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', 'entitlement_cancelled');

insert into public.client_instagram_accounts(id, client_id, account_id, active) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', true),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', true),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', true),
  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', false);

insert into public.commercial_account_lifecycle_operations(id, account_id, operation_type, state) values
  ('50000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'cancel', 'completed'),
  ('50000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 'cancel', 'completed');
insert into public.commercial_account_lifecycle_states(account_id, entitlement_id, stripe_subscription_id, commercial_state, last_operation_id) values
  ('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'sub_terminal', 'cancelled', '50000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004', 'sub_tombstone', 'cancelled', '50000000-0000-0000-0000-000000000004');
insert into public.commercial_stripe_subscriptions(stripe_subscription_id, client_account_entitlement_id, account_id, status) values
  ('sub_terminal', '30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'canceled'),
  ('sub_tombstone', '30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 'canceled');

\ir ../migrations/20260824120000_commercial_account_capacity_projection_v1.sql

do $$
declare v jsonb; v_count integer;
begin
  if (select capacity_status from public.client_instagram_accounts where account_id='20000000-0000-0000-0000-000000000003') <> 'released_terminal' then raise exception 'C terminal backfill failed'; end if;
  if not (select active from public.client_instagram_accounts where account_id='20000000-0000-0000-0000-000000000003') then raise exception 'O historical active link changed'; end if;
  if (select capacity_status from public.client_instagram_accounts where account_id='20000000-0000-0000-0000-000000000004') <> 'occupied' then raise exception 'F tombstone classified'; end if;

  select count(*) into v_count from public.client_account_entitlements where client_id='10000000-0000-0000-0000-000000000001' and status='entitlement_reserved' and account_id is null;
  if v_count <> 1 then raise exception 'I reservation count mismatch'; end if;
  select count(*) into v_count from public.client_instagram_accounts where client_id='10000000-0000-0000-0000-000000000001' and active and capacity_status='occupied';
  if v_count <> 2 then raise exception 'A/B/J linked occupancy mismatch'; end if;

  v := public.release_client_instagram_account_capacity_v1('20000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000003','replay');
  if v->>'status' <> 'already_released_terminal' then raise exception 'D replay not idempotent'; end if;

  begin
    update public.client_instagram_accounts set capacity_status='occupied' where account_id='20000000-0000-0000-0000-000000000003';
    raise exception 'monotonic trigger did not reject reoccupation';
  exception when check_violation then null;
  end;

  if has_function_privilege('anon','public.release_client_instagram_account_capacity_v1(uuid,uuid,text)','EXECUTE') then raise exception 'anon execute leaked'; end if;
  if has_function_privilege('authenticated','public.release_client_instagram_account_capacity_v1(uuid,uuid,text)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
  if not has_function_privilege('service_role','public.release_client_instagram_account_capacity_v1(uuid,uuid,text)','EXECUTE') then raise exception 'service_role execute missing'; end if;
end $$;

-- N: representative 1000+ row population and indexed capacity query.
insert into public.ig_accounts(id, admin_lifecycle_status)
select gen_random_uuid(), 'active' from generate_series(1,1001);
insert into public.client_instagram_accounts(client_id, account_id, active)
select '10000000-0000-0000-0000-000000000001', id, true
from public.ig_accounts where id not in (
  '20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004'
);
analyze public.client_instagram_accounts;
set enable_seqscan = off;
do $$ begin
  if (select count(*) from public.client_instagram_accounts where client_id='10000000-0000-0000-0000-000000000001' and active and capacity_status='occupied') <> 1003 then raise exception 'N scale count mismatch'; end if;
end $$;

select 'COMMERCIAL_ACCOUNT_CAPACITY_POSTGRES = PASS' as result;
