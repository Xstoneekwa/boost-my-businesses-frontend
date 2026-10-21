# Real Auto Restart → V4 certification

These tests call the actual Backend `getAutoRestartData` and `runAutoRestartTick`,
the actual Admin `handleRequest`, and PostgREST 16.2 backed by PostgreSQL 17.10.
No eligibility override, mock RPC, local authorization state machine, device or
external network request is used. An HTTP adapter only maps `/rest/v1` and `/admin`
to the local servers. The fetch guard rejects every non-loopback destination.

## Setup requirements

- Dedicated PG17 cluster under `/private/tmp/auto-restart-v2-pg17.*`, port 55489,
  `listen_addresses=''`, private Unix socket; empty database `auto_restart_v2`
  (or `auto_restart_v2_replay`). Never point this harness at a shared database.
- Export `LOCAL_PG_SOCKET`, optionally `LOCAL_PG_DATABASE`, and
  `ADMIN_CONTRACT_ROOT` (read-only Worker repository containing the canonical
  Admin handler and the three migration dependencies listed in `replay.mjs`).
- Run `node tests/auto-restart-real-pg17-v2/replay.mjs` from this repository.
  It replays the local platform compatibility baseline, public baseline, Backend
  forward migrations and three Worker-owned dependencies in timestamp order.
  One amended historical migration already contains its subsequent correction;
  the replay asserts that exact postcondition instead of reapplying its invalid
  text-replacement precondition. No RPC is weakened or replaced by a stub.
- PostgREST must point at that database/socket, expose `public`, use `anon` as
  anonymous role, listen on 127.0.0.1:55490, and use the **synthetic test-only** JWT
  signing secret `local-only-auto-restart-v2-fixture-secret-00000000`.
- Run `node --import tsx tests/auto-restart-real-pg17-v2/tick.cjs`.
  The actual application runs on the second loopback adapter, port 55491.
- The seed currently uses the midnight–06:00 local PostgreSQL timezone window;
  run within that window. A closed window is a test setup failure, not grounds
  to bypass application admission.
- Stop only these task-owned PostgREST/PG17 processes after use.

## Proof boundaries

The seed creates a synthetic identity failure, then resolves it using real V3.
The initial resolution returned `next_tick_eligible=true` and created an armed
authorization. `reset.sql` restores this synthetic fixture between independent
scenarios; it is not used inside either concurrent tick. The consumed scenario
uses the actual previously consumed authorization. The concurrent scenario uses
two actual tick invocations and the real database deduplication lock.

Source and projection tuple is `(root, 1, 0)`. RPC and successor tuple is
`(same root, 2, 1)`. Equality is **per stage with the intended increment**, not
literal equality of source and successor attempt/retry numbers.

Wrong RPC root/attempt is rejected by unchanged V4. Persisted contradictory
metadata is rejected by the real tick's canonical-first resolver. Attempts to
mutate persisted canonical columns are rejected by the real immutability trigger.
V4 normalizes an incoming retry mismatch to `attempt - 1`; this is NOT a retry
rejection guarantee. Neither the implementation nor its strictness is changed.

Legacy fallback without usable canonical columns is not a full integration PASS:
the deployed schema has NOT NULL constraints plus an INSERT normalization guard.
Historical legacy resolver tests remain unit proofs, explicitly classified as
such. Do not remove constraints/triggers or stub a query to claim real legacy
integration. This unresolved requested proof keeps Approval 2 on HOLD.

The extended regression also has two unchanged historical source-assertion
failures referencing `validateActiveModePrerequisites` in settings. This task
does not modify those files or that route. Build/typecheck and scoped lint pass.
