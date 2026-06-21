#!/usr/bin/env bash
# Initial Checkout — prepare fictional purchaser + payment probe (no pre-existing client workspace).
# Requires --apply to write. Never reads .env.local.

set -euo pipefail

INITIAL_CHECKOUT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export INITIAL_CHECKOUT_ROOT
# shellcheck source=initial-checkout-common.sh
source "${INITIAL_CHECKOUT_ROOT}/initial-checkout-common.sh"

SCRIPT_PREFIX="prepare-initial-checkout"
SETUP_MJS="${INITIAL_CHECKOUT_ROOT}/setup-initial-checkout.mjs"
RUN_STATE_DIR="${INITIAL_CHECKOUT_ROOT}/.run-state"

main() {
  local apply_mode="false"
  if [[ "${1:-}" == "--apply" ]]; then
    apply_mode="true"
    shift
  fi
  if [[ $# -gt 0 ]]; then
    initial_checkout_fail "${SCRIPT_PREFIX}" "Unknown argument: $1 (optional flag: --apply)"
  fi

  initial_checkout_assert_core_env "${SCRIPT_PREFIX}"
  initial_checkout_assert_database_ref "${SCRIPT_PREFIX}"
  initial_checkout_require_env "${SCRIPT_PREFIX}" INITIAL_CHECKOUT_TEST_DATABASE_URL

  local run_id purchaser_email payment_email
  run_id="${INITIAL_CHECKOUT_RUN_ID:-$(initial_checkout_generate_run_id)}"
  purchaser_email="$(initial_checkout_purchaser_email_for_run "${run_id}")"
  payment_email="$(initial_checkout_payment_email_for_run "${run_id}")"

  if [[ "${apply_mode}" != "true" ]]; then
    initial_checkout_info "${SCRIPT_PREFIX}" "DRY-RUN MODE: pass --apply to write fictional initial checkout fixtures"
    initial_checkout_info "${SCRIPT_PREFIX}" "Target ref: ${ALLOWED_REF} only"
    initial_checkout_info "${SCRIPT_PREFIX}" "Allowlisted purchaser: ${purchaser_email}"
    initial_checkout_info "${SCRIPT_PREFIX}" "Payment probe (non-allowlisted): ${payment_email}"
    initial_checkout_info "${SCRIPT_PREFIX}" "No pre-existing client workspace — checkout simulation creates tenant"
    exit 0
  fi

  export INITIAL_CHECKOUT_RUN_ID="${run_id}"
  initial_checkout_info "${SCRIPT_PREFIX}" "APPLY MODE: preparing fictional initial checkout run ${run_id}"
  initial_checkout_info "${SCRIPT_PREFIX}" "Allowlisted purchaser: ${purchaser_email}"
  initial_checkout_info "${SCRIPT_PREFIX}" "Payment probe: ${payment_email}"
  initial_checkout_info "${SCRIPT_PREFIX}" "Credentials: .run-state/initial-checkout-latest.json (local only; not printed)"

  node "${SETUP_MJS}"

  initial_checkout_secure_run_state_permissions "${RUN_STATE_DIR}" \
    "${RUN_STATE_DIR}/initial-checkout-latest.json" \
    "${RUN_STATE_DIR}/initial-checkout-${run_id}.json" \
    "${RUN_STATE_DIR}/initial-checkout-manifest.json"

  initial_checkout_info "${SCRIPT_PREFIX}" "Complete run=${run_id}"
}

main "$@"
