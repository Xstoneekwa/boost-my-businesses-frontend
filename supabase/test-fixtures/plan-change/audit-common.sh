#!/usr/bin/env bash
# Shared guards for catalogue-only audit scripts. Never logs database URLs or secrets.

set -euo pipefail

if [[ -z "${AUDIT_HARNESS_ROOT:-}" ]]; then
  AUDIT_HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

POSTGRES_URL_REF_HELPER="${AUDIT_HARNESS_ROOT}/postgres-url-ref.mjs"

audit_fail() {
  local prefix="$1"
  shift
  echo "[${prefix}] FAIL: $*" >&2
  exit 1
}

audit_info() {
  local prefix="$1"
  shift
  echo "[${prefix}] $*"
}

audit_require_env() {
  local prefix="$1"
  local name="$2"
  if [[ -z "${!name:-}" ]]; then
    audit_fail "${prefix}" "Missing required env var: ${name}"
  fi
}

audit_refuse_env_local() {
  local prefix="$1"
  if [[ -n "${DOTENV_CONFIG_PATH:-}" && "${DOTENV_CONFIG_PATH}" == *".env.local"* ]]; then
    audit_fail "${prefix}" "Refusing .env.local as credential source"
  fi
  if [[ -n "${ENV_FILE:-}" && "${ENV_FILE}" == *".env.local"* ]]; then
    audit_fail "${prefix}" "Refusing .env.local as credential source"
  fi
}

audit_extract_ref_from_postgres_url() {
  local url="$1"
  local ref err_file

  AUDIT_LAST_EXTRACT_ERROR=""
  AUDIT_EXTRACTED_REF=""

  if [[ ! -f "${POSTGRES_URL_REF_HELPER}" ]]; then
    AUDIT_LAST_EXTRACT_ERROR="Cannot parse project ref from database URL (URL not logged)"
    return 1
  fi

  err_file="$(mktemp)"
  if ! ref="$(printf '%s' "${url}" | node "${POSTGRES_URL_REF_HELPER}" --extract-stdin 2>"${err_file}")"; then
    AUDIT_LAST_EXTRACT_ERROR="$(tr -d '\n' < "${err_file}")"
    rm -f "${err_file}"
    if [[ -z "${AUDIT_LAST_EXTRACT_ERROR}" ]]; then
      AUDIT_LAST_EXTRACT_ERROR="Cannot parse project ref from database URL (URL not logged)"
    fi
    return 1
  fi
  rm -f "${err_file}"
  AUDIT_EXTRACTED_REF="${ref}"
  return 0
}

audit_assert_ref_matches() {
  local prefix="$1"
  local actual_ref="$2"
  local expected_ref="$3"
  local label="$4"

  if [[ "${actual_ref}" != "${expected_ref}" ]]; then
    audit_fail "${prefix}" "Refusing unexpected project ref on ${label} (expected: ${expected_ref})"
  fi
}

audit_assert_sql_readonly() {
  local prefix="$1"
  local harness_root="$2"
  local sql_file="$3"
  local validator="${harness_root}/validate-audit-sql.mjs"

  if [[ ! -f "${validator}" ]]; then
    audit_fail "${prefix}" "Missing SQL validator: ${validator}"
  fi

  node "${validator}" "${sql_file}" >/dev/null
}

audit_run_psql_catalogue() {
  local prefix="$1"
  local database_url="$2"
  local sql_file="$3"

  audit_info "${prefix}" "Running catalogue-only audit (read-only; connection not logged)"
  PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000' \
    psql -X "${database_url}" -v ON_ERROR_STOP=1 -f "${sql_file}"
}
