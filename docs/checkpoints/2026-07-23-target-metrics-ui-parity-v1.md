# Checkpoint — Targets metrics UI parity V1

Date: 2026-07-23

Status: code pushed on the canonical Warmup lineage; deployment pending
consolidated rollout.

## Lineage

- Backend Warmup base: `c8383001362a3b5400a4d6c41d0047e140b4f350`.
- Targets code commit: `108f7defc17c2bce328801f4c272f82fb1f62706`
  (`fix(backend): preserve target metric null semantics`).
- Branch: `feature/targets-ui-parity-v1-20260723`.

## Delivered contract

- Profile Details exposes `created_at` and `added_at`, both sourced only from
  `ig_targets.created_at`.
- Client Sent preserves `null`/missing as `—` and real zero as `0`.
- Client Perf distinguishes pending, insufficient, not applicable, low,
  average and good in French and English.
- Existing FBR reliability and performance thresholds remain unchanged.
- The obsolete test coupled to local variable name `metrics.fbrPercent` was
  replaced by result-oriented coverage.

## Verification

- 27 targeted Backend/Client projection, FBR, scoping and display tests pass.
- Targeted ESLint: zero errors; one pre-existing Hooks warning in the drawer.
- Scoped TypeScript for every changed TS/TSX source: pass.
- Next Webpack production compilation: pass; the repository-wide type phase is
  still blocked by pre-existing invalid extra route exports outside this patch.
- `git diff --check` and no-leak/account-specific scans: pass.
- BotApp has its own matching checkpoint in the BotApp repository.

## Explicitly unchanged

No Worker file, migration, Supabase data, target row, device command, ADB
command or Instagram run was created or modified.
