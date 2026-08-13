# Post-onboarding CT readiness contract

## Canonical thresholds

- `15` eligible CT is the initial onboarding gate. It is evaluated only while
  `client_instagram_accounts.onboarding_status` is not `ready`.
- `5` eligible CT is the post-onboarding low-stock threshold. It creates the
  existing need-target signal/email workflow and does not revoke growth
  readiness.

## Runtime invariants

- A completed, connected, identity-verified account does not become unready
  merely because target lifecycle events reduce its eligible CT inventory.
- Target depletion never bypasses package, credentials, assignment, incident,
  restriction, identity, or active-runtime guards.
- Initial onboarding with 14 eligible CT remains blocked; initial onboarding
  with 15 eligible CT can pass.
- After onboarding, 14, 10, 5, or fewer eligible CT preserve readiness. At 5 or
  fewer, the independent low-stock workflow remains authoritative.

## Canonical owners

- Initial onboarding threshold: `client-account-onboarding-policy.ts`.
- Admin/BotApp readiness projection: `readiness-projection.ts`.
- Client readiness execution: `readiness-now.ts`.
- Post-login/post-session repair: `reconcile_connected_instagram_growth_readiness_v1`.
- Low-stock signal and email threshold: `needs-more-target-accounts.ts` and the
  existing client account notification pipeline.

Do not reuse the onboarding minimum as a permanent campaign-readiness check.
