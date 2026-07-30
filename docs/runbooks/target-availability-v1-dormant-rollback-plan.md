# Target Availability V1 — Dormant Rollback Plan

Status: **prepared only — execution is not authorized**

## Immediate containment

1. Keep or restore the Target Availability kill switch ON.
2. Keep capture, writer, Shadow, Policy Shadow, enforce, Lifecycle and replacement OFF; clear any allowlist.
3. Do not delete the four valid Gate 4C observation rows.
4. Stop further rollout steps and capture the exact failing layer, SHA, migration version and timestamps.

## Preferred rollback strategy

Because the database change is additive and dormant, prefer a forward-fix over destructive schema rollback once any producer
has existed. The documentary down migration is safe only before producers/readers are enabled and only after a fresh snapshot.

## Layer-specific actions

### Backend

- Promote the previous production Backend SHA `d1de142892a13e4d24bb7fd1d7e2651f423a421b` if the dormant code introduces a build or serving regression.
- No Worker restart is required for a Backend-only rollback.
- Recheck the stable alias, HTTP status, SHA provenance and dormant controls.

### Worker

- Preferred deployment leaves the active Worker release unchanged at the baseline selected in the checkpoint, so no Worker rollback exists.
- If a test-only candidate was nevertheless activated, restore the recorded previous immutable release and symlink.
- Perform at most one separately authorized canonical restart after a zero gate; verify one wrapper/consumer and exact release root.

### Database

- Do not automatically run the down migration.
- If no producer/read path was ever enabled and rollback is explicitly approved, apply
  `supabase/rollback/20260730123708_ct_target_availability_identity_assessment_current_v1.down.sql`.
- The down migration removes only the 41 V3 columns and four V3 indexes. It does not touch
  `ct_target_availability_observations`, legacy CT tables, targets, accounts or business data.
- After a DB rollback, verify all five foundation tables still exist, the four Gate observations remain, RLS/FORCE RLS remain,
  and grants remain fail closed.

## Order by failure location

- Backend failure before migration: stop; nothing to roll back.
- Migration verification failure: keep Backend undeployed; prefer forward-fix, or execute the separately approved DB rollback.
- Backend failure after a successful migration: roll back Backend first; leave additive dormant DB columns in place unless separately approved.
- Optional Worker activation failure: restore Worker release/symlink and restart once if authorized; Backend/DB can remain dormant.

## Data preservation

Preserve migration history, the five foundation tables, all Gate 4B/4C evidence, the four observation rows, audit logs and
pre/post snapshots. Never delete CTs, targets, account ownership, incident records or legacy interacted-user history as part of this rollback.

## Exit criteria

The prior Backend/Worker provenance is restored where applicable, controls are OFF/empty with kill switch ON, the database
is structurally consistent, no new Availability writes occur, and Auto Restart/Unfollow/Follow 60s/Golden Flow remain unchanged.
