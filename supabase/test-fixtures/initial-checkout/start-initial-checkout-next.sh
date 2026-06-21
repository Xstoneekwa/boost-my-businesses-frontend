#!/usr/bin/env bash
# Start Next.js for Initial Checkout isolated E2E on nxntngkhkoynljcagmkq ONLY.

set -euo pipefail

INITIAL_CHECKOUT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export INITIAL_CHECKOUT_ROOT
# shellcheck source=initial-checkout-common.sh
source "${INITIAL_CHECKOUT_ROOT}/initial-checkout-common.sh"

SCRIPT_PREFIX="start-initial-checkout-next"
MANIFEST_PATH="${INITIAL_CHECKOUT_ROOT}/.run-state/initial-checkout-manifest.json"
REPO_ROOT="$(cd "${INITIAL_CHECKOUT_ROOT}/../../.." && pwd)"
PORT="${INITIAL_CHECKOUT_PORT:-3000}"

main() {
  if [[ -z "${SUPABASE_URL:-}" ]]; then
    if [[ -n "${INITIAL_CHECKOUT_TEST_SUPABASE_URL:-}" ]]; then
      export SUPABASE_URL="${INITIAL_CHECKOUT_TEST_SUPABASE_URL}"
    fi
  fi
  initial_checkout_assert_next_runtime_env "${SCRIPT_PREFIX}"
  ui_api_refuse_key_in_next_public "${SCRIPT_PREFIX}" SUPABASE_SERVICE_ROLE_KEY
  initial_checkout_require_env "${SCRIPT_PREFIX}" SUPABASE_SERVICE_ROLE_KEY
  initial_checkout_require_env "${SCRIPT_PREFIX}" NEXT_PUBLIC_SUPABASE_ANON_KEY

  if [[ "${SIMULATED_CHECKOUT_ENABLED:-}" != "true" ]]; then
    initial_checkout_fail "${SCRIPT_PREFIX}" "Set SIMULATED_CHECKOUT_ENABLED=true"
  fi

  if [[ ! -f "${MANIFEST_PATH}" ]]; then
    initial_checkout_fail "${SCRIPT_PREFIX}" "Missing ${MANIFEST_PATH} — run ./prepare-initial-checkout.sh --apply first"
  fi

  local manifest_json purchaser_email run_id
  manifest_json="$(cat "${MANIFEST_PATH}")"
  purchaser_email="$(printf '%s' "${manifest_json}" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).purchaserEmail)")"
  run_id="$(printf '%s' "${manifest_json}" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).runId)")"

  if [[ -z "${purchaser_email}" || -z "${run_id}" ]]; then
    initial_checkout_fail "${SCRIPT_PREFIX}" "Invalid manifest — re-run ./prepare-initial-checkout.sh --apply"
  fi

  if [[ -z "${SIMULATED_CHECKOUT_EMAIL_ALLOWLIST:-}" ]]; then
    initial_checkout_fail "${SCRIPT_PREFIX}" "Set SIMULATED_CHECKOUT_EMAIL_ALLOWLIST to purchaser ${purchaser_email}"
  fi

  if ! ui_api_allowlist_has_email "${SIMULATED_CHECKOUT_EMAIL_ALLOWLIST}" "${purchaser_email}"; then
    initial_checkout_fail "${SCRIPT_PREFIX}" "SIMULATED_CHECKOUT_EMAIL_ALLOWLIST must include purchaser ${purchaser_email}"
  fi

  initial_checkout_info "${SCRIPT_PREFIX}" "Starting Next.js on http://127.0.0.1:${PORT} for initial checkout run ${run_id}"
  initial_checkout_info "${SCRIPT_PREFIX}" "Server SUPABASE_URL ref: ${ALLOWED_REF}"
  initial_checkout_info "${SCRIPT_PREFIX}" "Allowlisted purchaser: ${purchaser_email}"
  initial_checkout_info "${SCRIPT_PREFIX}" "Payment probe intentionally absent from allowlist"
  initial_checkout_info "${SCRIPT_PREFIX}" "Passwords: .run-state/initial-checkout-latest.json (local only; not printed)"

  cd "${REPO_ROOT}"
  exec npm run dev -- --port "${PORT}"
}

main "$@"
