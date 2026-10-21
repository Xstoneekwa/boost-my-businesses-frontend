-- RPC contract tests only. Canonical cap/count providers are explicit local
-- dependency fixtures below; this does NOT certify the package/Runner E2E gate.
begin;
create table public.fleet_test_caps(account_id uuid primary key, cap integer not null);
create table public.fleet_test_follows(account_id uuid not null, followed_at timestamptz not null);
create function public.account_package_runtime_contract_status(p_account_id uuid)
returns jsonb language sql stable as $$
 select jsonb_build_object('ok',true,'settings',jsonb_build_object('follow_day',
   jsonb_build_object('effective',cap))) from public.fleet_test_caps where account_id=p_account_id;
$$;
create function public.auto_restart_daily_action_counts_v1(p_account_ids uuid[],p_since timestamptz)
returns table(account_id uuid,follow_done bigint) language sql stable as $$
 select f.account_id,count(*) from public.fleet_test_follows f
 where f.account_id=any(p_account_ids) and f.followed_at>=p_since group by f.account_id;
$$;
create function pg_temp.reject_rpc(statement text, expected text)
returns void language plpgsql as $$
begin
 begin
  execute statement;
 exception when others then
  if sqlerrm=expected then return; end if;
  raise;
 end;
 raise exception 'TEST_FAIL_expected_rejection:%',expected;
end $$;

insert into public.ig_accounts(id) values
 ('00000000-0000-0000-0000-000000000401'),('00000000-0000-0000-0000-000000000411');
insert into public.client_instagram_accounts values
 ('00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000402'),
 ('00000000-0000-0000-0000-000000000411','00000000-0000-0000-0000-000000000412');
insert into public.ig_runs values('00000000-0000-0000-0000-000000000404','00000000-0000-0000-0000-000000000401','running');
insert into public.fleet_account_policy_v1(account_id,client_id,revision,hold_state,policy_payload) values
 ('00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000402',1,'REQUESTED','{"emergency_cap":60}'),
 ('00000000-0000-0000-0000-000000000411','00000000-0000-0000-0000-000000000412',1,'REQUESTED','{}');
insert into public.account_run_requests(id,account_id,run_id,claimed_by,status,fleet_runtime_v1)
values('00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000401',
 '00000000-0000-0000-0000-000000000404','fixture-owner','running',
 '{"schema":"FLEET_EXECUTION_AUTHORITY_V1","tenant_id":"00000000-0000-0000-0000-000000000402",
 "account_id":"00000000-0000-0000-0000-000000000401","request_id":"00000000-0000-0000-0000-000000000403",
 "attempt_id":"00000000-0000-0000-0000-000000000404","consumer_instance_id":"fixture-owner",
 "consumer_boot_id":null,"execution_registered":false,"revision":1,"attempt_revision":1,
 "normal_effective_day_cap":120,"canonical_follows_before_run":52,"business_day":"2026-09-06","hold":"REQUESTED"}');
insert into public.fleet_test_caps values('00000000-0000-0000-0000-000000000401',120);
insert into public.fleet_test_follows select '00000000-0000-0000-0000-000000000401'::uuid,clock_timestamp() from generate_series(1,52);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare
 p jsonb:='{"account_id":"00000000-0000-0000-0000-000000000401","request_id":"00000000-0000-0000-0000-000000000403","attempt_id":"00000000-0000-0000-0000-000000000404","consumer_instance_id":"fixture-owner","consumer_boot_id":"B1","revision":1,"registration_intent":"REGISTER_OR_RETRY","child_pid":null}';
 response jsonb; registered jsonb; pg jsonb; proof jsonb; ack jsonb; receipt jsonb; generation text;
 b jsonb; total integer:=0; q uuid:='00000000-0000-0000-0000-000000000403';
begin
 if current_user<>'service_role' then raise exception 'TEST_FAIL_role'; end if;
 registered:=public.fleet_register_execution_attempt_v1(p);
 if registered->'ok' is distinct from 'true'::jsonb or registered->>'consumer_boot_id' is distinct from 'B1'
  or registered->>'owner_generation' is distinct from '1' then raise exception 'TEST_FAIL_initial_registration'; end if;
 total:=total+1;
 response:=public.fleet_register_execution_attempt_v1(p||'{"authority":{"normal_effective_day_cap":999999}}');
 if response is distinct from registered then raise exception 'TEST_FAIL_retry_or_client_authority'; end if;
 total:=total+1;
 perform pg_temp.reject_rpc(format('select public.fleet_register_execution_attempt_v1(%L::jsonb)',p||'{"consumer_boot_id":"B2"}'),'fleet_explicit_succession_required'); total:=total+1;
 perform pg_temp.reject_rpc(format('select public.fleet_register_execution_attempt_v1(%L::jsonb)',p||'{"consumer_instance_id":"wrong"}'),'fleet_owner_attempt_mismatch'); total:=total+1;
 perform pg_temp.reject_rpc(format('select public.fleet_register_execution_attempt_v1(%L::jsonb)',p||'{"revision":0}'),'fleet_stale_owner_revision'); total:=total+1;
 perform pg_temp.reject_rpc(format('select public.fleet_register_execution_attempt_v1(%L::jsonb)',p||'{"tenant_id":"00000000-0000-0000-0000-000000000412"}'),'fleet_account_binding_mismatch'); total:=total+1;
 perform pg_temp.reject_rpc(format('select public.fleet_register_execution_attempt_v1(%L::jsonb)',p||'{"account_id":"00000000-0000-0000-0000-000000000411"}'),'fleet_owner_attempt_mismatch'); total:=total+1;
 generation:=registered#>>'{authority,process_generation}';
 b:=p-'revision'-'registration_intent'-'child_pid';
 pg:=b||jsonb_build_object('process_group_id',12345,'leader_pid',12345,'fleet_revision',1,
  'process_generation',generation,'isolation_version','isolated_process_group_v1');
 ack:=jsonb_build_object('schema','FLEET_CAP_BOUNDARY_ACK_V1','account_id',p->>'account_id',
  'request_id',p->>'request_id','owner_boot_id','B1','revision',1,'boundary','before_candidate_selection',
  'business_day',(clock_timestamp() at time zone 'Africa/Johannesburg')::date::text,
  'canonical_consumed',52,'effective_day_cap',60,'remaining',8);
 perform pg_temp.reject_rpc(format('select public.fleet_ack_cap_revision_v1(%L::jsonb)',p||jsonb_build_object('boundary_ack',ack||'{"boundary":"inside_composite"}')),'fleet_invalid_cap_boundary_evidence'); total:=total+1;
 perform pg_temp.reject_rpc(format('select public.fleet_ack_cap_revision_v1(%L::jsonb)',p||jsonb_build_object('boundary_ack',ack||'{"canonical_consumed":51,"remaining":9}')),'fleet_unreconciled_cap_counters'); total:=total+1;
 response:=public.fleet_ack_cap_revision_v1(p||jsonb_build_object('boundary_ack',ack));
 if response->'ok' is distinct from 'true'::jsonb then raise exception 'TEST_FAIL_cap_ack'; end if;
 total:=total+1;
 if public.fleet_ack_cap_revision_v1(p||jsonb_build_object('boundary_ack',ack)) is distinct from response then raise exception 'TEST_FAIL_cap_retry'; end if;
 total:=total+1;
 perform pg_temp.reject_rpc(format('select public.fleet_ack_cap_revision_v1(%L::jsonb)',p||jsonb_build_object('boundary_ack',ack||'{"remaining":7}')),'fleet_cap_ack_replay_conflict'); total:=total+1;
 perform pg_temp.reject_rpc(format('select public.fleet_ack_cap_revision_v1(%L::jsonb)',p||'{"revision":0}'),'fleet_stale_owner_revision'); total:=total+1;
 perform pg_temp.reject_rpc(format('select public.fleet_ack_cap_revision_v1(%L::jsonb)',p||'{"consumer_boot_id":"stale"}'),'fleet_current_owner_required'); total:=total+1;
 response:=public.fleet_cancel_execution_attempt_v1(p);
 receipt:=response#>'{request,metadata_safe,fleet_cancellation_v1}';
 proof:=p||jsonb_build_object('child_gone',true,'pid',12345,'process_group',pg,'process_group_absent',true,'orphan_proof',null);
 perform pg_temp.reject_rpc(format('select public.fleet_reconcile_execution_attempt_v1(%L::jsonb)',proof-'process_group_absent'),'fleet_terminal_process_proof_required'); total:=total+1;
 perform pg_temp.reject_rpc(format('select public.fleet_reconcile_execution_attempt_v1(%L::jsonb)',proof||'{"process_group_absent":false}'),'fleet_terminal_process_proof_required'); total:=total+1;
 perform pg_temp.reject_rpc(format('select public.fleet_reconcile_execution_attempt_v1(%L::jsonb)',proof||jsonb_build_object('process_group',pg||'{"attempt_id":"00000000-0000-0000-0000-000000000499"}')),'fleet_terminal_process_proof_required'); total:=total+1;
 perform pg_temp.reject_rpc(format('select public.fleet_reconcile_execution_attempt_v1(%L::jsonb)',proof||'{"consumer_boot_id":"stale"}'),'fleet_current_owner_required'); total:=total+1;
 response:=public.fleet_reconcile_execution_attempt_v1(proof);
 if response->'canonical_terminal' is distinct from 'true'::jsonb then raise exception 'TEST_FAIL_reconciliation'; end if;
 total:=total+1;
 if public.fleet_reconcile_execution_attempt_v1(proof) is distinct from response then raise exception 'TEST_FAIL_terminal_retry'; end if;
 total:=total+1;
 if (select metadata_safe->'fleet_cancellation_v1' from public.account_run_requests where id=q) is distinct from receipt then raise exception 'TEST_FAIL_original_receipt_changed'; end if;
 total:=total+1;
 response:=public.fleet_ack_runtime_revision_v1(p);
 if response->>'state' is distinct from 'ACTIVE' then raise exception 'TEST_FAIL_real_reconcile_to_ack'; end if;
 total:=total+1;
 if has_function_privilege('anon','public.fleet_register_execution_attempt_v1(jsonb)','EXECUTE')
  or has_function_privilege('authenticated','public.fleet_reconcile_execution_attempt_v1(jsonb)','EXECUTE')
  or has_function_privilege('anon','public.fleet_ack_cap_revision_v1(jsonb)','EXECUTE')
  or has_table_privilege('service_role','public.fleet_cap_acks_v1','INSERT') then raise exception 'TEST_FAIL_rpc_privileges'; end if;
 total:=total+1;
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform pg_temp.reject_rpc(format('select public.fleet_register_execution_attempt_v1(%L::jsonb)',p),'service_role_required');
 perform pg_temp.reject_rpc(format('select public.fleet_reconcile_execution_attempt_v1(%L::jsonb)',proof),'service_role_required');
 perform pg_temp.reject_rpc(format('select public.fleet_ack_cap_revision_v1(%L::jsonb)',p),'service_role_required');
 total:=total+1;
 raise notice 'OWNER_RPC_SERVICE_ROLE_TESTS=% PASS; CAP_PROVIDER_SCOPE=LOCAL_DEPENDENCY_FIXTURE; INTEGRATED_27_CERT=NOT_ASSERTED',total;
end $$;
rollback;
