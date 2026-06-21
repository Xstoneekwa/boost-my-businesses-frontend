#!/usr/bin/env bash
# Catalogue-only audit of the isolated test DB (nxntngkhkoynljcagmkq).
# PREPARED ONLY — run manually from your terminal after explicit GO.
# Never uses .env.local; never logs database URLs.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_HARNESS_ROOT="${ROOT_DIR}"
# shellcheck source=audit-common.sh
source "${ROOT_DIR}/audit-common.sh"

PREFIX="audit-test-target"
SQL_FILE="${ROOT_DIR}/audit-test-target.sql"
EXPECTED_REF="nxntngkhkoynljcagmkq"
FORBIDDEN_REF="zgafnshkjywfltxgbtzg"

extract_ref_from_supabase_url() {
  local url="$1"
  echo "$url" | sed -E 's#https?://([^.]+)\..*#\1#'
}

main() {
  audit_refuse_env_local "${PREFIX}"

  audit_require_env "${PREFIX}" PLAN_CHANGE_TEST_SUPABASE_URL
  audit_require_env "${PREFIX}" PLAN_CHANGE_TEST_DATABASE_URL

  local supabase_ref
  local database_ref
  supabase_ref="$(extract_ref_from_supabase_url "${PLAN_CHANGE_TEST_SUPABASE_URL}")"
  if ! audit_extract_ref_from_postgres_url "${PLAN_CHANGE_TEST_DATABASE_URL}"; then
    audit_fail "${PREFIX}" "${AUDIT_LAST_EXTRACT_ERROR}"
  fi
  database_ref="${AUDIT_EXTRACTED_REF}"

  if [[ "${supabase_ref}" == "${FORBIDDEN_REF}" || "${database_ref}" == "${FORBIDDEN_REF}" ]]; then
    audit_fail "${PREFIX}" "Refusing forbidden shared project ref: ${FORBIDDEN_REF}"
  fi

  audit_assert_ref_matches "${PREFIX}" "${supabase_ref}" "${EXPECTED_REF}" "PLAN_CHANGE_TEST_SUPABASE_URL"
  audit_assert_ref_matches "${PREFIX}" "${database_ref}" "${EXPECTED_REF}" "PLAN_CHANGE_TEST_DATABASE_URL"

  if [[ "${supabase_ref}" != "${database_ref}" ]]; then
    audit_fail "${PREFIX}" "PLAN_CHANGE_TEST_SUPABASE_URL and PLAN_CHANGE_TEST_DATABASE_URL refs must match"
  fi

  if [[ ! -f "${SQL_FILE}" ]]; then
    audit_fail "${PREFIX}" "Missing SQL file: ${SQL_FILE}"
  fi

  audit_assert_sql_readonly "${PREFIX}" "${ROOT_DIR}" "${SQL_FILE}"

  audit_info "${PREFIX}" "Test ref guard OK (${EXPECTED_REF})"
  audit_info "${PREFIX}" "Catalogue-only scope: confirm empty public baseline before harness apply"
  audit_run_psql_catalogue "${PREFIX}" "${PLAN_CHANGE_TEST_DATABASE_URL}" "${SQL_FILE}"
  audit_info "${PREFIX}" "Complete — test target ready for harness apply when snapshot validated"
}

main "$@"
