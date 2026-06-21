# Plan Change test harness — runbook

**Scope:** isolated project `nxntngkhkoynljcagmkq` only.
**Forbidden:** `zgafnshkjywfltxgbtzg`, Lucie/Liam data, `.env.local`, `supabase db push`.

---

## 1. Environment classification

| Code | Name | Meaning |
|------|------|---------|
| A | `schema_exact_present` | Checkout + plan-change present and conforming |
| B | `schema_partial_or_divergent` | Partial schema or fingerprint drift |
| C | `probe_or_access_inconclusive` | Ambiguous probe/access failure |
| D | `empty_baseline_test_database` | All applicative tables missing — **current state** |

**Case D:** PASS isolation/environment. **NO-GO** for checkout/plan-change until harness snapshot applied.

Migration history not exposed via REST does **not** downgrade D → C.

---

## 2. Harness design (no retroactive migration)

We do **not** add a baseline file under `supabase/migrations/`.

Instead:

```
supabase/test-fixtures/plan-change/
  public-schema-canonical.snapshot.sql   ← generated schema-only (not in repo until GO)
  manifest.json
  verify-schema-only-snapshot.mjs
  apply-plan-change-test-harness.sh
```

The snapshot captures the **live canonical checkout schema** from the shared reference (DDL only). It must **exclude** plan-change objects so migration `20260621120000` remains the validated apply step.

---

## 3. Generating the snapshot (future — requires explicit GO)

**Read-only schema export from reference structure DB:**

```bash
# After GO — session isolated, credentials via env only (never commit)
# Preserve RLS, policies, GRANT, REVOKE — never use --no-privileges, --clean, or --create
pg_dump \
  --schema-only \
  --no-owner \
  --schema=public \
  "$REFERENCE_SCHEMA_DATABASE_URL" \
  > supabase/test-fixtures/plan-change/public-schema-canonical.snapshot.sql
```

**Forbidden `pg_dump` flags:** `--no-privileges`, `--clean`, `--create` (would strip RLS/grants or drop/create a whole DB).

Post-generation:

1. Fill `manifest.json` → `externalDependencies` from source audit (extensions, schemas, functions)
2. Run `verify-schema-only-snapshot.mjs`
3. Compute SHA-256 and set `manifest.json` → `snapshot.sha256` and `snapshot.generatedAt`
4. Review diff — no `COPY`, no `INSERT`, no plan-change objects, no credential material

**Never** export rows, Auth users, or client data.

---

## 4. Snapshot validator contract

`verify-schema-only-snapshot.mjs` **rejects** real secrets and data:

- `COPY`, `INSERT INTO`, seed data
- PostgreSQL URLs with embedded password
- `password=...` assignments, JWT-like `eyJ...`, Supabase keys `sb_...`, bearer tokens
- Actual `service_role` **key values** (not SQL role identifiers in `GRANT`/`REVOKE`)

**Allowed** in snapshot DDL:

- `GRANT ... TO service_role|anon|authenticated|postgres`
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and policies
- `GRANT` / `REVOKE`

**Requires** DDL for checkout/base tables and **BLOCKED** if:

- Plan-change objects present (`commercial_plan_change_quotes`, `client_credit_ledger`, `activate_commercial_plan_change`)
- `manifest.externalDependencies` incomplete or inconsistent with snapshot (undeclared `auth` refs, missing extensions, etc.)

Outputs JSON fingerprint with `sha256` and `byteLength`.

### External dependencies (manifest)

```json
"externalDependencies": {
  "auditStatus": "partial",
  "extensions": [],
  "schemas": ["auth"],
  "functions": ["set_updated_at", "validate_client_subscription_type"],
  "roles": ["anon", "authenticated", "service_role", "postgres"]
}
```

After full DDL validation on source:

```json
"externalDependencies": {
  "auditStatus": "complete",
  "extensions": [],
  "schemas": ["auth"],
  "functions": ["set_updated_at", "validate_client_subscription_type"],
  "roles": ["anon", "authenticated", "service_role", "postgres"]
}
```

Rules:

- `auditStatus: pending` → snapshot validation **BLOCKED**
- `auditStatus: partial` → catalogue confirmed, DDL not fully validated — **BLOCKED**
- `auditStatus: complete` → full evidence in `confirmedCatalogEvidence` required
- Snapshot generation and apply still require **explicit written GO** even when `complete`
- Object in snapshot but not in manifest → **BLOCKED**
- Object in manifest but not in snapshot → **BLOCKED**
- Validator never guesses dependencies

`audit-minimal-baseline-contract.sql` is **psql only** (`\echo` breaks SQL Editor). In SQL Editor, run each `SELECT` block separately.

---

## 5. Catalogue-only audits (prepared — manual execution)

Scripts (never auto-run from CI without explicit GO):

| Script | Target ref | Env vars |
|--------|------------|----------|
| `audit-reference-schema.sh` | `zgafnshkjywfltxgbtzg` | `REFERENCE_SCHEMA_PROJECT_REF`, `REFERENCE_SCHEMA_DATABASE_URL` |
| `audit-test-target.sh` | `nxntngkhkoynljcagmkq` | `PLAN_CHANGE_TEST_SUPABASE_URL`, `PLAN_CHANGE_TEST_DATABASE_URL` |

**Catalogue-only scope:** `pg_catalog`, `information_schema`, `pg_policies`, roles/grants metadata, extensions, dependency catalog.

**Forbidden:** row reads on applicative tables, `auth.users` rows, `COPY`, dump, DML/DDL, credentials in logs.

Source audit confirms (no data displayed):

1. Nine baseline/checkout tables present
2. Plan Change objects absent
3. Required extensions, `auth.*` refs, types/enums, functions, triggers, GRANT roles, RLS/policies, deps outside `public`

Target audit confirms: empty public baseline, `auth.users` catalog available, extensions/roles available, no Plan Change objects, no mutation.

Local validation for untracked harness files:

```bash
node supabase/test-fixtures/plan-change/validate-harness-local.mjs
```

---

## 6. Connection contract (test-only)

| Variable | Purpose |
|----------|---------|
| `PLAN_CHANGE_TEST_SUPABASE_URL` | REST probes (`PLAN_CHANGE_TEST_SERVICE_ROLE_KEY`) |
| `PLAN_CHANGE_TEST_DATABASE_URL` | **Required** for `psql` apply — local session env only |

Rules for `PLAN_CHANGE_TEST_DATABASE_URL`:

- Must target `nxntngkhkoynljcagmkq` only (ref validated before any command)
- Must **not** come from `.env.local`, must **never** be committed or logged
- `apply-plan-change-test-harness.sh` **refuses** apply if this variable is missing
- `PLAN_CHANGE_TEST_SERVICE_ROLE_KEY` is **not** a PostgreSQL connection substitute

---

## 7. Test-only apply order (after GO)

On `nxntngkhkoynljcagmkq` only:

| Step | Action |
|------|--------|
| 1 | `verify-schema-only-snapshot.mjs` |
| 2 | Apply `public-schema-canonical.snapshot.sql` via `psql` + `PLAN_CHANGE_TEST_DATABASE_URL` |
| 3 | Apply `supabase/migrations/20260621120000_commercial_plan_change.sql` |
| 4 | `NOTIFY pgrst, 'reload schema';` |
| 5 | `validate-plan-change-db-integration.mjs --phase=environment` (expect ≠ D) |
| 6 | `--phase=schema` (RLS/grants/RPC) |
| 7 | Create test tenant via checkout simulation |
| 8 | idempotency / concurrency |
| 9 | E2E plan change |

**Do not** run `20260615143000_commercial_checkout_entitlements.sql` if snapshot already includes checkout tables.

**Do not** run `supabase db push`.

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| Data leak in snapshot | Validator + `--schema-only` + manual review |
| Snapshot includes plan-change | Validator hard fail |
| Apply to wrong project | Ref guards in apply script + env confirm |
| Stale PostgREST cache | NOTIFY after apply |
| Checkout schema drift vs migration file | Snapshot = source of truth for test harness |

---

## 9. GO/NO-GO gates

| Action | Status |
|--------|--------|
| Environment D on empty test DB | **GO** (confirmed) |
| Catalogue-only audits (source + target) | **GO** (manual, already run) |
| Manifest `auditStatus: complete` | **GO** |
| Generate snapshot from reference | **NO-GO** until explicit written GO |
| Apply harness on test DB | **NO-GO** until snapshot validated + explicit written GO |
| Plan change E2E | **NO-GO** until schema phase passes |
