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
`account_dashboard_actions` and the append-only
`account_incident_review_events`; Slack/Discord delivery evidence is stored in
`account_incident_notifications`. The string `incidents_overview` is the
BotApp endpoint identifier, not the name of the production RPC.

Overview and detail are separate versioned contracts. Overview remains
`incidents_overview_v2`. A selected incident is loaded by authenticated
`GET /api/instagram-dashboard/incidents/:incidentId` and returns
`incident_detail_v1`. The detail loader uses explicit columns and safe
references; a missing run, request, action, assignment, archived account or
partial delivery history renders as an unavailable field rather than making
the whole detail fail. Metadata goes through the incident redactor before it
crosses the route.

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
must be explicit and audited. `transition_account_incident_human_review_v1`
supports acknowledge, note, resolve, and retry of one failed notification.
`acknowledged` is the existing schema's investigating/accepted state; no new
`investigating` status is invented. Reopen is not supported by this lifecycle.
Every transition has an idempotency key, expected lifecycle version, actor,
source, timestamp, and review event. Resolution requires a reason and closes
active linked dashboard actions in the same database transaction. Historical
open incidents whose action is already resolved are visible under All, but are
not blockers; they require object-by-object evidence before incident closure.

### Resolution and configuration independence V3 (9 August 2026)

An unresolved incident is scoped to its own account and recovery lineage. It
must never block account configuration writes, another account, or an unrelated
feature. In particular, Schedule Save enforces real slot/device conflicts but
does not call the operational incident projection and does not require incident
resolution first.

`Resolve after verification` is the single canonical operator action for a
verified non-security incident. `transition_account_incident_human_review_v2`
atomically:

1. resolves the incident and its linked active dashboard action;
2. records the actor, expected Worker SHA, fixed-cause version and idempotency
   key;
3. restores `restart_allowed` on the matching recoverable resume plan;
4. creates at most one resume authorization when a scheduled assignment is
   currently active, or leaves it ready for the next natural scheduler
   reconciliation when the account is `manual_only`;
5. returns the next-tick eligibility result without creating a request, a run,
   or a tick.

Severity is presentation/impact metadata, not a security classification. A
`critical` incident can therefore be resolved through the canonical action.
Only an explicit security type (`security_*`) or
`metadata.security_incident=true` remains fail-closed and requires a separate
security procedure. This rule is generic: it contains no account allowlist or
incident-specific exception.

The production contract is implemented by migration
`20260809180222_incident_resolution_config_independence_v3.sql`. Effective RPC
access remains least-privilege: `service_role` only; `public`, `anon` and
`authenticated` have no execute privilege.

Acknowledgment and notes do not notify, avoiding review spam. A resolution
prepares one unique event-scoped delivery key per enabled/configured channel.
The database commits before provider delivery, so a Slack success and Discord
failure never undo the resolution. Each channel retains its own sent/failed,
attempt, timestamp and safe error state. Only the failed channel may be retried
explicitly, with a maximum of three attempts. A reload or idempotent action
cannot create or resend a duplicate delivery.

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

## Runbook: incident detail unavailable

1. Capture the requested incident UUID and `GET` path without copying relay
   credentials.
2. `404` with `x-matched-path: /404` means the dynamic detail route is absent
   from the deployed backend; it is not a parser failure.
3. `400` means the UUID failed strict validation; `401` means relay/admin auth
   is missing; `403` means the authenticated caller is not allowed; `404` with
   `INCIDENT_NOT_FOUND` means the object is absent.
4. `503 INCIDENT_DETAIL_STORAGE_MISSING` means the review migration was not
   applied; `500 INCIDENT_DETAIL_QUERY_FAILED` is a server-side query failure.
5. A successful response must declare `incident_detail_v1`. BotApp reports a
   distinct contract error for unsupported/malformed payloads.
6. Closing or switching the drawer cancels/invalidates the old request. Retry
   detail is read-only. Do not use an incident action to test availability.

## Operator resolution procedure

Load detail, verify current reason plus linked run/request and later evidence,
then add a note or acknowledge if investigation is still in progress. Resolve
only with an explicit proof-backed reason. The result is reread from the
backend. Slack and Discord are inspected separately; retry only a failed
channel. Never treat a provider delivery as proof that the incident itself is
resolved, and never close historical incidents in bulk.

### Equivalent incident generations and natural-tick eligibility

`Resolve after verification` uses
`transition_account_incident_human_review_v3`. After resolving the selected
non-security incident, it also resolves only stale occurrences for the same
account with the same `incident_type` and the same normalized causal reason.
Every bundled occurrence receives an append-only review event linked to the
canonical incident. An incident with another cause, another type, another
account, or any security marker remains independent and blocking.

When no independent operator-review blocker remains, the same atomic contract
restores `paused_manual_review` to `active`. It does not alter the schedule,
commercial lifecycle, package, phone assignment, or create a run/tick. The
account is therefore eligible for its next natural open-window tick without a
second reconciliation gesture.

A canonical BotApp manual stop is command-edge state: it terminates the active
request/run lineage but never becomes a persistent Auto Restart exclusion.
While the lineage is active, the ordinary active-run/request locks still
block. Once terminal, the existing provenance checks authorize only a fresh
safe-boundary continuation; security and unsafe-marker gates remain unchanged.

## Obsolete blocker procedure

Never issue an unscoped bulk closure. For each candidate, record
incident/action IDs, account, original reason, run/request, subsequent
successful evidence, current account state, and the exact resolution reason.
The generation-aware resolver may bundle only the exact account/type/cause
equivalence class described above. Re-check Profiles to confirm no independent
unresolved blocker remains.

## Golden addendum

This checkpoint changes Backend/Supabase/BotApp incident observability only.
Worker source, Worker release, active symlink, dispatcher, heartbeat, scheduler,
run control, Follow, Welcome DM, Unfollow, assignments, phones and Android are
outside scope and unchanged. The existing Golden checkpoint remains where it
was; this addendum is evidence, not a new Golden baseline.
