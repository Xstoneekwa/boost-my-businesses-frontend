#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
PGPORT="${PGPORT:-55439}"
TEST_ROOT="$(mktemp -d /tmp/follow-warmup-event-type-compat-v1.XXXXXX)"
PGDATA="${TEST_ROOT}/data"

cleanup() {
  "${PG_BIN}/pg_ctl" -D "${PGDATA}" -m fast stop >/dev/null 2>&1 || true
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

"${PG_BIN}/initdb" -D "${PGDATA}" -A trust -U postgres >/dev/null
"${PG_BIN}/pg_ctl" -D "${PGDATA}" -o "-p ${PGPORT}" -w start >/dev/null
"${PG_BIN}/createdb" -p "${PGPORT}" -U postgres follow_warmup_v1
"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres \
  -d follow_warmup_v1 -f "${ROOT}/supabase/tests/follow-warmup-event-type-compat-v1.sql"
