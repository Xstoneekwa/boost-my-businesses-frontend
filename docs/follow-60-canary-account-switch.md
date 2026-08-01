# FOLLOW60_CANARY_ACCOUNT_SWITCH_V1

## Source of truth

The only account selector is one canonical row in
`public.follow_60s_canary_controls`. The Worker code and SQL binder contain no
account UUID, username or compile-time allowlist. The global environment flag is
only a kill switch; it never selects an account.

The canonical V2 row must carry, in `metadata_safe`, at least:

- `control_id`, `expected_worker_sha`, `baseline_release_sha`;
- `baseline_account_id`, `baseline_captured_at`, `baseline_timezone`;
- `baseline_package`, `baseline_warmup_ready`;
- `expected_package`, `expected_run_type`;
- `binding_version=FOLLOW_60S_CANARY_BINDING_V2`;
- `idempotency_key`, `created_by`, `source`;
- `armed_at`, `expires_at`, `max_new_cycles`, `current_new_cycle_count`;
- optional secondary `expected_username`;
- empty `revoked_at` and `completed_at` while armed.

The runtime binder independently re-reads and locks that row. It verifies the
control, account, active Worker SHA, account-scoped baseline SHA, request, run,
attempt and business session before consuming the binding once.

## Canonical switch

### 1. Audit the new account

Record the exact account ID, package, warmup state/day, remaining Follow quota,
available CT count, schedule window, device/clone, active incidents,
challenge/restriction state, and scheduler eligibility. Prove active requests,
runs, device locks, tick locks, lifecycle leases and critical outbox state.

### 2. Retire the old account

Archive or disable its control without deleting its baseline or results. Clear
no historical counters. The old account immediately follows the normal Golden
path and no run is created.

### 3. Capture the new baseline

Capture atomically and account-scoped: account ID, Worker SHA, canonical Follow
count, verified Post-Follow stage counts, package, warmup, timezone, timestamp
and a unique idempotency key. Never copy a baseline from another account.

### 4. Arm one control

Create/update exactly one row with `status=armed`, the exact account and Worker
SHA, baseline release SHA, cycle limit and expiry. `run_id`, `request_id`,
`attempt_id`, `business_session_id` and `runtime_binding_consumed` must be empty
before the future natural run. Arming creates neither request nor run.

### 5. Gate zero

Before any runtime switch, certify:

- active requests = 0;
- pending/running runs = 0;
- valid device locks = 0;
- started tick locks = 0;
- active lifecycle leases = 0;
- active critical outbox = 0;
- wrapper unique, consumer unique, `runtimeRootOk=true`;
- immutable target release and rollback release both verified.

### 6. Operator handoff

Codex stops at `READY_FOR_LIAM_<ACCOUNT>_SCHEDULE_SWITCH=YES`. Liam alone changes
the account from manual to scheduled. Codex must not perform that state change.

### 7. Natural execution

The next request and run must be created only by the natural scheduler tick. No
manual run, manual tick, ADB action or phone gesture is permitted.

## Fail-closed outcomes

The generic binder returns no binding and the Worker remains Golden on:

- `control_not_found`, `control_not_armed`, `control_expired`,
  `control_revoked`, `active_control_collision`;
- `account_mismatch`, `worker_sha_mismatch`,
  `baseline_release_mismatch`, `binding_version_mismatch`;
- `request_mismatch`, `run_mismatch`, `attempt_mismatch`,
  `business_session_mismatch`;
- `binding_already_consumed`, `max_cycles_reached`;
- `control_incomplete`, `binding_version_mismatch`, `package_mismatch`,
  `warmup_mismatch`.

Every rejection is raised before the single control-row update, so it cannot
leave a partial runtime binding.

## Rollback

Database rollback is
`supabase/rollback/20260801123500_follow_60s_canary_runtime_generic_v2.down.sql`.
It removes only the generic overload and restores the exact predecessor. A
production rollback still requires a separate explicit GO, a zero gate and a
verified Worker/RPC compatibility plan. Never roll back during an active run.

## Required report

Report the old/new account IDs, control ID/status, baseline and Worker SHA,
expiry, active-control count, gate counts, runtime root, wrapper/consumer PIDs,
request/run provenance, binder verdict/reason, rollback target and confirmation
that Liam alone controls manual-to-scheduled.

## Forbidden actions during source certification

No production migration, control mutation, arm/disarm, schedule change, Worker
switch, restart, request, run, tick, ADB action, device gesture or global
activation.
