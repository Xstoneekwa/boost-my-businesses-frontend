# Supabase baseline bootstrap and non-replay

## Immutable rules

- Cutover: `20260728001632`.
- Bootstrap is for an empty environment only.
- Never submit either baseline SQL file through production migration push.
- Never replay the 67 historical local files to represent production.
- Never repair production history automatically.

## Existing production

1. Confirm the live migration list still contains the cutover and all expected predecessors.
2. Confirm `PRODUCTION_BASELINE_BOOTSTRAP_PENDING = 0`.
3. Compare the four post-cutover filenames and hashes to `manifest.json`.
4. Review pending migrations manually; expected historical pending count is zero by policy because the deployment input is the explicit post-cutover allowlist, not the legacy directory.
5. Stop if any unknown version, changed hash or baseline file appears in the plan.

## New Supabase environment

1. Provision managed Auth, Vault, required extensions and roles.
2. Apply only `20260728001632_public_schema.sql` to the empty application schema.
3. Verify the structural signatures in the manifest.
4. Register the cutover using the separately reviewed environment-bootstrap procedure.
5. Apply only migrations listed in `postCutoverMigrations`.

## Plain PostgreSQL CI

Apply compatibility prelude, baseline, post-cutover migrations, synthetic fixtures and SQL tests in that order. The compatibility prelude is not a Supabase migration and contains only platform stubs.

## Existing developer database

- Empty: follow new-environment bootstrap.
- Matches cutover: apply post-cutover allowlist only.
- Unknown or partially historical: stop, export a schema-only signature, compare, and choose disposal/rebootstrap or manual review. Do not repair automatically.

## Drift classification

Critical: missing application object, changed column/constraint/index/view/function signature, trigger, RLS policy or effective CT grant. Non-functional and documented: owner neutrality, dump metadata removal and locally newer compatible `vector` 0.8.x.
