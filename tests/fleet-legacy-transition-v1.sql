-- Local PostgreSQL fixture only. Historical termination is simulated by updating
-- fixture rows, never by calling Stop, killing a Worker, or fabricating a receipt.
begin;
create function pg_temp.check_legacy(ok boolean, label text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %',label; end if;
  raise notice 'PASS: %',label;
end $$;
insert into public.ig_accounts values
 ('00000000-0000-0000-0000-000000000601'),('00000000-0000-0000-0000-000000000602');
insert into public.client_instagram_accounts values
 ('00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-000000000610'),
 ('00000000-0000-0000-0000-000000000602','00000000-0000-0000-0000-000000000620');
insert into public.fleet_account_policy_v1(account_id,client_id,revision,hold_state)
 values('00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-000000000610',1,'REQUESTED');
insert into public.ig_runs values
 ('00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000000601','running'),
 ('00000000-0000-0000-0000-000000000612','00000000-0000-0000-0000-000000000601','running'),
 ('00000000-0000-0000-0000-000000000621','00000000-0000-0000-0000-000000000602','running');
insert into public.account_run_requests(id,account_id,run_id,claimed_by,status) values
 ('00000000-0000-0000-0000-000000000631','00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-000000000611','legacy-consumer','running'),
 ('00000000-0000-0000-0000-000000000632','00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-000000000612','legacy-consumer','running');
set local role service_role;
set local request.jwt.claim.role='service_role';
select pg_temp.check_legacy(public.fleet_legacy_execution_count_v1('00000000-0000-0000-0000-000000000601')=2,'two legacy runs counted without duplicating linked requests');
select pg_temp.check_legacy(public.fleet_legacy_execution_count_v1('00000000-0000-0000-0000-000000000602')=1,'orphan run blocks independently in its account');
select pg_temp.check_legacy(public.fleet_transition_status_v1('00000000-0000-0000-0000-000000000601') @>
 '{"hold_state":"REQUESTED","transition_state":"WAITING_LEGACY_EXECUTION","reason":"legacy_unverifiable_execution","zero_legacy_gate":false,"admission_reason":"fleet_hold_requested"}', 'explicit waiting projection');
select pg_temp.check_legacy(not public.fleet_current_revision_converged_v1('00000000-0000-0000-0000-000000000601',1,'HOLD'),'legacy forbids convergence');
do $$ begin
  begin
    perform public.assert_fleet_admission_v1('00000000-0000-0000-0000-000000000601');
    raise exception 'admission unexpectedly allowed';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'fleet_hold_requested' then raise; end if;
  end;
  perform pg_temp.check_legacy(true,'canonical admission blocked');
  begin
    update public.fleet_account_policy_v1 set hold_state='ACTIVE' where account_id='00000000-0000-0000-0000-000000000601';
    raise exception 'ACTIVE unexpectedly accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'fleet_current_revision_convergence_unproven' then raise; end if;
  end;
  perform pg_temp.check_legacy(true,'direct ACTIVE transition rejected');
end $$;
select pg_temp.check_legacy(not exists(select 1 from public.fleet_runtime_owners_v1 where account_id='00000000-0000-0000-0000-000000000601'),'no adopted owner');
select pg_temp.check_legacy(not exists(select 1 from public.fleet_runtime_acks_v1 where account_id='00000000-0000-0000-0000-000000000601'),'no synthetic ACK');
select pg_temp.check_legacy(not exists(select 1 from public.fleet_terminal_receipts_v1 where account_id='00000000-0000-0000-0000-000000000601'),'no retroactive terminal receipt');
-- Fixture simulation of one canonical historical completion, with the other live.
update public.ig_runs set status='completed' where id='00000000-0000-0000-0000-000000000611';
update public.account_run_requests set status='completed' where id='00000000-0000-0000-0000-000000000631';
select pg_temp.check_legacy(public.fleet_legacy_execution_count_v1('00000000-0000-0000-0000-000000000601')=1,'partial drain still blocked');
select pg_temp.check_legacy(not public.fleet_current_revision_converged_v1('00000000-0000-0000-0000-000000000601',1,'HOLD'),'partial drain cannot activate');
update public.ig_runs set status='completed' where id='00000000-0000-0000-0000-000000000612';
select pg_temp.check_legacy(public.fleet_legacy_execution_count_v1('00000000-0000-0000-0000-000000000601')=1,'run exit alone does not hide unreconciled request');
update public.account_run_requests set status='completed' where id='00000000-0000-0000-0000-000000000632';
select pg_temp.check_legacy(public.fleet_transition_status_v1('00000000-0000-0000-0000-000000000601') @>
 '{"hold_state":"REQUESTED","transition_state":"LEGACY_DRAIN_COMPLETE","zero_legacy_gate":true}', 'full drain opens only the legacy gate');
select pg_temp.check_legacy(not public.fleet_current_revision_converged_v1('00000000-0000-0000-0000-000000000601',1,'HOLD'),'zero legacy does not invent owner ACKs');
select pg_temp.check_legacy(public.fleet_admission_reason_v1('00000000-0000-0000-0000-000000000601')='fleet_hold_requested','drain does not release Hold');
select pg_temp.check_legacy(not exists(select 1 from public.account_run_requests where account_id='00000000-0000-0000-0000-000000000601' and (cancel_reason is not null or cancel_requested_at is not null)),'no operator cancellation shortcut');
select pg_temp.check_legacy(public.fleet_legacy_execution_count_v1('00000000-0000-0000-0000-000000000602')=1,'other tenant execution unchanged');
set local request.jwt.claim.role='authenticated';
do $$ begin
  begin
    perform public.fleet_transition_status_v1('00000000-0000-0000-0000-000000000601');
    raise exception 'unauthorized projection accepted';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.check_legacy(true,'unauthorized projection rejected');
end $$;
rollback;
