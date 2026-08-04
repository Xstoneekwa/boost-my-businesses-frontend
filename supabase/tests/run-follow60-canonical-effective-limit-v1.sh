#!/usr/bin/env bash
set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
TEST_ROOT="$(mktemp -d /private/tmp/follow60-effective-limit-v1.XXXXXX)"
PGDATA="${TEST_ROOT}/pgdata"
PGPORT="${FOLLOW60_EFFECTIVE_LIMIT_TEST_PGPORT:-55451}"

cleanup() {
  "${PG_BIN}/pg_ctl" -D "${PGDATA}" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

"${PG_BIN}/initdb" -D "${PGDATA}" -A trust -U postgres >/dev/null
"${PG_BIN}/pg_ctl" -D "${PGDATA}" -o "-p ${PGPORT}" -w start >/dev/null
"${PG_BIN}/createdb" -p "${PGPORT}" -U postgres follow60_effective_limit_v1
"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres \
  -d follow60_effective_limit_v1 -f supabase/tests/follow60-canonical-effective-limit-v1.sql

set +e
"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres \
  -d follow60_effective_limit_v1 \
  -f supabase/tests/follow60-canonical-effective-limit-v1-concurrency-a.sql \
  >"${TEST_ROOT}/arm-a.log" 2>&1 &
PID_A=$!
"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres \
  -d follow60_effective_limit_v1 \
  -f supabase/tests/follow60-canonical-effective-limit-v1-concurrency-b.sql \
  >"${TEST_ROOT}/arm-b.log" 2>&1 &
PID_B=$!
wait "${PID_A}"
STATUS_A=$?
wait "${PID_B}"
STATUS_B=$?
set -e

if [[ $((STATUS_A + STATUS_B)) -ne 3 ]]; then
  cat "${TEST_ROOT}/arm-a.log" "${TEST_ROOT}/arm-b.log"
  echo "expected exactly one concurrent arm success and one psql failure" >&2
  exit 1
fi

"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres \
  -d follow60_effective_limit_v1 -c \
  "do \$\$ begin if (select count(*) from public.follow_60s_canary_controls) <> 1 then raise exception 'concurrent_active_control_count_invalid'; end if; end \$\$;"
echo "follow60_concurrency_one_active_ok"
