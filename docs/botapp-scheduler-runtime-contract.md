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

## Schedule-session cron gate order

1. Cron token + enabled flag
2. Active scheduled assignment window
3. **BotApp scheduler runtime healthy** (`schedulerConnected=true`)
4. Physical phone + fresh `device_heartbeats`
5. No active request/run / slot idempotency / phone busy
6. `evaluateRunStartEligibility(trigger=scheduler)`

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
