-- Safe functional rollback.  The additive history table and expanded status
-- constraint are deliberately retained so forensic/control history is never
-- destroyed by rollback.

revoke all on function public.prepare_follow_60s_canary_runtime_v3(uuid,uuid,text,text,uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
revoke all on function public.commit_follow_60s_canary_runtime_v3(uuid,uuid,text,text,uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
revoke all on function public.terminalize_follow_60s_canary_control_v1(uuid,uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.create_or_rearm_follow_60s_canary_control_v1(uuid,uuid,text,integer,integer,timestamptz,text,text,jsonb,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.reconcile_ig_run_canonical_totals_v1(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;

drop function if exists public.prepare_follow_60s_canary_runtime_v3(uuid,uuid,text,text,uuid,uuid,integer,text,text);
drop function if exists public.commit_follow_60s_canary_runtime_v3(uuid,uuid,text,text,uuid,uuid,integer,text,text);
drop function if exists public.terminalize_follow_60s_canary_control_v1(uuid,uuid,uuid,uuid,text,text,jsonb);
drop function if exists public.create_or_rearm_follow_60s_canary_control_v1(uuid,uuid,text,integer,integer,timestamptz,text,text,jsonb,text,text,text);
drop function if exists public.reconcile_ig_run_canonical_totals_v1(uuid,uuid,text,jsonb);

create or replace function public.mark_follow_60s_canary_barrier_v1(
  p_account_id uuid, p_run_id uuid, p_request_id uuid, p_canonical_follow_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.follow_60s_canary_controls%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  select * into v_row from public.follow_60s_canary_controls where account_id=p_account_id for update;
  if not found or v_row.status <> 'armed' then raise exception 'follow_60s_barrier_not_armed' using errcode='55000'; end if;
  if p_canonical_follow_count <> v_row.baseline_follow_count + v_row.evaluation_increment then
    raise exception 'follow_60s_barrier_count_mismatch' using errcode='22023';
  end if;
  update public.follow_60s_canary_controls set status='barrier_waiting_stop', run_id=p_run_id,
    request_id=p_request_id, barrier_reached_at=now(), updated_at=now()
    where account_id=p_account_id;
  return jsonb_build_object('ok',true,'status','barrier_waiting_stop','canonical_follow_count',p_canonical_follow_count);
end;
$$;

revoke all on function public.mark_follow_60s_canary_barrier_v1(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.mark_follow_60s_canary_barrier_v1(uuid,uuid,uuid,integer) to service_role;
