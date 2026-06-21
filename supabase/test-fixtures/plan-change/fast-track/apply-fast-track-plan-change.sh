#!/usr/bin/env bash
# Plan Change FAST-TRACK fixture — isolated functional validation on nxntngkhkoynljcagmkq ONLY.
# Dry-run by default; pass --apply to execute SQL. Never uses supabase db push or .env.local.
#
# Required env:
#   PLAN_CHANGE_TEST_DATABASE_URL  — psql target (local env only; never logged)
#   PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only

set -euo pipefail

FAST_TRACK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_ROOT="$(cd "${FAST_TRACK_ROOT}/.." && pwd)"
REPO_ROOT="$(cd "${FAST_TRACK_ROOT}/../../../.." && pwd)"

BASELINE_SQL="${FAST_TRACK_ROOT}/bootstrap-fast-track-baseline.sql"
SEED_SQL="${FAST_TRACK_ROOT}/seed-fast-track.sql"
SMOKE_SQL="${FAST_TRACK_ROOT}/run-fast-track-smoke.sql"
VERIFY_SQL="${FAST_TRACK_ROOT}/verify-fast-track-results.sql"
PLAN_CHANGE_MIGRATION="${REPO_ROOT}/supabase/migrations/20260621120000_commercial_plan_change.sql"

AUDIT_HARNESS_ROOT="${HARNESS_ROOT}"
# shellcheck source=../audit-common.sh
source "${HARNESS_ROOT}/audit-common.sh"

ALLOWED_REF="nxntngkhkoynljcagmkq"
FORBIDDEN_REF="zgafnshkjywfltxgbtzg"
SCRIPT_PREFIX="apply-fast-track-plan-change"

fail() {
  echo "[${SCRIPT_PREFIX}] FAIL: $*" >&2
  exit 1
}

info() {
  echo "[${SCRIPT_PREFIX}] $*"
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    fail "Missing required env var: ${name}"
  fi
}

assert_allowed_database_ref() {
  local ref="$1"
  if [[ "${ref}" == "${FORBIDDEN_REF}" ]]; then
    fail "Refusing forbidden shared project ref: ${FORBIDDEN_REF}"
  fi
  if [[ "${ref}" != "${ALLOWED_REF}" ]]; then
    fail "Refusing unexpected project ref (allowed: ${ALLOWED_REF})"
  fi
}

assert_apply_fixture_files() {
  local file
  for file in "${BASELINE_SQL}" "${SEED_SQL}" "${SMOKE_SQL}" "${PLAN_CHANGE_MIGRATION}"; do
    if [[ ! -f "${file}" ]]; then
      fail "Missing fixture file: ${file}"
    fi
  done
}

assert_verify_fixture_file() {
  if [[ ! -f "${VERIFY_SQL}" ]]; then
    fail "Missing fixture file: ${VERIFY_SQL}"
  fi
}

run_psql() {
  local sql_file="$1"
  info "Applying $(basename "${sql_file}") (connection not logged)"
  psql -X "${PLAN_CHANGE_TEST_DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${sql_file}"
}

run_psql_verify() {
  info "Running read-only verification $(basename "${VERIFY_SQL}") (connection not logged)"
  psql -X "${PLAN_CHANGE_TEST_DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${VERIFY_SQL}"
}

run_psql_command() {
  local sql_command="$1"
  info "Running PostgREST schema reload (connection not logged)"
  psql -X "${PLAN_CHANGE_TEST_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "${sql_command}"
}

main() {
  local apply_mode="false"
  local verify_mode="false"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --apply)
        apply_mode="true"
        shift
        ;;
      --verify-only)
        verify_mode="true"
        shift
        ;;
      *)
        fail "Unknown argument: $1 (optional flags: --apply, --verify-only)"
        ;;
    esac
  done

  if [[ "${apply_mode}" == "true" && "${verify_mode}" == "true" ]]; then
    fail "Cannot combine --apply and --verify-only"
  fi

  audit_refuse_env_local "${SCRIPT_PREFIX}"

  if [[ "${PLAN_CHANGE_DB_TEST_CONFIRM:-}" != "isolated-test-only" ]]; then
    fail "Set PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only"
  fi

  require_env PLAN_CHANGE_TEST_DATABASE_URL

  if ! audit_extract_ref_from_postgres_url "${PLAN_CHANGE_TEST_DATABASE_URL}"; then
    fail "${AUDIT_LAST_EXTRACT_ERROR}"
  fi
  assert_allowed_database_ref "${AUDIT_EXTRACTED_REF}"

  info "Project ref guard OK (${ALLOWED_REF}) — database URL present (not logged)"

  if [[ "${verify_mode}" == "true" ]]; then
    assert_verify_fixture_file
    info "VERIFY-ONLY MODE: read-only check of existing plan_change_test_* results"
    run_psql_verify
    info "Fast-track verify-only complete — review PASS/FAIL table above"
    exit 0
  fi

  assert_apply_fixture_files
  info "Fast-track functional validation (NOT full source schema parity)"

  if [[ "${apply_mode}" != "true" ]]; then
    info "DRY-RUN MODE: no SQL will be executed. Pass --apply to write or --verify-only to read existing results."
    info "Apply sequence on ${ALLOWED_REF} only:"
    info "  1. psql -f bootstrap-fast-track-baseline.sql"
    info "  2. psql -f supabase/migrations/20260621120000_commercial_plan_change.sql"
    info "  3. psql -c \"NOTIFY pgrst, 'reload schema';\""
    info "  4. psql -f seed-fast-track.sql"
    info "  5. psql -f run-fast-track-smoke.sql"
    info "Verify-only (read-only, no bootstrap/migration/seed/smoke mutations):"
    info "  psql -f verify-fast-track-results.sql"
    exit 0
  fi

  info "APPLY MODE: executing fast-track fixture sequence"
  run_psql "${BASELINE_SQL}"
  run_psql "${PLAN_CHANGE_MIGRATION}"
  run_psql_command "NOTIFY pgrst, 'reload schema';"
  run_psql "${SEED_SQL}"
  run_psql "${SMOKE_SQL}"
  info "Fast-track apply complete — review smoke PASS/FAIL table above"
}

main "$@"
