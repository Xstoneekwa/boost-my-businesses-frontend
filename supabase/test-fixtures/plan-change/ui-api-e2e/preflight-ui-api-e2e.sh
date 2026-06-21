#!/usr/bin/env bash
# Plan Change UI/API E2E — read-only preflight on nxntngkhkoynljcagmkq ONLY.
# Runs Fast Track --verify-only. Does not create users, quotes, or entitlements.

set -euo pipefail

UI_API_E2E_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ui-api-e2e-common.sh
source "${UI_API_E2E_ROOT}/ui-api-e2e-common.sh"

SCRIPT_PREFIX="preflight-ui-api-e2e"
FAST_TRACK_APPLY="${FAST_TRACK_DIR}/apply-fast-track-plan-change.sh"

main() {
  ui_api_assert_core_env "${SCRIPT_PREFIX}"
  ui_api_assert_database_ref "${SCRIPT_PREFIX}"

  ui_api_info "${SCRIPT_PREFIX}" "Project ref guard OK (${ALLOWED_REF})"
  ui_api_info "${SCRIPT_PREFIX}" "PLAN_CHANGE_TEST_* env present (values not logged)"

  if [[ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ]]; then
    ui_api_info "${SCRIPT_PREFIX}" "NEXT_PUBLIC_SUPABASE_URL targets isolated ref (not logged)"
  else
    ui_api_info "${SCRIPT_PREFIX}" "WARN: NEXT_PUBLIC_SUPABASE_URL unset — start Next.js pointed at PLAN_CHANGE_TEST_SUPABASE_URL"
  fi

  if [[ "${SIMULATED_CHECKOUT_ENABLED:-}" != "true" ]]; then
    ui_api_info "${SCRIPT_PREFIX}" "WARN: SIMULATED_CHECKOUT_ENABLED is not true (required for apply activation scenarios)"
  fi

  ui_api_info "${SCRIPT_PREFIX}" "READ-ONLY: invoking Fast Track verify-only (no UI/API fixture writes)"
  if [[ ! -x "${FAST_TRACK_APPLY}" ]]; then
    ui_api_fail "${SCRIPT_PREFIX}" "Missing fast-track apply script: ${FAST_TRACK_APPLY}"
  fi

  PLAN_CHANGE_DB_TEST_CONFIRM="${PLAN_CHANGE_DB_TEST_CONFIRM}" \
    PLAN_CHANGE_TEST_DATABASE_URL="${PLAN_CHANGE_TEST_DATABASE_URL}" \
    "${FAST_TRACK_APPLY}" --verify-only

  ui_api_info "${SCRIPT_PREFIX}" "Preflight complete — ready for apply-ui-api-e2e.sh --apply after explicit GO"
  ui_api_info "${SCRIPT_PREFIX}" "Next.js must use PLAN_CHANGE_TEST_SUPABASE_URL + server-only service role (never NEXT_PUBLIC_* secrets)"
}

main "$@"
