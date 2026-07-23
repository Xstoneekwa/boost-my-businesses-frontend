# Follow Warmup — Active SAST Days V1

Status at documentation checkpoint: code pushed; migration and production
deployment pending controlled rollout. This is a scoped backend checkpoint,
not the final Frontend/Stripe handover.

## Schema contract

`commercial_packages` provides four independent values:

- `default_follow_day_cap`;
- `default_follow_session_cap`;
- `max_follow_day_cap`;
- `max_follow_session_cap`.

Defaults initialize new account settings. Maxima bound server writes and Worker
execution. The additive migration backfills missing maxima from existing
defaults, adds positive/default-not-above-max constraints and preserves existing
configured account caps.

`account_package_summary` remains a `security_invoker` view. It exposes
`package_defaults`, `package_caps` and an effective preview without exposing
credentials or privileged configuration.

## Active-day derivation

Warmup counts prior distinct `Africa/Johannesburg` dates with a successful
`ig_interaction_events` row where:

- `interaction_type = 'follow'`;
- `interaction_status = 'success'`;
- `event_type = 'follow_verified'`;
- `run_id is not null`.

The next effective day is 1, 2, 3 or 4+. Package start timestamps are metadata
only. Several runs on one date count once; no verified Follow means no progress.

## API write boundary

`/api/instagram-dashboard/settings` resolves the active package server-side,
requires positive integers and rejects configured values above package maxima.
Warmup fields are not writable through the Follow settings payload. Tenant,
ownership and package association checks remain authoritative.

## Verification and rollout

- Code: `9a472903d4d6d3202e1489347a42b06df425f244`.
- Migration: `20260723110000_follow_warmup_active_sast_days_v1.sql`.
- Tests: 14 warmup contract tests and 19 package/write-policy tests.
- Targeted ESLint and Next production build with TypeScript: pass.
- `profiles_live`, Auto Login, Auto Restart and Devices routes remain present.
- No account-specific policy or secret-shaped addition.

After migration, verify local/remote history, constraints, columns, effective
grants, `security_invoker`, package rows and read-only projection values before
deploying the backend. Rollback of application code uses the previous Vercel
deployment. The additive database change is retained unless a separately
reviewed forward migration is approved.
