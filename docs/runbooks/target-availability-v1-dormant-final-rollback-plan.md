# Target Availability V1 — Final Dormant Rollback Plan

Status: **prepared only; execution requires a separate explicit GO**

## Containment

Keep kill switch ON; keep capture, writer, all shadows, enforcement, Lifecycle and replacement OFF; keep allowlist empty. Preserve the four Gate 4C observations and all audit evidence.

## Preferred strategy

After any producer or reader has existed, prefer a forward-fix. The documentary down migration is eligible only while the feature has remained fully dormant, after a fresh snapshot and a separate destructive-operation approval.

## Backend

If the candidate causes a serving/build regression, promote predecessor `d1de142892a13e4d24bb7fd1d7e2651f423a421b`, then verify SHA provenance, stable alias HTTP 200 and dormant controls. No Worker restart is required.

## Worker

The final dormant plan leaves active Worker `fecf91dfe8e60535810cd99ad9c10d370022ab16` unchanged, so there is no Worker rollback. Do not mutate the symlink or dispatcher.

## Database

The down artifact removes exactly the same 41 table/column pairs and four indexes derived from the forward SQL. It does not reference `ct_target_availability_observations` or legacy business tables. If separately authorized and still dormant:

1. verify checksum and preconditions;
2. apply `supabase/rollback/20260730123708_ct_target_availability_identity_assessment_current_v1.down.sql` once;
3. confirm the 41 additions and four indexes are absent;
4. confirm all five foundations, four observations, RLS/FORCE RLS and fail-closed grants remain intact;
5. retain migration/audit evidence and do not fake or rewrite production migration history.

## Exit criteria

Backend/DB are consistent, production controls remain fail closed, Worker provenance is unchanged, no Availability data was deleted, and Auto Restart, Unfollow V3, Follow 60s and Golden Flow remain healthy. `NEXT_STEP_AUTHORIZED=false`.
