\set ON_ERROR_STOP on

-- Historical Tracker-shaped chain: completed cancel followed by a later failed
-- operation in last_operation_id. The migration must select the completed
-- cancel itself, never mutable telemetry.
insert into public.clients values ('10000000-0000-0000-0000-000000000001');
insert into public.ig_accounts values
 ('20000000-0000-0000-0000-000000000001','cancelled'),
 ('20000000-0000-0000-0000-000000000002','cancelled'),
 ('20000000-0000-0000-0000-000000000003','active');
insert into public.client_account_entitlements values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','entitlement_cancelled'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','entitlement_cancelled'),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','entitlement_consumed');
insert into public.commercial_account_lifecycle_operations values
 ('9040c023-a3ec-45f1-a3aa-387e3a06559f','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','cancel','completed','2026-08-20 10:00Z'),
 ('71a1fa41-58e3-4cf3-a5b5-3a47ae45c01c','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','resume','failed','2026-08-21 10:00Z'),
 ('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','cancel','failed','2026-08-20 10:00Z');
insert into public.commercial_account_lifecycle_states values
 ('20000000-0000-0000-0000-000000000001',null,null,'action_required','commercial_subscription_missing','71a1fa41-58e3-4cf3-a5b5-3a47ae45c01c',now()),
 ('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','sub_partial','cancelled',null,'50000000-0000-0000-0000-000000000002',now()),
 ('20000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000003','sub_active','active',null,null,now());
insert into public.commercial_stripe_subscriptions values
 ('sub_tracker','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','canceled'),
 ('sub_partial','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','canceled'),
 ('sub_active','30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003','active');
insert into public.client_instagram_accounts(client_id,account_id,active) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',true),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',true),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003',true);

\ir ../migrations/20260824120000_commercial_account_capacity_projection_v1.sql
\ir ../migrations/20260824204235_commercial_cancel_terminal_monotonicity_v1.sql
\ir ../migrations/20260824205819_commercial_cancel_historical_provenance_reconciliation_v1.sql

do $$
declare v jsonb;
begin
  if (select terminal_cancel_operation_id from public.commercial_account_lifecycle_states where account_id='20000000-0000-0000-0000-000000000001')
      <> '9040c023-a3ec-45f1-a3aa-387e3a06559f'::uuid then raise exception 'K backfill did not select successful cancel'; end if;
  if (select last_operation_id from public.commercial_account_lifecycle_states where account_id='20000000-0000-0000-0000-000000000001')
      <> '71a1fa41-58e3-4cf3-a5b5-3a47ae45c01c'::uuid then raise exception 'F last_operation_id was not preserved'; end if;
  if (select entitlement_id from public.commercial_account_lifecycle_states where account_id='20000000-0000-0000-0000-000000000001')
      <> '30000000-0000-0000-0000-000000000001'::uuid then raise exception 'K canonical entitlement pointer not restored'; end if;
  if (select stripe_subscription_id from public.commercial_account_lifecycle_states where account_id='20000000-0000-0000-0000-000000000001')
      <> 'sub_tracker' then raise exception 'K canonical subscription pointer not restored'; end if;
  if (select capacity_release_reason from public.client_instagram_accounts where account_id='20000000-0000-0000-0000-000000000001')
      <> 'terminal_cancel_historical_provenance_v1' then raise exception 'K historical release provenance missing'; end if;
  if (select capacity_status from public.client_instagram_accounts where account_id='20000000-0000-0000-0000-000000000001') <> 'released_terminal' then raise exception 'G capacity not released'; end if;
  if (select terminal_cancel_operation_id from public.commercial_account_lifecycle_states where account_id='20000000-0000-0000-0000-000000000002') is not null then raise exception 'H partial cancel invented provenance'; end if;

  -- B/D: exact replay converges; a different operation cannot become authority.
  v := public.record_commercial_cancel_terminal_v1('20000000-0000-0000-0000-000000000001','9040c023-a3ec-45f1-a3aa-387e3a06559f','30000000-0000-0000-0000-000000000001','sub_tracker');
  if v->>'status' <> 'already_recorded' then raise exception 'B replay failed'; end if;
  v := public.record_commercial_cancel_terminal_v1('20000000-0000-0000-0000-000000000001','71a1fa41-58e3-4cf3-a5b5-3a47ae45c01c','30000000-0000-0000-0000-000000000001','sub_tracker');
  if v->>'reason' <> 'terminal_cancel_provenance_conflict' then raise exception 'C provenance overwrite allowed'; end if;

  update public.commercial_account_lifecycle_states set last_operation_id=null where account_id='20000000-0000-0000-0000-000000000001';
  if (select terminal_cancel_operation_id from public.commercial_account_lifecycle_states where account_id='20000000-0000-0000-0000-000000000001')
      <> '9040c023-a3ec-45f1-a3aa-387e3a06559f'::uuid then raise exception 'F sticky provenance followed last operation'; end if;

  begin update public.commercial_account_lifecycle_states set commercial_state='active' where account_id='20000000-0000-0000-0000-000000000001'; raise exception 'E lifecycle degraded'; exception when check_violation then null; end;
  begin update public.ig_accounts set admin_lifecycle_status='active' where id='20000000-0000-0000-0000-000000000001'; raise exception 'L admin resurrected'; exception when check_violation then null; end;
  begin update public.client_account_entitlements set status='entitlement_consumed' where id='30000000-0000-0000-0000-000000000001'; raise exception 'L entitlement resurrected'; exception when check_violation then null; end;
  begin update public.commercial_stripe_subscriptions set status='active' where stripe_subscription_id='sub_tracker'; raise exception 'L subscription resurrected'; exception when check_violation then null; end;

  if has_function_privilege('anon','public.record_commercial_cancel_terminal_v1(uuid,uuid,uuid,text)','EXECUTE') then raise exception 'grant leak anon'; end if;
  if has_function_privilege('authenticated','public.record_commercial_cancel_terminal_v1(uuid,uuid,uuid,text)','EXECUTE') then raise exception 'grant leak authenticated'; end if;
  if not has_function_privilege('service_role','public.record_commercial_cancel_terminal_v1(uuid,uuid,uuid,text)','EXECUTE') then raise exception 'service role grant missing'; end if;
end $$;

select 'COMMERCIAL_CANCEL_TERMINAL_MONOTONICITY_POSTGRES = PASS' as result;
