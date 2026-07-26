# Canonical package runtime contract and test onboarding rollback

## Package settings source of truth

`commercial_packages` owns the business caps. The additive
`commercial_package_runtime_settings` matrix owns the remaining package
settings: target rotation, likes, DM session limits, runtime profile, schedule
shape and warmup profile. `reconcile_account_package_runtime_contract` writes
the complete account projection from those two package sources after an
assignment has selected an exact `phone_app_instances` row.

The required resolution order is:

1. persistent package/account value;
2. temporary warmup cap for the current active SAST day;
3. optional Worker operations hard cap;
4. the minimum of the applicable values is the effective runtime limit.

Warmup values never replace `max_actions_per_day`, `follow_limit` or
`max_follow_per_run`. Schema defaults such as historical `20` and `10` are not
accepted as provisioning sources. A missing or inconsistent critical value
returns `package_settings_incomplete` and blocks login readiness/enqueue.

## Assignment and login gate

The runtime contract checks the active entitlement and package, subscription
runtime type, assignment, device, exact app instance, Android package, clone
projection, full settings rows and schedule window. Stable block reasons are:

- `assignment_package_mismatch`
- `app_instance_package_mismatch`
- `clone_package_mismatch`
- `package_settings_incomplete`
- `runtime_profile_mismatch`

The client and admin onboarding paths reconcile after assignment. The
assignment trigger performs the same reconciliation in the assignment
transaction. Both readiness and enqueue read the contract, and the database
rejects invalid login request inserts as the final backend barrier.

## BotApp projection

BotApp must label persistent configured limits, warmup limits and effective
runtime limits separately. Legacy compatibility fields are read-only evidence;
they are never an active fallback. Missing contract data is displayed as
`Configuration incomplete`.

## Test onboarding rollback runbook

The existing smoke cleanup RPC is not a safe rollback for a normal onboarding
account: it is restricted to smoke usernames, does not restore the consumed
entitlement, and physical account deletion would cascade historical run/action
evidence. It must not be reused.

Before any test-account cleanup, produce an exact preview containing account,
tenant/client, entitlement, ownership, assignment, app instance occupation,
credential reference, onboarding session, targets/settings, requests, runs,
locks, incidents and audit counts. The execution contract must be a dedicated
service-role-only transaction with exact-ID and expected-username guards. It
must refuse when a request, run, lock or Auto Login is active; revoke credentials
through the canonical credential helper; release assignment/instance occupancy;
remove account-scoped live projections; return the entitlement to `reserved`
with null account/consumption timestamps; and preserve diagnostic history.

The canonical contract is now `rollback_test_instagram_onboarding_v1`, delivered
by migration `20260726030119_rollback_test_instagram_onboarding_v1.sql`. It is
`SECURITY DEFINER`, has a fixed `public, extensions` search path, and is
executable only by `service_role`. `anon` and `authenticated` have no execute
privilege; the append-only audit table has RLS and no browser policies.

The default mode is `p_dry_run = true`. A successful preview takes locks and
evaluates every guard but performs no write and creates no audit event. Real
execution uses the same input fingerprint and idempotency key. A replay returns
`already_rolled_back`; reusing the key with different inputs returns
`idempotency_fingerprint_mismatch`.

The logical tombstone keeps `ig_accounts` and all diagnostic history. It frees
the canonical username through a deterministic internal rename, sets
`status=rolled_back_test_onboarding`, cancels the admin lifecycle, and marks the
tenant ownership projection inactive. Active Client and BotApp projections
explicitly exclude this state. The next manual onboarding therefore creates a
new account UUID and cannot inherit settings, targets, protection entries,
credentials, assignment, or runtime state from the tombstone.

No onboarding, Auto Login, run, ADB command, or device action is triggered by
this RPC. See `docs/account-cleanup-runbook.md` for the exact guard, retention,
and down/compensation procedures.
