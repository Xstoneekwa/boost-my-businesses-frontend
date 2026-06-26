# Supabase (boost-ai-frontend)

This directory holds SQL migrations and test fixtures for the Instagram dashboard frontend.

## Migration history

Read **`MIGRATION_HISTORY.md`** before adding or renaming migrations. It documents:

- canonical remote version IDs for TASK 3 / 4 / 5A migrations already applied on main production;
- retired local filenames that must not be reintroduced;
- verification steps before future migrations.

## Test fixtures

Plan-change and initial-checkout harnesses live under `test-fixtures/`. They target the **isolated** test project only and are never picked up by routine `supabase db push` from `migrations/`.

## Safety rules

- Never apply migrations to main production without explicit GO and remote history comparison.
- Never use the plan-change test database when reconciling main-production migration filenames.
- Do not commit `.temp/`, credentials, or environment files from this directory.
