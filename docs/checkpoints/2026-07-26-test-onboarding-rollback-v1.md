# Release checkpoint — Test onboarding rollback v1

Status: migration applied; execution evidence must be appended after the single
approved Rex transaction.

## Release registry

- Parent frontend/backend baseline: `13e0e6cd22248751efebcdef18f19ec2c9ab916e`
- Worker unchanged: `8eec60f8301aec32597a393659357da18d38ba36`
- BotApp unchanged: `f90df0dc4e7d90ddd67898c8f7b6bfb093fdf481`
- Migration: `20260726030119_rollback_test_instagram_onboarding_v1.sql`
- RPC: `rollback_test_instagram_onboarding_v1`
- Supabase project: `zgafnshkjywfltxgbtzg`

## Current production state and handover

The RPC and audit ACL are production-applied. The preview must show all guards
passing and zero mutation before the real call. Active Client/BotApp projections
must be deployed before execution. Worker, BotApp binaries, phones, ADB, runs,
and onboarding remain out of scope.

After the transaction, record the audit ID, changed-row counts, Client/BotApp
smokes, deployment ID, release commit, and `READY_TO_RESTART_ONBOARDING`. The
operator retains the only authority to start the next onboarding manually.
