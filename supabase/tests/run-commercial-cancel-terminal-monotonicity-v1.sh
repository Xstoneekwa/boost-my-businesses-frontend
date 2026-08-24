#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cancel-terminal-v1.XXXXXX")"
PORT="${CANCEL_TERMINAL_TEST_PORT:-55449}"
cleanup() {
  if [[ -f "$TMP_DIR/data/postmaster.pid" ]]; then pg_ctl -D "$TMP_DIR/data" -m fast stop >/dev/null; fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

initdb -D "$TMP_DIR/data" -A trust -U postgres >/dev/null
pg_ctl -D "$TMP_DIR/data" -o "-p $PORT -k $TMP_DIR" -w start >/dev/null
createdb -h "$TMP_DIR" -p "$PORT" -U postgres terminal_v1
psql -h "$TMP_DIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
create role anon;
create role authenticated;
create role service_role;
SQL

create_schema() {
  local db="$1"
  psql -h "$TMP_DIR" -p "$PORT" -U postgres -d "$db" -v ON_ERROR_STOP=1 <<'SQL'
create extension if not exists pgcrypto;
create table public.clients(id uuid primary key);
create table public.ig_accounts(id uuid primary key, admin_lifecycle_status text not null);
create table public.client_account_entitlements(id uuid primary key, client_id uuid not null, account_id uuid, status text not null);
create table public.commercial_account_lifecycle_operations(id uuid primary key, account_id uuid not null, entitlement_id uuid, operation_type text not null, state text not null, updated_at timestamptz not null default now());
create table public.commercial_account_lifecycle_states(account_id uuid primary key, entitlement_id uuid, stripe_subscription_id text, commercial_state text not null, action_required_reason text, last_operation_id uuid, updated_at timestamptz not null default now());
create table public.commercial_stripe_subscriptions(stripe_subscription_id text primary key, client_account_entitlement_id uuid, account_id uuid, status text not null);
create table public.client_instagram_accounts(id uuid primary key default gen_random_uuid(), client_id uuid not null, account_id uuid not null unique, active boolean not null default true, updated_at timestamptz not null default now());
SQL
}

create_schema terminal_v1
psql -h "$TMP_DIR" -p "$PORT" -U postgres -d terminal_v1 -v ON_ERROR_STOP=1 -f "$ROOT_DIR/supabase/tests/commercial-cancel-terminal-monotonicity-v1.sql"

# Clean-schema rollback must restore capacity V1 and permit reapply.
createdb -h "$TMP_DIR" -p "$PORT" -U postgres rollback_v1
create_schema rollback_v1
psql -h "$TMP_DIR" -p "$PORT" -U postgres -d rollback_v1 -v ON_ERROR_STOP=1 -f "$ROOT_DIR/supabase/migrations/20260824120000_commercial_account_capacity_projection_v1.sql" >/dev/null
psql -h "$TMP_DIR" -p "$PORT" -U postgres -d rollback_v1 -v ON_ERROR_STOP=1 -f "$ROOT_DIR/supabase/migrations/20260824194942_commercial_cancel_terminal_monotonicity_v1.sql" >/dev/null
psql -h "$TMP_DIR" -p "$PORT" -U postgres -d rollback_v1 -v ON_ERROR_STOP=1 -f "$ROOT_DIR/supabase/rollback/20260824194942_commercial_cancel_terminal_monotonicity_v1.down.sql" >/dev/null
psql -h "$TMP_DIR" -p "$PORT" -U postgres -d rollback_v1 -v ON_ERROR_STOP=1 -f "$ROOT_DIR/supabase/migrations/20260824194942_commercial_cancel_terminal_monotonicity_v1.sql" >/dev/null

# A populated terminal ledger must make rollback fail closed.
if psql -h "$TMP_DIR" -p "$PORT" -U postgres -d terminal_v1 -v ON_ERROR_STOP=1 -f "$ROOT_DIR/supabase/rollback/20260824194942_commercial_cancel_terminal_monotonicity_v1.down.sql" >/dev/null 2>&1; then
  echo "rollback unexpectedly accepted terminal provenance" >&2
  exit 1
fi
echo "COMMERCIAL_CANCEL_TERMINAL_ROLLBACK = PASS"
