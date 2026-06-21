#!/usr/bin/env bash
# Shared guards for Initial Checkout isolated fixtures. Never logs secrets or database URLs.

set -euo pipefail

if [[ -z "${INITIAL_CHECKOUT_ROOT:-}" ]]; then
  INITIAL_CHECKOUT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

PLAN_CHANGE_UI_API_ROOT="$(cd "${INITIAL_CHECKOUT_ROOT}/../plan-change/ui-api-e2e" && pwd)"
# shellcheck source=../plan-change/ui-api-e2e/ui-api-e2e-common.sh
source "${PLAN_CHANGE_UI_API_ROOT}/ui-api-e2e-common.sh"

initial_checkout_fail() {
  local prefix="$1"
  shift
  ui_api_fail "${prefix}" "$*"
}

initial_checkout_info() {
  local prefix="$1"
  shift
  ui_api_info "${prefix}" "$*"
}

initial_checkout_assert_core_env() {
  local prefix="$1"
  if [[ "${INITIAL_CHECKOUT_DB_TEST_CONFIRM:-}" != "isolated-test-only" ]]; then
    initial_checkout_fail "${prefix}" "Set INITIAL_CHECKOUT_DB_TEST_CONFIRM=isolated-test-only"
  fi
  ui_api_refuse_automatic_env_local "${prefix}"
  initial_checkout_assert_server_supabase_ref "${prefix}"
  ui_api_refuse_key_in_next_public "${prefix}" INITIAL_CHECKOUT_TEST_SERVICE_ROLE_KEY
  initial_checkout_require_env "${prefix}" INITIAL_CHECKOUT_TEST_SERVICE_ROLE_KEY
  initial_checkout_require_env "${prefix}" INITIAL_CHECKOUT_TEST_SUPABASE_URL
}

initial_checkout_require_env() {
  ui_api_require_env "$1" "$2"
}

initial_checkout_assert_server_supabase_ref() {
  local prefix="$1"
  initial_checkout_require_env "${prefix}" INITIAL_CHECKOUT_TEST_SUPABASE_URL
  local supabase_ref
  supabase_ref="$(echo "${INITIAL_CHECKOUT_TEST_SUPABASE_URL}" | sed -E 's#https?://([^.]+)\..*#\1#')"
  if [[ "${supabase_ref}" == "${FORBIDDEN_REF}" ]]; then
    initial_checkout_fail "${prefix}" "Refusing forbidden shared project ref on INITIAL_CHECKOUT_TEST_SUPABASE_URL"
  fi
  if [[ "${supabase_ref}" != "${ALLOWED_REF}" ]]; then
    initial_checkout_fail "${prefix}" "INITIAL_CHECKOUT_TEST_SUPABASE_URL must target ${ALLOWED_REF}"
  fi
}

initial_checkout_assert_database_ref() {
  local prefix="$1"
  initial_checkout_require_env "${prefix}" INITIAL_CHECKOUT_TEST_DATABASE_URL
  if ! audit_extract_ref_from_postgres_url "${INITIAL_CHECKOUT_TEST_DATABASE_URL}"; then
    initial_checkout_fail "${prefix}" "${AUDIT_LAST_EXTRACT_ERROR}"
  fi
  if [[ "${AUDIT_EXTRACTED_REF}" == "${FORBIDDEN_REF}" ]]; then
    initial_checkout_fail "${prefix}" "Refusing forbidden shared project ref on INITIAL_CHECKOUT_TEST_DATABASE_URL"
  fi
  if [[ "${AUDIT_EXTRACTED_REF}" != "${ALLOWED_REF}" ]]; then
    initial_checkout_fail "${prefix}" "INITIAL_CHECKOUT_TEST_DATABASE_URL must target ${ALLOWED_REF}"
  fi
}

initial_checkout_assert_next_runtime_env() {
  local prefix="$1"
  if [[ "${SIMULATED_CHECKOUT_ISOLATED_TEST_CONFIRM:-}" != "isolated-test-only" ]]; then
    initial_checkout_fail "${prefix}" "Set SIMULATED_CHECKOUT_ISOLATED_TEST_CONFIRM=isolated-test-only"
  fi
  if [[ -z "${SUPABASE_URL:-}" ]]; then
    initial_checkout_fail "${prefix}" "Set server-only SUPABASE_URL (never use NEXT_PUBLIC_* for simulation guards)"
  fi
  local server_ref
  server_ref="$(echo "${SUPABASE_URL}" | sed -E 's#https?://([^.]+)\..*#\1#')"
  if [[ "${server_ref}" != "${ALLOWED_REF}" ]]; then
    initial_checkout_fail "${prefix}" "SUPABASE_URL must target ${ALLOWED_REF}"
  fi
  ui_api_assert_next_public_supabase_ref "${prefix}"
}

initial_checkout_generate_run_id() {
  ui_api_generate_run_id
}

initial_checkout_purchaser_email_for_run() {
  echo "initial_checkout_test_${1}@example.invalid"
}

initial_checkout_payment_email_for_run() {
  echo "initial_checkout_payment_${1}@example.invalid"
}

initial_checkout_secure_run_state_permissions() {
  ui_api_secure_run_state_permissions "$@"
}
