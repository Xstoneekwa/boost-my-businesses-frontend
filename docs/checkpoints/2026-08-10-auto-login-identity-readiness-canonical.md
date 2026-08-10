# Auto Login / Identity / Readiness — canonical checkpoint

Date: 2026-08-10 23:43 SAST

Scope: documentation and handover only; no production mutation.

## Production baseline recorded

| Surface | Canonical production evidence |
|---|---|
| Backend code | `63b3d8f8c02a7ecbdb88f0251331fcbb6efc9b39` |
| Backend deployment | `dpl_GZiN2LppvsosCoyNfmFH5J22ZUQ9`, READY, alias `www.boostmybusinesses.com` |
| BotApp | `327bce37a6826c7cd8d826423cbac9f5fb9af682` |
| Worker | `e88767d9f035af8cb93fdf176b6167d45fa46228` |
| Worker release | `/Users/admin/phonefarm-worker-releases/e88767d-unfollow-s1-terminal-search-v1` |

The documentation branch is based on Backend source
`b61ce44f4673b47aabaa1cc9dacec5ec3825535d`, a descendant of the production
Backend SHA that contains the production-versioned historical reconciliation
migration. This checkpoint does not claim that `b61ce44` was deployed as web
code.

## Relevant production migrations

- `20260810111919_login_identity_readiness_gate_v1`
- `20260810153716_login_state_monotonic_v1`
- `20260810153733_operator_confirmed_login_readiness_v1`
- `20260810210246_login_preproof_transition_reconciliation_v1`
- `20260809181525_incident_resolution_config_independence_v3`

The `20260810210246` migration is a bounded compatibility reconciliation, not a
general bypass. It only accepts successful pre-gate login-provisioning lineage
with no later invalidation and records `historical_model_missing`, never a
fabricated `verified` proof.

## Validated contracts

- Auto Login revalidates assignment/device/app instance and reads credentials
  through the canonical Vault reference.
- `connected != ready`; readiness is recomputed server-side from every
  canonical gate.
- Exact identity proof sources are `worker` and authenticated `operator` only.
- Login state is monotonic; only a newer explicit canonical invalidation can
  downgrade a proven connected state.
- **Confirm login & refresh readiness** revalidates all gates, writes an audited
  operator proof, resolves a linked incident/action when applicable, reconciles
  Resume Authorization and starts no run/tick.
- BotApp exposes that confirming action through its authenticated relay. The
  current Admin **Run readiness now** button is deliberately documented as
  check-only because it does not send `operator_confirmation=true`; an Admin
  caller only confirms when it uses the protected endpoint with that explicit
  flag.
- Human Assistance is fail-closed, redacted, deduplicated and uses the canonical
  incident notification control plane.
- Email, SMS, WhatsApp and Authenticator App use the same
  `verification_code_required + verification_channel` provisioning lineage.
- Client, Admin and BotApp consume the Backend readiness projection. BotApp
  renders `growth ready` from canonical readiness, not legacy `can_start`.
- Production visual certification after the BotApp hotfix observed all six
  accounts as `connected · growth ready`, including `growth_with_bmb`.
- Incident resolution authorizes normal reevaluation at the next natural tick;
  account Auto Restart settings, windows, quotas and blockers remain intact.

## Unfollow reference and pending terrain certification

The runtime contract is maintained in
[`unfollow-one-healthy-session-contract.md`](https://github.com/Xstoneekwa/instagram-worker-python/blob/e88767d9f035af8cb93fdf176b6167d45fa46228/docs/unfollow-one-healthy-session-contract.md).
It covers the recently delivered Unfollow chain end to end:

- Follow → Unfollow handoff without premature terminalization;
- immutable `UNFOLLOW_DAILY_PLAN_V1`, with the same `plan_id` and remainder on
  a real recovery;
- modern exact Search processing inside the first healthy session;
- terminal deletion/exclusion of a proven nonexistent username;
- removal of the old fixed Search limit (`10/15`) as a normal session boundary;
- one-tap private-account confirmation and the full-width `Following` CTA;
- candidate-local recovery separated from the session safety circuit;
- Auto Restart reserved for abnormal interruption or an extreme residual, not
  used as normal pagination for a healthy S1.

Terrain certification of a new natural Unfollow phase after `e88767d` remains
under read-only observation. No qualifying terminal sample existed at the last
check. This pending performance/terrain evidence does **not** block creation of
the next Tenant 3 account because the Auto Login/Identity/Readiness gates are
independent and already certified.

## Future CT documentation handoff

The final CT documentation must retain the explicit handoff recorded in
[`ct-system-canonical-architecture.md`](../ct-system-canonical-architecture.md):
credentials/login/identity/readiness, gate 15, assignment, scheduler,
incident/Human Assistance, CT Resume, Unfollow Daily Plan and account-scoped
isolation.

## Mutation counters for this checkpoint

| Operation | Count |
|---|---:|
| Production DB writes | 0 |
| Deployments | 0 |
| Worker switches/restarts | 0 |
| Runs created | 0 |
| Manual ticks | 0 |
| ADB/device actions | 0 |

`READY_FOR_TENANT3_NEXT_ACCOUNT=YES`
