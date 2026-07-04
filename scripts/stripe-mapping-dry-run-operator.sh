#!/usr/bin/env bash
set -euo pipefail

# Safe operator wrapper for the Stripe Test -> Production mapping dry-run.
# It reads the two secrets only from the current terminal environment:
#   STRIPE_SECRET_KEY              restricted Stripe Test key, preferably rk_test_...
#   SUPABASE_SERVICE_ROLE_KEY      Production Supabase service-role key
#
# It never runs --apply. Apply remains a separate explicit approval step.
# On failure, the CLI writes a redacted local diagnostic file that Cursor can inspect.

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage:
  STRIPE_SECRET_KEY=... SUPABASE_SERVICE_ROLE_KEY=... bash scripts/stripe-mapping-dry-run-operator.sh

Optional:
  STRIPE_MAPPING_DIAGNOSTIC_FILE=/tmp/stripe-mapping-diagnostic.json

This script runs dry-run only and refuses all positional arguments.
EOF
  exit 0
fi

if [[ "$#" -ne 0 ]]; then
  echo '{"ok":false,"code":"operator_script_arguments_forbidden","stage":"validation","checkpoint":"cli_preflight"}' >&2
  exit 2
fi

cleanup() {
  unset STRIPE_SECRET_KEY
  unset SUPABASE_SERVICE_ROLE_KEY
  unset STRIPE_MAPPING_DIAGNOSTIC_FILE
}
trap cleanup EXIT

if [[ -z "${STRIPE_SECRET_KEY:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo '{"ok":false,"code":"operator_secrets_required","stage":"validation","checkpoint":"cli_preflight"}' >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

export SUPABASE_URL="${SUPABASE_URL:-https://zgafnshkjywfltxgbtzg.supabase.co}"
export STRIPE_MAPPING_DIAGNOSTIC_FILE="${STRIPE_MAPPING_DIAGNOSTIC_FILE:-/tmp/stripe-mapping-diagnostic.json}"

node "${REPO_ROOT}/scripts/stripe-sync-public-catalog-mapping.mjs"
