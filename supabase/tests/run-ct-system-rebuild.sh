#!/usr/bin/env bash
set -euo pipefail

database_name="${1:?temporary database name required}"
port="${CT_TEST_POSTGRES_PORT:-55437}"

if [[ ! "$database_name" =~ ^ct_validation[0-9]+$ ]]; then
  echo "temporary database name rejected" >&2
  exit 2
fi

createdb -h 127.0.0.1 -p "$port" "$database_name"

files=(
  supabase/baseline/0000_local_platform_compatibility.sql
  supabase/baseline/20260728001632_public_schema.sql
  supabase/migrations/20260728132018_ct_target_evaluation_performance_lifecycle_v1.sql
  supabase/migrations/20260728132019_ct_premium_proposals_and_action_contracts_v1.sql
  supabase/migrations/20260728132020_ct_system_rls_and_grants_v1.sql
  supabase/migrations/20260728185253_fix_client_account_notifications_global_grants_v1.sql
  supabase/migrations/20260728132021_ct_system_transactional_rpcs_v1.sql
  supabase/migrations/20260728220631_ct_target_availability_foundations_v1.sql
  supabase/migrations/20260728230641_ct_target_availability_restrict_service_role_and_index_fks_v1.sql
  supabase/migrations/20260730123708_ct_target_availability_identity_assessment_current_v1.sql
  supabase/tests/ct-system-fixtures.sql
  supabase/tests/ct-system-contract.sql
  supabase/tests/ct-target-availability-contract.sql
  supabase/tests/ct-target-availability-forward-fix-contract.sql
  supabase/tests/ct-target-availability-identity-assessment-current-v1-contract.sql
)

for file in "${files[@]}"; do
  psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$port" -d "$database_name" -f "$file"
done

CT_TEST_DATABASE_URL="postgresql://127.0.0.1:${port}/${database_name}" \
  node supabase/tests/ct-system-security-forward-fix.test.mjs

psql -X -Atq -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$port" -d "$database_name" -f supabase/tests/ct-system-structure-hash.sql
