-- DEFERRED / NOT FOR V1 DEPLOYMENT. Outside supabase/migrations deliberately.
-- Requires separate authorization, no legacy Worker/rollback and verified new startup.
begin;
-- Existing rows are not rewritten. All future writes must carry a real request.
alter table public.auto_restart_device_locks
  add constraint fleet_device_lease_request_required_v1 check (request_id is not null) not valid;

-- Retain old signatures only as explicit fail-closed boundaries. Current
-- tokenized renewal has p_expected_lease_id and is deliberately left unchanged.
do $close$
declare r record; d text;
begin
  for r in select p.oid,p.prosrc,l.lanname,p.prorettype from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname='public' and p.proname in (
      'auto_restart_acquire_device_lock','auto_restart_bind_device_lock_to_request',
      'auto_restart_renew_device_lock','auto_restart_release_device_lock','auto_restart_transfer_device_lock')
      and not ('p_expected_lease_id'=any(coalesce(p.proargnames,array[]::text[])))
  loop
    if r.lanname<>'plpgsql' or r.prorettype<>'jsonb'::regtype then
      raise exception 'device_lock_legacy_signature_requires_review: %',r.oid::regprocedure;
    end if;
    d:=pg_get_functiondef(r.oid);
    execute replace(d,r.prosrc,$body$begin
      raise exception 'device_lock_token_required_use_atomic_enqueue_or_fenced_rpc' using errcode='22023';
    end$body$);
  end loop;
end $close$;

-- Unused bulk/legacy RPCs cannot remain an ownership-mutation escape hatch.
do $close$
declare r record;
begin
  for r in select p.oid,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('reconcile_stale_device_ui_leases','handoff_preflight_device_lock_to_request')
  loop
    execute replace(pg_get_functiondef(r.oid),r.prosrc,$body$begin
      raise exception 'device_lock_exact_reconciliation_required' using errcode='22023';
    end$body$);
  end loop;
end $close$;

-- Legacy admission/recovery retirement needs a dedicated qualified cleanup.
-- This file is a retained separation inventory, not a deployment-ready migration.
rollback;
