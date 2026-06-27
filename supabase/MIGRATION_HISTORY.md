# Supabase migration history — reconciliation notes

This document records how the repository migration filenames align with the **main production database** migration history (`zgafnshkjywfltxgbtzg`).

It does **not** replace the full remote history. The repo still contains only a subset of migrations used by this frontend project; older production migrations may exist only on the remote database.

## Canonical versions (TASK 3 / 4 / 5A — already applied on production)

These three migrations were applied on the main production database during controlled activation (June 2026). The **remote version IDs** are the source of truth.

| Canonical remote version | Canonical filename | Role |
|--------------------------|-------------------|------|
| `20260626142303` | `20260626142303_target_periodic_revalidation_schedule.sql` | Periodic CT revalidation schedule columns on `ig_targets` |
| `20260626142312` | `20260626142312_client_account_notifications.sql` | Persistent client dashboard notifications |
| `20260626142335` | `20260626142335_client_email_foundation.sql` | Transactional email templates, send intents, delivery events |

**Status on main production:** already applied. Do **not** re-apply on production.

## Superseded local filenames (do not reintroduce)

During development, equivalent SQL was authored under different local timestamps. Those files were **never** recorded in the remote migration history under these names.

| Retired local filename | Replaced by canonical version |
|------------------------|------------------------------|
| `20260625180000_target_periodic_revalidation_schedule.sql` | `20260626142303` |
| `20260626120000_client_account_notifications.sql` | `20260626142312` |
| `20260627120000_client_email_foundation.sql` | `20260626142335` |

**Rule:** never recreate the retired filenames. They would appear as new migrations to Supabase CLI and risk double-apply attempts.

## Why filenames were replaced (TASK 5C)

1. SQL was applied to production through controlled activation using MCP `apply_migration`, which registers **new** remote version IDs at apply time.
2. The semantic SQL matched the local drafts, but local filenames used different version prefixes.
3. Reconciling repo filenames to remote versions makes `supabase migration list` comparisons accurate and lets fresh environments replay the same schema without duplicate migrations.

## Fresh environment procedure

1. Use migrations under `supabase/migrations/` with the **canonical** version prefixes above.
2. Apply the full migration chain appropriate to that environment (never on main production for these three — already applied).
3. After apply, verify structures (read-only):

```sql
-- ig_targets periodic revalidation columns
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'ig_targets'
  and column_name like 'periodic_revalidation%'
order by 1;

-- notifications + email foundation tables
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'client_account_notifications',
    'client_email_templates',
    'client_email_send_intents',
    'client_email_delivery_events'
  )
order by 1;
```

4. Confirm RLS is enabled on the four client notification/email tables (no policies required for current server-side access model).

## Pending local migration (TASK 6C)

| Local version | Filename | Role |
|---------------|----------|------|
| `20260628120000` | `20260628120000_client_email_test_intents.sql` | Test-only send intents: `intent_kind`, nullable client/account refs for test rows, `manual_test` trigger, provider message id on intent |

**Status on main production:** applied as remote version `20260627000908` / `client_email_test_intents`.

## Pending local migration (TASK 7A)

| Local version | Filename | Role |
|---------------|----------|------|
| `20260629120000` | `20260629120000_client_email_needs_more_targets_sequences.sql` | Lifecycle sequence episodes for `needs_more_target_accounts`, intent triggers `automatic_initial` / `automatic_reminder`, optional `sequence_id` on intents |

**Status on main production:** applied as remote version `20260627005729` / `client_email_needs_more_targets_sequences`.

## Pending local migration (TASK 8A — not applied)

| Local version | Filename | Role |
|---------------|----------|------|
| `20260630120000` | `20260630120000_client_email_lifecycle_episodes.sql` | Generic lifecycle email episodes for `account_paused`, `account_canceled`, `needs_assistance` |

**Status on main production:** not applied. Do **not** apply without explicit GO.

## Before any future migration

1. Compare local `supabase/migrations/` with remote history (`supabase migration list` on the intended project, or read-only remote list).
2. Never apply a migration whose version already exists remotely.
3. Never add a repair/no-op duplicate for an already-applied change.
4. Do **not** use the isolated plan-change test project (`nxntngkhkoynljcagmkq`) when validating main-production migration parity.

## Isolated test database

The plan-change test project (`nxntngkhkoynljcagmkq`) is **out of scope** for this reconciliation. Do not apply these reconciled files there unless a dedicated harness explicitly requires it.

## Parity audit summary (TASK 5C)

Structures verified on main production before filename reconciliation:

- `ig_targets.periodic_revalidation_last_terminal_at`, `periodic_revalidation_next_due_at`, `periodic_revalidation_window_key`
- Index `ig_targets_periodic_revalidation_due_idx`
- Table `client_account_notifications` with category/status checks and three partial indexes
- Tables `client_email_templates`, `client_email_send_intents`, `client_email_delivery_events` with constraints, foreign keys, and indexes as defined in the canonical SQL files
- RLS enabled on notification/email tables; no RLS policies (service-role server access only today)
