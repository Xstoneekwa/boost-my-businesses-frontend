# Incidents overview and retention V1

Status: scoped production checkpoint, 24 July 2026. This document is an
Incidents addendum only. It does not move or replace the Phone Farm Golden tag.

## Architecture and source of truth

BotApp calls `incidents.list` through preload IPC. Electron sends an
authenticated `GET /api/instagram-dashboard/incidents`. The backend requires a
valid relay credential or an authenticated admin, calls
`get_account_incidents_overview_v1`, attaches delivery rows, redacts metadata,
and returns `incidents_overview_v2`.

The source of truth is `account_incidents`. Human work is stored in
`account_dashboard_actions`; Slack/Discord delivery evidence is stored in
`account_incident_notifications`. The string `incidents_overview` is the
BotApp endpoint identifier, not the name of the production RPC.

## Read contract

- default page size: 50; server maximum: 100;
- stable ordering: `last_seen_at desc, id desc`;
- opaque cursor derived from the same tuple;
- filters: Open, Action required, Resolved, All;
- search: account username, incident type, reason, failure reason;
- operational counters are global and independent of the loaded page;
- test incidents never inflate operational counters;
- resolved/ignored incidents cannot be Open or Action required;
- archived incidents are omitted from the operational view.

An empty result is HTTP 200 and renders `No open incidents`. Authentication
failures, backend availability failures, and invalid contracts have distinct
client-safe states. BotApp must not show `Open: 0` while a load error is active.

## Lifecycle and blockers

`upsert_account_incident` deduplicates active incidents by the partial unique
dedupe key and increments `occurrence_count`. Operator review is a separate
action. `blocking_campaign` belongs to that action, not to the incident row.
Only active action statuses (`pending`, `acknowledged`,
`pending_verification`, `code_submitted`) can be projected as Action required.
Resolved, dismissed, or ignored actions cannot block Profiles.

Resolving an incident does not infer a later success. The canonical transition
must be explicit and audited. `sync_account_incident_dashboard_action` closes a
supported linked action when the incident is resolved/ignored. Historical
open incidents whose action is already resolved are visible under All, but are
not blockers; they require object-by-object evidence before incident closure.

Notification delivery keys are unique. A sent key is not sent twice. A failed
key can be attempted again when the delivery function is explicitly invoked;
there is no independent automatic retry queue in this checkpoint.

## Retention policy

Server configuration lives in `incident_retention_policies` and defaults to:

| Class | Logical archive after resolution |
| --- | ---: |
| normal | 180 days |
| critical | 365 days |
| technical nonblocking | 90 days |
| legal/audit hold | logical archive only, configurable |
| Slack/Discord delivery logs | 90 days after a terminal incident |

Open/acknowledged incidents and `pending_verification` actions are never
automatically deleted. The trigger stamps the policy version and `purge_after`
on terminal incidents. The daily cleanup first archives eligible incidents.
Physical deletion is delayed by 30 more days and is allowed only when the
incident has no run, source event, request reference, legal hold, or dashboard
action. This deliberately preserves run/request history.

`run_incident_retention_cleanup_v1` uses a transaction-scoped advisory lock,
`FOR UPDATE SKIP LOCKED`, and batches of 250 by default (server maximum 1000).
Every invocation writes `incident_cleanup_runs` with start/completion,
examined/archived/deleted counts, delivery deletion count, errors, dry-run
state, and policy version. `pg_cron` invokes it daily at 03:17 UTC.

## Runbook: incidents overview unavailable

1. Confirm relay health independently; a green relay does not prove that the
   Incidents route exists.
2. Call the route with relay/admin auth and record HTTP status and safe code.
3. `404`: verify the deployed backend contains the route.
4. `401/403`: verify relay credential alignment and effective function grants.
5. `503` with `INCIDENTS_RPC_MISSING`: apply the scoped migration.
6. `502` with `INCIDENTS_PAYLOAD_INVALID`: compare route/RPC contract versions.
7. HTTP 200 with `incidents: []`: this is a normal empty state, not an outage.
8. Confirm `anon` and `authenticated` cannot execute either incident RPC.

## Obsolete blocker procedure

Never close incidents in bulk. For each candidate, record incident/action IDs,
account, original reason, run/request, subsequent successful evidence, current
account state, and the exact resolution reason. Resolve only the proven object
and its linked action. Re-check Profiles to confirm no resolved blocker remains.

## Golden addendum

This checkpoint changes Backend/Supabase/BotApp incident observability only.
Worker source, Worker release, active symlink, dispatcher, heartbeat, scheduler,
run control, Follow, Welcome DM, Unfollow, assignments, phones and Android are
outside scope and unchanged. The existing Golden checkpoint remains where it
was; this addendum is evidence, not a new Golden baseline.
