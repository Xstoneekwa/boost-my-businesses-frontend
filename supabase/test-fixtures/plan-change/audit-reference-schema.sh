#!/usr/bin/env bash
# Catalogue-only audit of the canonical reference DB (zgafnshkjywfltxgbtzg).
# PREPARED ONLY — run manually from your terminal after explicit GO.
# Never uses .env.local; never logs database URLs.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_HARNESS_ROOT="${ROOT_DIR}"
# shellcheck source=audit-common.sh
source "${ROOT_DIR}/audit-common.sh"

PREFIX="audit-reference-schema"
SQL_FILE="${ROOT_DIR}/audit-reference-schema.sql"
EXPECTED_REF="zgafnshkjywfltxgbtzg"

main() {
  audit_refuse_env_local "${PREFIX}"

  audit_require_env "${PREFIX}" REFERENCE_SCHEMA_PROJECT_REF
  audit_require_env "${PREFIX}" REFERENCE_SCHEMA_DATABASE_URL

  if [[ "${REFERENCE_SCHEMA_PROJECT_REF}" != "${EXPECTED_REF}" ]]; then
    audit_fail "${PREFIX}" "Refusing unexpected source project ref (expected: ${EXPECTED_REF})"
  fi

  local parsed_ref
  if ! audit_extract_ref_from_postgres_url "${REFERENCE_SCHEMA_DATABASE_URL}"; then
    audit_fail "${PREFIX}" "${AUDIT_LAST_EXTRACT_ERROR}"
  fi
  parsed_ref="${AUDIT_EXTRACTED_REF}"

  audit_assert_ref_matches "${PREFIX}" "${parsed_ref}" "${EXPECTED_REF}" "REFERENCE_SCHEMA_DATABASE_URL"

  if [[ ! -f "${SQL_FILE}" ]]; then
    audit_fail "${PREFIX}" "Missing SQL file: ${SQL_FILE}"
  fi

  audit_assert_sql_readonly "${PREFIX}" "${ROOT_DIR}" "${SQL_FILE}"

  audit_info "${PREFIX}" "Source ref guard OK (${EXPECTED_REF})"
  audit_info "${PREFIX}" "Catalogue-only scope: pg_catalog, information_schema, pg_policies — no row reads"
  audit_run_psql_catalogue "${PREFIX}" "${REFERENCE_SCHEMA_DATABASE_URL}" "${SQL_FILE}"
  audit_info "${PREFIX}" "Complete — update manifest.externalDependencies from audit output (auditStatus=complete)"
}

main "$@"
