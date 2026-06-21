#!/usr/bin/env bash
# Plan Change UI/API E2E — apply on nxntngkhkoynljcagmkq ONLY. Requires --apply.
# Creates fictional auth user + client/entitlement, then runs API scenarios against live Next.js.

set -euo pipefail

UI_API_E2E_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ui-api-e2e-common.sh
source "${UI_API_E2E_ROOT}/ui-api-e2e-common.sh"

SCRIPT_PREFIX="apply-ui-api-e2e"
BOOTSTRAP_SQL="${UI_API_E2E_ROOT}/bootstrap-ui-api-minimal.sql"
SEED_SQL="${UI_API_E2E_ROOT}/seed-ui-api-e2e.sql"
SETUP_MJS="${UI_API_E2E_ROOT}/setup-ui-api-e2e.mjs"
RUN_MJS="${UI_API_E2E_ROOT}/run-ui-api-e2e.mjs"

main() {
  local apply_mode="false"
  if [[ "${1:-}" == "--apply" ]]; then
    apply_mode="true"
    shift
  fi
  if [[ $# -gt 0 ]]; then
    ui_api_fail "${SCRIPT_PREFIX}" "Unknown argument: $1 (optional flag: --apply)"
  fi

  ui_api_assert_core_env "${SCRIPT_PREFIX}"
  ui_api_assert_database_ref "${SCRIPT_PREFIX}"
  ui_api_require_env "${SCRIPT_PREFIX}" PLAN_CHANGE_TEST_ANON_KEY
  ui_api_require_env "${SCRIPT_PREFIX}" PLAN_CHANGE_TEST_DATABASE_URL

  if [[ "${apply_mode}" != "true" ]]; then
    local preview_run_id
    preview_run_id="$(ui_api_generate_run_id)"
    local preview_email
    preview_email="$(ui_api_test_email_for_run "${preview_run_id}")"
    ui_api_info "${SCRIPT_PREFIX}" "DRY-RUN MODE: pass --apply to write fictional fixture data and run API scenarios"
    ui_api_info "${SCRIPT_PREFIX}" "Target ref: ${ALLOWED_REF} only"
    ui_api_info "${SCRIPT_PREFIX}" "Example fictional email: ${preview_email}"
    ui_api_info "${SCRIPT_PREFIX}" "Add this email to SIMULATED_CHECKOUT_EMAIL_ALLOWLIST on the running Next.js server"
    ui_api_info "${SCRIPT_PREFIX}" "Sequence with --apply:"
    ui_api_info "${SCRIPT_PREFIX}" "  1. node setup-ui-api-e2e.mjs (auth.users fictional user)"
    ui_api_info "${SCRIPT_PREFIX}" "  2. psql bootstrap-ui-api-minimal.sql + seed-ui-api-e2e.sql"
    ui_api_info "${SCRIPT_PREFIX}" "  3. node run-ui-api-e2e.mjs (live Next.js at PLAN_CHANGE_UI_API_BASE_URL)"
    exit 0
  fi

  if [[ "${SIMULATED_CHECKOUT_ENABLED:-}" != "true" ]]; then
    ui_api_fail "${SCRIPT_PREFIX}" "Set SIMULATED_CHECKOUT_ENABLED=true on the Next.js server for activation scenarios"
  fi

  export PLAN_CHANGE_UI_API_RUN_ID="${PLAN_CHANGE_UI_API_RUN_ID:-$(ui_api_generate_run_id)}"
  local test_email
  test_email="$(ui_api_test_email_for_run "${PLAN_CHANGE_UI_API_RUN_ID}")"

  if [[ ",${SIMULATED_CHECKOUT_EMAIL_ALLOWLIST:-}," != *",${test_email},"* ]]; then
    ui_api_fail "${SCRIPT_PREFIX}" "SIMULATED_CHECKOUT_EMAIL_ALLOWLIST must include ${test_email} on the Next.js server"
  fi

  ui_api_info "${SCRIPT_PREFIX}" "APPLY MODE: isolated UI/API E2E on ${ALLOWED_REF} (connection not logged)"
  ui_api_info "${SCRIPT_PREFIX}" "Fictional test email: ${test_email}"

  ui_api_info "${SCRIPT_PREFIX}" "Creating fictional auth user (server-side admin API only)"
  local setup_json
  setup_json="$(node "${SETUP_MJS}")"
  local auth_user_id client_id session_id entitlement_id
  auth_user_id="$(printf '%s' "${setup_json}" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).auth_user_id)")"
  payment_auth_user_id="$(printf '%s' "${setup_json}" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).payment_probe_auth_user_id)")"
  client_id="$(printf '%s' "${setup_json}" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).client_id)")"
  session_id="$(printf '%s' "${setup_json}" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).session_id)")"
  entitlement_id="$(printf '%s' "${setup_json}" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).entitlement_id)")"

  ui_api_info "${SCRIPT_PREFIX}" "Applying bootstrap-ui-api-minimal.sql (connection not logged)"
  psql -X "${PLAN_CHANGE_TEST_DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${BOOTSTRAP_SQL}"

  ui_api_info "${SCRIPT_PREFIX}" "Applying seed-ui-api-e2e.sql (connection not logged)"
  psql -X "${PLAN_CHANGE_TEST_DATABASE_URL}" -v ON_ERROR_STOP=1 \
    -v "ui_run_id=${PLAN_CHANGE_UI_API_RUN_ID}" \
    -v "ui_auth_user_id=${auth_user_id}" \
    -v "ui_payment_auth_user_id=${payment_auth_user_id}" \
    -v "ui_client_id=${client_id}" \
    -v "ui_session_id=${session_id}" \
    -v "ui_entitlement_id=${entitlement_id}" \
    -v "ui_test_email=${test_email}" \
    -f "${SEED_SQL}"

  ui_api_info "${SCRIPT_PREFIX}" "Running API scenarios against ${PLAN_CHANGE_UI_API_BASE_URL:-http://127.0.0.1:3000}"
  node "${RUN_MJS}"

  ui_api_info "${SCRIPT_PREFIX}" "UI/API E2E apply complete — review PASS/FAIL table above"
}

main "$@"
