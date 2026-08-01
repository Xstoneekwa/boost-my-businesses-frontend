#!/usr/bin/env bash
set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
TEST_ROOT="$(mktemp -d /private/tmp/follow60-generic-rpc-v2.XXXXXX)"
PGDATA="${TEST_ROOT}/pgdata"
PGPORT="${FOLLOW60_GENERIC_TEST_PGPORT:-55447}"

cleanup() {
  "${PG_BIN}/pg_ctl" -D "${PGDATA}" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

"${PG_BIN}/initdb" -D "${PGDATA}" -A trust -U postgres >/dev/null
"${PG_BIN}/pg_ctl" -D "${PGDATA}" -o "-p ${PGPORT}" -w start >/dev/null
"${PG_BIN}/createdb" -p "${PGPORT}" -U postgres follow60_generic_v2
"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres \
  -d follow60_generic_v2 -f supabase/tests/follow-60s-canary-runtime-generic-v2.sql
