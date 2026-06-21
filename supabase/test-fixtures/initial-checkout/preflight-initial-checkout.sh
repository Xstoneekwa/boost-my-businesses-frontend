#!/usr/bin/env bash
# Initial Checkout isolated preflight — read-only guards only.

set -euo pipefail

INITIAL_CHECKOUT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export INITIAL_CHECKOUT_ROOT
# shellcheck source=initial-checkout-common.sh
source "${INITIAL_CHECKOUT_ROOT}/initial-checkout-common.sh"

SCRIPT_PREFIX="preflight-initial-checkout"

main() {
  initial_checkout_assert_core_env "${SCRIPT_PREFIX}"
  initial_checkout_assert_database_ref "${SCRIPT_PREFIX}"
  initial_checkout_info "${SCRIPT_PREFIX}" "Target ref: ${ALLOWED_REF} only"
  initial_checkout_info "${SCRIPT_PREFIX}" "Server simulation confirm: SIMULATED_CHECKOUT_ISOLATED_TEST_CONFIRM=isolated-test-only"
  initial_checkout_info "${SCRIPT_PREFIX}" "Fictional emails only: *@example.invalid"
  initial_checkout_info "${SCRIPT_PREFIX}" "PASS (read-only)"
}

main "$@"
