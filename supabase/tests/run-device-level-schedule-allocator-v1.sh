#!/usr/bin/env bash
set -euo pipefail
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
TEST_ROOT="$(mktemp -d /private/tmp/device-level-schedule-allocator-v1.XXXXXX)"
PGDATA="${TEST_ROOT}/pgdata"
PGPORT="${DEVICE_SCHEDULE_TEST_PGPORT:-55491}"
cleanup() {
  "${PG_BIN}/pg_ctl" -D "${PGDATA}" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT
"${PG_BIN}/initdb" -D "${PGDATA}" -A trust -U postgres >/dev/null
"${PG_BIN}/pg_ctl" -D "${PGDATA}" -o "-p ${PGPORT} -c shared_memory_type=mmap -c dynamic_shared_memory_type=mmap" -w start >/dev/null
"${PG_BIN}/createdb" -p "${PGPORT}" -U postgres device_schedule_v1
"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres -d device_schedule_v1 \
  -f supabase/tests/device-level-schedule-allocator-v1.sql

"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres -d device_schedule_v1 -c "
  insert into public.phone_devices(id) values('10000000-0000-0000-0000-000000000003');
"

"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres -d device_schedule_v1 -c "
  begin;
  insert into public.account_assignments(account_id,device_id,status,schedule_mode,starts_at,ends_at)
  values('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','reserved','scheduled','2026-08-10 22:00Z','2026-08-11 04:00Z');
  select pg_sleep(1.5);
  commit;
" >/dev/null &
first_pid=$!
sleep 0.2
set +e
second_output="$("${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres -d device_schedule_v1 -c "
  insert into public.account_assignments(account_id,device_id,status,schedule_mode,starts_at,ends_at)
  values('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003','reserved','scheduled','2026-08-11 22:00Z','2026-08-12 04:00Z');
" 2>&1)"
second_status=$?
set -e
wait "${first_pid}"
if [[ ${second_status} -eq 0 ]] || [[ "${second_output}" != *"assignment_recurring_slot_conflict"* ]]; then
  echo "concurrent allocator did not fail closed: ${second_output}" >&2
  exit 1
fi
count="$("${PG_BIN}/psql" -X -Atq -p "${PGPORT}" -U postgres -d device_schedule_v1 -c "
  select count(*) from public.account_assignments where device_id='10000000-0000-0000-0000-000000000003';
")"
[[ "${count}" == "1" ]] || { echo "expected exactly one concurrent reservation, got ${count}" >&2; exit 1; }
echo "device_level_schedule_allocator_concurrency_ok"
"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres -d device_schedule_v1 \
  -f supabase/rollback/20260811150000_device_level_schedule_allocator_collision_prevention_v1.down.sql >/dev/null
rollback_signature="$("${PG_BIN}/psql" -X -Atq -p "${PGPORT}" -U postgres -d device_schedule_v1 -c "
  select to_regprocedure('public.list_available_assignment_slots(uuid,uuid,text,date)') is not null
    and to_regprocedure('public.reconcile_account_assignment_schedule_v1(uuid)') is null
    and not exists (select 1 from pg_trigger where tgname='account_assignments_device_recurring_exclusivity_v1' and not tgisinternal);
")"
[[ "${rollback_signature}" == "t" ]] || { echo "rollback contract failed" >&2; exit 1; }
echo "device_level_schedule_allocator_rollback_ok"
