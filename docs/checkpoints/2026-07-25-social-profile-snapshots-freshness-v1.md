# Social Profile Snapshots Freshness V1 — 2026-07-25

## Production lineage and scope

Parent Backend: `12a121d3d2e2594457af6411e87433f575fa6108`, the active
Incidents/T-10/Auto-Restart lineage. This checkpoint adds the existing
Social-Profile-Snapshots V1 service/guard contract, a real daily Vercel cron,
one canonical projection and explicit freshness. It changes no Stripe flow,
entitlement, onboarding, account, Worker policy, device or historical data.

## Release state and Golden addendum

The release hosting this document is the Backend code reference. Production
activation additionally requires the canonical Vercel deployment ID and
`SOCIAL_PROFILE_SNAPSHOTS_ENABLED=true`. The cron is backend-only and cannot
create a Worker request/run. Incidents, Scheduler, T-10 and Auto Restart routes
remain present in the combined build.

The Golden runtime addendum is data-only: public profile observations and
growth projections do not alter Golden Follow/Unfollow/DM navigation. The
first provider write is deliberately deferred to the natural scheduled cron;
delivery performs no phone action.

## Evidence

- Canonical table: `ig_account_social_profile_snapshots`.
- Legacy table: retained but not read by Profiles/Stats.
- Schedule: `15 2 * * *` UTC.
- Auth: exact `CRON_SECRET` Bearer gate before all work.
- Frequency-aligned thresholds: fresh <=36 h, aging <=72 h, stale >72 h.
- 72-hour baseline tolerance: +/-24 h with explicit coverage.
- Manual and scheduler-inactive accounts remain eligible when lifecycle-active.
- No migration: existing job tables, RPCs, indexes and grants are reused.
- Error responses are redacted; avatar URLs and provider credentials are not
  added to the Profiles projection.

Full architecture, rollback and operator handover:
[Social profile snapshot contract V1](../social-profile-snapshot-contract-v1.md).
