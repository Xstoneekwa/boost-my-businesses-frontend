#!/usr/bin/env bash
set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
TEST_ROOT="$(mktemp -d /private/tmp/commercial-lifecycle-email-transition-evidence-v1.XXXXXX)"
PGDATA="${TEST_ROOT}/pgdata"
PGPORT="${COMMERCIAL_LIFECYCLE_EMAIL_TEST_PGPORT:-55512}"

cleanup() {
  "${PG_BIN}/pg_ctl" -D "${PGDATA}" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

"${PG_BIN}/initdb" -D "${PGDATA}" -A trust -U postgres >/dev/null
"${PG_BIN}/pg_ctl" -D "${PGDATA}" \
  -o "-p ${PGPORT} -c shared_memory_type=mmap -c dynamic_shared_memory_type=mmap" \
  -w start >/dev/null
"${PG_BIN}/createdb" -p "${PGPORT}" -U postgres lifecycle_email_transition_v1

"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres \
  -d lifecycle_email_transition_v1 <<'SQL'
create role anon;
create role authenticated;

create table public.ig_accounts (
  id uuid primary key,
  username text not null,
  admin_lifecycle_status text not null default 'active'
);

create table public.commercial_account_lifecycle_operations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id),
  operation_type text not null check (operation_type in ('pause', 'resume', 'cancel')),
  idempotency_key text not null unique,
  state text not null check (state in ('pending', 'in_progress', 'completed', 'failed')),
  source_surface text,
  updated_at timestamptz not null default now()
);

create table public.ig_action_logs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id),
  run_id uuid,
  target_username text,
  action_type text not null,
  status text not null,
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
SQL

"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres \
  -d lifecycle_email_transition_v1 \
  -f supabase/migrations/20260814184500_commercial_lifecycle_email_transition_evidence_v1.sql
"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres \
  -d lifecycle_email_transition_v1 \
  -f supabase/tests/commercial_lifecycle_email_transition_evidence_v1.test.sql
"${PG_BIN}/psql" -X -v ON_ERROR_STOP=1 -p "${PGPORT}" -U postgres \
  -d lifecycle_email_transition_v1 \
  -f supabase/rollback/20260814184500_commercial_lifecycle_email_transition_evidence_v1.down.sql

trigger_count="$("${PG_BIN}/psql" -X -Atq -p "${PGPORT}" -U postgres \
  -d lifecycle_email_transition_v1 \
  -c "select count(*) from pg_trigger where tgname = 'commercial_lifecycle_email_transition_evidence_v1' and not tgisinternal")"
function_count="$("${PG_BIN}/psql" -X -Atq -p "${PGPORT}" -U postgres \
  -d lifecycle_email_transition_v1 \
  -c "select count(*) from pg_proc where proname = 'project_commercial_lifecycle_email_transition_evidence_v1'")"

test "${trigger_count}" = "0"
test "${function_count}" = "0"
printf 'commercial_lifecycle_email_transition_evidence_v1: PASS\n'
