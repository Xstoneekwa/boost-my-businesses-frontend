#!/usr/bin/env bash
set -euo pipefail
PG_BIN=/opt/homebrew/opt/postgresql@17/bin
FR_TEST_ROOT=$(mktemp -d /private/tmp/bmb-france-db.XXXXXX)
cleanup() { "$PG_BIN/pg_ctl" -D "$FR_TEST_ROOT/data" -m fast stop >/dev/null 2>&1 || true; }
trap cleanup EXIT
"$PG_BIN/initdb" -D "$FR_TEST_ROOT/data" -A trust -U postgres >/dev/null
"$PG_BIN/pg_ctl" -D "$FR_TEST_ROOT/data" -l "$FR_TEST_ROOT/postgres.log" -o "-p 55521 -k $FR_TEST_ROOT -c listen_addresses='' -c shared_memory_type=mmap -c dynamic_shared_memory_type=mmap" -w start >/dev/null
"$PG_BIN/psql" -X -h "$FR_TEST_ROOT" -p 55521 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/commercial-crm-foundation-v1.sql > "$FR_TEST_ROOT/foundation.log"
"$PG_BIN/psql" -X -h "$FR_TEST_ROOT" -p 55521 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/20260926094255_commercial_france_beauty_portability_canary_v1.sql
"$PG_BIN/psql" -X -h "$FR_TEST_ROOT" -p 55521 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/commercial-france-portability-v1.sql
"$PG_BIN/psql" -X -h "$FR_TEST_ROOT" -p 55521 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/20260926101229_commercial_france_location_evidence_hardening_v1.sql
"$PG_BIN/psql" -X -h "$FR_TEST_ROOT" -p 55521 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/commercial-france-location-hardening-v1.sql
"$PG_BIN/psql" -X -h "$FR_TEST_ROOT" -p 55521 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/20260926171007_commercial_france_profile_first_v2.sql
"$PG_BIN/psql" -X -h "$FR_TEST_ROOT" -p 55521 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/commercial-france-profile-first-v2.sql
printf 'FR_DB_VALIDATION=PASS\nLogs: %s\n' "$FR_TEST_ROOT"
