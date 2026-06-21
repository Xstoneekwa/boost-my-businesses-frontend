#!/usr/bin/env bash
# Start Next.js for Plan Change visual smoke on nxntngkhkoynljcagmkq ONLY.
# Never reads or modifies .env.local. Never logs credentials.

set -euo pipefail

UI_API_E2E_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ui-api-e2e-common.sh
source "${UI_API_E2E_ROOT}/ui-api-e2e-common.sh"

SCRIPT_PREFIX="start-visual-smoke-next"
MANIFEST_PATH="${UI_API_E2E_ROOT}/.run-state/visual-smoke-manifest.json"
REPO_ROOT="$(cd "${UI_API_E2E_ROOT}/../../.." && pwd)"
PORT="${PLAN_CHANGE_VISUAL_SMOKE_PORT:-3000}"

ui_api_allowlist_has_email() {
  local allowlist="$1"
  local email="$2"
  local normalized
  normalized="$(printf '%s' "${email}" | tr '[:upper:]' '[:lower:]')"
  local entry lowered
  IFS=',' read -ra entries <<< "${allowlist}"
  for entry in "${entries[@]}"; do
    entry="${entry#"${entry%%[![:space:]]*}"}"
    entry="${entry%"${entry##*[![:space:]]}"}"
    lowered="$(printf '%s' "${entry}" | tr '[:upper:]' '[:lower:]')"
    if [[ "${lowered}" == "${normalized}" ]]; then
      return 0
    fi
  done
  return 1
}

main() {
  ui_api_refuse_automatic_env_local "${SCRIPT_PREFIX}"
  ui_api_assert_next_public_supabase_ref "${SCRIPT_PREFIX}"
  ui_api_refuse_key_in_next_public "${SCRIPT_PREFIX}" SUPABASE_SERVICE_ROLE_KEY

  ui_api_require_env "${SCRIPT_PREFIX}" SUPABASE_SERVICE_ROLE_KEY
  ui_api_require_env "${SCRIPT_PREFIX}" NEXT_PUBLIC_SUPABASE_ANON_KEY

  if [[ "${SIMULATED_CHECKOUT_ENABLED:-}" != "true" ]]; then
    ui_api_fail "${SCRIPT_PREFIX}" "Set SIMULATED_CHECKOUT_ENABLED=true for visual smoke activation"
  fi

  if [[ ! -f "${MANIFEST_PATH}" ]]; then
    ui_api_fail "${SCRIPT_PREFIX}" "Missing ${MANIFEST_PATH} — run ./prepare-visual-smoke.sh --apply first"
  fi

  local manifest_json main_email run_id
  manifest_json="$(cat "${MANIFEST_PATH}")"
  main_email="$(printf '%s' "${manifest_json}" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).mainEmail)")"
  run_id="$(printf '%s' "${manifest_json}" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).runId)")"

  if [[ -z "${main_email}" || -z "${run_id}" ]]; then
    ui_api_fail "${SCRIPT_PREFIX}" "Invalid visual smoke manifest — re-run ./prepare-visual-smoke.sh --apply"
  fi

  if [[ -z "${SIMULATED_CHECKOUT_EMAIL_ALLOWLIST:-}" ]]; then
    ui_api_fail "${SCRIPT_PREFIX}" "Set SIMULATED_CHECKOUT_EMAIL_ALLOWLIST to the main fictional account for run ${run_id}"
  fi

  if ! ui_api_allowlist_has_email "${SIMULATED_CHECKOUT_EMAIL_ALLOWLIST}" "${main_email}"; then
    ui_api_fail "${SCRIPT_PREFIX}" "SIMULATED_CHECKOUT_EMAIL_ALLOWLIST must include main account ${main_email}"
  fi

  ui_api_info "${SCRIPT_PREFIX}" "Starting Next.js on http://127.0.0.1:${PORT} for visual smoke run ${run_id}"
  ui_api_info "${SCRIPT_PREFIX}" "Main allowlisted account: ${main_email}"
  ui_api_info "${SCRIPT_PREFIX}" "Payment probe is intentionally absent from allowlist"
  ui_api_info "${SCRIPT_PREFIX}" "Login passwords: .run-state/visual-smoke-latest.json (local only; not printed)"

  cd "${REPO_ROOT}"
  exec npm run dev -- --port "${PORT}"
}

main "$@"
