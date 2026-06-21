#!/usr/bin/env bash
# Shared guards for Plan Change UI/API E2E fixtures. Never logs secrets or database URLs.

set -euo pipefail

if [[ -z "${UI_API_E2E_ROOT:-}" ]]; then
  UI_API_E2E_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

HARNESS_ROOT="$(cd "${UI_API_E2E_ROOT}/.." && pwd)"
FAST_TRACK_DIR="${HARNESS_ROOT}/fast-track"
AUDIT_HARNESS_ROOT="${HARNESS_ROOT}"

# shellcheck source=../audit-common.sh
source "${HARNESS_ROOT}/audit-common.sh"

ALLOWED_REF="nxntngkhkoynljcagmkq"
FORBIDDEN_REF="zgafnshkjywfltxgbtzg"
AUTH_COOKIE_NAME="instagram_auth_access_token"
REFRESH_COOKIE_NAME="instagram_auth_refresh_token"

ui_api_fail() {
  local prefix="$1"
  shift
  echo "[${prefix}] FAIL: $*" >&2
  exit 1
}

ui_api_info() {
  local prefix="$1"
  shift
  echo "[${prefix}] $*"
}

ui_api_require_env() {
  local prefix="$1"
  local name="$2"
  if [[ -z "${!name:-}" ]]; then
    ui_api_fail "${prefix}" "Missing required env var: ${name}"
  fi
}

ui_api_refuse_shared_public_supabase_url() {
  local prefix="$1"
  local public_url="${NEXT_PUBLIC_SUPABASE_URL:-}"
  if [[ -z "${public_url}" ]]; then
    return 0
  fi
  if [[ "${public_url}" == *"${FORBIDDEN_REF}"* ]]; then
    ui_api_fail "${prefix}" "NEXT_PUBLIC_SUPABASE_URL points at forbidden shared ref ${FORBIDDEN_REF}"
  fi
  local public_ref
  public_ref="$(echo "${public_url}" | sed -E 's#https?://([^.]+)\..*#\1#')"
  if [[ "${public_ref}" != "${ALLOWED_REF}" ]]; then
    ui_api_fail "${prefix}" "NEXT_PUBLIC_SUPABASE_URL must target ${ALLOWED_REF} when set for UI/API E2E"
  fi
}

ui_api_assert_plan_change_test_supabase_ref() {
  local prefix="$1"
  ui_api_require_env "${prefix}" PLAN_CHANGE_TEST_SUPABASE_URL
  local supabase_ref
  supabase_ref="$(echo "${PLAN_CHANGE_TEST_SUPABASE_URL}" | sed -E 's#https?://([^.]+)\..*#\1#')"
  if [[ "${supabase_ref}" == "${FORBIDDEN_REF}" ]]; then
    ui_api_fail "${prefix}" "Refusing forbidden shared project ref on PLAN_CHANGE_TEST_SUPABASE_URL"
  fi
  if [[ "${supabase_ref}" != "${ALLOWED_REF}" ]]; then
    ui_api_fail "${prefix}" "PLAN_CHANGE_TEST_SUPABASE_URL must target ${ALLOWED_REF}"
  fi
}

ui_api_assert_database_ref() {
  local prefix="$1"
  ui_api_require_env "${prefix}" PLAN_CHANGE_TEST_DATABASE_URL
  if ! audit_extract_ref_from_postgres_url "${PLAN_CHANGE_TEST_DATABASE_URL}"; then
    ui_api_fail "${prefix}" "${AUDIT_LAST_EXTRACT_ERROR}"
  fi
  if [[ "${AUDIT_EXTRACTED_REF}" == "${FORBIDDEN_REF}" ]]; then
    ui_api_fail "${prefix}" "Refusing forbidden shared project ref on PLAN_CHANGE_TEST_DATABASE_URL"
  fi
  if [[ "${AUDIT_EXTRACTED_REF}" != "${ALLOWED_REF}" ]]; then
    ui_api_fail "${prefix}" "PLAN_CHANGE_TEST_DATABASE_URL must target ${ALLOWED_REF}"
  fi
}

ui_api_refuse_service_role_in_next_public() {
  local prefix="$1"
  local key="${PLAN_CHANGE_TEST_SERVICE_ROLE_KEY:-}"
  if [[ -z "${key}" ]]; then
    return 0
  fi
  local name
  while IFS= read -r name; do
    [[ -z "${name}" ]] && continue
    if [[ "${name}" == NEXT_PUBLIC_* ]]; then
      local value="${!name:-}"
      if [[ -n "${value}" && "${value}" == "${key}" ]]; then
        ui_api_fail "${prefix}" "Service role key must not be exported via ${name}"
      fi
    fi
  done < <(compgen -e || true)
}

ui_api_refuse_automatic_env_local() {
  audit_refuse_env_local "$1"
}

ui_api_assert_core_env() {
  local prefix="$1"
  if [[ "${PLAN_CHANGE_DB_TEST_CONFIRM:-}" != "isolated-test-only" ]]; then
    ui_api_fail "${prefix}" "Set PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only"
  fi
  ui_api_refuse_automatic_env_local "${prefix}"
  ui_api_assert_plan_change_test_supabase_ref "${prefix}"
  ui_api_refuse_shared_public_supabase_url "${prefix}"
  ui_api_refuse_service_role_in_next_public "${prefix}"
  ui_api_require_env "${prefix}" PLAN_CHANGE_TEST_SERVICE_ROLE_KEY
}

ui_api_generate_run_id() {
  date -u +%Y%m%dT%H%M%SZ
}

ui_api_test_email_for_run() {
  echo "plan_change_ui_test_${1}@example.invalid"
}
