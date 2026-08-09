#!/usr/bin/env bash
set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
TEST_ROOT="$(mktemp -d /private/tmp/unfollow-already-terminal-v1.XXXXXX)"
PGDATA="${TEST_ROOT}/pgdata"
PGPORT="${UNFOLLOW_ALREADY_TERMINAL_TEST_PGPORT:-55463}"

cleanup() {
  "${PG_BIN}/pg_ctl" -D "${PGDATA}" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

"${PG_BIN}/initdb" -D "${PGDATA}" -A trust -U postgres >/dev/null
"${PG_BIN}/pg_ctl" -D "${PGDATA}" -o "-p ${PGPORT}" -w start >/dev/null
"${PG_BIN}/createdb" -p "${PGPORT}" -U postgres unfollow_already_terminal_v1
"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres \
  -d unfollow_already_terminal_v1 \
  -f supabase/tests/unfollow-already-not-following-terminal-v1.sql
