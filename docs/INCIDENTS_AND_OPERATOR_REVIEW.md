# Incidents and Operator Review

> Canonical operational snapshot verified read-only on **2026-07-14 at
> 12:55:56Z**. Incident history is retained; acknowledgement, review and
> resolution are distinct states.

## Current production snapshot

| Class | State | Evidence | Interpretation |
|---|---|---|---|
| Real | `c0096…`, open/error | `followers_surface_lost`, created `2026-07-14T11:10:58Z` | Current worker incident; no physical closure proof |
| Real | `4c548…`, open/critical | `recovered_snapshot_rejected`, `operator_review_required`, created `2026-07-14T10:46:28Z` | One linked blocking Operator Review action remains pending verification |
| Historical real | `734928…`, acknowledged/critical | Welcome retry unverified / surface lost | Preserved for audit; acknowledgement is not physical validation |
| Historical real | `f849…`, acknowledged/critical | scheduled early failure retrying | Linked Operator Review action is resolved |
| Real, older | 3 open incidents | `actual_logged_in_username_not_detected`, 2026-07-07 | Still open; current physical truth is **UNKNOWN** |
| Test | 1 open incident | `system_test_incident` | Test evidence, not a production failure |
| Test | 5 ignored incidents | `orf4b` / `orf4c` smoke tests | Closed test evidence, retained |

Source: Supabase production read-only queries and Codex observation, 2026-07-14.
Short UUIDs above are display-only; use the database relationship, never a
prefix, for an operator mutation.

BotApp displayed the two current incident rows. The deployed backend and
installed BotApp contain the incident-to-action projection and `Mark reviewed`
control, but the drawer could not be opened during the last visual check.
Therefore the end-to-end interaction is **NOT PHYSICALLY VALIDATED**.

## Operator Review actions

| Action | Incident | State | Blocking | Evidence |
|---|---|---|---|---|
| `062be2d8-767d-4187-a0e2-b93e04a45b32` | `4c548…` | `pending_verification` | `true` | live DB, 2026-07-14 |
| `a5a54c06-…` | `f849…` | `resolved` | `false` | live DB, 2026-07-14 |

The canonical transition is the service-only
`review_operator_dashboard_action` RPC. Its live migration entry is
`20260713231003_operator_review_canonical_transition`; its controlled Git
source is
`supabase/migrations/20260714003000_operator_review_canonical_transition.sql`.
The backend must target
the action linked to the selected incident; it must not select an unrelated
action by account alone.

## State rules

- `open` means unresolved, not necessarily scheduler-blocking.
- `acknowledged` means an operator saw the incident; it does not prove recovery.
- `ignored` is appropriate for identified test/smoke evidence, with audit kept.
- `resolved` requires the relevant recovery or review criterion to be met.
- `Mark reviewed` resolves the linked Operator Review action and clears its
  blocking flag through the canonical RPC. It does not delete the incident.
- A real incident is closed only after the runtime condition is no longer
  present and the expected flow is verified. Build/deploy/UI presence alone is
  insufficient.
- No cap, schedule, CT, package, Welcome DM, `dry_run` or `send_enabled` change
  may be used as a closure shortcut.

## Closure criteria for current items

### `followers_surface_lost`

1. Run uses the intended worker release and expected Instagram version.
2. Followers surface and Suggestions boundary are observed on the physical
   device without an invented timeout/recovery.
3. Expected run outcome and artifacts are recorded.
4. Only then may the incident be acknowledged/resolved under operator policy.

Current status: **NOT PHYSICALLY VALIDATED**.

### `recovered_snapshot_rejected`

1. Operator opens the linked incident drawer and verifies the exact action.
2. `Mark reviewed` is exercised only with explicit authorization.
3. The linked action becomes terminal and non-blocking; unrelated actions stay
   unchanged.
4. The recovered snapshot/follower flow is physically revalidated before the
   incident itself is resolved.

Current status: UI deployed/installed; action still pending;
**NOT PHYSICALLY VALIDATED**.

### Older identity incidents

Recheck expected package and actual logged-in username on the relevant device.
Do not infer recovery from age or fresh device heartbeat. Current status:
**UNKNOWN**.

## Sources and related documents

- Migration: `supabase/migrations/20260714003000_operator_review_canonical_transition.sql`
- Incident projection API: `app/api/instagram-dashboard/incidents/[incidentId]/route.ts`
- Review transition API: `app/api/instagram-dashboard/dashboard-actions/review/route.ts`
- Correlation helper: `lib/instagram-dashboard/incident-operator-review.ts`
- Scheduler contract: [botapp-scheduler-runtime-contract.md](botapp-scheduler-runtime-contract.md)
- Worker snapshot: repository-relative logical path
  `docs/CURRENT_PRODUCTION_STATE.md` in `instagram-worker-python`
