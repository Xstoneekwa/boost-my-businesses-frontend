#!/usr/bin/env bash
set -euo pipefail
PG_BIN=/opt/homebrew/opt/postgresql@17/bin
FOLLOWUP_TEST_ROOT=$(mktemp -d /private/tmp/bmb-followup-db.XXXXXX)
FOLLOWUP_PGDATA="$FOLLOWUP_TEST_ROOT/data"
cleanup() { "$PG_BIN/pg_ctl" -D "$FOLLOWUP_PGDATA" -m fast stop >/dev/null 2>&1 || true; }
trap cleanup EXIT
"$PG_BIN/initdb" -D "$FOLLOWUP_PGDATA" -A trust -U postgres >/dev/null
"$PG_BIN/pg_ctl" -D "$FOLLOWUP_PGDATA" -l "$FOLLOWUP_TEST_ROOT/postgres.log" -o "-p 55519 -k $FOLLOWUP_TEST_ROOT -c listen_addresses='' -c shared_memory_type=mmap -c dynamic_shared_memory_type=mmap" -w start >/dev/null
"$PG_BIN/psql" -X -h "$FOLLOWUP_TEST_ROOT" -p 55519 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/commercial-crm-foundation-v1.sql > "$FOLLOWUP_TEST_ROOT/foundation.log"
"$PG_BIN/psql" -X -h "$FOLLOWUP_TEST_ROOT" -p 55519 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/20260908093529_commercial_response_call_booking_v1.sql
"$PG_BIN/psql" -X -h "$FOLLOWUP_TEST_ROOT" -p 55519 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/commercial-response-call-booking-v1.sql
printf 'DB_VALIDATION=PASS\nFixture logs: %s\n' "$FOLLOWUP_TEST_ROOT"
