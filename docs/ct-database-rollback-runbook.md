# CT database rollback runbook

Rollback is forward-only for an existing environment. Never delete migration-history rows and never run the bootstrap baseline as rollback.

## Before runtime activation

Keep all adapters unmounted and email contracts disabled. If a migration must be reversed, first stop the deployment. Prefer a reviewed compensating migration that revokes CT RPC execute, freezes access and restores the previous notification constraint only after proving no CT rows exist.

## After CT rows exist

Do not drop or physically delete business rows. Revoke entry-point execute, freeze batches, preserve append-only events, export schema/row counts, then write a compatible forward fix. New targets created through replacement-first must be reconciled explicitly; old targets were never auto-archived by V1.

## Local/CI

Dispose of the temporary database and rebuild from baseline. This is the only supported bootstrap rollback.

## Forbidden

Production reset, migration repair, history deletion, destructive backfill, implicit target archive, email/send-intent replay, or broad privilege restoration.
