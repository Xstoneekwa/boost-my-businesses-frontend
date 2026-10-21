-- Runs only against an isolated PostgreSQL fixture. This is not HTTP/E2E certification.
create function pg_temp.fixture_owner_authority(a uuid,c uuid) returns void language plpgsql as $$
begin
 update public.fleet_runtime_owners_v1 o set authority_snapshot=jsonb_build_object(
  'schema','FLEET_EXECUTION_AUTHORITY_V1','tenant_id',c,
  'account_id',o.account_id,'request_id',o.request_id,'attempt_id',o.attempt_id,
  'consumer_instance_id',o.consumer_instance_id,'consumer_boot_id',o.consumer_boot_id,
  'process_generation',o.process_generation,'owner_generation',o.owner_generation,
  'execution_registered',true,'revision',p.revision,'attempt_revision',o.registered_revision,
  'normal_effective_day_cap',120,'canonical_follows_before_run',0,
  'business_day',(current_timestamp at time zone 'Africa/Johannesburg')::date::text,
  'hold',p.hold_state,'emergency_cap',p.policy_payload->'emergency_cap')
 from public.fleet_account_policy_v1 p
 where o.account_id=a and p.account_id=o.account_id and p.client_id=c and not o.retired;
 update public.account_run_requests q set fleet_runtime_v1=o.authority_snapshot
 from public.fleet_runtime_owners_v1 o
 where o.account_id=a and not o.retired and q.id=o.request_id
   and q.account_id=o.account_id and q.run_id=o.attempt_id and q.claimed_by=o.consumer_instance_id;
end $$;
begin;
create temporary table fleet_test_results(name text primary key);
create function pg_temp.check_case(p_name text,p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAIL: %',p_name; end if;
  insert into fleet_test_results values(p_name);
end;
$$;
create function pg_temp.reject_case(p_name text,p_sql text,p_error text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm=p_error then
      perform pg_temp.check_case(p_name,true);
      return;
    end if;
    raise;
  end;
  raise exception 'FAIL: % did not reject',p_name;
end;
$$;

insert into public.ig_accounts(id) values('00000000-0000-4000-8000-000000000001');
insert into public.client_instagram_accounts(account_id,client_id)
values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
select pg_temp.check_case('no_policy',public.fleet_admission_reason_v1('00000000-0000-4000-8000-000000000001') is null);
insert into public.fleet_account_policy_v1(account_id,client_id,revision,hold_state)
values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',1,'REQUESTED');
select pg_temp.check_case('requested_blocks',public.fleet_admission_reason_v1('00000000-0000-4000-8000-000000000001')='fleet_hold_requested');
select pg_temp.reject_case('creation_blocks',
  $q$select public.create_account_run_request('00000000-0000-4000-8000-000000000001',null,'admin','fixture','account_session','fixture',0,'{}')$q$,
  'fleet_hold_requested');
select pg_temp.reject_case('admission_blocks',
  $q$select public.admit_account_run_attempt_v1('00000000-0000-4000-8000-000000000001','fixture',null,null,null,'fixture',null,null,300)$q$,
  'fleet_hold_requested');
select pg_temp.reject_case('missing_all_owners_blocks',
  $q$update public.fleet_account_policy_v1 set hold_state='ACTIVE'$q$,
  'fleet_current_revision_convergence_unproven');

insert into public.ig_runs(id,account_id,status) values
('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','completed'),
('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000001','completed');
insert into public.account_run_requests(id,account_id,run_id,claimed_by,status) values
('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000021','owner-a','completed'),
('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000022','owner-b','completed');
insert into public.fleet_runtime_owners_v1(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,
  registered_revision,terminal_reconciled,process_group_absent,isolation_version,process_generation)
select account_id,claimed_by,'boot-'||claimed_by,id,run_id,1,true,true,'isolated_process_group_v1','generation-'||claimed_by
from public.account_run_requests;
select pg_temp.reject_case('missing_owner_authority_snapshot_rejected',
  $q$update public.fleet_account_policy_v1 set revision=2,hold_state='REQUESTED',policy_payload='{"emergency_cap":40}'$q$,
  'fleet_owner_authority_sync_required');
-- Synthetic registered owners must carry the same durable authority as their
-- request projection. The negative case above deliberately omits it.
update public.fleet_runtime_owners_v1 o set authority_snapshot=jsonb_build_object(
  'schema','FLEET_EXECUTION_AUTHORITY_V1',
  'tenant_id','00000000-0000-4000-8000-000000000002',
  'account_id',o.account_id,'request_id',o.request_id,'attempt_id',o.attempt_id,
  'consumer_instance_id',o.consumer_instance_id,'consumer_boot_id',o.consumer_boot_id,
  'process_generation',o.process_generation,'owner_generation',o.owner_generation,
  'execution_registered',true,'revision',1,'attempt_revision',1,
  'normal_effective_day_cap',120,'canonical_follows_before_run',0,
  'business_day',(current_timestamp at time zone 'Africa/Johannesburg')::date::text,
  'hold','REQUESTED','emergency_cap',null);
update public.account_run_requests q set fleet_runtime_v1=o.authority_snapshot
from public.fleet_runtime_owners_v1 o
where q.id=o.request_id and q.account_id=o.account_id and q.run_id=o.attempt_id
  and q.claimed_by=o.consumer_instance_id;
insert into public.fleet_runtime_acks_v1
select account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,1,'HOLD',process_generation
from public.fleet_runtime_owners_v1 where consumer_instance_id='owner-a';
select pg_temp.reject_case('partial_ack_blocks',
  $q$update public.fleet_account_policy_v1 set hold_state='ACTIVE'$q$,
  'fleet_current_revision_convergence_unproven');
select pg_temp.reject_case('stale_ack_rejected',
  $q$insert into public.fleet_runtime_acks_v1 select account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,0,'HOLD',process_generation from public.fleet_runtime_owners_v1 where consumer_instance_id='owner-b'$q$,
  'fleet_stale_ack');
select pg_temp.reject_case('misbound_boot_rejected',
  $q$insert into public.fleet_runtime_acks_v1 select account_id,consumer_instance_id,'old-boot',request_id,attempt_id,1,'HOLD',process_generation from public.fleet_runtime_owners_v1 where consumer_instance_id='owner-b'$q$,
  'fleet_misbound_owner_ack');
insert into public.fleet_runtime_acks_v1
select account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,1,'HOLD',process_generation
from public.fleet_runtime_owners_v1 where consumer_instance_id='owner-b';
update public.fleet_account_policy_v1 set hold_state='ACTIVE';
select pg_temp.check_case('all_exact_acks_active_same_revision',
  (select hold_state='ACTIVE' and revision=1 from public.fleet_account_policy_v1));
select pg_temp.check_case('active_still_blocks',public.fleet_admission_reason_v1('00000000-0000-4000-8000-000000000001')='fleet_hold_active');
select pg_temp.reject_case('same_revision_payload_change_rejected',
  $q$update public.fleet_account_policy_v1 set policy_payload='{"emergency_cap":40}'$q$,
  'fleet_policy_mutation_requires_revision');

savepoint cap_change;
update public.fleet_account_policy_v1 set revision=2,hold_state='REQUESTED',policy_payload='{"emergency_cap":40}';
select pg_temp.reject_case('old_acks_cannot_activate_new_cap_revision',
  $q$update public.fleet_account_policy_v1 set hold_state='ACTIVE'$q$,
  'fleet_current_revision_convergence_unproven');
-- Preserve the test result while restoring the policy scenario independently.
rollback to cap_change;
select pg_temp.check_case('new_cap_invalidates_old_acks',true);

update public.fleet_account_policy_v1 set revision=2,hold_state='RELEASING';
select pg_temp.check_case('releasing_blocks',public.fleet_admission_reason_v1('00000000-0000-4000-8000-000000000001')='fleet_hold_releasing');
select pg_temp.reject_case('release_requires_own_revision_acks',
  $q$update public.fleet_account_policy_v1 set hold_state='CLEARED'$q$,
  'fleet_current_revision_convergence_unproven');
insert into public.fleet_runtime_acks_v1
select account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,2,'RELEASE',process_generation
from public.fleet_runtime_owners_v1;
update public.fleet_account_policy_v1 set hold_state='CLEARED';
select pg_temp.check_case('release_cleared_same_revision',
  (select hold_state='CLEARED' and revision=2 from public.fleet_account_policy_v1));
select pg_temp.check_case('cleared_removes_fleet_only',public.fleet_admission_reason_v1('00000000-0000-4000-8000-000000000001') is null);
select pg_temp.reject_case('new_hold_same_revision_rejected',
  $q$update public.fleet_account_policy_v1 set hold_state='REQUESTED'$q$,
  'fleet_policy_mutation_requires_revision');
update public.fleet_account_policy_v1 set revision=3,hold_state='REQUESTED';
select pg_temp.check_case('new_hold_revision_three',
  (select hold_state='REQUESTED' and revision=3 from public.fleet_account_policy_v1));
insert into public.fleet_runtime_acks_v1
select account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,3,'HOLD',process_generation
from public.fleet_runtime_owners_v1;
insert into public.account_run_requests(id,account_id,status)
values('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001','queued');
select pg_temp.reject_case('unresolved_attempt_blocks_even_with_all_acks',
  $q$update public.fleet_account_policy_v1 set hold_state='ACTIVE'$q$,
  'fleet_current_revision_convergence_unproven');
select pg_temp.check_case('public_access_denied',
  not has_table_privilege('anon','public.fleet_account_policy_v1','SELECT')
  and not has_function_privilege('authenticated','public.assert_fleet_admission_v1(uuid)','EXECUTE'));
select pg_temp.check_case('service_cannot_forge_proofs',
  not has_table_privilege('service_role','public.fleet_runtime_owners_v1','INSERT')
  and not has_table_privilege('service_role','public.fleet_runtime_acks_v1','INSERT'));
select json_build_object('BACKEND_SQL_TESTS',count(*),'RESULT','PASS','SCOPE','LOCAL_GUARD_FIXTURES') from fleet_test_results;
-- Real cancellation RPC against a local request/owner fixture. No business
-- table may be written by this operation and no terminal status is fabricated.
set local request.jwt.claim.role = 'service_role';
do $$
declare
  a uuid := '00000000-0000-0000-0000-000000000091';
  c uuid := '00000000-0000-0000-0000-000000000092';
  q uuid := '00000000-0000-0000-0000-000000000093';
  r uuid := '00000000-0000-0000-0000-000000000094';
  payload jsonb;
  result jsonb;
  repeated jsonb;
begin
  insert into public.ig_accounts(id) values(a);
  insert into public.client_instagram_accounts(account_id,client_id) values(a,c);
  insert into public.fleet_account_policy_v1(account_id,client_id,revision,hold_state) values(a,c,1,'REQUESTED');
  insert into public.ig_runs(id,account_id,status) values(r,a,'running');
  insert into public.account_run_requests(id,account_id,run_id,claimed_by,status,metadata_safe)
    values(q,a,r,'fixture-worker','running','{"existing":"preserved"}');
  insert into public.fleet_runtime_owners_v1(account_id,consumer_instance_id,consumer_boot_id,
    request_id,attempt_id,registered_revision,isolation_version,process_generation)
    values(a,'fixture-worker','fixture-boot',q,r,1,'isolated_process_group_v1','fixture-generation');
  perform pg_temp.fixture_owner_authority(a,c);
  payload := jsonb_build_object('account_id',a,'request_id',q,'attempt_id',r,
    'consumer_instance_id','fixture-worker','consumer_boot_id','fixture-boot','revision',1);
  result := public.fleet_cancel_execution_attempt_v1(payload);
  perform pg_temp.check_case('fleet_cancel_explicit_source',
    result #>> '{request,metadata_safe,fleet_cancellation_v1,termination_source}' = 'fleet_control');
  perform pg_temp.check_case('fleet_cancel_not_operator_override', result #>> '{request,cancel_reason}' = 'fleet_hold');
  perform pg_temp.check_case('fleet_cancel_does_not_fake_terminal', result #>> '{request,status}' = 'running');
  perform pg_temp.check_case('fleet_cancel_preserves_metadata', result #>> '{request,metadata_safe,existing}' = 'preserved');
  repeated := public.fleet_cancel_execution_attempt_v1(payload);
  perform pg_temp.check_case('fleet_cancel_idempotent', result = repeated);
  perform pg_temp.reject_case('fleet_cancel_stale_revision',
    format('select public.fleet_cancel_execution_attempt_v1(%L::jsonb)', payload || '{"revision":0}'),
    'fleet_cancellation_policy_mismatch');
  perform pg_temp.reject_case('fleet_cancel_stale_owner',
    format('select public.fleet_cancel_execution_attempt_v1(%L::jsonb)', payload || '{"consumer_boot_id":"stale"}'),
    'fleet_cancellation_owner_mismatch');
  update public.account_run_requests set cancel_reason='manual_stop',
    metadata_safe=metadata_safe - 'fleet_cancellation_v1' where id=q;
  result := public.fleet_cancel_execution_attempt_v1(payload);
  perform pg_temp.check_case('fleet_cancel_preserves_first_individual_stop',
    result #>> '{request,cancel_reason}' = 'manual_stop'
    and not ((result #> '{request,metadata_safe}') ? 'fleet_cancellation_v1'));
end;
$$;
do $$
declare
  a uuid := '00000000-0000-0000-0000-000000000091';
  q uuid := '00000000-0000-0000-0000-000000000093';
  r uuid := '00000000-0000-0000-0000-000000000094';
  binding jsonb;
  receipt jsonb;
  evidence jsonb;
  payload jsonb;
  result jsonb;
  original_stop timestamptz;
  revision_number integer;
begin
  binding := jsonb_build_object('account_id',a,'request_id',q,'attempt_id',r,
    'consumer_instance_id','fixture-worker','consumer_boot_id','fixture-boot');
  receipt := binding || '{"revision":1,"termination_source":"fleet_control","termination_reason":"fleet_hold"}'::jsonb;
  evidence := binding || '{"process_generation":"fixture-generation","terminal_state":"canceled","process_group_absent":true,"termination_source":"fleet_control"}'::jsonb;
  update public.account_run_requests set status='canceled',cancel_reason='fleet_hold',
    metadata_safe=jsonb_build_object('fleet_cancellation_v1',receipt) where id=q;
  select cancel_requested_at into original_stop from public.account_run_requests where id=q;
  update public.ig_runs set status='canceled' where id=r;
  update public.fleet_runtime_owners_v1 set terminal_reconciled=true,process_group_absent=true where account_id=a;
  insert into public.fleet_terminal_receipts_v1(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,
    process_generation,terminal_state,cancellation_receipt,terminal_evidence,evidence_sha256)
    values(a,'fixture-worker','fixture-boot',q,r,'fixture-generation','canceled',receipt,evidence,
      encode(sha256(convert_to(evidence::text,'UTF8')),'hex'));
  perform pg_temp.check_case('durable_receipt_exact_terminal_binding',public.fleet_terminal_receipt_valid_v1(binding,receipt));
  perform pg_temp.check_case('durable_receipt_wrong_attempt_rejected',not public.fleet_terminal_receipt_valid_v1(
    binding || '{"attempt_id":"00000000-0000-0000-0000-000000000099"}',receipt));
  perform pg_temp.check_case('durable_receipt_wrong_request_rejected',not public.fleet_terminal_receipt_valid_v1(
    binding || '{"request_id":"00000000-0000-0000-0000-000000000099"}',receipt));
  perform pg_temp.check_case('durable_receipt_wrong_account_rejected',not public.fleet_terminal_receipt_valid_v1(
    binding || '{"account_id":"00000000-0000-0000-0000-000000000099"}',receipt));
  perform pg_temp.check_case('durable_receipt_corruption_rejected',not public.fleet_terminal_receipt_valid_v1(
    binding,receipt || '{"termination_source":"operator"}'));
  insert into public.fleet_runtime_acks_v1(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,revision,ack_kind,process_generation)
    values(a,'fixture-worker','fixture-boot',q,r,1,'HOLD','fixture-generation');
  update public.fleet_account_policy_v1 set hold_state='ACTIVE' where account_id=a;
  update public.fleet_account_policy_v1 set revision=2,hold_state='REQUESTED',policy_payload='{"cap":40}' where account_id=a;
  payload := binding || '{"revision":2}';
  result := public.fleet_cancel_execution_attempt_v1(payload);
  perform pg_temp.check_case('old_receipt_preserved_at_new_revision',
    result #> '{request,metadata_safe,fleet_cancellation_v1}' = receipt and result->>'revision'='2');
  perform pg_temp.check_case('no_duplicate_cancellation',
    (result #>> '{request,cancel_requested_at}')::timestamptz = original_stop);
  perform pg_temp.reject_case('old_ack_cannot_activate_new_revision',
    format('update public.fleet_account_policy_v1 set hold_state=''ACTIVE'' where account_id=%L',a),
    'fleet_current_revision_convergence_unproven');
  update public.account_run_requests set status='running' where id=q;
  perform pg_temp.reject_case('receipt_cannot_prove_nonterminal_request',
    format('select public.fleet_cancel_execution_attempt_v1(%L::jsonb)',payload),
    'fleet_durable_terminal_receipt_unproven');
  update public.account_run_requests set status='canceled' where id=q;
  insert into public.account_run_requests(id,account_id,status) values('00000000-0000-0000-0000-000000000097',a,'queued');
  perform pg_temp.reject_case('receipt_cannot_cover_new_open_attempt',
    format('select public.fleet_cancel_execution_attempt_v1(%L::jsonb)',payload),
    'fleet_durable_terminal_receipt_unproven');
  delete from public.account_run_requests where id='00000000-0000-0000-0000-000000000097';
  perform pg_temp.reject_case('terminal_receipt_update_forbidden',
    format('update public.fleet_terminal_receipts_v1 set terminal_state=''failed'' where account_id=%L',a),
    'fleet_terminal_receipt_immutable');
  perform pg_temp.reject_case('terminal_receipt_delete_forbidden',
    format('delete from public.fleet_terminal_receipts_v1 where account_id=%L',a),
    'fleet_terminal_receipt_immutable');
  perform pg_temp.check_case('terminal_receipt_service_write_denied',
    not has_table_privilege('service_role','public.fleet_terminal_receipts_v1','INSERT'));
  for revision_number in 2..4 loop
    if revision_number > 2 then
      update public.fleet_account_policy_v1 set revision=revision_number,hold_state='REQUESTED',
        policy_payload=jsonb_build_object('cap',40-revision_number) where account_id=a;
    end if;
    result := public.fleet_cancel_execution_attempt_v1(binding || jsonb_build_object('revision',revision_number));
    perform pg_temp.check_case('receipt_stable_revision_' || revision_number,
      result #> '{request,metadata_safe,fleet_cancellation_v1}' = receipt);
    insert into public.fleet_runtime_acks_v1(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,revision,ack_kind,process_generation)
      values(a,'fixture-worker','fixture-boot',q,r,revision_number,'HOLD','fixture-generation');
    update public.fleet_account_policy_v1 set hold_state='ACTIVE' where account_id=a;
    perform pg_temp.check_case('exact_current_ack_activates_revision_' || revision_number,
      (select hold_state='ACTIVE' and revision=revision_number from public.fleet_account_policy_v1 where account_id=a));
  end loop;
end;
$$;
select jsonb_build_object('BACKEND_SQL_TESTS', count(*) || '/' || count(*) || ' PASS',
  'SCOPE', 'LOCAL_GUARD_AND_CANCELLATION_RPC_FIXTURES') from fleet_test_results;
rollback;

-- Real local successor RPC, including rejection of noncanonical terminal receipts.
begin;
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare
 a uuid := '00000000-0000-0000-0000-000000000201';
 c uuid := '00000000-0000-0000-0000-000000000202';
 q uuid := '00000000-0000-0000-0000-000000000203';
 r uuid := '00000000-0000-0000-0000-000000000204';
 b jsonb; receipt jsonb; evidence jsonb; authority jsonb; proposal jsonb; payload jsonb;
 result jsonb; retry_result jsonb; expected_hash text; tests integer := 0; calls integer := 0;
begin
 insert into public.ig_accounts values(a);
 insert into public.client_instagram_accounts values(a,c);
 insert into public.ig_runs values(r,a,'canceled');
 b := jsonb_build_object('account_id',a,'request_id',q,'attempt_id',r,'consumer_instance_id','fixture-instance','consumer_boot_id','B1');
 receipt := b || '{"revision":1,"termination_source":"fleet_control","termination_reason":"fleet_hold"}'::jsonb;
 evidence := b || '{"process_generation":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","terminal_state":"canceled","process_group_absent":true,"process_group_id":12345,"termination_source":"fleet_control"}'::jsonb;
 expected_hash := encode(sha256(convert_to(evidence::text,'UTF8')),'hex');
 authority := b || jsonb_build_object('schema','FLEET_EXECUTION_AUTHORITY_V1','tenant_id',c,'revision',1,'attempt_revision',1,'execution_registered',true,'hold_state','ACTIVE','normal_cap',120,'canonical_baseline',0,'emergency_cap',60,'business_day','2026-09-06');
 insert into public.account_run_requests(id,account_id,run_id,claimed_by,status,cancel_requested_at,cancel_reason,metadata_safe,fleet_runtime_v1)
 values(q,a,r,'fixture-instance','canceled',now(),'fleet_hold',jsonb_build_object('fleet_cancellation_v1',receipt),authority);
 insert into public.fleet_account_policy_v1(account_id,client_id,revision,hold_state,policy_payload) values(a,c,1,'REQUESTED','{"emergency_cap":60}');
 insert into public.fleet_runtime_owners_v1(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,registered_revision,terminal_reconciled,process_group_absent,isolation_version,process_generation,authority_snapshot)
 values(a,'fixture-instance','B1',q,r,1,true,true,'isolated_process_group_v1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',authority);
 perform pg_temp.fixture_owner_authority(a,c);
 proposal := jsonb_build_object('schema','FLEET_OWNER_SUCCESSION_V1','previous_binding',b,'previous_generation',1,'old_owner_reconciled',true,'old_attempts_open',0,'old_process_group_quiescent',true,'process_group_id',12345,'process_generation','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','terminal_evidence_sha256',expected_hash,'observed_process_group_absent',true);
 payload := b || jsonb_build_object('consumer_boot_id','B2','revision',1,'registration_intent','REGISTER_SUCCESSOR','succession',proposal);
 -- Deliberately noncanonical receipt, confined to an automatically rolled-back subtransaction.
 begin
  insert into public.fleet_terminal_receipts_v1(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,process_generation,terminal_state,cancellation_receipt,terminal_evidence,evidence_sha256)
  values(a,'fixture-instance','B1',q,r,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','canceled',(receipt-'termination_reason') || '{"reason":"fleet_hold"}'::jsonb,evidence,expected_hash);
  calls:=calls+1;
  perform public.fleet_succeed_execution_owner_v1(payload);
  raise exception 'TEST_FAIL_noncanonical_reason_accepted';
 exception when others then
  if sqlerrm <> 'fleet_successor_terminal_proof_unproven' then raise; end if;
 end;
 tests:=tests+1;
 insert into public.fleet_terminal_receipts_v1(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,process_generation,terminal_state,cancellation_receipt,terminal_evidence,evidence_sha256)
 values(a,'fixture-instance','B1',q,r,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','canceled',receipt,evidence,expected_hash);
 insert into public.fleet_runtime_acks_v1(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,revision,ack_kind,process_generation)
 values(a,'fixture-instance','B1',q,r,1,'HOLD','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
 update public.fleet_account_policy_v1 set hold_state='ACTIVE' where account_id=a;
 begin
  update public.fleet_runtime_owners_v1 set terminal_reconciled=false where account_id=a;
  calls:=calls+1;
  perform public.fleet_succeed_execution_owner_v1(payload);
  raise exception 'TEST_FAIL_unreconciled_owner_accepted';
 exception when others then
  if sqlerrm <> 'fleet_successor_terminal_proof_unproven' then raise; end if;
 end;
 if not exists(select 1 from public.fleet_runtime_owners_v1 where account_id=a and consumer_boot_id='B1' and not retired and terminal_reconciled) then raise exception 'TEST_FAIL_failed_handoff_not_atomic'; end if;
 tests:=tests+1;
 begin
  update public.fleet_runtime_owners_v1 set process_group_absent=false where account_id=a;
  calls:=calls+1;
  perform public.fleet_succeed_execution_owner_v1(payload);
  raise exception 'TEST_FAIL_live_group_accepted';
 exception when others then
  if sqlerrm <> 'fleet_successor_terminal_proof_unproven' then raise; end if;
 end;
 tests:=tests+1;
 calls:=calls+1;
 result := public.fleet_succeed_execution_owner_v1(payload);
 if result->>'consumer_boot_id'<>'B2' or result->>'owner_generation'<>'2' or result->>'revision'<>'1' then raise exception 'TEST_FAIL_successor_response'; end if;
 tests:=tests+1;
 if (select count(*) from public.fleet_runtime_owners_v1 where account_id=a and not retired)<>1 or not exists(select 1 from public.fleet_runtime_owners_v1 where account_id=a and consumer_boot_id='B1' and retired) then raise exception 'TEST_FAIL_dual_owner'; end if;
 tests:=tests+1;
 if (select hold_state from public.fleet_account_policy_v1 where account_id=a)<>'REQUESTED' or public.fleet_current_revision_converged_v1(a,1,'HOLD') then raise exception 'TEST_FAIL_old_ack_inherited'; end if;
 tests:=tests+1;
 calls:=calls+1;
 retry_result := public.fleet_succeed_execution_owner_v1(payload);
 if retry_result is distinct from result then raise exception 'TEST_FAIL_retry_not_idempotent'; end if;
 tests:=tests+1;
 begin
  calls:=calls+1;
  perform public.fleet_succeed_execution_owner_v1(payload || '{"consumer_boot_id":"B1"}'::jsonb);
  raise exception 'TEST_FAIL_old_boot_resurrected';
 exception when others then
  if sqlerrm <> 'fleet_retired_boot_fenced' then raise; end if;
 end;
 tests:=tests+1;
 begin
  calls:=calls+1;
  perform public.fleet_succeed_execution_owner_v1(payload || '{"consumer_boot_id":"B3"}'::jsonb);
  raise exception 'TEST_FAIL_third_boot_hopped';
 exception when others then
  if sqlerrm <> 'fleet_successor_predecessor_mismatch' then raise; end if;
 end;
 tests:=tests+1;
 begin
  insert into public.fleet_runtime_acks_v1(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,revision,ack_kind,process_generation)
  values(a,'fixture-instance','B1',q,r,1,'HOLD','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  raise exception 'TEST_FAIL_old_ack_accepted';
 exception when others then
  if sqlerrm <> 'fleet_misbound_owner_ack' then raise; end if;
 end;
 tests:=tests+1;
 update public.fleet_account_policy_v1 set revision=2,policy_payload='{"emergency_cap":40}' where account_id=a;
 begin
  calls:=calls+1;
  perform public.fleet_succeed_execution_owner_v1(payload);
  raise exception 'TEST_FAIL_stale_revision_accepted';
 exception when others then
  if sqlerrm <> 'fleet_stale_successor_revision' then raise; end if;
 end;
 tests:=tests+1;
 raise notice 'SUCCESSION_SQL_RPC_TESTS=% PASS; REAL_LOCAL_SQL_RPC_CALLS=%; NON_CANONICAL_REASON_FIELD_ACCEPTED=NO',tests,calls;
end $$;
rollback;
-- Runtime ACK RPC: pre-existing owner reconciliation is a fixture, not an E2E claim.

begin;
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare
 a uuid:='00000000-0000-0000-0000-000000000301';
 c uuid:='00000000-0000-0000-0000-000000000302';
 q1 uuid:='00000000-0000-0000-0000-000000000303';
 q2 uuid:='00000000-0000-0000-0000-000000000304';
 r1 uuid:='00000000-0000-0000-0000-000000000305';
 r2 uuid:='00000000-0000-0000-0000-000000000306';
 p1 jsonb; p2 jsonb; response jsonb; saved jsonb; total integer:=0;
begin
 insert into public.ig_accounts values(a);
 insert into public.client_instagram_accounts values(a,c);
 insert into public.ig_runs values(r1,a,'canceled'),(r2,a,'canceled');
 insert into public.account_run_requests(id,account_id,run_id,claimed_by,status)
 values(q1,a,r1,'A','canceled'),(q2,a,r2,'B','canceled');
 insert into public.fleet_account_policy_v1(account_id,client_id,revision,hold_state)
 values(a,c,1,'REQUESTED');
 insert into public.fleet_runtime_owners_v1(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,registered_revision,terminal_reconciled,process_group_absent,isolation_version,process_generation)
 values(a,'A','B1',q1,r1,1,true,true,'isolated_process_group_v1','generation-A'),
       (a,'B','B1',q2,r2,1,true,true,'isolated_process_group_v1','generation-B');
 perform pg_temp.fixture_owner_authority(a,c);
 -- Setup above is fixture-only; the RPC and convergence tests run as service_role.
 execute 'set local role service_role';
 if current_user <> 'service_role' then raise exception 'TEST_FAIL_service_role_not_active'; end if;
 if not has_table_privilege(current_user,'public.ig_accounts','SELECT')
    or not has_table_privilege(current_user,'public.ig_accounts','UPDATE') then
   raise exception 'TEST_FAIL_canonical_fixture_privilege_parity';
 end if;
 p1:=jsonb_build_object('account_id',a,'request_id',q1,'attempt_id',r1,'consumer_instance_id','A','consumer_boot_id','B1','revision',1);
 p2:=jsonb_build_object('account_id',a,'request_id',q2,'attempt_id',r2,'consumer_instance_id','B','consumer_boot_id','B1','revision',1);
 response:=public.fleet_ack_runtime_revision_v1(p1);
 if response->>'state' is distinct from 'REQUESTED' or response->'converged' is distinct from 'false'::jsonb then raise exception 'TEST_FAIL_partial_ack'; end if;
 total:=total+1;
 response:=public.fleet_ack_runtime_revision_v1(p2);
 if response->>'state' is distinct from 'ACTIVE' or response->>'revision' is distinct from '1' then raise exception 'TEST_FAIL_full_ack_same_revision'; end if;
 total:=total+1;
 saved:=response;
 response:=public.fleet_ack_runtime_revision_v1(p2);
 if response is distinct from saved or (select count(*) from public.fleet_runtime_acks_v1 where account_id=a)<>2 then raise exception 'TEST_FAIL_ack_retry'; end if;
 total:=total+1;
 begin
  perform public.fleet_ack_runtime_revision_v1(p1 || '{"revision":0}'::jsonb);
  raise exception 'TEST_FAIL_stale_ack';
 exception when others then
  if sqlerrm<>'fleet_stale_ack' then raise; end if;
 end;
 total:=total+1;
 begin
  perform public.fleet_ack_runtime_revision_v1(p1 || '{"consumer_boot_id":"unregistered"}'::jsonb);
  raise exception 'TEST_FAIL_misbound_ack';
 exception when others then
  if sqlerrm<>'fleet_misbound_owner_ack' then raise; end if;
 end;
 total:=total+1;
 update public.fleet_account_policy_v1 set revision=2,hold_state='REQUESTED',policy_payload='{"emergency_cap":40}' where account_id=a;
 begin
  perform public.fleet_ack_runtime_revision_v1(p1);
  raise exception 'TEST_FAIL_previous_policy_ack';
 exception when others then
  if sqlerrm<>'fleet_stale_ack' then raise; end if;
 end;
 total:=total+1;
 p1:=p1||'{"revision":2}'::jsonb; p2:=p2||'{"revision":2}'::jsonb;
 response:=public.fleet_ack_runtime_revision_v1(p1);
 if response->>'state' is distinct from 'REQUESTED' then raise exception 'TEST_FAIL_new_revision_partial'; end if;
 response:=public.fleet_ack_runtime_revision_v1(p2);
 if response->>'state' is distinct from 'ACTIVE' or response->>'revision' is distinct from '2' then raise exception 'TEST_FAIL_new_revision_full'; end if;
 total:=total+1;
 update public.fleet_account_policy_v1 set revision=3,hold_state='RELEASING' where account_id=a;
 p1:=p1||'{"revision":3}'::jsonb; p2:=p2||'{"revision":3}'::jsonb;
 response:=public.fleet_ack_runtime_revision_v1(p1);
 if response->>'state' is distinct from 'RELEASING' then raise exception 'TEST_FAIL_release_partial'; end if;
 total:=total+1;
 response:=public.fleet_ack_runtime_revision_v1(p2);
 if response->>'state' is distinct from 'CLEARED' or response->>'revision' is distinct from '3' then raise exception 'TEST_FAIL_release_full'; end if;
 total:=total+1;
 if has_function_privilege('anon','public.fleet_ack_runtime_revision_v1(jsonb)','EXECUTE')
 or has_function_privilege('authenticated','public.fleet_ack_runtime_revision_v1(jsonb)','EXECUTE')
 or not has_function_privilege('service_role','public.fleet_ack_runtime_revision_v1(jsonb)','EXECUTE')
 or has_table_privilege('service_role','public.fleet_runtime_owners_v1','UPDATE')
 or has_table_privilege('service_role','public.fleet_runtime_acks_v1','INSERT') then raise exception 'TEST_FAIL_ack_privileges'; end if;
 total:=total+1;
 perform set_config('request.jwt.claim.role','authenticated',true);
 begin
  perform public.fleet_ack_runtime_revision_v1(p1);
  raise exception 'TEST_FAIL_untrusted_role';
 exception when insufficient_privilege then
  if sqlerrm<>'service_role_required' then raise; end if;
 end;
 total:=total+1;
 raise notice 'RUNTIME_ACK_SQL_RPC_TESTS=% PASS; SCOPE=REAL_RPC_WITH_PERSISTED_OWNER_FIXTURES',total;
end $$;
rollback;
