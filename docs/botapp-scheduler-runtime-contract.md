# BotApp scheduler runtime contract (TASK 19B)

## Phase-1 rule

Server-side `schedule-session` cron may evaluate assignment windows continuously, but it **must not enqueue** `account_session` run requests unless the **local BotApp scheduler runtime** on the operator Mac is healthy.

This phase intentionally couples scheduled growth runs to an open BotApp session on the phone-farm Mac.

## Runtime components

| Component | Where it runs | Heartbeat |
|-----------|---------------|-----------|
| BotApp scheduler runtime | Electron main while app is open | `worker_heartbeats.worker_id = botapp-scheduler-runtime:{host}` |
| Run-control dispatcher | launchd + `account_run_request_consumer.py` | `worker_heartbeats` dispatcher row |
| Device heartbeat publisher | launchd + `device_heartbeat_publisher.py` | `device_heartbeats` |
| Schedule-session cron | Vercel `*/5` | no enqueue without BotApp runtime gate |

## BotApp open lifecycle

1. Relay bootstrap succeeds.
2. Device heartbeat autostart (existing).
3. Dispatcher autostart (existing).
4. **Scheduler runtime start** publishes heartbeat every 30s while BotApp is open.
5. Each tick may call `ensureDispatcherAutostart` if dispatcher is degraded (no duplicate processes).

## BotApp voluntary close

On `before-quit`, BotApp publishes `status=stopping`, `voluntary_shutdown=true`, `scheduler_available=false`.

Server cron then returns `botapp_runtime_unavailable` and creates **zero** new scheduled run requests.

No infinite Auto Restart loop is attempted for a voluntary shutdown.

## Server APIs

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/instagram-dashboard/botapp/scheduler-runtime-health` | relay/admin | Publish BotApp scheduler heartbeat |
| `GET` | `/api/instagram-dashboard/botapp/scheduler-runtime-health` | relay/admin | Read projected runtime health |
| `GET/POST` | `/api/instagram-dashboard/schedule-session/cron` | cron token | Evaluate windows; enqueue only if runtime healthy |
| `GET` | `/api/instagram-dashboard/auto-restart/scheduler-status` | relay/admin | Read-only scheduler observability read-model (see below) |
| `PATCH` | `/api/instagram-dashboard/auto-restart/settings` | relay/admin | Canonical global scheduler ON/OFF (`auto_restart_enabled`) |

## Scheduler global ON/OFF + observability read-model

The scheduler engine is embedded in the dispatcher worker
(`account_run_request_consumer.py` → `auto_restart_dispatcher_tick.py` →
`POST /api/instagram-dashboard/auto-restart/tick`). The backend is the **only
selection authority**: caps, schedules, readiness, assignment, lifecycle and
`manual_only` (hard exclusion, `manual_only_requires_manual_trigger`).

Two independent axes, never to be conflated:

- **Engine status** (`running` / `degraded` / `unknown`): projection of the
  dispatcher `worker_heartbeats` row. The engine runs as long as the launchd
  service runs, regardless of the switch.
- **Backend mode** (`enabled` / `disabled_by_config`): the canonical flag
  `auto_restart_settings.auto_restart_enabled` (row `id='global'`).

Switch semantics (global operator/admin setting, never per tenant/account):

- **OFF**: the next canonical tick skips selection (`scheduler_disabled`,
  gate `schedulerTickGate` in `lib/instagram-dashboard/auto-restart-tick-helpers.ts`).
  No new scheduled `account_run_request` is created. **Active runs are never
  interrupted** — the tick never touches `ig_runs`.
- **ON**: the next canonical tick may select genuinely eligible accounts.
  Flipping the flag never creates a run by itself.
- Mutations go only through the existing `PATCH /auto-restart/settings`
  (relay/admin auth, audited as `auto_restart_settings_updated` in
  `auto_restart_decisions`). No endpoint calls a worker directly.

`GET /auto-restart/scheduler-status` (`lib/instagram-dashboard/scheduler-status.ts`)
is a **read-model derived from canonical facts only** — it never decides
eligibility, never creates runs, and is never a second source of truth:

- `auto_restart_settings` → `backend_mode`, `tick_interval_seconds`;
- `auto_restart_tick_locks` → `last_tick_at`, `last_success_at`, `last_error`
  (real ticks only; disabled ticks persist nothing, so a stale `last_tick_at`
  with backend OFF is expected);
  - **Failed tick finalization**: business outcomes (`scheduler_disabled`,
    no candidates, exclusions such as `manual_only`, per-candidate enqueue
    errors absorbed as `blocked` decisions) always finalize the lock as
    `completed`. Only an unexpected engine/backend exception finalizes the
    lock as `failed` (`failTickLock` in `auto-restart-tick.ts`), persisting a
    redacted stable reason (`sanitizeTickFailureReason`, secrets/URLs/tokens
    masked, bounded length) in `metadata_safe.failure_reason`. The lock is
    always finalized so the next tick bucket stays runnable, and
    `scheduler-status` exposes this real reason as `last_error.reason`
    (fallback `tick_failed` for legacy rows).
- `auto_restart_decisions` (24h window) → `examined_count`, `enqueued_count`,
  `blocked_count`, `recent_decisions` (canonical reasons, account only when it
  really exists);
- dispatcher heartbeat projection → `engine_status`.

No estimated `next_tick` is ever invented. BotApp consumes this contract in
its `Scheduler` view (observability + switch); it performs no local
eligibility computation and never calls the tick endpoint to refresh.

## CP0 — Single toggle for every automatic start

`auto_restart_settings.auto_restart_enabled` is the **only** business
authorization for automatic `account_run_request` creation, for both
automatic sources:

- `instagram_schedule_session_cron` (daily cold starts within a Schedule window);
- `auto_restart_tick` (resume-plan restarts).

Contract: `lib/instagram-dashboard/scheduler-authorization.ts`
(`automaticRunCreationAllowed`, `loadSchedulerAutomaticRunAuthorization`,
fail-closed on missing settings). `schedulerTickGate` and
`runScheduleSessionCron` both delegate to it.

Atomic enforcement: migration
`20260710160000_cp0_scheduler_toggle_gates_automatic_run_requests.sql` — the
`create_account_run_request` RPC locks the settings row `FOR SHARE` and raises
`scheduler_disabled` for automatic source surfaces when the toggle is OFF, so
a concurrent toggle OFF can never race an automatic insert.

Not gated by the toggle (own guards + future device leases apply): manual
Play/Start/Stop, explicit Auto Login, `login_provisioning`,
`login_email_code_resume`, assisted provisioning surfaces.

Cron observable states (`state` in the cron result):

| State | Meaning |
|-------|---------|
| `technical_disabled` | `INSTAGRAM_SCHEDULE_SESSION_CRON_ENABLED=false` |
| `dry_run` | technical dry-run on: scan only, zero enqueue |
| `scheduler_disabled` | cron healthy, not dry-run, toggle OFF: zero automatic request |
| `active` | cron healthy, toggle ON, canonical gates apply |

Production target after CP0: `INSTAGRAM_SCHEDULE_SESSION_CRON_ENABLED=true`,
`INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN=false` — the BotApp Scheduler toggle
is then the only switch left to govern automatic starts.

## Schedule-session cron gate order

1. Cron token + technical enabled flag (`technical_disabled`)
2. **Canonical Scheduler toggle ON** (`scheduler_disabled` otherwise; CP0)
3. Active scheduled assignment window
4. **BotApp scheduler runtime healthy** (`schedulerConnected=true`)
5. Physical phone + fresh `device_heartbeats`
6. No active request/run / slot idempotency / phone busy
7. `evaluateRunStartEligibility(trigger=scheduler)`
8. Atomic RPC guard at insert (`scheduler_disabled` counted as
   `skipped_scheduler_disabled_count`, never fatal)

## CP1 — Stable reasons and Scheduler observability

Canonical nomenclature: `lib/instagram-dashboard/scheduler-reasons.ts`.
Normalization happens at **projection time only** (scheduler-status read-model
and BotApp view); persisted decisions are never rewritten.

Contract:

- every projected decision carries a stable `reason_code` plus a
  `reason_kind` (`business` | `technical` | `config` | `unavailable`);
- technical errors (`enqueue_failed`, `unexpected_tick_error`, `tick_failed`,
  …) stay distinct from business blocks (`phone_busy`, `active_run_exists`,
  `assignment_window_closed`, …);
- legacy/emitter-specific values converge through aliases
  (`already_running` → `active_run_exists`, `skipped_phone_busy` →
  `phone_busy`, `worker_plan:*` → `resume_plan_missing` / `no_recent_run` /
  `restart_not_allowed`, …) while the raw redacted reason is preserved for
  tooltips and forensics;
- `unknown` is **gone as an invented value**: a run without any resume-plan
  verdict now projects the real state `resume_plan_missing`
  (`auto-restart-data.ts` fallback fixed); when no canonical data allows a
  conclusion the projection says `reason_unavailable` and BotApp displays
  “reason unavailable” — nothing is ever invented;
- global ON/OFF settings events (`auto_restart_settings_updated`,
  `account_id=null`) are typed `event="scheduler_config"` with
  `config_enabled`; BotApp renders them as “Scheduler configuration — ON/OFF”,
  never as an “unknown account”;
- the scheduler-status read-model exposes a `daily_engine` block
  (`technical_enabled`, `dry_run`, `state`) so BotApp distinguishes the daily
  engine (schedule-session cron), the Auto Restart engine (dispatcher tick)
  and the global toggle.

Forensic reference (2026-07-06, `i_m_your_traker`, decision 14:21:29Z):
the tick evaluated the account while Scheduler was ON, every gate passed
except the resume-plan check — the last run (June 8) predates the resume-plan
contract, so the worker never produced a restart verdict. The candidate
projection fell back to the literal `"unknown"`, which the view displayed
as-is. Canonical classification: `resume_plan_missing` (blocked, business),
not a technical error, not `botapp_runtime_unavailable`, not `phone_busy`.

## CP2 — Daily recurrence, derived windows and 48h projection

Product decision: a `schedule_mode=scheduled` account repeats its Schedule
slot **every day**; `manual_only` is a hard exclusion (never materialized,
never selected automatically).

Single source of truth (unchanged): the existing Schedule — the single open
`account_assignments` row per account (unique index
`one_open_assignment_per_account`), whose dated `starts_at`/`ends_at` encode
the durable local slot (e.g. 06:00–12:00 Africa/Johannesburg) in the device
timezone. No new table, no new cron, no second source of truth.

Derivation module: `lib/instagram-dashboard/schedule-recurrence.ts`:

- `extractDailySlot` recovers the local slot from the stored dated window
  (timezone + DST safe via `zonedLocalDateTimeToUtc`, cross-midnight slots
  supported; a window that cannot express a daily slot is rejected — nothing
  is invented);
- `deriveCurrentDailyWindow` returns the current-or-next dated occurrence
  (deterministic: concurrent callers derive the same window);
- `projectDailyWindows` lists occurrences over the 48h horizon.

Materialization (roll-forward) inside `schedule-session-cron` (canonical
source, gate order updated):

1. Cron token + technical enabled flag (`technical_disabled`)
2. **CP2 roll-forward**: expired `scheduled` windows are re-derived in place
   (same row → duplicates structurally impossible; optimistic guard on the
   previous `ends_at` → concurrent crons update 0 rows). Skipped in dry-run.
   Runs even while the Scheduler toggle is OFF because it is a state
   derivation, never a run creation — automatic runs stay governed by the
   toggle + atomic RPC guard. Counters: `rolled_forward_count`,
   `roll_forward_failed_count` (explicit, never silent).
3. Canonical Scheduler toggle ON (`scheduler_disabled` otherwise; CP0)
4. …existing gates unchanged (window, runtime, phone, idempotency,
   eligibility, atomic RPC guard).

Observability: the scheduler-status read-model exposes
`upcoming_windows` (+ `windows_horizon_hours: 48`) — per derived occurrence:
account, device, dated UTC bounds, timezone, `local_slot`, `is_open`,
`materialized`, `stored_window_expired`. BotApp renders the "Upcoming
windows (48h)" card with honest states (`open now`, `planned`,
`awaiting roll-forward`) — no false "growth waiting", no silent expired
window, manual-only accounts never listed.

## Future Admin Dashboard relay contract (not implemented in 19B)

Admin Dashboard remains **read-mostly** and must never spawn local processes from the browser.

### Desired command model

| Dashboard state | Meaning |
|-----------------|---------|
| `requested` | Operator asked for scheduler runtime on a host |
| `awaiting_botapp` | Backend recorded request; BotApp not yet heartbeating |
| `active` | BotApp runtime heartbeat fresh |
| `unavailable` | BotApp closed voluntarily or relay down |
| `stale` | Heartbeat older than 90s |
| `error` | Redacted failure reason |

### Future endpoints (planned)

| Method | Path | Role |
|--------|------|------|
| `POST` | `/api/instagram-dashboard/botapp/runtime-desired-state` | Admin writes desired scheduler state for a host |
| `GET` | `/api/instagram-dashboard/botapp/runtime-desired-state` | Admin reads desired vs observed |
| `POST` | `/api/instagram-dashboard/botapp/runtime-ack` | BotApp relay acknowledges desired state |

BotApp local process remains the only place allowed to start/maintain dispatcher + scheduler runtime.

## Stale thresholds

| Signal | Threshold |
|--------|-----------|
| BotApp scheduler runtime | 90s (3 missed 30s heartbeats) |
| Device assignment heartbeat | 15 min (existing) |
| Dispatcher heartbeat | 60s (existing) |

## Run request metadata (scheduled)

```json
{
  "source": "schedule_session_cron",
  "trigger": "scheduler",
  "assignment_id": "...",
  "scheduled_session_at": "...",
  "scheduled_session_ends_at": "...",
  "device_timezone": "Africa/Johannesburg"
}
```

Manual Play remains `trigger=manual` and is never written by this cron.

## Test onboarding rollback capacity contract

The Test onboarding rollback refuses any active request, run, device lock, Auto
Login, live view, processing job, or device heartbeat occupancy. It then calls
`release_account_schedule_capacity` for the exact account. The normal assignment
trigger terminalizes the assignment and releases only its exact
`phone_app_instances` occupant. `rolled_back_test_onboarding` is excluded from
BotApp active profiles and has no open assignment, so scheduler/readiness cannot
select it. No Worker or BotApp release is required for this DB/frontend contract.
