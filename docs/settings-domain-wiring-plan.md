# Settings Domain Wiring Plan

Date: 2026-05-30
Scope: Instagram dashboard settings UX and future domain API wiring.
Status: planning + frontend UX correction. No runtime wiring, no worker change, no `config.py` change, no migration, no env change.

## 1. Current Verdict

**NO-GO for Prod Run Defaults Freeze.**

The Runtime Settings Readiness Matrix shows a split-brain settings model: the dashboard still writes mostly to `ig_account_settings` and `ig_account_filters`, while the Python worker reads domain tables and config/env gates such as `ig_account_dm_settings`, `ig_account_unfollow_settings`, `ig_account_follow_settings`, `ig_targets`, `ig_interacted_users`, and worker config.

**GO for Settings UX restoration** because useful controls should remain visible while clearly marked as draft / needs routing until domain APIs are proven.

## 2. Corrected Product Rule

A visible control should be shown when it is:

1. **Active / routed** — proven runtime effect through a domain API or audited action route.
2. **Needs routing** — useful Phone Farm setting kept visible as dashboard draft until domain wiring is complete.
3. **Read-only** — safe projection or audit utility with no false edit promise.
4. **Ops-only hidden** — dangerous kill switches, device/debug internals, or controls that cannot be safely exposed.

**Do not hide** useful settings merely because runtime is not wired yet. Hide only when the control is truly unusable, dangerous without env gates, or deprecated with no routing path.

## 3. Settings UX Status (post-correction)

| Surface | Status | Notes |
|---|---|---|
| Account tools | Stats, Logs, **Run manually (disabled)**, Stop run, Settings, Filters, Targets, lifecycle | Play visible but disabled until run queue API exists. Stop remains routed. |
| Settings drawer tabs | General, Schedule, Actions, DM, Followback, Sources, Filters, Safety, Advanced | Full UX restored. |
| Draft save copy | Dashboard draft settings/filters | Save does not promise runtime effect. |
| Templates | Save/Apply admin utility | Templates replay dashboard draft settings only. |
| Targets modal | Active / routed for CT | Source of truth for CT targets. |
| Add Profile wizard | Active admin utility | Credential handoff write-only. |

## 4. Field Classification

### Keep Visible — Needs Routing (draft)

These remain editable as dashboard draft settings with clear `Needs routing` status:

| Group | Fields |
|---|---|
| Schedule/session | `timeslot_start`, `timeslot_end`, `total_sessions`, `stop_interactions_after_minutes`, `pause_account_days`, `pause_account_until`, `randomize_start_enabled` |
| Action quotas | `follow_limit`, `total_follows_limit`, `total_unfollows_limit`, `unfollow_delay_days`, `total_likes_limit`, `likes_per_follow_min`, `likes_per_follow_max` |
| DM | `welcome_dm_enabled`, `welcome_dm_message`, `cold_dm_enabled`, `cold_dm_message`, `max_dm_per_run`, `max_consecutive_dms`, `check_chat_before_welcoming`, `safe_review_mode` |
| Followback/unfollow | `followback_on_followers`, `max_followback_skips`, `max_followback_ignore`, `sort_followers_mode`, `unfollow_non_followers`, `unfollow_any`, `unfollow_skip_limit`, `mute_posts_after_follow`, `mute_stories_after_follow`, `do_follows_first` |
| Sources policy | `truncate_sources_min`, `truncate_sources_max`, `change_source_if_crash`, `skipped_posts_limit`, `fling_when_skipped` — CT targets stay in Targets panel |
| Filters | all `ig_account_filters` fields exposed in drawer |
| Safety/caps | interaction caps, max actions per hour/day, random delays, warmup, stop conditions, max repeated errors |
| General draft | `two_fa_enabled`, `campaign_name` |

### Keep Visible — Read-only

| Fields | Reason |
|---|---|
| Identity/status projections | `username`, `display_name`, `device_name`, `email_display`, `password_status`, `device_assignment`, `app_package_status`, `clone_assignment_status`, `account_status` |
| Advanced projections | `current_run_status`, `last_error`, `last_successful_action`, `manual_stop_requested` |
| Safety counter | `interactions_count` |

### Keep Hidden / Ops-only

| Group | Fields / controls |
|---|---|
| Real-action kill switches | `dry_run_enabled`, `send_enabled`, `follow_enabled`, `unfollow_enabled`, `like_enabled` |
| Device/debug internals | Device tab fields, raw device identifiers, clone package internals, update/play-store locks, debug/screen record, close apps, UIAutomator restart, relog/block handling |
| Risky pacing internals | `speed_multiplier`, `timeout_startup_seconds`, random pause/long break internals |
| Deprecated / no routing path | percentage knobs, story-watch timing, raw `source_accounts` as primary source truth |
| Destructive ops | `delete_interacted_users` (social memory deletion) |
| Run queue | Manual run action until audited queue API exists — Play button visible disabled |

## 5. Domain Wiring Plan

| Domain | Current UI fields | Legacy DB fields | Target domain table/API | Runtime consumer expected | Migration needed | Audit needed | Client-safe | BotApp-safe | Priority | Risks | Recommended patch sequence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Run / Session queue | Run manually (disabled) | none | audited run queue / session start API | dispatcher / scheduler / `ig_runs` | Likely yes | Yes | Admin-only | No | P0 | Double-run, device overlap | Add queue API with idempotence before enabling Play. |
| DM Templates / DM Settings | welcome/cold DM fields | `ig_account_settings.*` DM keys | `ig_account_dm_settings`, template approval API | `account_session_orchestrator`, `welcome_*`, `outreach_session_orchestrator`, `dm_sender_engine` | Maybe | Yes | Limited after proof | Read-only first | P0 | DM spam, content drift | Read API first, audited PATCH, real-send env-only. |
| Unfollow Settings | unfollow delay/mode/limit fields | legacy action/followback keys | `ig_account_unfollow_settings` API | `unfollow_settings`, `unfollow_session_orchestrator` | Maybe | Yes | Admin-only initially | Read-only first | P0 | Destructive unfollows | Map modes explicitly, env kill switch display. |
| Follow Settings | follow limits, mute/like-after-follow | legacy action keys | `ig_account_follow_settings`, follow policy API | runner/followers engine | Likely yes | Yes | Later | Read-only first | P1 | Follow spam | Start with private-profile policy, then caps. |
| Filters | all filter drawer fields | `ig_account_filters` | filter eligibility policy API | visual/profile eligibility engine | Likely yes | Yes | Later subset | Read-only first | P1 | Semantic conflicts | Reconcile private-profile toggles, prove worker reads. |
| Package / Caps / Entitlements | package labels, day/session caps | scattered legacy caps | entitlement/package policy API | effective cap resolver | Yes | Yes | Read-only | Read-only | P1 | Pricing/runtime divergence | Define packages, expose effective caps. |
| Session / Scheduling | schedule tab fields | legacy schedule keys | scheduler policy API + lifecycle pause API | dispatcher/scheduler | Yes | Yes | Limited later | Read-only first | P2 | Overlapping sessions | Split lifecycle pause from scheduler. |
| Ops / Kill Switches | hidden env/config gates | legacy hidden keys | ops-only panel or no UI | worker config/env | Maybe no | Yes | No | No | P0/P2 | Real actions, secret leakage | Keep hidden; document env authority. |

## 6. API Readiness Requirements

Every future domain API must include:

- Idempotent writes keyed by `account_id` and domain.
- `updated_at` or version checks to avoid silent overwrites by multiple admins/clients.
- Audit events with actor, field set, old/new redacted summaries, and reason.
- Partial-success reporting for multi-field or multi-account updates.
- Rollback strategy or explicit compensation for multi-step operations.
- Package entitlement enforcement at API boundary.
- Runtime hard cap enforcement as `effective = min(package, DB, env hard cap, day remaining)`.
- No duplicate jobs/actions when templates, CT, or DM queues are involved.
- Provider rate/backpressure handling for any provider-backed verification or account lookup.
- No silent divergence between admin UI, client UI, BotApp, and worker runtime.
- Anti double-submit on Play/Stop and other destructive admin actions.

## 7. Recommended Patch Sequence

1. **Settings UX restoration**: restore full drawer + Filters tool + disabled Play with honest draft copy.
2. **Run queue API design**: audited manual run/session enqueue before enabling Play.
3. **Domain read APIs**: expose read-only effective DM/unfollow/follow/filter/package/session projections.
4. **DM domain write API**: audited writes for safe fields; real-send remains env-only.
5. **Unfollow domain write API**: audited writes with destructive confirmations and env kill switch display.
6. **Follow/filter policy read proof**: prove worker consumption before client editing.
7. **Package/cap resolver**: centralize package caps and effective limits.
8. **Scheduler/lifecycle split**: separate account pause lifecycle from session scheduling and phone rest.
9. **BotApp/client projections**: expose read-only effective settings first, then selectively allow safe edits.

## 8. No-Leak Confirmation

This plan contains table names, field names, and architecture notes only. It does not include API keys, SearchApi keys, cron tokens, service role values, complete Authorization headers, cookies/sessions, passwords, full secret references, Vault UUIDs, provider responses, raw metadata, env secret values, or webhook URLs.
