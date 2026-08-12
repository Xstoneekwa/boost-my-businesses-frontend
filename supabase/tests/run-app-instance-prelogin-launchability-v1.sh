#!/usr/bin/env bash
set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
TEST_ROOT="$(mktemp -d /private/tmp/app-instance-prelogin-launchability-v1.XXXXXX)"
PGDATA="${TEST_ROOT}/pgdata"
PGPORT="${APP_INSTANCE_LAUNCHABILITY_TEST_PGPORT:-55479}"

cleanup() {
  "${PG_BIN}/pg_ctl" -D "${PGDATA}" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

"${PG_BIN}/initdb" -D "${PGDATA}" -A trust -U postgres >/dev/null
"${PG_BIN}/pg_ctl" -D "${PGDATA}" -o "-p ${PGPORT} -c shared_memory_type=mmap -c dynamic_shared_memory_type=mmap" -w start >/dev/null
"${PG_BIN}/createdb" -p "${PGPORT}" -U postgres app_instance_prelogin_launchability_v1
"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres \
  -d app_instance_prelogin_launchability_v1 \
  -f supabase/tests/app-instance-prelogin-launchability-v1.sql
