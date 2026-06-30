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
