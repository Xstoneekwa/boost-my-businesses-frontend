#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/capacity-v1.XXXXXX")"
PORT="${CAPACITY_TEST_PORT:-55439}"
cleanup() {
  if [[ -f "$TMP_DIR/data/postmaster.pid" ]]; then pg_ctl -D "$TMP_DIR/data" -m fast stop >/dev/null; fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

initdb -D "$TMP_DIR/data" -A trust -U postgres >/dev/null
pg_ctl -D "$TMP_DIR/data" -o "-p $PORT -k $TMP_DIR" -w start >/dev/null
createdb -h "$TMP_DIR" -p "$PORT" -U postgres capacity_v1
psql -h "$TMP_DIR" -p "$PORT" -U postgres -d capacity_v1 -v ON_ERROR_STOP=1 <<'SQL'
create extension if not exists pgcrypto;
create role anon; create role authenticated; create role service_role;
create table public.clients(id uuid primary key);
create table public.ig_accounts(id uuid primary key, admin_lifecycle_status text not null);
create table public.client_account_entitlements(id uuid primary key, client_id uuid not null, account_id uuid, status text not null);
create table public.commercial_account_lifecycle_operations(id uuid primary key, account_id uuid not null, operation_type text not null, state text not null, updated_at timestamptz not null default now());
create table public.commercial_account_lifecycle_states(account_id uuid primary key, entitlement_id uuid, stripe_subscription_id text, commercial_state text not null, action_required_reason text, last_operation_id uuid, updated_at timestamptz not null default now());
create table public.commercial_stripe_subscriptions(stripe_subscription_id text primary key, client_account_entitlement_id uuid, account_id uuid, status text not null);
create table public.client_instagram_accounts(id uuid primary key default gen_random_uuid(), client_id uuid not null, account_id uuid not null unique, active boolean not null default true, updated_at timestamptz not null default now());
SQL
psql -h "$TMP_DIR" -p "$PORT" -U postgres -d capacity_v1 -v ON_ERROR_STOP=1 -f "$ROOT_DIR/supabase/tests/commercial-account-capacity-projection-v1.sql"
