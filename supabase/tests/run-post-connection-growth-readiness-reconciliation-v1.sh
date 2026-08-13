#!/usr/bin/env bash
set -euo pipefail

PG_BIN="/opt/homebrew/opt/postgresql@17/bin"
TEST_ROOT="$(mktemp -d /private/tmp/post-connection-growth-readiness-v1.XXXXXX)"
PGDATA="${TEST_ROOT}/data"
PGPORT="55491"

cleanup() {
  "${PG_BIN}/pg_ctl" -D "${PGDATA}" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

"${PG_BIN}/initdb" -D "${PGDATA}" -A trust -U postgres >/dev/null
"${PG_BIN}/pg_ctl" -D "${PGDATA}" -o "-p ${PGPORT} -c shared_memory_type=mmap -c dynamic_shared_memory_type=mmap" -w start >/dev/null
"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres -d postgres \
  -f supabase/tests/post-connection-growth-readiness-reconciliation-v1.sql
