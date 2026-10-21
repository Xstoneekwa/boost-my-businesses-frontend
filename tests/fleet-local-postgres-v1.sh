#!/bin/sh
# Disposable local PostgreSQL 17 only. No production connection or credentials.
# SELECT/UPDATE parity on four canonical tables was inspected read-only 2026-09-06.
# Admission functions below are anchor fixtures, NOT real endpoint certification.
set -eu
PG=/opt/homebrew/opt/postgresql@17/bin
D=$(mktemp -d /private/tmp/fleet-successor-rpc.XXXXXX)
cleanup() { "$PG/pg_ctl" -D "$D/data" -m immediate -w stop >/dev/null 2>&1 || true; case "$D" in /private/tmp/fleet-successor-rpc.*) rm -rf -- "$D";; esac; }
trap cleanup EXIT
"$PG/initdb" -D "$D/data" --auth=trust --no-locale -E UTF8 >/dev/null
"$PG/pg_ctl" -D "$D/data" -l "$D/server.log" -o "-F -k $D -h '' -p 55483" -w start >/dev/null
"$PG/psql" -h "$D" -p 55483 -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
create role anon; create role authenticated; create role service_role bypassrls;
create table public.ig_accounts(id uuid primary key);
grant select, update on public.ig_accounts to service_role;
create table public.client_instagram_accounts(account_id uuid,client_id uuid);
create table public.ig_runs(id uuid primary key,account_id uuid,status text);
create table public.account_run_requests(id uuid primary key default gen_random_uuid(),account_id uuid,run_id uuid,claimed_by text,status text default 'queued',cancel_requested_at timestamptz,cancel_reason text,metadata_safe jsonb default '{}');
grant select, update on public.client_instagram_accounts, public.account_run_requests, public.ig_runs to service_role;
create function public.create_account_run_request(p_account_id uuid,p_actor uuid,p_actor_type text,p_source text,p_run_type text,p_idempotency_key text,p_priority integer,p_metadata jsonb) returns public.account_run_requests language plpgsql as $$
declare v_row public.account_run_requests;
begin
  insert into public.account_run_requests (account_id) values(p_account_id) returning * into v_row;
return v_row;
end $$;
create function public.admit_account_run_attempt_v1(p_request_id uuid,p_worker text,p_assignment uuid,p_device uuid,p_instance uuid,p_package text,p_start timestamptz,p_end timestamptz,p_lease integer) returns jsonb language plpgsql as $$
declare v_plan record; v_account_id uuid := p_request_id;
begin
select 1 as zero_work_contract_version into v_plan;
  if v_plan.zero_work_contract_version = 1 then
return '{"ok":true}'::jsonb;
end if;
return '{"ok":false}'::jsonb;
end $$;
SQL
"$PG/psql" -h "$D" -p 55483 -d postgres -v ON_ERROR_STOP=1 -q -f /Users/admin/Projects/backend-fleet-control-v1/supabase/migrations/20260906171034_fleet_admission_authority_v1.sql
"$PG/psql" -h "$D" -p 55483 -d postgres -v ON_ERROR_STOP=1 -q -f /Users/admin/Projects/backend-fleet-control-v1/tests/fleet-revision-guard-v1.sql
"$PG/psql" -h "$D" -p 55483 -d postgres -v ON_ERROR_STOP=1 -q -f /Users/admin/Projects/backend-fleet-control-v1/tests/fleet-owner-rpcs-v1.sql
