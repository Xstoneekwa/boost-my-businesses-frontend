#!/usr/bin/env bash
# Plan Change test harness apply — PREPARED ONLY. Do not run without explicit GO.
# Applies schema-only snapshot + plan-change migration to nxntngkhkoynljcagmkq ONLY.
# Never uses supabase db push or .env.local.
#
# Connection contract:
#   PLAN_CHANGE_TEST_SUPABASE_URL  — REST probes (service_role key); not used for psql.
#   PLAN_CHANGE_TEST_DATABASE_URL  — required for psql apply; local env only; never logged.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${ROOT_DIR}/../../.." && pwd)"
VERIFY="${ROOT_DIR}/verify-schema-only-snapshot.mjs"
MANIFEST="${ROOT_DIR}/manifest.json"
PLAN_CHANGE_MIGRATION="${REPO_ROOT}/supabase/migrations/20260621120000_commercial_plan_change.sql"

AUDIT_HARNESS_ROOT="${ROOT_DIR}"
# shellcheck source=audit-common.sh
source "${ROOT_DIR}/audit-common.sh"

ALLOWED_REF="nxntngkhkoynljcagmkq"
FORBIDDEN_REF="zgafnshkjywfltxgbtzg"

fail() {
  echo "[apply-plan-change-test-harness] FAIL: $*" >&2
  exit 1
}

info() {
  echo "[apply-plan-change-test-harness] $*"
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    fail "Missing required env var: ${name}"
  fi
}

extract_ref_from_supabase_url() {
  local url="$1"
  echo "$url" | sed -E 's#https?://([^.]+)\..*#\1#'
}

assert_allowed_ref() {
  local ref="$1"
  local label="$2"

  if [[ "${ref}" == "${FORBIDDEN_REF}" ]]; then
    fail "Refusing forbidden shared project ref on ${label}: ${FORBIDDEN_REF}"
  fi

  if [[ "${ref}" != "${ALLOWED_REF}" ]]; then
    fail "Refusing unexpected project ref on ${label} (allowed: ${ALLOWED_REF})"
  fi
}

main() {
  if [[ "${PLAN_CHANGE_DB_TEST_CONFIRM:-}" != "isolated-test-only" ]]; then
    fail "Set PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only"
  fi

  require_env PLAN_CHANGE_TEST_SUPABASE_URL
  require_env PLAN_CHANGE_TEST_DATABASE_URL

  local supabase_ref
  local database_ref
  supabase_ref="$(extract_ref_from_supabase_url "${PLAN_CHANGE_TEST_SUPABASE_URL}")"
  if ! audit_extract_ref_from_postgres_url "${PLAN_CHANGE_TEST_DATABASE_URL}"; then
    fail "${AUDIT_LAST_EXTRACT_ERROR}"
  fi
  database_ref="${AUDIT_EXTRACTED_REF}"

  assert_allowed_ref "${supabase_ref}" "PLAN_CHANGE_TEST_SUPABASE_URL"
  assert_allowed_ref "${database_ref}" "PLAN_CHANGE_TEST_DATABASE_URL"

  if [[ "${supabase_ref}" != "${database_ref}" ]]; then
    fail "PLAN_CHANGE_TEST_SUPABASE_URL and PLAN_CHANGE_TEST_DATABASE_URL project refs must match"
  fi

  if ! node -e "
    const m = JSON.parse(require('node:fs').readFileSync('${MANIFEST}', 'utf8'));
    const s = m.externalDependencies?.auditStatus;
    if (s !== 'complete') {
      console.error('[apply-plan-change-test-harness] FAIL: Harness snapshot/apply BLOCKED until externalDependencies.auditStatus is complete (current: ' + (s ?? 'missing') + ')');
      process.exit(1);
    }
  "; then
    exit 1
  fi

  info "Project ref guard OK (${ALLOWED_REF}) — database URL present (not logged)"

  local snapshot_path="${ROOT_DIR}/public-schema-canonical.snapshot.sql"
  if [[ ! -f "${snapshot_path}" ]]; then
    fail "Snapshot not found: ${snapshot_path} — generate schema-only snapshot after explicit GO"
  fi

  if [[ ! -f "${PLAN_CHANGE_MIGRATION}" ]]; then
    fail "Plan change migration not found: ${PLAN_CHANGE_MIGRATION}"
  fi

  info "Verifying snapshot (no data, no plan-change objects, RLS/grants preserved)..."
  node "${VERIFY}" --snapshot="${snapshot_path}"

  info "DRY-RUN MODE: script prepared but not executing SQL."
  info "psql apply requires PLAN_CHANGE_TEST_DATABASE_URL (local env only; never commit; never .env.local)."
  info "PLAN_CHANGE_TEST_SERVICE_ROLE_KEY is for REST probes only — not a psql substitute."
  info "When authorized, apply in this order on ${ALLOWED_REF} only:"
  info "  1. psql with PLAN_CHANGE_TEST_DATABASE_URL -v ON_ERROR_STOP=1 -f snapshot.sql"
  info "  2. psql with PLAN_CHANGE_TEST_DATABASE_URL -v ON_ERROR_STOP=1 -f plan-change migration"
  info "  3. psql with PLAN_CHANGE_TEST_DATABASE_URL -v ON_ERROR_STOP=1 -c \"NOTIFY pgrst, 'reload schema';\""
  info "  4. node scripts/validate-plan-change-db-integration.mjs --phase=environment"
  info "  5. node scripts/validate-plan-change-db-integration.mjs --phase=schema"

  info "Snapshot verified. Awaiting explicit GO to execute psql steps."
}

main "$@"
