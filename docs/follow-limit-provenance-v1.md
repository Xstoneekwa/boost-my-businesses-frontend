# Follow Limit Provenance V1 — intermediate backend checkpoint

Status: local candidate only. The migration is not applied, the server flag is
off by default, and neither Worker nor BotApp consumes this contract yet. This
is not the final Frontend/Stripe handover.

## Current problem

`account_package_summary.package_caps` is the commercial source of truth, but
the current preview also treats `ig_account_settings.max_actions_per_day` and
`follow_limit` as if they were intentional account overrides. Historical
provisioning seeded `120/20` (and `max_follow_per_run=10`), so those values have
no reliable provenance and must remain legacy read-only evidence.

## Candidate architecture

- `commercial_packages` / `account_package_summary.package_caps`: package
  Follow limits.
- `ig_account_follow_limit_overrides`: explicit, server-only account intent.
  Absence of a row means “use package defaults”. Package values and warmup
  values must never seed this table.
- `account_warmup_settings`: temporary ramp, independent from the override.
- `resolveAccountFollowBusinessPolicy`: unique business resolver. It applies
  `min(package, explicit override when present, active warmup)` independently
  to day and session.
- `buildAccountFollowLimitProjection`: canonical backend projection for the
  Admin Dashboard and a future BotApp integration. Legacy values are clearly
  marked `read_only: true` and are never labeled as an account override.

Hard Ops caps, daily counters, remaining-today, run/session quotas and Auto
Restart are intentionally outside this resolver.

## Migration candidate and access model

Candidate: `supabase/migrations/20260722012822_follow_limit_provenance_v1.sql`.

The table has a canonical account FK, positive nullable caps, at least one cap,
bounded provenance (`admin`, `support`, `migration_confirmed`), timestamps and
RLS. `PUBLIC`, `anon` and `authenticated` have no table or RPC privilege.
`service_role` receives table read and RPC execute only; direct table writes are
revoked so mutations must pass through the audited RPCs. Save/reset RPCs
serialize per account, are idempotent and record before/after evidence in the existing
`ig_action_logs` architecture. They do not update `ig_account_settings`,
`follow_enabled`, `dry_run_enabled` or `send_enabled`.

The future backend surface is
`/api/instagram-dashboard/settings/follow-limits`. It requires the existing
relay/admin authorization and `FOLLOW_LIMIT_OVERRIDE_V1_ENABLED=true`. The flag
defaults off and this checkpoint does not wire any client control to PATCH or
DELETE.

## Upgrade, downgrade and reset

Overrides are preserved across package changes and always bounded at read time.
An override above a downgraded package remains stored, is reported as
`override_above_package_bounded`, and may become applicable after a later
upgrade. Reset deletes the row; it never copies package caps into override or
legacy columns.

## Warmup

Day 1/2/3 are 10/20/40. Day 4+ dynamically uses the effective package cap when
the specific value is null. The same ramp bounds day and session independently,
so Day 4+ is Growth 80/80 and Pro/Premium 120/120 under the certified package
matrix. Warmup never creates or updates an override.

The current SQL projection computes `CURRENT_DATE - package_started_at::date +
1`. Hosted Supabase normally uses UTC, and the new TypeScript resolver makes UTC
explicit. Known gap: a future database timezone change could make the old view
and the new resolver disagree around midnight; this checkpoint does not alter
the production view or timezone.

## Provisioning and legacy compatibility

New-account provisioning continues to write the existing settings record for
runtime/schema compatibility but does not create an override. The new resolver
ignores `max_actions_per_day`, `follow_limit` and `max_follow_per_run` for
business policy. Those columns are not removed or repurposed because
`max_actions_per_day` may have broader legacy semantics.

During rollout, the old resolver remains available by leaving
`FOLLOW_LIMIT_OVERRIDE_V1_ENABLED` off. Once the candidate migration is applied
and classifications are approved, the flag can be enabled for server-side
projection/save traffic. No silent legacy-to-override fallback is allowed.

## Reconciliation and future backfill

`scripts/follow-limit-provenance-dry-run.mjs` classifies a read-only snapshot as
`already_consistent`, `explicit_override_confirmed`, `package_seeded_legacy`,
`legacy_test_value`, `override_above_package` or `ambiguous_manual_review`.
Only an exact concordant admin audit is eligible for a later controlled
backfill. Ambiguous rows are never backfilled automatically.

## Future Worker contract (not active)

The next checkpoint may provide the Worker with package caps, explicit
overrides, warmup caps, business effective caps and their source/reason. The
Worker must then apply Ops hard caps, remaining-today and current run/session
quotas to produce runtime effective limits. This repository does not claim the
Worker uses the V1 contract.

Worker environment audit (read-only): the canonical source inspected was
`/Users/admin/Projects/instagram-worker-python-clean`; `requirements.txt` pins
`uiautomator2>=3.0.0,<4.0.0` and `Pillow>=10.0.0`. No canonical `.venv`/`venv`
was found in that repo or the inspected release tree. Documented tests use
`python3 -m unittest ...`; the next checkpoint must first identify or create an
approved isolated venv and install from that requirements file. Do not install
globally and do not run device initialization merely to execute unit tests.

## Future BotApp contract (not active)

BotApp must consume the canonical backend projection and display package,
override, warmup, business effective, future runtime effective, and legacy
read-only sections separately. It must not infer overrides from any of the
three legacy fields.

## Rollback and known gaps

Rollback before any backfill is to leave the feature flag off and continue the
existing resolver. The candidate migration is additive; dropping its RPCs and
table is mechanically possible only while no authoritative override rows have
been created. After backfill, rollback requires preserving/exporting those rows
first.

Known gaps: migration not applied; no authoritative override backfill; existing
`account_package_summary.effective_caps_preview` still mixes legacy limits;
Admin UI not rewired; Worker/BotApp not integrated; runtime cap enforcement not
tested; ambiguous production accounts require operator review.
