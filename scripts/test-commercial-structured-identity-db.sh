#!/usr/bin/env bash
set -euo pipefail
PG_BIN=/opt/homebrew/opt/postgresql@17/bin
IDENTITY_TEST_ROOT=$(mktemp -d /private/tmp/bmb-identity-db.XXXXXX)
cleanup() { "$PG_BIN/pg_ctl" -D "$IDENTITY_TEST_ROOT/data" -m fast stop >/dev/null 2>&1 || true; }
trap cleanup EXIT
"$PG_BIN/initdb" -D "$IDENTITY_TEST_ROOT/data" -A trust -U postgres >/dev/null
"$PG_BIN/pg_ctl" -D "$IDENTITY_TEST_ROOT/data" -l "$IDENTITY_TEST_ROOT/postgres.log" -o "-p 55522 -k $IDENTITY_TEST_ROOT -c listen_addresses='' -c shared_memory_type=mmap -c dynamic_shared_memory_type=mmap" -w start >/dev/null
PSQL=("$PG_BIN/psql" -X -h "$IDENTITY_TEST_ROOT" -p 55522 -U postgres -d postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f supabase/tests/commercial-crm-foundation-v1.sql > "$IDENTITY_TEST_ROOT/foundation.log"
"${PSQL[@]}" -f supabase/migrations/20260926094255_commercial_france_beauty_portability_canary_v1.sql > "$IDENTITY_TEST_ROOT/france.log"
"${PSQL[@]}" -f supabase/migrations/20260926101229_commercial_france_location_evidence_hardening_v1.sql >> "$IDENTITY_TEST_ROOT/france.log"
"${PSQL[@]}" -f supabase/migrations/20260926171007_commercial_france_profile_first_v2.sql >> "$IDENTITY_TEST_ROOT/france.log"
"${PSQL[@]}" -f supabase/migrations/20260926203812_commercial_structured_discovery_identity_safety_v1.sql > "$IDENTITY_TEST_ROOT/migration.log"
"${PSQL[@]}" -f supabase/tests/commercial-structured-identity-v1.sql > "$IDENTITY_TEST_ROOT/identity.log"
for case_id in same distinct; do
  pids=()
  for request_id in 1 2 3 4; do
    siret="2234567890000$request_id"
    if [[ "$case_id" == same ]]; then siret=32345678900001; fi
    "${PSQL[@]}" -c "begin; set local request.jwt.claim.role='service_role'; set local role service_role; select public.create_structured_commercial_business_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','sirene','$siret','Concurrent $case_id','FR',null,null,'https://concurrent-$case_id.example','concurrent_$case_id'); select pg_sleep(0.2); commit;" > "$IDENTITY_TEST_ROOT/$case_id-$request_id.log" &
    pids+=("$!")
  done
  for pid in "${pids[@]}"; do wait "$pid"; done
done
"${PSQL[@]}" -c "do \$\$ begin if (select count(*) from public.commercial_business_identifiers where provider='sirene' and external_id='32345678900001')<>1 then raise exception 'same ID concurrency failed'; end if; if (select count(*) from public.commercial_businesses where website_domain_normalized='concurrent-distinct.example' and instagram_handle_normalized='concurrent_distinct')<>4 then raise exception 'distinct ID concurrency failed'; end if; end \$\$;"
printf 'DB_VALIDATION=PASS\nLogs: %s\n' "$IDENTITY_TEST_ROOT"
