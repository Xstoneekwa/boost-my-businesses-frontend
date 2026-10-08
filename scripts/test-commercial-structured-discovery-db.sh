#!/usr/bin/env bash
set -euo pipefail
PG_BIN=/opt/homebrew/opt/postgresql@17/bin
POC_TEST_ROOT=$(mktemp -d /private/tmp/bmb-structured-poc-db.XXXXXX)
cleanup() { "$PG_BIN/pg_ctl" -D "$POC_TEST_ROOT/data" -m fast stop >/dev/null 2>&1 || true; }
trap cleanup EXIT
"$PG_BIN/initdb" -D "$POC_TEST_ROOT/data" -A trust -U postgres -c shared_memory_type=mmap -c dynamic_shared_memory_type=mmap >/dev/null
"$PG_BIN/pg_ctl" -D "$POC_TEST_ROOT/data" -l "$POC_TEST_ROOT/postgres.log" -o "-p 55523 -k $POC_TEST_ROOT -c listen_addresses='' -c shared_memory_type=mmap -c dynamic_shared_memory_type=mmap" -w start >/dev/null
PSQL=("$PG_BIN/psql" -X -h "$POC_TEST_ROOT" -p 55523 -U postgres -d postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f supabase/tests/commercial-crm-foundation-v1.sql > "$POC_TEST_ROOT/foundation.log"
for migration in 20260926094255_commercial_france_beauty_portability_canary_v1 20260926101229_commercial_france_location_evidence_hardening_v1 20260926171007_commercial_france_profile_first_v2 20260926203812_commercial_structured_discovery_identity_safety_v1 20260926211539_commercial_structured_discovery_poc_v1 20260926213520_commercial_sirene_bounded_provider_activation_v1; do
  "${PSQL[@]}" -f "supabase/migrations/$migration.sql" >> "$POC_TEST_ROOT/migrations.log"
done
"${PSQL[@]}" -f supabase/tests/commercial-structured-identity-v1.sql > "$POC_TEST_ROOT/identity.log"
"${PSQL[@]}" -f supabase/tests/commercial-structured-discovery-v1.sql > "$POC_TEST_ROOT/poc.log"
"${PSQL[@]}" -f supabase/migrations/20260926223051_commercial_resolver_v2_bounded_reprocess.sql >> "$POC_TEST_ROOT/migrations.log"
"${PSQL[@]}" -f supabase/tests/commercial-resolver-v2.sql > "$POC_TEST_ROOT/resolver.log"
"${PSQL[@]}" -f supabase/migrations/20260928014214_commercial_sirene_alias_diagnostic_v3a.sql >> "$POC_TEST_ROOT/migrations.log"
"${PSQL[@]}" -f supabase/tests/commercial-sirene-alias-v3a.sql > "$POC_TEST_ROOT/aliases.log"
printf 'DB_VALIDATION=PASS\nLogs: %s\n' "$POC_TEST_ROOT"
