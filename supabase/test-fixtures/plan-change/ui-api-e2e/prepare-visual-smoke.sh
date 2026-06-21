#!/usr/bin/env bash
# Plan Change visual smoke — prepare fictional Growth fixtures on nxntngkhkoynljcagmkq ONLY.
# Requires --apply to write. Does not run API scenarios or activations. Never reads .env.local.

set -euo pipefail

UI_API_E2E_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ui-api-e2e-common.sh
source "${UI_API_E2E_ROOT}/ui-api-e2e-common.sh"

SCRIPT_PREFIX="prepare-visual-smoke"
BOOTSTRAP_SQL="${UI_API_E2E_ROOT}/bootstrap-ui-api-minimal.sql"
SEED_SQL="${UI_API_E2E_ROOT}/seed-visual-smoke.sql"
SETUP_MJS="${UI_API_E2E_ROOT}/setup-visual-smoke.mjs"
RUN_STATE_DIR="${UI_API_E2E_ROOT}/.run-state"

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
  ui_api_require_env "${SCRIPT_PREFIX}" PLAN_CHANGE_TEST_DATABASE_URL

  if [[ "${apply_mode}" != "true" ]]; then
    local preview_run_id
    preview_run_id="$(ui_api_generate_run_id)"
    ui_api_info "${SCRIPT_PREFIX}" "DRY-RUN MODE: pass --apply to write fictional visual smoke fixtures"
    ui_api_info "${SCRIPT_PREFIX}" "Target ref: ${ALLOWED_REF} only"
    ui_api_info "${SCRIPT_PREFIX}" "Main allowlisted email: $(ui_api_test_email_for_run "${preview_run_id}")"
    ui_api_info "${SCRIPT_PREFIX}" "Payment probe email (non-allowlisted): $(ui_api_payment_email_for_run "${preview_run_id}")"
    ui_api_info "${SCRIPT_PREFIX}" "Sequence with --apply:"
    ui_api_info "${SCRIPT_PREFIX}" "  1. node setup-visual-smoke.mjs (two fictional auth users; passwords in .run-state/ only)"
    ui_api_info "${SCRIPT_PREFIX}" "  2. psql bootstrap-ui-api-minimal.sql + seed-visual-smoke.sql"
    ui_api_info "${SCRIPT_PREFIX}" "  3. ./start-visual-smoke-next.sh (Next.js test-only; no automatic activation)"
    exit 0
  fi

  export PLAN_CHANGE_UI_API_RUN_ID="${PLAN_CHANGE_UI_API_RUN_ID:-$(ui_api_generate_run_id)}"
  local main_email payment_email
  main_email="$(ui_api_test_email_for_run "${PLAN_CHANGE_UI_API_RUN_ID}")"
  payment_email="$(ui_api_payment_email_for_run "${PLAN_CHANGE_UI_API_RUN_ID}")"

  ui_api_info "${SCRIPT_PREFIX}" "APPLY MODE: visual smoke preparation on ${ALLOWED_REF} (connection not logged)"
  ui_api_info "${SCRIPT_PREFIX}" "Run id: ${PLAN_CHANGE_UI_API_RUN_ID}"
  ui_api_info "${SCRIPT_PREFIX}" "Main allowlisted email: ${main_email}"
  ui_api_info "${SCRIPT_PREFIX}" "Payment probe email (non-allowlisted): ${payment_email}"
  ui_api_info "${SCRIPT_PREFIX}" "Credentials file: .run-state/visual-smoke-latest.json (local only; not printed)"

  ui_api_info "${SCRIPT_PREFIX}" "Creating two fictional auth users (server-side admin API only)"
  local setup_json
  setup_json="$(node "${SETUP_MJS}")"

  local main_auth_user_id main_client_id main_session_id main_entitlement_id
  local payment_auth_user_id payment_client_id payment_session_id payment_entitlement_id

  main_auth_user_id="$(printf '%s' "${setup_json}" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).main_auth_user_id)")"
  main_client_id="$(printf '%s' "${setup_json}" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).main_client_id)")"
  main_session_id="$(printf '%s' "${setup_json}" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).main_session_id)")"
  main_entitlement_id="$(printf '%s' "${setup_json}" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).main_entitlement_id)")"
  payment_auth_user_id="$(printf '%s' "${setup_json}" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).payment_auth_user_id)")"
  payment_client_id="$(printf '%s' "${setup_json}" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).payment_client_id)")"
  payment_session_id="$(printf '%s' "${setup_json}" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).payment_session_id)")"
  payment_entitlement_id="$(printf '%s' "${setup_json}" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).payment_entitlement_id)")"

  local latest_state manifest_state
  latest_state="${RUN_STATE_DIR}/visual-smoke-latest.json"
  manifest_state="${RUN_STATE_DIR}/visual-smoke-manifest.json"
  ui_api_secure_run_state_permissions "${RUN_STATE_DIR}" \
    "${latest_state}" \
    "${RUN_STATE_DIR}/visual-smoke-${PLAN_CHANGE_UI_API_RUN_ID}.json" \
    "${manifest_state}"

  ui_api_info "${SCRIPT_PREFIX}" "Applying bootstrap-ui-api-minimal.sql (connection not logged)"
  psql -X "${PLAN_CHANGE_TEST_DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${BOOTSTRAP_SQL}"

  ui_api_info "${SCRIPT_PREFIX}" "Applying seed-visual-smoke.sql (connection not logged)"
  psql -X "${PLAN_CHANGE_TEST_DATABASE_URL}" -v ON_ERROR_STOP=1 \
    -v "ui_run_id=${PLAN_CHANGE_UI_API_RUN_ID}" \
    -v "ui_main_auth_user_id=${main_auth_user_id}" \
    -v "ui_main_client_id=${main_client_id}" \
    -v "ui_main_session_id=${main_session_id}" \
    -v "ui_main_entitlement_id=${main_entitlement_id}" \
    -v "ui_main_email=${main_email}" \
    -v "ui_payment_auth_user_id=${payment_auth_user_id}" \
    -v "ui_payment_client_id=${payment_client_id}" \
    -v "ui_payment_session_id=${payment_session_id}" \
    -v "ui_payment_entitlement_id=${payment_entitlement_id}" \
    -v "ui_payment_email=${payment_email}" \
    -f "${SEED_SQL}"

  ui_api_info "${SCRIPT_PREFIX}" "Visual smoke preparation complete — both accounts start on Growth"
  ui_api_info "${SCRIPT_PREFIX}" "Next: export Next.js test env and run ./start-visual-smoke-next.sh"
  ui_api_info "${SCRIPT_PREFIX}" "Load login passwords from .run-state/visual-smoke-latest.json (never logged here)"
}

main "$@"
