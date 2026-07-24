# Target Followers Resume V2 storage

Migration `20260724215200_target_followers_progressive_resume_v2.sql` is the
only V2 storage migration on the active Backend lineage. Historical migration
`20260722100000` was audited but is not applied from its old branch.

The migration creates no business row and performs no backfill. It defines one
checkpoint per account, target and `followers` surface plus append-only audit
events. Shadow and future enforce values are separate. Depth is `0..80`, anchor
arrays contain at most 12 hashed tokens, metadata is bounded, timestamps are
coherent and optimistic versions start at one.

All five RPCs use `SECURITY DEFINER` with an empty `search_path`. `PUBLIC`,
`anon` and `authenticated` have no table or function access. `service_role` can
read the two tables and execute the RPCs, but cannot directly insert/update a
checkpoint or mutate an event. RLS is enabled with no client policy.

`claim` verifies that the target belongs to the account, serializes the row,
checks optimistic version and acquires a 30–900 second run lease. `commit`
requires the same run, mode, live lease and exact version, and accepts at most
one proven depth increment. `invalidate` and `reset` are CAS operations. Every
successful mutation appends an event.

Rollback is runtime-first: disable Worker shadow and clear its allowlist. Do not
drop these tables or erase audit rows during an operational rollback. A schema
rollback, if ever separately authorized before real data exists, must revoke
the five RPCs before dropping events then checkpoints.
