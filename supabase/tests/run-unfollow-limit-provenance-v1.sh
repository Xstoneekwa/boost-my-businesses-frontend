#!/usr/bin/env bash
set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
TEST_ROOT="$(mktemp -d /private/tmp/unfollow-limit-provenance-v1.XXXXXX)"
PGDATA="${TEST_ROOT}/pgdata"
PGPORT="${UNFOLLOW_LIMIT_PROVENANCE_TEST_PGPORT:-55466}"

cleanup() {
  "${PG_BIN}/pg_ctl" -D "${PGDATA}" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

"${PG_BIN}/initdb" -D "${PGDATA}" -A trust -U postgres >/dev/null
"${PG_BIN}/pg_ctl" -D "${PGDATA}" -o "-p ${PGPORT} -c shared_memory_type=mmap -c dynamic_shared_memory_type=mmap" -w start >/dev/null
"${PG_BIN}/createdb" -p "${PGPORT}" -U postgres unfollow_limit_provenance_v1
"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres \
  -d unfollow_limit_provenance_v1 \
  -f supabase/tests/unfollow-limit-provenance-v1.sql
