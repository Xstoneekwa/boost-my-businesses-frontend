# Plan Change — test harness (schema-only)

This directory is **outside** `supabase/migrations/` and is **never** picked up by `supabase db push`.

## Purpose

Install the **real canonical checkout schema** on the isolated test project `nxntngkhkoynljcagmkq`, then apply only the Plan Change migration for validation.

## Strategy

1. **Snapshot** — schema-only dump of `public` from the shared reference DB (structure only).
2. **Apply snapshot** — on test DB only (never `zgafnshkjywfltxgbtzg`).
3. **Apply migration** — `20260621120000_commercial_plan_change.sql` only.
4. **Do not re-apply** `20260615143000_commercial_checkout_entitlements.sql` if checkout tables are already in the snapshot.

Plan Change objects (`commercial_plan_change_quotes`, `client_credit_ledger`, `activate_commercial_plan_change`) must **not** be in the snapshot.

## Files

| File | Role |
|------|------|
| `manifest.json` | Contract: refs, checksum, required/forbidden objects, `externalDependencies.auditStatus` |
| `harness-contract.mjs` | Shared classification constants (imported by validation script) |
| `verify-schema-only-snapshot.mjs` | Rejects data/secrets/plan-change in snapshot |
| `apply-plan-change-test-harness.sh` | Guarded apply sequence (dry-run until GO) |
| `audit-reference-schema.sh` / `.sql` | Catalogue-only source audit (`zgafnshkjywfltxgbtzg`) — prepared, not auto-run |
| `audit-test-target.sh` / `.sql` | Catalogue-only test target audit (`nxntngkhkoynljcagmkq`) — prepared, not auto-run |
| `audit-minimal-baseline-contract.sql` | **psql only** — compact DDL audit (SQL Editor: run each SELECT block separately) |
| `audit-minimal-trigger-functions.sql` | Trigger function metadata audit |
| `audit-minimal-extension-usage.sql` | Extension usage audit for scope tables only |
| `validate-harness-local.mjs` | Local checks for untracked harness files |
| `docs/plan-change-test-harness.md` | Full runbook |
| `public-schema-canonical.snapshot.sql` | **Not committed until generated** (after GO) |

## Environment variables (test only)

```bash
export PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only
export PLAN_CHANGE_TEST_SUPABASE_URL=https://nxntngkhkoynljcagmkq.supabase.co
export PLAN_CHANGE_TEST_SERVICE_ROLE_KEY=...   # REST probes only — never commit
export PLAN_CHANGE_TEST_DATABASE_URL=...       # psql apply only — local session; never commit or log
```

- `PLAN_CHANGE_TEST_DATABASE_URL` is **required** for psql apply; script refuses without it.
- Ref in URL must be `nxntngkhkoynljcagmkq` (forbidden: `zgafnshkjywfltxgbtzg`).
- Do **not** use `.env.local`.
- Snapshot generation: `pg_dump --schema-only --no-owner --schema=public` (keep RLS/grants; no `--no-privileges`, `--clean`, `--create`).

## Current DB state (confirmed)

Classification **D — empty_baseline_test_database**: all applicative tables missing on `nxntngkhkoynljcagmkq`. Harness not yet applied.

## Quick checks

```bash
# Full local validation (tests + bash -n + manifest + whitespace)
node supabase/test-fixtures/plan-change/validate-harness-local.mjs

# Or run individually:
node --test scripts/plan-change-rest-probe.test.mjs supabase/test-fixtures/plan-change/*.test.mjs
bash -n supabase/test-fixtures/plan-change/apply-plan-change-test-harness.sh
bash -n supabase/test-fixtures/plan-change/audit-reference-schema.sh
bash -n supabase/test-fixtures/plan-change/audit-test-target.sh
```

### `externalDependencies.auditStatus`

| Status | Meaning |
|--------|---------|
| `pending` | Snapshot validation **BLOCKED** (`extensions`/`functions`/`roles` = `null`) |
| `partial` | Catalogue inventory confirmed; full DDL not validated — **BLOCKED** |
| `complete` | Columns, constraints, indexes, policies, minimal functions validated — snapshot generation still requires explicit written GO |

Current manifest: **`complete`** (catalog evidence in `confirmedCatalogEvidence`).

### Audit SQL files and Supabase SQL Editor

| File | How to run |
|------|------------|
| `audit-minimal-baseline-contract.sql` | **psql only** (`\echo` incompatible with SQL Editor). Alternative: copy each `SELECT` block into SQL Editor one at a time. |
| `audit-minimal-trigger-functions.sql` | SQL Editor: run each section separately |
| `audit-minimal-extension-usage.sql` | SQL Editor: run each section separately |
| `audit-reference-schema.sh` / `audit-test-target.sh` | Terminal + psql only |

Snapshot generation and harness apply remain **BLOCKED without explicit written GO**, even when `auditStatus` is `complete`.

## Catalogue-only audits (manual — your terminal only)

```bash
export REFERENCE_SCHEMA_PROJECT_REF=zgafnshkjywfltxgbtzg
export REFERENCE_SCHEMA_DATABASE_URL=...   # local session only; never commit or log

bash supabase/test-fixtures/plan-change/audit-reference-schema.sh

export PLAN_CHANGE_TEST_SUPABASE_URL=https://nxntngkhkoynljcagmkq.supabase.co
export PLAN_CHANGE_TEST_DATABASE_URL=...   # local session only; never commit or log

bash supabase/test-fixtures/plan-change/audit-test-target.sh
```

Never use `.env.local`. URLs are never printed in logs.

See `docs/plan-change-test-harness.md` for the full procedure.
